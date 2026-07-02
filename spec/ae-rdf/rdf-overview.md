# AE RDF

Browser-based, live RDF data browser.

## Overview

AE RDF connects directly to a SPARQL endpoint over HTTP and lets you browse its
data live: see what types exist, drill into a type's instances, open any
resource, and walk its links. Everything is an on-demand SPARQL query — there
are no precomputed analysis artifacts and no backend server.

> **Live tool vs. parked profiler.** This spec describes the shipped live
> browser. The sibling specs `rdf00-EndpointAnalysis`, `rdf01-QueryLibrary`
> (capability gating) and `rdf02-OwlGeneration` describe a **parked** offline
> endpoint-profiler + OWL/SHACL generator (now at top-level `endpoint-profiler/`,
> outside the workspace). They are **not** part of this tool — harvest from them
> when AE OWL / AE SHACL start. See `/CLAUDE.md` and `ae-rdf/PLAN.md`.
>
> The **config JSON format** (`app.json` + per-endpoint files, `TypeConfig`,
> profiling cache) is specified separately in
> [`rdf03-ConfigFormat`](./rdf03-ConfigFormat.md).

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Browser                     │
│  ┌─────────────────────────────────────┐    │
│  │            AE RDF App               │    │
│  │  ┌──────────┐  ┌──────────────────┐ │    │
│  │  │ Endpoint │  │   RDF Browser    │ │    │
│  │  │ Manager  │  │ Types→Instances→ │ │    │
│  │  │          │  │   Resource       │ │    │
│  │  └────┬─────┘  └────────┬─────────┘ │    │
│  │       └────────┬────────┘           │    │
│  │                ▼                    │    │
│  │      SPARQL Service + rdfQueries    │    │
│  └────────────────┬────────────────────┘    │
└───────────────────┼─────────────────────────┘
                    │ HTTP (Fetch API)
                    ▼
           ┌────────────────┐
           │ SPARQL Endpoint │
           │ (CORS enabled)  │
           └────────────────┘
