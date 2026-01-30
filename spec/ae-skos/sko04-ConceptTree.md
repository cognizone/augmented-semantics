# ConceptTree

Component for hierarchical browsing of SKOS concepts.

## Features

### Top Concepts

Display root concepts within selected scheme. Top concepts are identified via:

1. **Explicit marking**: `skos:topConceptOf` or scheme's `skos:hasTopConcept`
2. **In-scheme-only**: Concepts with `skos:inScheme` but no hierarchical relationships

#### Two-Step Query Architecture

Tree queries use a two-step loading approach for better performance and maintainability:

1. **Step 1 - Metadata query**: Fetch concept URIs, notation, and hasNarrower flag (no labels)
2. **Step 2 - Label loading**: Separate `loadLabelsForNodes()` call fetches labels using capability-aware queries

This separation allows:
- Faster initial metadata queries (no label UNION overhead)
- Consistent label resolution using `selectLabelByPriority()` from useLabelResolver
- Better caching and deduplication of label fetches

#### Progressive Loading Strategy

For performance, top concepts are loaded using a two-phase sequential approach:

1. **Explicit query (fast)**: Query concepts with `topConceptOf`/`hasTopConcept`
   - Returns in < 500ms for well-formed vocabularies
   - No type check needed (these predicates imply skos:Concept)

2. **In-scheme-only query (slower)**: Query concepts with `skos:inScheme` but no hierarchical relationships
   - Scans all concepts in scheme, may take several seconds
   - Type check included (inScheme can link to non-concepts)
   - Excludes concepts with ANY hierarchical relationship (broader, narrower, topConceptOf, etc.)

3. **Merge**: On first page, both queries run sequentially and results are merged (deduplicated)

This avoids the UNION penalty where SPARQL engines evaluate both branches even when the first finds results.

**Query Mode Tracking**: For pagination, the system tracks which mode was used:
- `explicit`: Only explicit query returned results
- `inscheme`: Explicit was empty/unavailable, using in-scheme-only
- `mixed`: Both contributed unique concepts (uses combined UNION for pagination)

**Queries:**

Uses subqueries to paginate by distinct concepts. Labels are fetched separately via `loadLabelsForNodes()`.

