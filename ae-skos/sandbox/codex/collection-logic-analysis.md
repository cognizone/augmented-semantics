# AE SKOS Collection Logic Analysis

## Scope
This note focuses on collection behavior in:
- Tree display and expansion
- Collection details view
- Collection member loading
- Label selection and language ordering

Primary code paths reviewed:
- `ae-skos/src/composables/useCollections.ts`
- `ae-skos/src/composables/useCollectionQueries.ts`
- `ae-skos/src/composables/useCollectionData.ts`
- `ae-skos/src/components/skos/CollectionDetails.vue`
- `ae-skos/src/components/skos/ConceptTree.vue`
- `ae-skos/src/composables/useTreePagination.ts` (orphan collections)

Specs referenced:
- `spec/ae-skos/sko03-ConceptTree.md`
- `spec/ae-skos/sko05-Collections.md`

---

## Current Behavior (What Happens Today)

### A. Collections at the root (ConceptTree)
- `useCollections.loadCollectionsForScheme()` fetches all collections that have members in the current scheme, using capability-aware queries.
- Collections are shown under the scheme root (regular schemes). For the orphan scheme, collections are handled via orphan detection in `useTreePagination` and are injected into top concepts.
- Top-level collections are those without a parent collection (`hasParentCollection = false`). Nested collections are lazy-loaded on expand.
- Label selection uses `selectLabelByPriority` (full label priority) and language ordering from `useLabelResolver`.

### B. Nested collections (child collections)
- `useCollections.loadChildCollections(parentUri)` queries child collections of a parent using `skos:member` and filters them to those that have members in the current scheme.
- Each child collection is flagged with `hasChildCollections` for lazy expansion.

### C. Collection details view
- `useCollectionData.loadDetails()` fetches a combined property query (labels, metadata, notes) and then loads XL labels separately.
- `CollectionDetails.vue` uses `selectCollectionLabel` with full priority (prefLabel/xlPrefLabel > dct:title > dc:title > rdfs:label).

### D. Collection members (details view)
- `useCollectionData.loadMembers()`:
  1) Loads member metadata (notation, hasNarrower, isCollection, inCurrentScheme).
  2) Loads labels progressively by member type (concept vs collection) using endpoint capabilities.
  3) Sorts members by label.
- Member icons:
  - Collections show a collection icon.
  - Concepts show leaf vs label icon based on `hasNarrower`.

### E. Orphan collections
- `useTreePagination` loads orphan collection URIs and fetches their labels via capability-aware label union.
- Orphan collections are represented as nodes with `type: 'collection'` and `hasNarrower = hasChildCollections`.

---

## Query / Capability Logic

### Membership detection for collections
From `useCollectionQueries`:
- Uses endpoints' relationship capabilities (`hasInScheme`, `hasTopConceptOf`, `hasHasTopConcept`, `hasBroader`, `hasBroaderTransitive`).
- For scheme membership it combines:
  - `skos:inScheme`
  - `skos:topConceptOf`
  - `skos:hasTopConcept`
  - `skos:broaderTransitive` (preferred) or `skos:broader+`

### Label fetching
- Collections use capability-aware label unions in:
  - `useCollections` (tree)
  - `useTreePagination` (orphans)
  - `useCollectionData` (members + details)
- Priority and language order are applied client-side with `useLabelResolver`.

---

## Gaps / Risks

1. **Collection member hasNarrower uses only `skos:narrower`**
   - `useCollectionData.buildMembersMetadataQuery()` sets `hasNarrower` via `OPTIONAL { ?member skos:narrower ?narrowerChild }`.
   - This misses the inverse pattern `?narrower skos:broader ?member`, which is used elsewhere (tree, concept details).
   - Result: some concepts can be shown as leaves even when they have children.

2. **OrderedCollection not explicitly supported**
   - Queries require `?collection a skos:Collection` and detect child collections with `?childCol a skos:Collection`.
   - If an endpoint uses `skos:OrderedCollection` without asserting `skos:Collection`, these collections may be missed.

3. **Nested collection membership filter is shallow**
   - Child collection query requires that a child collection has a **direct member** that is in the current scheme.
   - If a collection only contains nested collections (no direct concept members), it may be excluded.

