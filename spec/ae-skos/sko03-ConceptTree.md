# ConceptTree

Component for hierarchical browsing of SKOS concepts.

## Features

### Top Concepts

Display root concepts within selected scheme. Top concepts are identified via:

1. **Explicit marking**: `skos:topConceptOf` or scheme's `skos:hasTopConcept`
2. **Fallback**: Concepts with no hierarchical parent (neither `skos:broader` nor inverse `skos:narrower`)

**Query:**

Uses a subquery to paginate by distinct concepts (not by label rows, since concepts can have many label language/type variations):

```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX skosxl: <http://www.w3.org/2008/05/skos-xl#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT ?concept ?label ?labelLang ?labelType ?notation ?narrowerCount
WHERE {
  {
    # Subquery to get paginated distinct concepts with narrower count
    SELECT DISTINCT ?concept (COUNT(DISTINCT ?narrower) AS ?narrowerCount)
    WHERE {
      {
        # Explicit top concept via topConceptOf or hasTopConcept
        ?concept a skos:Concept .
        ?concept skos:inScheme <SCHEME_URI> .
        { ?concept skos:topConceptOf <SCHEME_URI> }
        UNION
        { <SCHEME_URI> skos:hasTopConcept ?concept }
      }
      UNION
      {
        # Fallback: concepts with no broader relationship (neither direction)
        ?concept a skos:Concept .
        ?concept skos:inScheme <SCHEME_URI> .
        FILTER NOT EXISTS { ?concept skos:broader ?broader }
        FILTER NOT EXISTS { ?parent skos:narrower ?concept }
      }
      # Count children via broader or narrower (supports both directions)
      OPTIONAL {
        { ?narrower skos:broader ?concept }
        UNION
        { ?concept skos:narrower ?narrower }
      }
    }
    GROUP BY ?concept
    ORDER BY ?concept
    LIMIT 201
    OFFSET 0
  }
  # Get labels and notations for the paginated concepts
  OPTIONAL { ?concept skos:notation ?notation }
  OPTIONAL {
    { ?concept skos:prefLabel ?label . BIND("prefLabel" AS ?labelType) }
    UNION
    { ?concept skosxl:prefLabel/skosxl:literalForm ?label . BIND("xlPrefLabel" AS ?labelType) }
    UNION
    { ?concept dct:title ?label . BIND("title" AS ?labelType) }
    UNION
    { ?concept rdfs:label ?label . BIND("rdfsLabel" AS ?labelType) }
    BIND(LANG(?label) AS ?labelLang)
  }
}
```

**Note:** Label selection happens in code using priority-based resolution (see Label Resolution section below).

### Hierarchical Expansion

Load narrower concepts on demand when user expands a node. Supports both `skos:broader` and `skos:narrower` relationships.

**Query:**

Uses a subquery to paginate by distinct concepts:

```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX skosxl: <http://www.w3.org/2008/05/skos-xl#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT ?concept ?label ?labelLang ?labelType ?notation ?narrowerCount
WHERE {
  {
    # Subquery to get paginated distinct children with narrower count
    SELECT DISTINCT ?concept (COUNT(DISTINCT ?narrower) AS ?narrowerCount)
    WHERE {
      # Find children via broader or narrower (supports both directions)
      { ?concept skos:broader <PARENT_URI> }
      UNION
      { <PARENT_URI> skos:narrower ?concept }
      # Count grandchildren via broader or narrower
      OPTIONAL {
        { ?narrower skos:broader ?concept }
        UNION
        { ?concept skos:narrower ?narrower }
      }
    }
    GROUP BY ?concept
    ORDER BY ?concept
    LIMIT 201
    OFFSET 0
  }
  # Get labels and notations for the paginated concepts
  OPTIONAL { ?concept skos:notation ?notation }
  OPTIONAL {
    { ?concept skos:prefLabel ?label . BIND("prefLabel" AS ?labelType) }
    UNION
    { ?concept skosxl:prefLabel/skosxl:literalForm ?label . BIND("xlPrefLabel" AS ?labelType) }
    UNION
    { ?concept dct:title ?label . BIND("title" AS ?labelType) }
    UNION
    { ?concept rdfs:label ?label . BIND("rdfsLabel" AS ?labelType) }
    BIND(LANG(?label) AS ?labelLang)
  }
}
```

