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

## Graph awareness (core)

For every triple we display we must always **know its full set of graphs** — a
triple `(s,p,o)` can assert in several named graphs at once. Awareness lives in
the data model; *displaying* it is a separate, quiet choice.

- **Resource query** is the safe superset: `GRAPH ?g { … }` UNION the
  default-graph triples (`FILTER NOT EXISTS` guards against union-default
  double-counting). The same `(p,o)` returns once per graph → folded into a
  `graphs: string[]` set (empty = default graph).
- **Chrome:** per-triple graphs are hidden by default with a "Show graphs"
  toggle; a triple in **>1 graph is always badged**; hover always reveals the
  graph(s); the subject header shows the union of graphs.
- **graphMode** (`'named' | 'none'`) gates the discovery/list query shape. It is
  reused from `endpoint.analysis.supportsNamedGraphs` (shared with AE SKOS via
  the `ae-endpoints` key) when present, else one `detectGraphs` ASK per connect.
- **Out of scope (parked):** detecting default-graph *semantics* (union vs
  separate) and a graph *filtering* UI.

## Query library

All in `services/rdfQueries.ts`. Subject IRIs pass `sanitizeIri` (SPARQL-injection
guard). Counts always use `COUNT(DISTINCT ?s)` (a subject is typed once per
graph, so a non-distinct count is inflated by graph multiplicity). Discovery/list
queries are graphMode-gated (Option A: on `named` endpoints scoped to
`GRAPH ?g { ?s a <T> }`, not unioned with the default graph — responsiveness over
the rare separate-default completeness gap).

| Query | Builder |
|-------|---------|
| Type inventory | `buildTypeInventoryQuery(graphMode)` |
| Instance count | `buildInstanceCountQuery(type, graphMode)` |
| Instance page | `buildInstanceListQuery(type, graphMode, limit, offset)` (GROUP BY ?s + SAMPLE) |
| Resource triples | `buildResourceTriplesQuery(uri, graphMode)` |
| Object labels | `buildLabelsQuery(uris)` (batch; VALUES + UNION over LABEL_PREDICATES) |

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
  a sample `rdf:type` per object, shown as a trailing badge (`Title [Project]`);
  a label-less object renders its type as the value itself (`[Beneficiary]`
  instead of a UUID).
- **URI-display setting** (`settings.uriDisplay`, localStorage): `humanized`
  (default, friendly) / `prefixed` (`prefix:local` qnames) / `full` (raw IRIs).
  Centralized in `utils/format.ts` (`displayPredicate` / `displayObject` /
  `displayType`); consumed by PropertyTable, ResourceView, TypeList.
- **Fast tooltips:** resource-view hovers use the PrimeVue `v-tooltip` directive
  (short delay), not native `title` (whose ~1s delay felt slow).

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