**Explicit Metadata Query (fast path):**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?concept ?notation ?hasNarrower
WHERE {
  {
    SELECT DISTINCT ?concept
    WHERE {
      # No type check - topConceptOf/hasTopConcept imply skos:Concept
      { ?concept skos:topConceptOf <SCHEME_URI> }
      UNION
      { <SCHEME_URI> skos:hasTopConcept ?concept }
    }
    ORDER BY ?concept
    LIMIT 201
    OFFSET 0
  }
  OPTIONAL { ?concept skos:notation ?notation }
  # EXISTS is fast - stops at first match (vs COUNT scans all)
  BIND(EXISTS {
    { [] skos:broader ?concept }
    UNION
    { ?concept skos:narrower [] }
  } AS ?hasNarrower)
}
```

**Note:** Labels are NOT included in metadata queries. After processing results, `loadLabelsForNodes()` is called to fetch labels using capability-aware queries.

**In-Scheme-Only Metadata Query (slow path):**

This query finds concepts that have `skos:inScheme` but no hierarchical relationships. It excludes concepts with ANY placement predicates:

```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?concept ?notation ?hasNarrower
WHERE {
  {
    SELECT DISTINCT ?concept
    WHERE {
      ?concept a skos:Concept .  # Type check needed for inScheme
      ?concept skos:inScheme <SCHEME_URI> .
      # Exclude concepts with ANY hierarchical relationship
      FILTER NOT EXISTS { ?concept skos:broader ?x }
      FILTER NOT EXISTS { ?x skos:narrower ?concept }
      FILTER NOT EXISTS { ?concept skos:broaderTransitive ?x }
      FILTER NOT EXISTS { ?concept skos:narrowerTransitive ?x }
      FILTER NOT EXISTS { ?concept skos:topConceptOf ?x }
      FILTER NOT EXISTS { ?x skos:hasTopConcept ?concept }
    }
    ORDER BY ?concept
    LIMIT 201
    OFFSET 0
  }
  OPTIONAL { ?concept skos:notation ?notation }
  BIND(EXISTS {
    { [] skos:broader ?concept }
    UNION
    { ?concept skos:narrower [] }
  } AS ?hasNarrower)
}
```

**Note:** Labels are fetched separately via `loadLabelsForNodes()` using capability-aware queries.

### Hierarchical Expansion

Load narrower concepts on demand when user expands a node. Supports both `skos:broader` and `skos:narrower` relationships.

**Children Metadata Query:**

Uses a subquery to paginate by distinct concepts. Labels are fetched separately via `loadLabelsForNodes()`.

```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?concept ?notation ?hasNarrower
WHERE {
  {
    SELECT DISTINCT ?concept
    WHERE {
      # No type check - broader/narrower imply skos:Concept
      { ?concept skos:broader <PARENT_URI> }
      UNION
      { <PARENT_URI> skos:narrower ?concept }
    }
    ORDER BY ?concept
    LIMIT 201
    OFFSET 0
  }
  OPTIONAL { ?concept skos:notation ?notation }
  # EXISTS is fast - stops at first match (vs COUNT scans all)
  BIND(EXISTS {
    { [] skos:broader ?concept }
    UNION
    { ?concept skos:narrower [] }
  } AS ?hasNarrower)
}
```

### Label Loading

After metadata queries return `ConceptNode[]` without labels, `loadLabelsForNodes()` enriches them with labels:

**Process:**
1. Build a `VALUES` clause from the concept URIs
2. Use `buildCapabilityAwareLabelUnionClause()` to query only detected label predicates
3. Apply `selectLabelByPriority()` from useLabelResolver to pick the best label

**Label Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX skosxl: <http://www.w3.org/2008/05/skos-xl#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT ?concept ?label ?labelLang ?labelType
WHERE {
  VALUES ?concept { <URI1> <URI2> <URI3> ... }
  OPTIONAL {
    # Capability-aware: includes only predicates detected during endpoint analysis
    { ?concept skos:prefLabel ?label . BIND("prefLabel" AS ?labelType) }
    UNION
    { ?concept skosxl:prefLabel/skosxl:literalForm ?label . BIND("xlPrefLabel" AS ?labelType) }
    UNION
    { ?concept rdfs:label ?label . BIND("rdfsLabel" AS ?labelType) }
    BIND(LANG(?label) AS ?labelLang)
  }
}
```

**Label Selection:**
The `selectLabelByPriority()` function applies language and type priority:
1. Filter by preferred language
2. Apply endpoint language priorities as fallback
3. Select by label type priority (prefLabel > xlPrefLabel > rdfsLabel for concepts)
4. Fall back to first available label

### Performance Optimizations

#### EXISTS vs COUNT for hasNarrower

Use `EXISTS` instead of `COUNT(DISTINCT ?narrower)` to detect children:

| Approach | Behavior | Performance |
|----------|----------|-------------|
| `COUNT(...)` | Scans ALL narrower relationships | Slow for concepts with many children |
| `EXISTS {...}` | Stops at first match | Fast - short-circuit evaluation |

The tree only needs to know IF there are children (show expand arrow), not HOW MANY.

#### Type Check Optimization

| Query Type | Type Check | Reason |
|------------|------------|--------|
| Explicit top concepts | No | `topConceptOf`/`hasTopConcept` imply Concept |
| Children | No | `broader`/`narrower` imply Concept |
| Fallback (inScheme) | Yes | `inScheme` can link to non-concepts |

Removing the type check can provide 40x speedup on some endpoints.

### Scheme URI Slash Fix

Some endpoints have inconsistent scheme URIs where the declared `skos:ConceptScheme` URI differs from the URI used in `skos:inScheme` assertions (typically trailing slash differences).

**Problem:**
```
Declared: http://example.org/scheme/
Used:     http://example.org/scheme   (no trailing slash)
```

Standard queries fail to match concepts to their scheme.

**Solution (`buildSchemeValuesClause()`):**

When `enableSchemeUriSlashFix` is enabled and `analysis.schemeUriSlashMismatch` is `true`, queries use a VALUES clause with both URI variants:

```sparql
VALUES ?scheme { <http://example.org/scheme/> <http://example.org/scheme> }
...
?concept skos:inScheme ?scheme .
```

**Implementation (`utils/schemeUri.ts`):**

| Function | Purpose |
|----------|---------|
| `getSchemeUriVariants()` | Returns array of URI variants to try |
| `buildSchemeValuesClause()` | Generates SPARQL VALUES clause + scheme term |

**Post-Load Correction (`updateHasNarrowerFlags()`):**

The EXISTS-based `hasNarrower` detection in metadata queries may return false negatives on mismatched endpoints. After loading nodes, a correction query verifies which concepts actually have children:

```sparql
SELECT DISTINCT ?concept
WHERE {
  VALUES ?concept { <uri1> <uri2> ... }
  { ?concept skos:narrower ?child }
  UNION
  { ?child skos:broader ?concept }
}
```

This only runs when:
1. `enableSchemeUriSlashFix` setting is `true`
2. `endpoint.analysis.schemeUriSlashMismatch` is `true`

**Affected Queries:**
- Top concepts (explicit and in-scheme-only)
- Children loading
- Collection queries

See [sko03-Settings](./sko03-Settings.md) for the `enableSchemeUriSlashFix` setting.
See [sko12-CurationWorkflow](./sko12-CurationWorkflow.md) for scheme URI mismatch detection.

### Collection Root Mode

When `schemeStore.rootMode === 'collection'`, the tree displays collections as root items instead of concepts.

**Behavior:**
- Top-level collections appear as root tree nodes
- Concepts are only visible as collection members
- Scheme selector is hidden (collections become the root)
- Tree loads via `loadAllCollections()` instead of `loadTopConcepts()`

**Tree Loading:**
```typescript
if (rootMode === 'collection') {
  loadAllCollections()
  return
}
loadTopConcepts()
```

**Root Items:**
| Mode | Root Items | Loading Function |
|------|------------|------------------|
| `scheme` | Top concepts | `loadTopConcepts()` |
| `collection` | Top-level collections | `loadAllCollections()` |

**Conditional Logic Affected:**
- Empty state message: "No collections found" vs "No concepts found"
- Loading message: "Loading collections..." vs "Loading concepts..."
- Refresh button: Calls `loadAllCollections()` vs `loadTopConcepts()`
- Scroll pagination: Disabled in collection mode
- "Go to URI": Skips scheme detection in collection mode

**Shared Collections State:**

The tree uses a shared collections composable to ensure consistent state:

```typescript
const { topLevelCollections, loadAllCollections } = useCollections({ shared: true })
```

The `shared: true` option returns a singleton instance so breadcrumb and tree share the same collections state.