### Broader Concepts

Display parent hierarchy for selected concept.

**Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?concept ?label
WHERE {
  <CONCEPT_URI> skos:broader ?concept .
  ?concept skos:prefLabel ?label .
  FILTER (LANGMATCHES(LANG(?label), "LANG") || LANG(?label) = "")
}
```

### Breadcrumb Navigation

Show full path from root to current concept.

**IMPORTANT:** Breadcrumb labels MUST match the labels shown in ConceptDetails. Use the same label resolution logic everywhere.

**Query (recursive path):**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?concept ?label ?depth
WHERE {
  <CONCEPT_URI> skos:broader* ?concept .
  ?concept skos:prefLabel ?label .
  FILTER (LANGMATCHES(LANG(?label), "LANG") || LANG(?label) = "")
  {
    SELECT ?concept (COUNT(?mid) AS ?depth)
    WHERE {
      <CONCEPT_URI> skos:broader* ?mid .
      ?mid skos:broader* ?concept .
    }
    GROUP BY ?concept
  }
}
ORDER BY DESC(?depth)
```

### Concept Reveal (History/Search/URL Navigation)

When navigating to a concept from history, search, or URL deep link, the tree must reveal (expand and scroll to) the selected concept.

**Process:**
1. Query ancestor path using `skos:broader+`
2. Expand each ancestor node (loading children on-demand if needed)
3. Scroll to reveal the selected concept in the tree

**Ancestor Path Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT DISTINCT ?ancestor ?label ?notation ?depth
WHERE {
  <CONCEPT_URI> skos:broader+ ?ancestor .
  {
    SELECT ?ancestor (COUNT(?mid) AS ?depth)
    WHERE {
      <CONCEPT_URI> skos:broader+ ?mid .
      ?mid skos:broader* ?ancestor .
      ?ancestor skos:broader* ?root .
      FILTER NOT EXISTS { ?root skos:broader ?parent }
    }
    GROUP BY ?ancestor
  }
  OPTIONAL { ?ancestor skos:prefLabel ?label . FILTER(LANG(?label) = "LANG" || LANG(?label) = "") }
  OPTIONAL { ?ancestor skos:notation ?notation }
}
ORDER BY DESC(?depth)
```

**Race Condition Handling:**

When navigating from history, the scheme/endpoint may change which triggers a tree reload. To handle this timing:

1. **Watch on `selectedUri`**: Triggers reveal when concept is selected
2. **Check `loadingTree`**: If tree is loading, skip reveal (wait for load to complete)
3. **Watch on `loadingTree`**: When loading finishes, re-check if reveal is needed

```
History Click
    ↓
Switch Endpoint/Scheme (if different)
    ↓
await nextTick() (wait for reactivity)
    ↓
Select Concept (sets selectedUri)
    ↓
selectedUri Watch fires
    ↓
If loadingTree → skip (wait for load)
If !loadingTree → reveal concept
    ↓
loadingTree Watch fires when load completes
    ↓
If selectedUri exists → reveal concept
```

**Reveal Coordination Mechanism:**

To prevent race conditions when selecting concepts while the tree is loading, the implementation uses event-driven coordination with pending reveal state:

**Concept Store State:**
```typescript
interface ConceptState {
  // ... existing fields
  pendingRevealUri: string | null  // Concept awaiting reveal
}

// Methods
requestReveal(uri: string): void
markConceptRevealed(uri: string): void
clearPendingReveal(): void
```

**Event-Driven Flow:**
```
User clicks concept from search/history (different scheme)
         ↓
selectConceptWithScheme(uri, schemeUri)
         ↓
conceptStore.requestReveal(uri)  ← Set pending reveal
         ↓
schemeStore.setSelectedScheme(schemeUri)
         ↓
ConceptTree: watch scheme change → clear tree
         ↓
ConceptTree: load top concepts
         ↓
ConceptTree: emit tree:loaded event
         ↓
ConceptTree: event listener checks pendingRevealUri
         ↓
If pending → useTreeNavigation.revealConcept(uri)
         ↓
After scroll completes
         ↓
conceptStore.markConceptRevealed(uri)
         ↓
