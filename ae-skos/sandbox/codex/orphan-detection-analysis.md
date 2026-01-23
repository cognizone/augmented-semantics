# AE SKOS Orphan Detection Analysis

## Scope
This note reviews orphan concept + orphan collection detection logic and performance.

Primary code paths reviewed:
- `ae-skos/src/composables/useTreePagination.ts`
- `ae-skos/src/composables/useOrphanConcepts.ts`
- `ae-skos/src/composables/useOrphanQueries.ts`
- `ae-skos/src/composables/useOrphanProgress.ts`

Spec reference:
- `spec/ae-skos/sko08-OrphanDetection.md`

---

## Current Flow (as implemented)

### A. Orphan concepts (tree “Orphans” scheme)
- `useTreePagination.loadOrphanConcepts()` orchestrates:
  1) calculate orphan concepts (fast single query or slow multi‑query based on settings)
  2) calculate orphan collections (always after concepts)
  3) page combined orphan URIs (collections first, then concepts) and fetch labels
- Settings:
  - `settingsStore.orphanDetectionStrategy = fast | slow | auto`.
  - Auto tries fast first, falls back to slow on error.

#### Slow method (multi‑query)
- `calculateOrphanConcepts()`:
  1) Fetch **all concepts** with pagination (`PAGE_SIZE=5000`), using `buildAllConceptsQuery()`.
  2) Build exclusion queries based on endpoint relationships (`buildOrphanExclusionQueries`).
  3) Run each exclusion query (paginated) and subtract from all‑concepts set.

#### Fast method (single query)
- `calculateOrphanConceptsFast()`:
  - Uses `buildSingleOrphanQuery()` with `FILTER NOT EXISTS` and a UNION of capability‑based membership patterns.
  - Paginates with `PAGE_SIZE=5000` and `LIMIT+1` detection.

### B. Orphan collections
- `calculateOrphanCollections()` uses `buildOrphanCollectionsQuery()`:
  - Defines orphan collection as **no member** that can be linked to any scheme via detected relationship paths.
  - Uses a single `FILTER NOT EXISTS` with capability‑based UNION membership patterns.
  - Paginates with `PAGE_SIZE=5000` and `LIMIT+1` detection.

---

## Logic Soundness – Findings

1) **Orphan collections ignore narrowerTransitive / narrower+**
- `buildOrphanCollectionsQuery()` only uses `broaderTransitive` or `broader+` (when topConcepts exist).
- If an endpoint only exposes `narrowerTransitive` (common in some datasets), collections may be falsely marked orphan.

2) **Orphan collections only check direct members (no recursive collections)**
- Query is `?collection skos:member ?concept .` + membership test on `?concept`.
- If collections contain **collections** (nested collections), and those child collections contain in‑scheme concepts, the parent may still be flagged orphan (false positive).

3) **Concept orphan logic is comprehensive but may double‑count paths**
- Both broader and narrower transitive/path patterns are used.
- This is safe but can create heavy query plans on some endpoints.

4) **Progress text suggests “concepts are displayed immediately,” but tree waits for collections too**
- `loadOrphanConcepts()` computes concepts, then collections, and only afterwards loads labels for the first page.
- This is not strictly “display concepts immediately” even though the comment says so.

---

## Performance Notes

1) **Slow method is very heavy on large endpoints**
- Fetching all concepts (possibly millions) + multiple exclusion queries is expensive.
- Uses `ORDER BY ?concept` + `DISTINCT` in all queries; `OFFSET` paging over large datasets is slow on some engines.

2) **Fast single query relies on FILTER NOT EXISTS optimization**
- This can be fast if the endpoint optimizes NOT EXISTS well.
- On weak endpoints, it can be slower than the multi‑query approach (hence the auto fallback).

3) **Repeated query rebuild in slow method**
- `fetchExcludedConceptsForQuery()` rebuilds all queries per page to get the current query by name.
- Not a correctness issue, but avoidable overhead (minor relative to query time).

4) **Progress uses `endpoint.analysis.totalConcepts`**
- If the analysis count is missing or stale, progress numbers are misleading (but logic is still correct).

---

## Suggested Improvements

### A. Logic correctness
1) **Add narrowerTransitive / narrower+ for orphan collections**
- Mirror the concept orphan logic when building membership branches for collections.

2) **Handle nested collections (optional)**
- Decide whether nested collections should protect parents from being “orphan.”
- If yes, extend collection membership check to include `?collection skos:member ?childCollection . ?childCollection skos:member ?concept`.

### B. Performance
3) **Stream results for the orphan scheme**
- Emit orphan concepts as soon as they are computed (before orphan collections finish).
- Or load collection orphans in background and prepend later.

4) **Prefer transitive predicates when available**
- For both orphan concepts and collections, use transitive predicates (broader/narrower) instead of property paths when available.

5) **Consider LIMIT‑less fast path for smaller datasets**
- If `totalConcepts` is small (e.g., <50k), consider a single non‑paged query (lower overhead).

---

## Overall Assessment
- Orphan concept detection is broadly correct and robust (fast + slow strategies).
- Orphan collection detection is **under‑inclusive** for endpoints with only narrowerTransitive and for nested collections.
- Performance is acceptable on small/medium endpoints but can be expensive on very large datasets; streaming and transitive‑first selection would help.