4. **Member list hard limit**
   - `buildMembersMetadataQuery()` uses `LIMIT 500` with no pagination or “load more”.
   - Large collections will silently truncate members.

5. **External scheme indicator uses limited membership checks**
   - `inCurrentScheme` is based on `inScheme` or `topConceptOf` only.
   - Endpoints that only model scheme membership via `hasTopConcept` or hierarchy without direct scheme assertions may be marked as external incorrectly.

---

## Notes / Observations

- Collection label logic is now consistently capability-aware (tree + breadcrumbs + details).
- Collection nodes are displayed only at the root level; members appear only in the details panel, not in the tree. This matches current UI design but is worth noting for expectations.
- Orphan collections follow a different path (orphan detection + label query) but still use the same label priority.

---

## Suggested Next Steps (if you want to address gaps)

1. **Align `hasNarrower` for collection members**
   - Use an `EXISTS` union (`skos:broader` inverse + `skos:narrower`) similar to tree/concept details.

2. **Include `skos:OrderedCollection`**
   - Update collection queries to accept `skos:Collection` OR `skos:OrderedCollection`.

3. **Consider nested-only collections**
   - Decide if collections that only contain other collections should appear.
   - If yes, extend membership logic to allow nested collections to qualify.

4. **Member list pagination**
   - Add paging or “load more” in `useCollectionData` to avoid truncation on large collections.

5. **Expand inCurrentScheme detection**
   - Include `hasTopConcept` and/or hierarchy-based signals to avoid false “external” flags.

---

## Proposal: Safe + Incremental Collection Detection (Staged Queries)

Goal: efficiently find collections that have **at least one concept in the current scheme**, while allowing incremental UI updates.

Implementation status: staged query loading now wired in `useCollections` with `buildCollectionsStageQuery` in `useCollectionQueries`.

### Stage 0: Capability check
Use `endpoint.analysis.relationships` to decide which patterns are valid.
- Direct: `hasInScheme`, `hasTopConceptOf`, `hasHasTopConcept`
- Transitive: `hasBroaderTransitive`, `hasNarrowerTransitive`
- Fallback path: `hasBroader`/`hasNarrower` for `skos:broader+` or `skos:narrower+`

### Stage 1: Direct membership (fast)
Query collections whose members are **directly in the scheme**:
- `?collection skos:member ?concept . ?concept skos:inScheme <scheme>`
Incrementally append results.

### Stage 2: Top-concept membership (fast)
Query collections whose members are **top concepts** of the scheme:
- `?concept skos:topConceptOf <scheme>` OR `<scheme> skos:hasTopConcept ?concept`
Append only new collections.

### Stage 3: Transitive membership anchored to top concepts (safe + bounded)
If any transitive predicate exists, prefer it over property paths:
- **broaderTransitive** (member → top):
  - `?collection skos:member ?concept . ?concept skos:broaderTransitive ?top . ?top skos:topConceptOf <scheme>`
  - or `?top` via `<scheme> skos:hasTopConcept ?top`
- **narrowerTransitive** (top → member):
  - `<scheme> skos:hasTopConcept ?top . ?top skos:narrowerTransitive ?concept . ?collection skos:member ?concept`

When both transitive predicates exist, use a UNION inside a single EXISTS block to be defensive.

### Stage 4: Property-path fallback (only if no transitive predicates)
Only if no transitive predicate exists:
- Use `skos:broader+` or `skos:narrower+` anchored to top concepts.

### De-duplication + incremental UI
Maintain a set of collection URIs; each stage appends only new items.

### Handling nested collections during staged loading
Do not drop nested collections from the internal results set. Instead:
- Always compute `hasParentCollection` via `EXISTS` in each stage.
- Keep all collections in the internal map for de-duplication.
- Only display collections where `isNested = false`.
This prevents flicker while still allowing incremental discovery.

### Rationale (answering “broader/narrower when transitive exists?”)
If a transitive predicate exists, **prefer it and skip property paths** to avoid redundant, heavier scans.
Only use property paths as a fallback when no transitive predicate is available, or as an opt-in “paranoid” mode for known-bad endpoints.