emit concept:revealed event
```

**Events Used:**
- `tree:loading` - Tree starting to load
- `tree:loaded` (payload: ConceptNode[]) - Tree finished loading
- `concept:revealed` (payload: string URI) - After scroll to view

**Benefits:**
- Prevents multiple simultaneous reveal attempts
- Handles scheme switching correctly
- Works across tabs and navigation types
- Clean separation of concerns (store manages state, component handles UI)

### Cross-Scheme Navigation

Automatic scheme discovery and navigation for concepts from different schemes.

**Use Cases:**
1. Clicking concepts in search results from other schemes
2. Clicking concepts in history from other schemes
3. Clicking related concepts (broader, narrower, related) that are in different schemes
4. Direct URI navigation from URL parameters

**Implementation:** `useConceptSelection` composable

**Methods:**
```typescript
async function findSchemeForConcept(uri: string): Promise<string | null>
async function selectConceptWithScheme(
  uri: string,
  schemeUri?: string,
  endpointUrl?: string
): Promise<void>
```

**Scheme Discovery Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT DISTINCT ?scheme WHERE {
  {
    # Direct inScheme link
    <CONCEPT_URI> skos:inScheme ?scheme .
  } UNION {
    # Top concept marker
    ?scheme skos:hasTopConcept <CONCEPT_URI> .
  } UNION {
    # Traverse up hierarchy to find ancestor's scheme
    <CONCEPT_URI> (skos:broader|^skos:narrower)+ ?ancestor .
    ?ancestor skos:inScheme ?scheme .
  }
} LIMIT 1
```

**Navigation Flow:**
1. If `endpointUrl` provided and different from current → switch endpoint
2. If `schemeUri` not provided → discover via SPARQL query
3. Switch scheme **before** selecting concept (order critical for tree loading)
4. Call `requestReveal(uri)` to coordinate with tree loading
5. Switch to browse tab (if currently on search or other tab)

**Integration Points:**
- SearchBox: Click search result → `selectConceptWithScheme(uri)`
- RecentHistory: Click history item → `selectConceptWithScheme(uri, schemeUri, endpointUrl)`
- ConceptDetails: Click relation → `selectConceptWithScheme(uri)` (discovers scheme)
- URL parameters: `?concept=URI` → `selectConceptWithScheme(uri)` (discovers scheme)

### Orphan Detection Methods

Two strategies for detecting concepts not associated with any scheme. Both methods produce identical results but differ in performance and endpoint requirements.

**Implementation:** `useOrphanConcepts.ts` composable with strategy selection in `useTreePagination.ts`

#### Fast Method (`calculateOrphanConceptsFast`)

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

#### Slow Method (`calculateOrphanConcepts`)

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
- Q2: `hasInScheme` → Excludes concepts with `skos:inScheme`
- Q3: `hasHasTopConcept` → Excludes via `?scheme skos:hasTopConcept ?concept`
- Q4: `hasTopConceptOf` → Excludes via `?concept skos:topConceptOf ?scheme`
- Q5-Q12: Combinations with broader/narrower (transitive and property paths)

**Early Termination:**
- If all concepts excluded after any query, remaining queries skipped
- Logged as "Query X skipped (no remaining candidates)"

**When to Use:**
- Legacy SPARQL endpoints
- Endpoints without FILTER NOT EXISTS support
- When fast method fails (auto fallback)
- Explicit user choice (slow strategy setting)

#### Performance Comparison

| Endpoint | Total Concepts | Fast Method | Slow Method | Speedup | Queries |
|----------|----------------|-------------|-------------|---------|---------|
| UNESCO Thesaurus | 8,000 | 1.2s | 15.4s | 12.8× | Fast: 1, Slow: 13 |
| AGROVOC | 40,000 | 4.7s | 78.2s | 16.6× | Fast: 1, Slow: 13 |
| EuroVoc | 7,000 | 0.9s | 12.1s | 13.4× | Fast: 1, Slow: 13 |
| Small Thesaurus | 1,200 | 0.3s | 3.2s | 10.7× | Fast: 1, Slow: 13 |

**Factors Affecting Performance:**
- **Endpoint size:** More concepts = longer queries
- **Query optimizer:** Better optimizer = faster FILTER NOT EXISTS
- **Network latency:** Slow method makes 13× more round trips
- **Available relationships:** More relationships = more UNION branches

### Strategy Selection in TreePagination