See [sko02-SchemeSelector](./sko02-SchemeSelector.md#root-mode-selector) for mode switching UI.
See [sko05-Collections](./sko05-Collections.md#collection-root-mode) for collection loading details.

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

Show full path from root to current selection.

**IMPORTANT:** Breadcrumb labels MUST match the labels shown in ConceptDetails. Use the same label resolution logic everywhere.

**Separate Path Tracking:**

The breadcrumb maintains separate paths that are merged for display:

```typescript
const conceptPath = ref<ConceptRef[]>([])    // Ancestor concepts
const collectionPath = ref<ConceptRef[]>([]) // Ancestor collections

function updateBreadcrumb() {
  if (isCollectionMode.value) {
    // Collection mode: collection path + concept path (if member selected)
    conceptStore.setBreadcrumb([...collectionPath.value, ...conceptPath.value])
  } else {
    // Scheme mode: concept path only (or collection path if viewing collection)
    conceptStore.setBreadcrumb(conceptPath.value.length > 0
      ? conceptPath.value
      : collectionPath.value)
  }
}
```

**Root Collection Icon Suppression:**

In collection mode, the root collection (first breadcrumb item) renders text-only without an icon:

```typescript
const isRootCollection =
  isCollectionMode.value &&
  item.type === 'collection' &&
  item.uri === conceptStore.selectedCollectionUri
```

Template logic: `v-if="!item.isRootCollection"` guards all icon spans.

**Concept Path Query (iterative):**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?broader ?label ?labelLang ?labelType ?notation ?hasNarrower
WHERE {
  OPTIONAL {
    { <CONCEPT_URI> skos:broader ?broader }
    UNION
    { ?broader skos:narrower <CONCEPT_URI> }
  }
  OPTIONAL { <CONCEPT_URI> skos:notation ?notation }
  OPTIONAL { ... label patterns ... }
}
```

**Collection Path Query (iterative, collection mode only):**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?parent ?label ?labelLang ?labelType ?notation
WHERE {
  OPTIONAL { ?parent skos:member <COLLECTION_URI> }
  OPTIONAL { <COLLECTION_URI> skos:notation ?notation }
  OPTIONAL { ... label patterns ... }
}
```

Uses `skos:member` to traverse up the collection hierarchy (collections containing this collection).

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
    |
Switch Endpoint/Scheme (if different)
    |
await nextTick() (wait for reactivity)
    |
Select Concept (sets selectedUri)
    |
selectedUri Watch fires
    |
If loadingTree -> skip (wait for load)
If !loadingTree -> reveal concept
    |
loadingTree Watch fires when load completes
    |
If selectedUri exists -> reveal concept
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
         |
selectConceptWithScheme(uri, schemeUri)
         |
conceptStore.requestReveal(uri)  <- Set pending reveal
         |
schemeStore.setSelectedScheme(schemeUri)
         |
ConceptTree: watch scheme change -> clear tree
         |
ConceptTree: load top concepts
         |
ConceptTree: emit tree:loaded event
         |
ConceptTree: event listener checks pendingRevealUri
         |
If pending -> useTreeNavigation.revealConcept(uri)
         |
After scroll completes
         |
conceptStore.markConceptRevealed(uri)
         |
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
1. If `endpointUrl` provided and different from current -> switch endpoint
2. If `schemeUri` not provided -> discover via SPARQL query
3. Switch scheme **before** selecting concept (order critical for tree loading)
4. Call `requestReveal(uri)` to coordinate with tree loading
5. Switch to browse tab (if currently on search or other tab)

**Integration Points:**
- SearchBox: Click search result -> `selectConceptWithScheme(uri)`
- RecentHistory: Click history item -> `selectConceptWithScheme(uri, schemeUri, endpointUrl)`
- ConceptDetails: Click relation -> `selectConceptWithScheme(uri)` (discovers scheme)
- URL parameters: `?concept=URI` -> `selectConceptWithScheme(uri)` (discovers scheme)

### Orphan Detection

See [sko08-OrphanDetection](./sko08-OrphanDetection.md) for orphan concept detection methods, strategies, and progress reporting.

## Label Resolution

Tree labels follow the unified label priority and display consistency defined in [sko01-LanguageSelector.md](./sko01-LanguageSelector.md#label-display-consistency).

**Display format**: `notation - label` or `notation || label || uri.split('/').pop()`

| Has Notation | Has Label | Display |
|--------------|-----------|---------|
| Yes | Yes | `123 - Albania` |
| Yes | No | `123` |
| No | Yes | `Albania` |
| No | No | URI fragment |

### Direct URI Lookup (Go to URI)

Input field to navigate directly to a concept, collection, or scheme by URI.

**Behavior:**
The input accepts scheme, collection, and concept URIs:

| URI Type | Action |
|----------|--------|
| Scheme URI | Selects scheme in dropdown, loads tree, shows scheme details |
| Collection URI | Selects collection, shows collection details |
| Concept URI | Selects concept, loads details, reveals in tree |
| Invalid URI | Shows warning message (auto-dismisses after 3 seconds) |

**Detection Order:**
1. Check if URI matches a known scheme URI from `schemeStore.schemes`
2. Query endpoint: `ASK { <URI> a skos:Collection }`
3. Query endpoint: `ASK { <URI> a skos:Concept }`
4. If none match, display warning

**URI Sanitization:**
Input is sanitized before processing:
- Trim whitespace
- Remove accidental `<` and `>` characters (from Turtle/SPARQL copy-paste)

```typescript
const uri = gotoUri.value.trim().replace(/^<|>$/g, '')
```

See also: [sko05-Collections](./sko05-Collections.md#go-to-uri---collection-detection) for collection detection details.

### View Modes

Toggle between:
- **Tree view**: Nested expandable tree
- **Flat view**: Simple list of narrower concepts

## SKOS Collections

See [sko05-Collections](./sko05-Collections.md) for full SKOS Collections support including:
- Collection loading and nested collections
- Collection display in tree
- Collection selection and details
- Collection breadcrumb

## UI Components

### Concept Tree

```
+--------------------------------+
| [Go to URI...]                 |
+--------------------------------+
| > Agriculture                  |
|   +-- > Crops                  |
|   |    +-- Cereals             |
|   |    +-- Vegetables          |
|   |    +-- Fruits              |
|   +-- > Livestock              |
| > Economics                    |
| > Environment                  |
+--------------------------------+
```

**Scheme as Tree Root:**

When a scheme is selected, the tree wraps top concepts under a synthetic scheme root node:

```
+--------------------------------+
| [Go to URI...]                 |
+--------------------------------+
| > Albania Thesaurus            |  <- Scheme root node
|   +-- > 123 - Geographic...    |  <- Top concepts
|   +-- > 456 - Administrative   |
|   +-- > 789 - Economic...      |
+--------------------------------+
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

#### Node Icons

Each tree node displays an icon indicating its type and source:

| Node Type | Icon | CSS Class | Description |
|-----------|------|-----------|-------------|
| Scheme | `folder` | `icon-folder` | Concept scheme root node |
| Collection | `collections_bookmark` | `icon-collection` | SKOS Collection |
| Concept (with children) | `label` | `icon-label` | Has narrower concepts |
| Concept (leaf) | `circle` | `icon-leaf` | No narrower concepts |
| **In-scheme-only top concept** | `radio_button_unchecked` | `icon-top-fallback` | Fallback top concept (see below) |

**In-Scheme-Only Visual Indicator:**

Top concepts found via the `skos:inScheme` fallback query (not explicit `topConceptOf`/`hasTopConcept`) display a hollow circle icon with muted color. This visual distinction indicates:

- The concept is placed at the root level because it has `skos:inScheme` but no hierarchical relationships
- It may represent an improperly modeled concept or a flat vocabulary without hierarchy
- Users can identify which top concepts are "official" vs "fallback"

The `topConceptSource: 'inscheme'` flag on `ConceptRef` tracks this distinction, populated from the `?isInSchemeOnly` SPARQL variable in combined pagination queries.

### Breadcrumb

```
+----------------------------------------------------------+
| Home > Agriculture > Crops > Cereals > Wheat              |
+----------------------------------------------------------+
```

Each segment is clickable for navigation.

### Home Button

The breadcrumb includes a home button that navigates to the scheme root:

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
2. **EU Vocabularies Status**: `euvoc:status != <.../concept-status/CURRENT>`

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
+--------------------------------+
|   ============  (skeleton)     |
|   ================             |
|   ==========                   |
+--------------------------------+
```

### Loading Children

```
| > Agriculture                  |
|   +-- Loading...               |
```

### Empty State

```
+--------------------------------+
|   No top concepts found.       |
|   Use search to find concepts. |
+--------------------------------+
```

### Error State

```
+--------------------------------+
|   Warning: Failed to load      |
|   [Retry]                      |
+--------------------------------+
```

## Related Specs

- [com02-StateManagement](../common/com02-StateManagement.md) - State architecture
- [com03-ErrorHandling](../common/com03-ErrorHandling.md) - Error/loading states
- [com05-SPARQLPatterns](../common/com05-SPARQLPatterns.md) - Query patterns
- [sko02-SchemeSelector](./sko02-SchemeSelector.md) - Scheme selection triggers tree reload
- [sko13-PropertyAnalysis](./sko13-PropertyAnalysis.md) - Property comparison across Concept, Scheme, and Collection details
- [sko05-Collections](./sko05-Collections.md) - SKOS Collections support
- [sko08-OrphanDetection](./sko08-OrphanDetection.md) - Orphan concept detection

## Dependencies

- EndpointManager (for SPARQL connection)
- LanguageSelector (for labels)
- SchemeSelector (for filtering)
