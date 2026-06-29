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
| Object labels + type | `buildLabelsQuery(uris)` (VALUES + OPTIONAL label + `?s a ?t`) |
| Embedded triples | `buildEmbeddedTriplesQuery(uris, strategy)` (batch; caller folds `(p,o)`) |

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
  a sample `rdf:type` per object, shown as a trailing context badge
  (`Title [Project]`). The object's own identity (label, else qname) is always
  the primary text so repeated unlabeled objects stay distinct (a generic type
  like `Concept` ×N as the value would be useless). Objects within a predicate
  are sorted by display text.
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
- **Authoring:** a per-type **gear** in `TypeList` sets both — gated behind
  **Config authoring mode** (`settings.editMode`, off by default, hidden in
  config mode), so end users get a clean read-only view. `hide`/`pin` are
  consumed there (filter + sort, with a "show N hidden" toggle). Configured
  types show inline indicator icons (pinned / embed / label) regardless of edit
  mode. The configured *effects* (embed/hide/pin) always apply; only the gear +
  export are gated.
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