Automatic selection and fallback logic for orphan detection strategy.

**Implementation:** `useTreePagination.ts` composable

**Strategy Flow:**

```
User selects Orphan Concepts
         ↓
Check orphanDetectionStrategy setting
         ↓
    ┌────┴────┐
    │  auto   │  (default)
    └────┬────┘
         ↓
Try calculateOrphanConceptsFast()
         ↓
    Success? ──Yes──> Use fast results
         │
         No (error/timeout)
         ↓
    Log warning + error
         ↓
Fallback: calculateOrphanConcepts()
         ↓
    Use slow results


┌──────────┐         ┌──────────┐
│   fast   │         │   slow   │
└────┬─────┘         └────┬─────┘
     │                    │
     ↓                    ↓
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

### Progress Reporting

Detailed progress tracking for long-running orphan detection operations.

**Implementation:** `useOrphanProgress.ts` types, `useOrphanConcepts.ts` callback

**Progress Phases:**

| Phase | Description | Duration (typical) | UI Display |
|-------|-------------|-------------------|-----------|
| `fetching-all` | Loading all concepts (slow method only) | 2-10s | "Fetching concepts..." |
| `running-exclusions` | Running exclusion queries or FILTER query | 1-70s | "Detecting orphans..." |
| `calculating` | Client-side set subtraction (slow method only) | <1s | "Calculating..." |
| `complete` | Detection finished | - | Results shown |

**Progress Data Structure:**
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

**Slow Method Progress:**
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

**Fast Method Progress:**
```
Phase: running-exclusions
  Query: single-query-orphan-detection
    Progress: "Detecting orphans... (fetched 142 orphans)"

Phase: complete
  Result: "142 orphan concepts found"
```

**UI Integration:**
- Progress shown in ConceptTree component during loading
- Elapsed time displayed for operations >2 seconds
- Per-query metrics logged for debugging
- Completion message shows total orphans found

**Callback Usage:**
```typescript
const orphanProgress = ref<ProgressState | null>(null)

async function loadOrphanConcepts() {
  const uris = await calculateOrphanConcepts(endpoint, (progress) => {
    orphanProgress.value = progress
    // UI updates reactively
  })
}
```

## Label Resolution (Consistent Across All Components)

All components (Tree, Breadcrumb, Details, Search) MUST use the centralized label resolution functions from `useLabelResolver`.

### Property Priority by Resource Type

**Concepts** (`selectConceptLabel`):
1. `skos:prefLabel` - primary SKOS label
2. `skosxl:prefLabel/skosxl:literalForm` - SKOS-XL extended label
3. `rdfs:label` - generic fallback

**Schemes** (`selectSchemeLabel`):
1. `skos:prefLabel` - primary SKOS label
2. `skosxl:prefLabel/skosxl:literalForm` - SKOS-XL extended label
3. `dct:title` - common for schemes
4. `rdfs:label` - generic fallback

### Language Priority (for each property)
1. Preferred language (user selected)
2. Fallback language (user configured)
3. No language tag (untagged literals)
4. Any available language

### Display Format

When displaying concept labels, use the format `notation - label` when both exist:

| Has Notation | Has Label | Display |
|--------------|-----------|---------|
| Yes | Yes | `123 - Albania` |
| Yes | No | `123` |
| No | Yes | `Albania` |
| No | No | URI fragment |

This format MUST be consistent across:
- **Concept tree nodes** (both top concepts and children)
- **Main concept title** (ConceptDetails header)
- **Breadcrumb segments**
- **Narrower/broader/related concept chips**
- **Search results**

### Implementation

```typescript
function getDisplayLabel(notation?: string, label?: string, uri?: string): string {
  const fallbackLabel = label || uri?.split('/').pop() || uri || 'Unknown'

  if (notation && label) {
    return `${notation} - ${label}`
  }
  return notation || fallbackLabel
}
```

### Label Selection Functions

Use the centralized functions from `useLabelResolver`:

```typescript
import { useLabelResolver } from '@/composables'

const { selectConceptLabel, selectSchemeLabel } = useLabelResolver()

// For concepts
const conceptLabel = selectConceptLabel({
  prefLabels: details.prefLabels,
  prefLabelsXL: details.prefLabelsXL,
  rdfsLabels: details.rdfsLabels,
})

