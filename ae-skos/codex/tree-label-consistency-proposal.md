# AE SKOS Label Consistency + Tree Expansion Analysis

## Scope
This note focuses on:
- Concept/scheme/collection label selection consistency
- Language ordering logic across the app
- Tree expansion mechanics starting from a scheme
- Performance characteristics and risk points

Primary code paths reviewed:
- `ae-skos/src/components/skos/ConceptTree.vue`
- `ae-skos/src/composables/useTreePagination.ts`
- `ae-skos/src/composables/useConceptTreeQueries.ts`
- `ae-skos/src/composables/useConceptBindings.ts`
- `ae-skos/src/components/skos/ConceptBreadcrumb.vue`
- `ae-skos/src/composables/useLabelResolver.ts`
- `ae-skos/src/composables/useConceptData.ts`
- `ae-skos/src/composables/useCollectionData.ts`
- `ae-skos/src/composables/useCollections.ts`
- `ae-skos/src/services/sparql.ts` (analysis + label predicate detection)

Specs referenced:
- `spec/ae-skos/sko01-LanguageSelector.md`
- `spec/ae-skos/sko04-ConceptTree.md`
- `spec/ae-skos/sko06-ConceptDetails.md`

---

## Summary Proposal (Actionable)

### A. Make tree expansion faster + spec-aligned
1. **Replace COUNT with EXISTS for `hasNarrower` in tree queries** (done)
   - Update `useConceptTreeQueries.ts` to use `BIND(EXISTS { ... } AS ?hasNarrower)` and return `?hasNarrower` instead of `?narrowerCount`.
   - Tree expansion now uses metadata queries (no `narrowerCount`) and `EXISTS`.
   - This aligns with `sko04-ConceptTree.md` performance guidance.

2. **Avoid always running fallback query on first page** (not for now)
   - In-scheme-only currently runs alongside explicit for completeness.
   - Option remains: only run when explicit yields zero results.

3. **Add proper per-node label resolution for orphan collections** (done)
   - Replace first-label-wins logic in `useTreePagination.ts::processCollectionBindings` with `selectLabelByPriority` for consistent language + predicate order.

4. **Separate concept discovery from label fetching in the tree** (done)
   - First query only returns concept URIs + notation + hasNarrower.
   - Second query enriches labels using `VALUES` for the page URIs.
   - This reduces label explosion and enforces consistent label ordering client-side.

### B. Make label logic consistent across concept/scheme/collection views
1. **Unify concept label priority across tree/breadcrumb/details** (done)
   - Today:
     - Tree uses `LABEL_PRIORITY` (includes dct/dc)
     - Concept header uses `selectLabelWithXL` (no dct/dc)
   - Implemented via `CONCEPT_LABEL_PRIORITY` and passing it to `selectLabelByPriority` for concept contexts.

2. **Fix capability-aware label detection for dct/dc titles** (done)
   - `detectLabelPredicates()` now tracks `dct:title` and `dc:title` per resource type.
   - Curation pipeline outputs and merge checks reflect these capabilities.

3. **Unify label fetching patterns for scheme/collection refs** (done)
   - `useConceptData` uses progressive loader that relies on label capabilities.
   - `ConceptBreadcrumb` scheme + collection queries now use capability-aware label unions, matching `useCollectionQueries`.

### C. Make relation icon logic robust
1. **`hasNarrower` detection in details should be symmetrical** (done)
   - `useConceptData.ts` metadata query now uses `EXISTS` with both `skos:broader` inverse and `skos:narrower`.

---

## Tree Expansion: Current Implementation

### Flow
- Scheme selection is managed in `ConceptBreadcrumb.vue`.
- Tree loading is triggered by a watcher in `ConceptTree.vue` on `schemeStore.selectedUri` / endpoint change.
- `loadTopConcepts()` runs in `useTreePagination.ts` and performs a two-step strategy:
  1. **Explicit top concepts** (`skos:topConceptOf` or `skos:hasTopConcept`) via metadata query
  2. **In-scheme-only** concepts (no placement relations) via metadata query

### Tree Queries
Defined in `useConceptTreeQueries.ts` (metadata only):

| Query | Source | Notes |
|---|---|---|
| Explicit top concepts | `buildExplicitTopConceptsMetadataQuery()` | No type check, uses topConceptOf/hasTopConcept unions |
| In-scheme-only concepts | `buildInSchemeOnlyTopConceptsMetadataQuery()` | Requires type check + inScheme + no placement relations |
| Children | `buildChildrenMetadataQuery()` | Uses broader/narrower union, no type check |

### Performance Notes
- **`EXISTS` for hasNarrower**: tree now uses `EXISTS` in metadata queries (no COUNT).
- **In-scheme-only runs every time** (even if explicit returns results). This is intentional for completeness but doubles metadata queries.
- **Label overfetching avoided**: label fetching is separated and limited to current page via `VALUES`.

### Implemented Tree Expansion Update (Separated Fetch)
Tree expansion is now split into two steps:
1) **Concept metadata** (URI + notation + hasNarrower)  
2) **Label enrichment** (labels only for the current page of URIs)

