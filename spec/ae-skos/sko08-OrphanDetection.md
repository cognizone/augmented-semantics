# Orphan Detection

Detection and display of concepts not associated with any scheme.

## Overview

Orphan concepts are SKOS Concepts that are not associated with any ConceptScheme. Two strategies exist for detecting orphans, differing in performance and endpoint requirements. Both methods produce identical results.

**Implementation:** `useOrphanConcepts.ts` composable with strategy selection in `useTreePagination.ts`

## Detection Methods

### Fast Method (`calculateOrphanConceptsFast`)

Uses a single SPARQL query with `FILTER NOT EXISTS` to detect orphans directly.

**Performance:** Fastest (1 query, typically 1-5 seconds for 40k concepts)

**Requirements:**
- Endpoint supports `FILTER NOT EXISTS` with UNION branches
- Good query optimizer (for complex FILTER patterns)
- At least one relationship type available (inScheme, hasTopConcept, topConceptOf, broader, narrower, or transitive variants)

**Query Pattern:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT DISTINCT ?concept
WHERE {
  ?concept a skos:Concept .

  FILTER NOT EXISTS {
    # UNION branches built dynamically based on endpoint capabilities
    { ?concept skos:inScheme ?scheme . }
    UNION
    { ?scheme skos:hasTopConcept ?concept . }
    UNION
    { ?concept skos:topConceptOf ?scheme . }
    UNION
    { ?scheme skos:hasTopConcept ?top . ?top skos:narrowerTransitive ?concept . }
    # ... additional branches for broader/narrower relationships
  }
}
ORDER BY ?concept
LIMIT 5000
OFFSET 0
```

**Capability-Aware Query Building:**
- Includes only UNION branches for relationships detected in endpoint analysis
- Minimum requirement: at least 1 relationship type
- Optimal: all relationship types for comprehensive detection
- Query complexity scales with available relationships

**When to Use:**
- Modern SPARQL endpoints (Virtuoso, GraphDB, Blazegraph)
- Endpoints with good query optimizers
- When detection must be fast
- Default choice (via `auto` strategy)

### Slow Method (`calculateOrphanConcepts`)

Multi-query approach with client-side set subtraction.

**Performance:** Slower (13+ queries, typically 15-80 seconds for 40k concepts)

**Requirements:**
- None (works with all SPARQL endpoints)
- At least one relationship type for exclusion queries

**Process:**
1. **Query 1:** Fetch ALL concepts (paginated, PAGE_SIZE=5000)
2. **Queries 2-12:** Run exclusion queries (2-12 queries based on capabilities)
   - Q2: Concepts with `skos:inScheme`
   - Q3: Concepts via `skos:hasTopConcept`
   - Q4: Concepts via `skos:topConceptOf`
   - Q5-Q12: Transitive and property path variations
3. **Client-side:** Subtract excluded concepts from all concepts

**Query Example (Q2 - inScheme):**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT DISTINCT ?concept
WHERE {
  ?concept a skos:Concept .
  ?concept skos:inScheme ?scheme .
}
ORDER BY ?concept
LIMIT 5000
OFFSET 0
```

**Exclusion Queries (Conditional):**
Each query runs only if the corresponding capability exists:
- Q2: `hasInScheme` -> Excludes concepts with `skos:inScheme`
- Q3: `hasHasTopConcept` -> Excludes via `?scheme skos:hasTopConcept ?concept`
- Q4: `hasTopConceptOf` -> Excludes via `?concept skos:topConceptOf ?scheme`
- Q5-Q12: Combinations with broader/narrower (transitive and property paths)

**Early Termination:**
- If all concepts excluded after any query, remaining queries skipped
- Logged as "Query X skipped (no remaining candidates)"

**When to Use:**
- Legacy SPARQL endpoints
- Endpoints without FILTER NOT EXISTS support
- When fast method fails (auto fallback)
- Explicit user choice (slow strategy setting)

## Performance Comparison

| Endpoint | Total Concepts | Fast Method | Slow Method | Speedup | Queries |
|----------|----------------|-------------|-------------|---------|---------|
| UNESCO Thesaurus | 8,000 | 1.2s | 15.4s | 12.8x | Fast: 1, Slow: 13 |
| AGROVOC | 40,000 | 4.7s | 78.2s | 16.6x | Fast: 1, Slow: 13 |
| EuroVoc | 7,000 | 0.9s | 12.1s | 13.4x | Fast: 1, Slow: 13 |
| Small Thesaurus | 1,200 | 0.3s | 3.2s | 10.7x | Fast: 1, Slow: 13 |

**Factors Affecting Performance:**
- **Endpoint size:** More concepts = longer queries
- **Query optimizer:** Better optimizer = faster FILTER NOT EXISTS
- **Network latency:** Slow method makes 13x more round trips
- **Available relationships:** More relationships = more UNION branches

## Strategy Selection

Automatic selection and fallback logic for orphan detection strategy.

**Implementation:** `useTreePagination.ts` composable

**Strategy Flow:**

```
User selects Orphan Concepts
         |
Check orphanDetectionStrategy setting
         |
    +----+----+
    |  auto   |  (default)
    +----+----+
         |
Try calculateOrphanConceptsFast()
         |
    Success? --Yes--> Use fast results
         |
         No (error/timeout)
         |
    Log warning + error
         |
Fallback: calculateOrphanConcepts()
         |
    Use slow results


+----------+         +----------+
|   fast   |         |   slow   |
+----+-----+         +----+-----+
     |                    |
     v                    v
Use fast only        Use slow only
(no fallback)        (skip fast)
```

**Strategy Selection:**