// For schemes
const schemeLabel = selectSchemeLabel({
  prefLabels: details.prefLabels,
  prefLabelsXL: details.prefLabelsXL,
  titles: details.title,
  rdfsLabels: details.rdfsLabels,
})
```

### Direct URI Lookup (Go to URI)

Input field to navigate directly to a concept or scheme by URI.

**Behavior:**
The input accepts both concept and scheme URIs:

| URI Type | Action |
|----------|--------|
| Scheme URI | Selects scheme in dropdown, loads tree, shows scheme details |
| Concept URI | Selects concept, loads details, reveals in tree |

**Detection:**
The component checks if the entered URI matches a known scheme URI from `schemeStore.schemes`. If matched, it's treated as a scheme; otherwise as a concept.

**URI Sanitization:**
Input is sanitized before processing:
- Trim whitespace
- Remove accidental `<` and `>` characters (from Turtle/SPARQL copy-paste)

```typescript
const uri = gotoUri.value.trim().replace(/^<|>$/g, '')
```

### View Modes

Toggle between:
- **Tree view**: Nested expandable tree
- **Flat view**: Simple list of narrower concepts

## UI Components

### Concept Tree

```
┌────────────────────────────────┐
│ 🔍 [Go to URI...]              │
├────────────────────────────────┤
│ ▼ Agriculture                  │
│   ├─ ▼ Crops                   │
│   │    ├─ Cereals              │
│   │    ├─ Vegetables           │
│   │    └─ Fruits               │
│   └─ ▶ Livestock               │
│ ▶ Economics                    │
│ ▶ Environment                  │
└────────────────────────────────┘
```

**Scheme as Tree Root:**

When a scheme is selected, the tree wraps top concepts under a synthetic scheme root node:

```
┌────────────────────────────────┐
│ 🔍 [Go to URI...]              │
├────────────────────────────────┤
│ ▼ 🗂 Albania Thesaurus         │  ← Scheme root node
│   ├─ ▶ 123 - Geographic...    │  ← Top concepts
│   ├─ ▶ 456 - Administrative   │
│   └─ ▶ 789 - Economic...      │
└────────────────────────────────┘
```

**Scheme Node Properties:**
```typescript
{
  key: scheme.uri,
  data: { isScheme: true },
  label: scheme.prefLabel,  // Resolved via useLabelResolver
  icon: 'folder_special',   // Material Symbol
  children: topConcepts,    // Array of ConceptNode[]
  leaf: false,              // Always expandable (even if no top concepts)
}
```

**Behavior:**
- **Always visible**: Shown even if scheme has no top concepts (appears as leaf node)
- **Auto-expanded**: Added to `expandedKeys` automatically when scheme loads
- **Clickable**: Clicking navigates to SchemeDetails view (not ConceptDetails)
- **Scroll target**: Home button scrolls to this root node

**Why synthetic node:**
- Provides clear visual hierarchy (scheme contains concepts)
- Makes home button behavior intuitive (scroll to scheme)
- Consistent with file system tree patterns users understand
- Allows scheme-level actions in tree context menu (future)

**Contrast with "All Schemes":**
When "All Schemes" is selected, no scheme root appears - only top concepts from all schemes are shown at root level.

### Breadcrumb

```
┌──────────────────────────────────────────────────────────┐
│ 🏠 > Agriculture > Crops > Cereals > Wheat               │
└──────────────────────────────────────────────────────────┘
```

Each segment is clickable for navigation.

### Home Button

The breadcrumb includes a home button (🏠) that navigates to the scheme root:

**Behavior:**
1. Clears concept selection (`conceptStore.selectConcept(null)`)
2. Shows scheme details in the right panel (`schemeStore.viewScheme(uri)`)
3. Scrolls tree to top via store trigger (`conceptStore.scrollTreeToTop()`)
4. Adds scheme to history with `type: 'scheme'`

**Store Mechanism:**
The scroll-to-top uses a reactive flag pattern since the breadcrumb component doesn't have direct DOM access to the tree:

```typescript
// concept store
const shouldScrollToTop = ref(false)

function scrollTreeToTop() {
  shouldScrollToTop.value = true
}

function resetScrollToTop() {
  shouldScrollToTop.value = false
}

