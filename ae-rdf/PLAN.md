# AE RDF — Build Plan

## Context

AE RDF is a **barebones, browser-only RDF data browser**: connect to a SPARQL
endpoint over HTTP and browse its data live. It mirrors AE SKOS's architecture
(Vue 3 + Pinia + PrimeVue, direct fetch to the endpoint, no backend).

This plan deliberately follows a scope correction. An earlier effort grew an
offline endpoint-mining + OWL/SHACL pipeline before any UI existed; that work
is now parked at top-level `endpoint-profiler/` and is **not** a dependency of
this tool. See `/CLAUDE.md` and `endpoint-profiler/`.

**Goal:** the smallest live browser that is genuinely useful — connect, see what
types exist, click into any resource and walk its links.

**Non-goals (explicitly deferred):**
- No precomputed analysis artifacts; everything is live, on-demand queries.
- No capability-gating / optimistic-vs-safe machinery (that is the parked
  pipeline). v1 issues straightforward queries; add a fallback only if a real
  endpoint forces it.
- No OWL/SHACL/inheritance generation (belongs to AE OWL / AE SHACL).
- No search box, no caching, no named-graph selection UI, no incoming-triple
  view in v1 (union/default graph only).

## Current state

- `src/main.ts` already wires Pinia + PrimeVue (Aura) + `@ae/styles`. ✅
- `src/App.vue` is a 74-line placeholder header. Replace.
- No router, stores, services, or components yet. No `vue-router` dep.
- `src/data/endpoints.json` = `{ "endpoints": [] }`.

## Reuse strategy (the core principle)

Almost all plumbing already exists in AE SKOS and is SKOS-agnostic. **Copy the
generic pieces into `ae-rdf`, stripping SKOS-specific code.** Build only the
RDF-browsing UI fresh.

> **Decision — copy vs. extract a shared package.** The right long-term home for
> the shared primitives (endpoint store, SPARQL service, error types,
> EndpointManager) is a `packages/core` (`@ae/core`) package, per the project's
> own "share when 2+ apps use it" rule. But extracting now means refactoring
> stable AE SKOS too — real risk for a barebones tool. **Recommendation:**
> copy-first into `ae-rdf` (trimmed), and extract to `@ae/core` when the 3rd
> consumer (AE OWL) starts or when a fix first has to be applied in two places.
> Mark copied files with a `ponytail:` note pointing here.

### Lift mostly as-is (generic — strip SKOS bits where noted)

| From `ae-skos/src/...` | Into `ae-rdf/src/...` | Notes |
|---|---|---|
| `types/endpoint.ts` | `types/endpoint.ts` | Keep `SPARQLEndpoint`, `EndpointStatus`. Drop/optional the SKOS-heavy `analysis?: EndpointAnalysis` + `languagePriorities`. |
| `types/errors.ts` | `types/errors.ts` | `AppError`, `ErrorCode` — as-is. |
| `services/sparql.ts` | `services/sparql.ts` | Keep `executeSparql`, `testConnection`, `detectGraphs`, `withPrefixes`, `SPARQL_PREFIXES`, `fetchRawRdf`, interfaces. **Drop** `detectSkosGraphs`, `detectConceptSchemes`, `detectLanguages`, `detectLabelPredicates`, `analyzeEndpoint`. |
| `services/{logger,prefix,security,config,eventBus,index}.ts` | same | Generic infra — as-is. |
| `stores/endpoint.ts` | `stores/endpoint.ts` | Keep CRUD + `loadFromStorage/Config`, `saveToStorage`, `selectEndpoint`, status/error. Drop `mergeAnalysis`/`enrichEndpointFromSuggested` SKOS coupling. **Keeps the shared `ae-endpoints` key** (endpoints are intentionally shared across all AE tools — com01/com02). |
| `stores/{ui,language,settings,index}.ts` | same | `ui`/`language` lift as-is. Trim SKOS-only settings out of `settings.ts`; its key becomes `ae-rdf-settings`. |
| `components/common/DetailsStates.vue` | `components/common/` | Reusable empty/loading/error state for detail panes. |
| `composables/{useDelayedLoading,useElapsedTime,useClipboard,useEndpointForm,useEndpointTest,useEndpointCapabilities,useResourceExport}.ts` | same | Generic. Skip all `useConcept*`/`useScheme*`/`useTree*`/`useOrphan*`/`useCollection*`/`useXLLabels`/`useDeprecation`. |
| `components/common/{EndpointManager,EndpointWizard,WizardStepBasicInfo,WizardStepCapabilities,EndpointDeleteDialog,ErrorBoundary,RawRdfDialog}.vue` | `components/common/` | Trim SKOS capability checks from `WizardStepCapabilities`. Skip `WizardStepLanguages`, `LabelsSection`, `XLLabelsGroup`, SKOS detail sections. |
| `router/index.ts` | `router/index.ts` | Same single-route pattern; simplify `URL_PARAMS` to `{ endpoint, type, resource }` (deep-linking per com04). |

### Build fresh (RDF-specific)

- `src/services/rdfQueries.ts` — query builders (see Query Library below).
- `src/stores/browse.ts` — `currentType`, `currentResource`, results, loading/error.
- `src/composables/{useRdfTypes,useInstanceList,useResourceView}.ts` — each owns
  one query + `requestId` race-guard (com02 pattern) + delayed loading.