```

Almost all plumbing (endpoint store, SPARQL service, error types, prefix
resolution, EndpointManager) is lifted from AE SKOS — it is SKOS-agnostic and
copied (trimmed) into `ae-rdf`. Only the RDF-browsing UI is built fresh. See
`ae-rdf/PLAN.md` for the reuse table and copy-vs-extract decision.

## Common specs

| Spec | Description |
|------|-------------|
| [com01-EndpointManager](../common/com01-EndpointManager.md) | SPARQL endpoint connection and management (shared `ae-endpoints` storage) |
| [com02-StateManagement](../common/com02-StateManagement.md) | Stores, events (`endpoint:changed`), `requestId` race-guard |
| [com03-ErrorHandling](../common/com03-ErrorHandling.md) | Errors, delayed loading, empty states |
| [com04-URLRouting](../common/com04-URLRouting.md) | Deep linking (`?type`, `?resource`) |
| [com05-SPARQLPatterns](../common/com05-SPARQLPatterns.md) | Query execution, JSON/XML negotiation, auth |

## Components

| Component | File | Description |
|-----------|------|-------------|
| EndpointManager | `components/common/EndpointManager.vue` | Compact add/edit/test/select/remove — no analysis wizard (live-query tool) |
| TypeList | `components/rdf/TypeList.vue` | Sidebar: every `rdf:type` with a distinct-instance count; select → `?type` |
| InstanceList | `components/rdf/InstanceList.vue` | Paged instances of the selected type; click → `?resource` |
| ResourceView | `components/rdf/ResourceView.vue` | Label, URI, type chips, graph summary; properties split into Attributes / Relationships |
| PropertyTable | `components/rdf/PropertyTable.vue` | Predicate/object rows; humanized predicates; object labels; clickable URIs; lang/datatype/graph tags |
| RdfView | `views/RdfView.vue` | Layout: type sidebar + URI bar + main pane (resource › instances › hint) |

Composables (each owns one query + a `requestId` race-guard + delayed loading):
`useRdfTypes`, `useInstanceList`, `useResourceView`, `useGraphMode`.

## Graph model (core)

A triple `(s,p,o)` can assert in several named graphs at once, and we must always
*know* its full set of graphs. How the endpoint stores data is captured per
endpoint on **two orthogonal axes** (`EndpointGraph`, each field unset = unknown):

- **`quads`** — does it expose named graphs (quad store)?
- **`defaultView`** — is the explicit (default, no-`GRAPH`) view the endpoint's
  **own** distinct triples, or just a **merged** view of the quads?

`resolveGraphStrategy(graph)` → `{ useNamed, useDefault }`:

```
useNamed   = quads !== false                          // query named graphs unless we KNOW there are none
useDefault = quads === false || defaultView !== 'merged'   // merged ⇒ the default view is redundant/bag-y ⇒ never query it
```

| quads | defaultView | useNamed | useDefault | meaning |
|-------|-------------|----------|------------|---------|
| false | — | false | true | triple store: plain queries |
| true | merged | true | false | quad store, default = merged quads → **`GRAPH ?g` only** |
| true | own | true | true | quad store with own default triples → `GRAPH ?g` ∪ default |
| unknown | — | true | true | safe superset (folding `(p,o)` dedups any merge) |

Every builder takes this strategy. Cross-graph duplicates are removed by folding
`(p,o)` client-side (resource + embed) or `COUNT(DISTINCT ?s)` / `GROUP BY ?s`
(aggregates) — **never** ad-hoc `SELECT DISTINCT`. This is why a merged endpoint
no longer doubles values: we don't query its bag-y default view, and we fold.

**Resolution / authoring:** `quads` is resolved config → SKOS analysis
(`supportsNamedGraphs`, shared `ae-endpoints`) → one `detectGraphs` ASK probe.
`defaultView` is **config-declared** (the deployer knows their endpoint;
auto-detecting merged-vs-own is the parked profiler's job) — unset behaves as the
safe superset. Both axes live on the endpoint config (authored via an endpoint
gear, exported to `app.json`).

**Chrome:** per-triple graphs hidden by default with a "Show graphs" toggle; a
triple in >1 graph is always badged; hover always reveals the graph(s); the
subject header shows the union. Graph *filtering* UI stays out of scope.

## Query library

All in `services/rdfQueries.ts`; every builder takes a `GraphStrategy`. Subject
IRIs pass `sanitizeIri` (SPARQL-injection guard). Counts always
`COUNT(DISTINCT ?s)`.

| Query | Builder |
|-------|---------|
| Type inventory | `buildTypeInventoryQuery(strategy)` |
| Instance count | `buildInstanceCountQuery(type, strategy)` |
| Instance page | `buildInstanceListQuery(type, strategy, limit, offset)` (GROUP BY ?s + SAMPLE) |
| Resource triples | `buildResourceTriplesQuery(uri, strategy)` |
| Object labels + most-specific type | `buildLabelsQuery(uris)` (label + the leaf `rdf:type` via `FILTER NOT EXISTS {?more rdfs:subClassOf+ ?t}`) |
| Embedded triples | `buildEmbeddedTriplesQuery(uris, strategy)` (batch; caller folds `(p,o)`) |
| Subclass hierarchy | `buildSubclassQuery(types, strategy)` (`rdfs:subClassOf` among listed types) |
| Embed composition | `buildCompositionQuery(embedTypes, strategy)` (class → embed-type edges, count scoped to the class) |
| Path-scoped embed count | `buildPathCountQuery(chain, strategy)` (count along `[class, …embedTypes]`; on demand) |
| Incoming count / list | `buildIncomingCountQuery(uri, strategy)` / `buildIncomingQuery(uri, strategy, limit)` (`?s ?p <uri>`, graph-aware, capped) |

Labels have no single predicate in general RDF; they are derived client-side by
precedence: `rdfs:label`, `skos:prefLabel`, `dct:title`, `dc:title`, `foaf:name`,
`schema:name` (`LABEL_PREDICATES`).

## Resource readability

The resource view is built for scanning, not raw dumps (`utils/format.ts` holds
the pure helpers, unit-tested):

- **Humanized predicates:** `dateEndApplicability` → "Date end applicability"
  (`humanizeLocalName`); the qname/URI stays on hover.
- **Sections:** properties split into **Attributes** (literal-valued) and
  **Relationships** (link-valued), each ordered by priority — labels →
  identifiers → dates → status → rest, then alphabetical.
- **Type chips:** `rdf:type` is lifted out of the table into header chips;
  clicking one browses that type's instances.
- **Object labels (Phase 2):** object IRIs are batch-resolved to human labels
  (`MENV` → its `rdfs:label`), fetched in parallel with prefix resolution;
  fall back to the qname when an IRI has no label.
- **Object type badges:** the same batch query (`buildLabelsQuery`) also returns
  the **most specific** `rdf:type` per object (the leaf — one with no more-specific
  asserted type), shown as a trailing context badge (`Title [JournalPaper]`, not
  the generic `[Result]`). The object's own identity (label, else qname) is always
  the primary text so repeated unlabeled objects stay distinct (a generic type
  like `Concept` ×N as the value would be useless). Objects within a predicate
  are sorted by display text.
- **Capped object lists:** a predicate with many objects renders the first 100
  with a "100 of N" line + **Show all / Show fewer** toggle (`PropertyTable`), so
  a hub node (thousands of links) doesn't run forever.
- **Inverse relations ("Referenced by"):** a collapsible section shows who points
  *at* the resource (`?s ?p <uri>`), so you can walk backwards. Loaded **lazily on
  expand** (`useIncomingRelations`) — incoming is unbounded on hub nodes — fetching
  a distinct-subject count + a `LIMIT`-capped list in parallel, grouped by
  predicate (inbound ↤ marker), subjects resolved to labels + most-specific types,
  graph-aware. Shown even when the resource has no outgoing triples.
- **URI-display setting** (`settings.uriDisplay`, localStorage): `humanized`
  (default, friendly) / `prefixed` (`prefix:local` qnames) / `full` (raw IRIs).
  Centralized in `utils/format.ts` (`displayPredicate` / `displayObject` /
  `displayType`); consumed by PropertyTable, ResourceView, TypeList.
- **Fast tooltips:** resource-view hovers use the PrimeVue `v-tooltip` directive
  (short delay), not native `title` (whose ~1s delay felt slow).

## Per-type config (live authoring)

Types differ in how they should display: first-class entities (`Project`,
`Organisation`) are navigation targets; **value objects** (`MonetaryAmount`,
coordinates) are meaningless to navigate to — you want them inline. So each type
carries a config, authored live and (eventually) exported to `app.json`.

- **`TypeConfig`** (`types/endpoint.ts`): `sidebar: show | hide | pin`,
  `render: link | embed | label`, and an optional `group` label (collects the
  type under a collapsible sidebar group header, e.g. "Ontology"; a grouped type
  is promoted to a root within its group, leaving any subclass nesting). Stored **per-endpoint** on
  `SPARQLEndpoint.types` (config travels with the endpoint that owns it, not the
  app — easier to maintain across deployments). `stores/typeConfig.ts` is a thin
  get/set facade over `endpointStore.current.types`; edits persist with the
  endpoint (`ae-endpoints`).
- **Authoring:** a per-type **gear** in `TypeList` sets all of these — gated
  behind **Config authoring mode** (`settings.editMode`, off by default), so end
  users get a clean read-only view. The gear + **Export app.json** stay available
  even in config mode, so a deployer can load a deployed config, tweak, and
  re-export. The configured *effects* (embed/hide/pin/group) always apply; only
  the gear is gated. `pin` floats to the top; `hide` moves the type into the
  collapsible **Hidden** system group.
- **Embed (recursive):** when an object's type is `render:embed`, `useResourceView`
  batch-fetches those objects' triples (`buildEmbeddedTriplesQuery`, graph-aware)
  and follows embed-typed objects within them (BFS, depth-capped at 5 with a
  `seen` cycle guard) so chains like `Organisation → Site → PostalAddress` inline
  fully; `PropertyTable` renders them inline recursively (passing `embedded` +
  `objectTypes` down), with each type as a badge. The inline triples are **also graph-aware**:
  each `(p,o)` is folded into a `graphs[]` set (provenance kept, not discarded —
  a value in >1 graph is badged), and the resource's "Show graphs" toggle reaches
  the embed. `rdf:type` is dropped from the inline view (it's the badge).
  `label` renders identity-only; `link` (default) is the clickable chip.
- **Composed labels (multi-hop):** `label` lists the predicates whose values
  compose a type's display label (joined ` · `). A URI-valued field resolves to
  the referent's own (possibly composed) label; `useResourceView` walks that
  label graph up to 3 hops (`GrantPayment → hasRecipient → OrganisationRole →
  isRoleOf → Organisation`), fetching labels for referents reached only via label
  fields so a **linked** (non-embedded) object doesn't collapse to its literal
  parts. `foldAfter` folds an embed's rows after a predicate; `groupByType` lists
  predicates whose object lists render **grouped by object type** (subheading +
  count) — for long mixed-type relations like `Project → hasResult`. Full field
  reference: [`rdf03-ConfigFormat`](./rdf03-ConfigFormat.md).
- **Long object lists:** a relation with >100 objects starts collapsed to a count
  (`N values → Show first 100`) and never renders >100 rows (the tail is walked
  by opening an object); the "Referenced by" (inverse) section shows its count
  upfront via a cheap `COUNT` and loads the list on expand.
- **Prefixes:** `AppConfig.prefixes` (prefix→namespace) is seeded into the prefix
  service at boot (`setConfigPrefixes`, highest precedence over the built-in
  common set and prefix.cc), so custom-vocab qnames render correctly and offline.
  The export caches declared + prefix.cc-resolved prefixes (`getKnownPrefixes`); a
  read-only **Prefixes** legend in the header lists the active mappings
  (`getDisplayPrefixes`).
- **Lifecycle:** author live → **Export app.json** (Settings → Deployment;
  `utils/configExport.ts:buildAppConfig` serializes each endpoint with its own
  `graph` axes, `types`, and cached **`typeInventory`** (uri+count), plus an
  app-level **`prefixes`** map (prefixes are shared, not per-endpoint), then
  `downloadJson`) → deploy as `config/app.json` → config mode (locked) for end
  users. Credentials are never written into the export (auth `type` only). In
  config mode each endpoint's cached `typeInventory` seeds the Types sidebar
  **with no discovery query** (`useRdfTypes` paints instantly; prefixes resolve
  in the background). Re-export to refresh the snapshot.

## Types sidebar (tree)

`TypeList` renders the inventory as one flat, ordered row list (`rows`) built
from several overlaid structures; rows are keyed by position (the same embed
type can appear under several parents, so identity keys would collide).

- **Subclass nesting:** `buildSubclassQuery` discovers `rdfs:subClassOf` edges
  among listed types; a more-specific kind tucks under its general type
  (`Result → ProjectPublication → JournalPaper`), indented and collapsible. Only
  asserted edges nest — if the data carries no `subClassOf`, the list stays flat.
  Roots = types with no listed superclass; pinned float to a top section.
- **Embed nesting:** `buildCompositionQuery` finds which classes compose which
  `render:embed` types (a class instance has a property pointing to an instance
  of that type), with a count **scoped to the class**. Embeds nest under their
  composing class (recursively — `Site → PostalAddress`). A **direct** embed
  child's count is class-scoped; a **deeper** one's isn't, so it's hidden until
  hovered, when `buildPathCountQuery` resolves the true path-scoped count
  (`[class, …embed chain]`), cached per chain.
- **Groups:** a type's optional `group` collects it under a collapsible header
  (promoted to a root within its group). Two auto **system groups** sit at the
  bottom, collapsed by default: **Embedded** (every embed type, also shown nested
  for consistency) and **Hidden** (every `hide` type). User groups render between
  the ungrouped roots and the system groups.
- **Navigation:** class rows and embed rows are both clickable → that type's
  instance list (being `render:embed` only governs object rendering, not
  browsability). Indent lives on the row, so a subclass's collapse chevron shifts
  right with depth; depth is capped (~3 levels) for the narrow panel.

## UI layout

```
┌──────────────────────────────────────────────────────────────┐
│ AE RDF   [Endpoint ▼]                    [?] [☾] [⚙]          │
├───────────────────┬──────────────────────────────────────────┤
│  TYPES            │  [ Enter a resource URI…          ] [Go]  │
│                   ├──────────────────────────────────────────┤
│  Result    696k   │  <resource label>                        │
│  Act       149k   │  http://…/resource          [copy]       │
│  Concept   207k   │  ⬡ graph: …/eurio          [Show graphs] │
│  …                │  ─────────────────────────────────────   │
│                   │  rdfs:label    "end date"                │
│  (or: instance    │  rdfs:range    xsd:date                  │
│   list when a     │  …                                       │
│   type is picked) │                                          │
└───────────────────┴──────────────────────────────────────────┘
```

Main-pane precedence: **resource** (`?resource`) › **instance list** (`?type`) ›
connect hint. Selecting a type clears `?resource`; clicking an instance or an
object URI sets `?resource`. Both live in the URL for deep-linking and
back/forward.

## Technology

- **Frontend:** Vue 3 + Composition API, TypeScript (strict), Pinia, PrimeVue, Vite
- **Storage:** `ae-endpoints` (shared across AE tools), `ae-rdf-settings`, `ae-preferred-language`
- **Connection:** direct SPARQL via Fetch API (requires a CORS-enabled endpoint)
- **Testing:** Vitest; pure query builders covered in `services/__tests__/rdfQueries.test.ts`

## Status

Live browser shipped (connect → types → instances → resource, graph-aware).
Optional next: raw SPARQL panel; incoming-triple view; per-instance graph badges.