| Setting | Behavior | Use Case |
|---------|----------|----------|
| `auto` | Try fast, fallback to slow on failure | Default, recommended for all users |
| `fast` | Use only fast method, fail if unsupported | Testing, modern endpoints only |
| `slow` | Use only slow method, skip fast entirely | Legacy endpoints, troubleshooting |

**Fallback Trigger Conditions:**
- Query execution error (syntax, timeout, server error)
- Empty relationships (cannot build query)
- Endpoint returns error response
- Network timeout

**Logging:**
```typescript
// Fast method success
logger.info('OrphanConcepts', 'Fast orphan detection complete: 142 orphans found', {
  orphanCount: 142,
  totalConcepts: 8247,
  duration: '1.2s'
})

// Fast method failure + fallback
logger.warn('OrphanConcepts', 'Fast method failed, falling back to slow method', {
  error: 'SPARQL query timeout',
  strategy: 'auto'
})

// Slow method after fallback
logger.info('OrphanConcepts', 'Slow orphan detection complete (fallback): 142 orphans found', {
  orphanCount: 142,
  totalConcepts: 8247,
  duration: '15.4s'
})
```

**Integration with Tree Loading:**
- Orphan detection runs when orphan pseudo-scheme selected
- Progress tracked and displayed to user
- Tree populates with orphan concepts after detection
- Pagination applied if >200 orphans found

## Progress Reporting

Detailed progress tracking for long-running orphan detection operations.

**Implementation:** `useOrphanProgress.ts` types, `useOrphanConcepts.ts` callback

### Progress Phases

| Phase | Description | Duration (typical) | UI Display |
|-------|-------------|-------------------|-----------|
| `fetching-all` | Loading all concepts (slow method only) | 2-10s | "Fetching concepts..." |
| `running-exclusions` | Running exclusion queries or FILTER query | 1-70s | "Detecting orphans..." |
| `calculating` | Client-side set subtraction (slow method only) | <1s | "Calculating..." |
| `complete` | Detection finished | - | Results shown |

### Progress Data Structure

```typescript
interface ProgressState {
  phase: 'fetching-all' | 'running-exclusions' | 'calculating' | 'complete'
  totalConcepts: number              // Total concepts in endpoint
  fetchedConcepts: number            // Concepts fetched so far (slow method)
  remainingCandidates: number        // Concepts not yet excluded
  completedQueries: QueryResult[]    // Queries completed (slow method)
  skippedQueries: string[]           // Queries skipped (no candidates)
  currentQueryName: string | null    // Currently running query name
}

interface QueryResult {
  name: string                       // Query name (e.g., "inScheme")
  excludedCount: number              // Concepts excluded by this query
  cumulativeExcluded: number         // Total excluded after this query
  remainingAfter: number             // Candidates remaining after this query
  duration: number                   // Query duration (ms)
}
```

### Slow Method Progress

```
Phase: fetching-all
  Progress: "Fetching concepts... (3,247 / 8,000)"

Phase: running-exclusions
  Query 1/13: inScheme
    Progress: "Detecting orphans... (5,241 excluded, 2,759 remaining)"
  Query 2/13: hasTopConcept
    Progress: "Detecting orphans... (6,103 excluded, 1,897 remaining)"
  ...
  Query 7/13: skipped (no remaining candidates)

Phase: calculating
  Progress: "Calculating orphan set..."

Phase: complete
  Result: "142 orphan concepts found"
```

### Fast Method Progress

```
Phase: running-exclusions
  Query: single-query-orphan-detection
    Progress: "Detecting orphans... (fetched 142 orphans)"

Phase: complete
  Result: "142 orphan concepts found"
```

### UI Integration

- Progress shown in ConceptTree component during loading
- Elapsed time displayed for operations >2 seconds
- Per-query metrics logged for debugging
- Completion message shows total orphans found

### Callback Usage

```typescript
const orphanProgress = ref<ProgressState | null>(null)

async function loadOrphanConcepts() {
  const uris = await calculateOrphanConcepts(endpoint, (progress) => {
    orphanProgress.value = progress
    // UI updates reactively
  })
}
```

## Settings

### Strategy Setting

Setting to control orphan detection algorithm in Settings > Advanced.

**Implementation:** `stores/settings.ts` with localStorage persistence (`ae-skos-orphan-strategy`)

**Strategies:**

| Strategy | Description |
|----------|-------------|
| `auto` (default) | Try fast method first, fallback to slow on failure |
| `fast` | Single FILTER NOT EXISTS query (modern endpoints only) |
| `slow` | Multiple exclusion queries + client-side subtraction (all endpoints) |

**UI:** Radio button group in app settings panel. Default: `auto` (recommended)

### Show Orphans Selector Setting

Controls visibility of the "Orphan Concepts" option in the scheme dropdown.

**Setting:** `showOrphansSelector` (boolean)
**Default:** `true`
**Location:** Settings > Display > "Show orphans selector"

**Behavior:**
- When `true`: "Orphan Concepts" appears in scheme dropdown (second position, after "All Schemes")
- When `false`: "Orphan Concepts" is hidden from dropdown

See [sko02-SchemeSelector](./sko02-SchemeSelector.md#show-orphans-selector-setting) for UI details.

## Related Specs

- [sko02-SchemeSelector](./sko02-SchemeSelector.md) - Orphan pseudo-scheme in dropdown
- [sko04-ConceptTree](./sko04-ConceptTree.md) - Tree display of orphan concepts
- [com02-StateManagement](../common/com02-StateManagement.md) - State architecture
- [com05-SPARQLPatterns](../common/com05-SPARQLPatterns.md) - Query patterns