#### InScheme-only “unplaced” concepts
Add a **separate query** to capture concepts that are in a scheme but have no placement:
- No `broader`, `narrower`, `broaderTransitive`, `narrowerTransitive`
- No `topConceptOf` / `hasTopConcept`
This handles flat lists and “not yet placed” concepts without polluting explicit top concepts.

---

## Label / Language Resolution Matrix

### Language order (common)
Defined in `useLabelResolver.ts`:
1. Preferred language
2. Endpoint priorities (ordered)
3. No-language tag
4. First available

### Label priority by resource type

| Resource | Spec Priority | Current Implementation | Risk |
|---|---|---|---|
| Concept | prefLabel > xlPrefLabel > rdfsLabel | **Tree/Breadcrumb** use `LABEL_PRIORITY` (includes dct/dc) | Inconsistent labels between tree/breadcrumb and concept header |
| Scheme | prefLabel > xlPrefLabel > dctTitle > dcTitle > rdfsLabel | Used in SchemeDetails + Breadcrumb scheme load | OK, but capability detection may drop dct/dc |
| Collection | prefLabel > xlPrefLabel > dctTitle > dcTitle > rdfsLabel | Used in CollectionDetails + Collections list | OK, but orphan collections bypass resolver |

### Label selection by surface

| Surface | Label Query | Resolver | Notes |
|---|---|---|---|
| Tree nodes | fetch label + labelType (all predicates) | `useConceptBindings` uses `LABEL_PRIORITY` + `selectLabel()` | Concept vs Scheme priorities not distinguished |
| Breadcrumb (concepts) | fetch label + labelType per node | `selectLabelByPriority` | Uses full priority list including dct/dc |
| Concept header | details query + `selectLabelWithXL` | **prefLabel/xl only** | Different from tree/breadcrumb |
| Scheme dropdown | scheme whitelist query | `selectLabelByPriority` | OK, but no capability-aware optimization |
| Collections list (tree) | `useCollections` | `selectLabelByPriority` | OK |
| Orphan collections | `processCollectionBindings` (tree pagination) | **first label wins** | Inconsistent

---

## Important Gaps / Risks

1. **Label predicate capabilities do not include dct/dc titles** (resolved)
   - Detection now includes `dct:title` and `dc:title` for scheme/collection (and concept, where present).

2. **Concept label inconsistency**
   - Tree/breadcrumb can display dct/dc labels for concepts, but details header will not. This breaks “same logic” across surfaces.

3. **hasNarrower mismatch** (resolved)
   - Concept detail refs now use the same broader+narrower EXISTS check as the tree.

4. **Orphan collections bypass label logic**
   - For orphan collections, a random label row becomes the displayed label with no language order or predicate priority.

---

## Detailed Proposed Changes (Concrete)

### 1) Tree `hasNarrower` performance fix
- **File**: `ae-skos/src/composables/useConceptTreeQueries.ts`
- Replace `COUNT(DISTINCT ?narrower) AS ?narrowerCount` with:
  ```sparql
  BIND(EXISTS {
    { ?narrower skos:broader ?concept }
    UNION
    { ?concept skos:narrower ?narrower }
  } AS ?hasNarrower)
  ```
- **File**: `ae-skos/src/composables/useConceptBindings.ts`
  - Read `hasNarrower` boolean.
  - Remove `narrowerCount` usage.

### 2) Avoid unconditional fallback query
- **File**: `ae-skos/src/composables/useTreePagination.ts`
  - Only run fallback when:
    - explicit query is missing (capabilities), or
    - explicit yields zero results.
  - Optional: allow “merge explicit+fallback” as a setting.

### 3) Fix orphan collection labels
- **File**: `ae-skos/src/composables/useTreePagination.ts`
  - In `processCollectionBindings`, collect all labels and run `selectLabelByPriority`.

### 4) Fix label predicate detection for title properties
- **File**: `ae-skos/src/services/sparql.ts`
  - Update `detectLabelPredicates()` to check `dct:title` and `dc:title` per resource type.
  - Update `LabelPredicateCapabilities` in `ae-skos/src/types/endpoint.ts` if needed (already includes dct/dc fields but not set).

### 5) Unify concept label priority
- **Option A (spec-aligned)**:
  - Add a concept-specific selector (pref/xl/rdfs only) and use it for tree/breadcrumb concept labels.
- **Option B (pragmatic)**:
  - Keep dct/dc as extra fallback for concepts but adjust concept header to also use `LABEL_PRIORITY` for consistency.

### 6) Symmetric hasNarrower for details
- **File**: `ae-skos/src/composables/useConceptData.ts`
  - In metadata query, replace `OPTIONAL { ?concept skos:narrower ?narrowerChild }` with an `EXISTS` check using broader+narrower.

---

## Suggested Work Order
1. Tree `hasNarrower` EXISTS + binding changes
2. Orphan collection label fix
3. Capability detection extension (dct/dc)
4. Decide concept label priority policy (spec vs pragmatic)
5. Update detail icon logic

---

## Notes / Open Questions
- Should concept labels ever use `dct:title`/`dc:title`? Spec says no, but real data might rely on titles.
- Do we want fallback query merging on first page always, or only on-demand? This has a material perf impact on large endpoints.
- Do we want to add a “strict label priority” mode for debugging endpoints?