- `src/components/rdf/{TypeList,InstanceList,ResourceView,PropertyTable}.vue`.
- `src/views/RdfView.vue` — layout: endpoint bar (EndpointManager) + type-list
  sidebar + main pane (instance list → resource view).

## Query Library (v1, concrete)

Standard prefixes come from the lifted `SPARQL_PREFIXES` / `withPrefixes()`.
General RDF has no single label predicate, so resolve labels by precedence:
`rdfs:label`, `skos:prefLabel`, `dct:title`, `dc:title`, `foaf:name`, `schema:name`.

**1. Type inventory** (sidebar):
```sparql
SELECT ?type (COUNT(?s) AS ?count)
WHERE { ?s a ?type }
GROUP BY ?type ORDER BY DESC(?count) LIMIT 500
```
<!-- ponytail: optimistic, no safe-mode gating. Add chunked fallback only if a real endpoint times out. -->

**2. Instances of a type** (paged list):
```sparql
SELECT DISTINCT ?s ?label WHERE {
  ?s a <TYPE_URI> .
  OPTIONAL { ?s rdfs:label   ?l1 }
  OPTIONAL { ?s skos:prefLabel ?l2 }
  OPTIONAL { ?s dct:title    ?l3 }
  BIND(COALESCE(?l1, ?l2, ?l3, STR(?s)) AS ?label)
} ORDER BY ?label LIMIT 100 OFFSET <N>
```
Count (separate): `SELECT (COUNT(DISTINCT ?s) AS ?total) WHERE { ?s a <TYPE_URI> }`

**3. Resource detail — outgoing triples** (the core view):
```sparql
SELECT ?p ?o WHERE { <RESOURCE_URI> ?p ?o } ORDER BY ?p
```

**4. Resource label** (header):
```sparql
SELECT ?label WHERE {
  VALUES ?lp { rdfs:label skos:prefLabel dct:title dc:title foaf:name }
  <RESOURCE_URI> ?lp ?label
} LIMIT 1
```

**5. Incoming triples** (deferred to a later task):
```sparql
SELECT ?s ?p WHERE { ?s ?p <RESOURCE_URI> } LIMIT 200
```

## Tasks (ordered)

**T1 — Scaffold + reuse foundation.** Add `vue-router`. In `main.ts` register
PrimeVue `ToastService` + `ConfirmationService` and a global error handler
(EndpointManager + error toasts depend on them). Copy the generic
types/services/stores/composables (table above). Replace `App.vue` with the
lifted header shell + endpoint menu wrapping `<ErrorBoundary><RouterView/>`; add
`router/` and an `RdfView` shell. Storage keys: shared `ae-endpoints`,
app-specific `ae-rdf-settings` / `ae-rdf-history`. *Done when:* app boots, no
console errors, type-checks.

**T2 — Endpoint connection.** Wire lifted `EndpointManager` + endpoint store +
trimmed wizard into `RdfView`. Seed `src/data/endpoints.json` with the CORDIS
endpoint (`https://cordis.europa.eu/datalab/sparql`). *Done when:* user can add/
select/test an endpoint and `endpoint:changed` fires.

**T3 — Class discovery.** `rdfQueries` type-inventory + `useRdfTypes` +
`TypeList.vue` sidebar (name via prefix service, count badge). *Done when:*
selecting CORDIS lists its types with counts.

**T4 — Resource view (CORE).** Resource-triples + label queries +
`useResourceView` + `ResourceView.vue`/`PropertyTable.vue`. URIs in object
position are clickable → navigate (updates `?resource` URL param). Literals shown
with datatype/lang. *Done when:* entering/clicking a URI shows its properties and
you can walk links.

**T5 — Instance list.** Instances-per-type + count + `InstanceList.vue` with
pagination. Click instance → T4 view. *Done when:* type → instances → resource
flow works end-to-end.

**T6 — Raw SPARQL panel (optional, last).** Reuse `RawRdfDialog`/a simple
textarea + results grid bound to `executeSparql`. *Done when:* arbitrary SELECT
renders in a table.

### Thinnest first slice
**T1 + T2 + T4** = connect to an endpoint and view any resource by URI. That
alone is a usable RDF browser. T3/T5 are navigation conveniences; T6 is a bonus.
Stop after the slice works against CORDIS before layering the rest.

## Verification

- `pnpm --filter ae-rdf vue-tsc --noEmit` clean (CLAUDE.md commit rule).
- `pnpm --filter ae-rdf dev` → connect to CORDIS → see types (T3) → click into a
  Project resource (T4) → follow a link to an Organisation. Manual e2e.
- Unit tests for `rdfQueries.ts` builders (pure string output — assert query
  shape) following the AE SKOS `src/**/__tests__` + `test-utils` pattern and
  sko10-Testing conventions. The pre-commit hook runs type-check + unit tests.

## References

- Specs: `/spec/common/com01,02,03,04,05`, `/spec/ae-rdf/rdf01-QueryLibrary.md`
  (borrow only the simple query shapes, not the gating pipeline).
- Reuse sources: `ae-skos/src/{services/sparql.ts, stores/endpoint.ts,
  components/common/EndpointManager.vue, router/index.ts}`.
- Shared styles/tokens: `@ae/styles` (`packages/styles/STYLES.md`).