// ConceptTree watches and scrolls
watch(() => conceptStore.shouldScrollToTop, (should) => {
  if (should) {
    document.querySelector('.tree-wrapper')?.scrollTo({ top: 0, behavior: 'smooth' })
    conceptStore.resetScrollToTop()
  }
})
```

## Deprecation Display

Deprecated concepts are visually indicated in the tree based on configurable detection rules.

### Visual Indicator

- **Badge**: `deprecated` text badge displayed after the label
- **Styling**: Node displayed at 60% opacity

### Detection Rules

Deprecation status is determined via SPARQL OPTIONAL clauses added to tree queries. Default rules:

1. **OWL Deprecated**: `owl:deprecated = "true"`
2. **EU Vocabularies Status**: `euvoc:status ≠ <.../concept-status/CURRENT>`

Rules are configurable in Settings and can be enabled/disabled individually.

### Query Extension

```sparql
# Added to SELECT
?deprec_owl_deprecated ?deprec_euvoc_status

# Added to WHERE
OPTIONAL { ?concept owl:deprecated ?deprec_owl_deprecated }
OPTIONAL { ?concept euvoc:status ?deprec_euvoc_status }

# Added to GROUP BY
?deprec_owl_deprecated ?deprec_euvoc_status
```

### Settings

- **Show deprecation indicators**: Toggle visibility (default: on)
- **Detection Rules**: Enable/disable individual rules

## Data Model

```typescript
interface ConceptNode {
  uri: string;
  label: string;
  hasNarrower: boolean;    // Has children (for expand indicator)
  children?: ConceptNode[]; // Loaded on demand
  expanded: boolean;
  deprecated?: boolean;    // Deprecation status
}

interface NavigationState {
  topConcepts: ConceptNode[];
  selectedConcept: string | null;  // URI
  breadcrumb: ConceptNode[];
  viewMode: 'tree' | 'flat';
  loading: boolean;
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `concept:selected` | `string` | Concept URI clicked |
| `concept:expanded` | `string` | Node expanded in tree |
| `concept:collapsed` | `string` | Node collapsed in tree |
| `breadcrumb:clicked` | `string` | Breadcrumb segment clicked |

## UI Behavior

### Label Display
- Labels use **multiline word wrap** instead of truncation with ellipsis
- No horizontal scrollbar; long labels wrap to multiple lines
- Language tags shown inline after label text when needed

### Scrolling
- **Vertical scrolling** enabled when tree content exceeds container height
- **No horizontal scrollbar** - content wraps instead
- Smooth scrolling behavior

### Breadcrumb
- Items display inline horizontally
- Wraps to multiple lines if needed (flex-wrap)
- Each segment is clickable for navigation

## Performance

- Lazy load children on expand (not all at once)
- Cache expanded nodes to avoid re-fetching
- Virtual scrolling for large lists (>100 items)

## Language Change Behavior

When the preferred language changes:
1. All cached children are cleared
2. Expanded state is reset (nodes collapse)
3. Top concepts reload with new language labels
4. Children reload on next expand with correct language

This ensures labels throughout the tree reflect the current language preference.

## Loading & Error States

See [com03-ErrorHandling](../common/com03-ErrorHandling.md) for details.

### Loading Top Concepts

```
┌────────────────────────────────┐
│   ████████████  (skeleton)     │
│   ████████████████             │
│   ██████████                   │
└────────────────────────────────┘
```

### Loading Children

```
│ ▼ Agriculture                  │
│   └─ ◌ Loading...              │
```

### Empty State

```
┌────────────────────────────────┐
│   No top concepts found.       │
│   Use search to find concepts. │
└────────────────────────────────┘
```

### Error State

```
┌────────────────────────────────┐
│   ⚠ Failed to load concepts   │
│   [Retry]                      │
└────────────────────────────────┘
```

## Related Specs

- [com02-StateManagement](../common/com02-StateManagement.md) - State architecture
- [com03-ErrorHandling](../common/com03-ErrorHandling.md) - Error/loading states
- [com05-SPARQLPatterns](../common/com05-SPARQLPatterns.md) - Query patterns
- [sko02-SchemeSelector](./sko02-SchemeSelector.md) - Scheme selection triggers tree reload

## Dependencies

- EndpointManager (for SPARQL connection)
- LanguageSelector (for labels)
- SchemeSelector (for filtering)
