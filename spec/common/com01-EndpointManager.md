# EndpointManager

Shared component for SPARQL endpoint connection, management, and analysis.

## Browser-Based SPARQL Connection

### How It Works

The browser connects directly to SPARQL endpoints using the standard **Fetch API**. SPARQL endpoints expose an HTTP interface that accepts queries via GET or POST requests.

```
Browser (AE Tool) --HTTP/HTTPS--> SPARQL Endpoint
```

**Request format:**
- **GET**: Query passed as URL parameter `?query=SELECT...`
- **POST**: Query in request body with `Content-Type: application/x-www-form-urlencoded` or `application/sparql-query`

**Response formats:**
- `application/sparql-results+json` - JSON results (preferred)
- `application/sparql-results+xml` - XML results
- `text/turtle`, `application/ld+json` - For CONSTRUCT queries

### CORS Requirements

For browser-based direct connections, the SPARQL endpoint **must** have CORS enabled. The endpoint needs to send appropriate headers:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Accept
```

**Note:** Most public SPARQL endpoints (DBpedia, Wikidata, etc.) have CORS enabled. Private endpoints may need configuration.

### Authentication

Optional authentication methods:
- **None** - Public endpoints
- **Basic Auth** - Username/password in Authorization header
- **API Key** - Custom header or query parameter
- **Bearer Token** - OAuth2 token in Authorization header

### Request Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Timeout | 60000ms | Request timeout (AbortController) |
| Method | POST | HTTP method for queries |
| Max retries | 3 | Automatic retry attempts |
| Retry delay | 1000ms | Initial retry delay (exponential backoff) |

See [com03-ErrorHandling](./com03-ErrorHandling.md) for retry logic details.

## Endpoint Analysis

Run analysis queries on connection to detect endpoint characteristics.

### Analysis Steps

Analysis runs automatically on endpoint connection and can be re-triggered via "Re-analyze" button.

**Steps:**
1. **JSON Support** - Test if endpoint returns JSON responses (`detectJsonSupport()`)
2. **SKOS Content** - Check for ConceptSchemes or Concepts
3. **Named Graphs** - Detect graph support
4. **SKOS Graphs** - Count graphs with SKOS content (conditional on step 3)
5. **Concept Schemes** - Detect and store scheme URIs (max 200)
6. **Concepts** - Count total concepts
7. **Collections** - Count SKOS Collections
8. **Ordered Collections** - Count SKOS OrderedCollections
9. **Relationships** - Detect SKOS relationship capabilities (7 properties)
10. **Label Predicates** - Detect available label predicates per resource type
11. **Languages** - Detect available label languages

```
┌─────────────────────────────────────────────────────────────┐
│ SPARQL Capabilities                                    [×]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ✓ ( 1/11) JSON Support: yes                                │
│ ✓ ( 2/11) SKOS Content: yes                                │
│ ✓ ( 3/11) Named Graphs: yes                                │
│ ✓ ( 4/11) SKOS Graphs: 3                                   │
│ ✓ ( 5/11) Concept Schemes: 101                             │
│ ✓ ( 6/11) Concepts: 3,439                                  │
│ ✓ ( 7/11) Collections: 12                                  │
│ ✓ ( 8/11) Ordered Collections: 0                           │
│ ✓ ( 9/11) Relationships: 5/7                               │
│ ✓ (10/11) Label Predicates: 3                              │
│ ✓ (11/11) Languages: 45                                    │
│                                                             │
│ Last analyzed: 2 hours ago                                  │
├─────────────────────────────────────────────────────────────┤
│                              [Re-analyze]  [Close]          │
└─────────────────────────────────────────────────────────────┘
```

### Step 1: Graph Detection

Detect if endpoint uses named graphs using a 3-method approach:

**Method 1: Empty Graph Pattern** (fastest)
```sparql
SELECT (COUNT(DISTINCT ?g) AS ?count)
WHERE { GRAPH ?g { } }
```

**Method 2: Triple Pattern** (fallback if Method 1 fails)
```sparql
SELECT (COUNT(DISTINCT ?g) AS ?count)
WHERE { GRAPH ?g { [] [] [] } }
```

**Method 3: Enumeration** (fallback if count fails)
```sparql
SELECT DISTINCT ?g
WHERE { GRAPH ?g { [] [] [] } }
LIMIT 10001
```

**Results:**
- `null` (not supported) - Endpoint doesn't support GRAPH queries
- `0` (no graphs) - Single default graph
- `n` (count) - Number of named graphs (10000+ if enumeration hit limit)

**Display:**
- "not supported" - Graphs not available
- "none found" - No named graphs
- "12 graphs (empty graph pattern)" - Shows count and method used

### Step 2: Duplicate Detection

Check if same triples exist in multiple graphs (only if multiple graphs exist).

**Query:**
```sparql
ASK {
  GRAPH ?g1 { ?s ?p ?o }
  GRAPH ?g2 { ?s ?p ?o }
  FILTER(?g1 != ?g2)
}
```

**Conditions:**
- **Skipped** if `supportsNamedGraphs === null` (not supported)
- **Skipped** if `graphCount <= 1` (no multiple graphs)
- **Run** if multiple graphs exist

**Results:**
- `true` - Duplicates found across graphs (warning)
- `false` - No duplicates

### Step 3: Language Detection

Detect available languages from SKOS concept labels.

**Query (default):**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX skosxl: <http://www.w3.org/2008/05/skos-xl#>

SELECT ?lang (COUNT(?label) AS ?count)
WHERE {
  ?concept a skos:Concept .
  {
    ?concept skos:prefLabel|skos:altLabel|skos:hiddenLabel
             |skos:definition|skos:scopeNote ?label .
  } UNION {
    ?concept skosxl:prefLabel/skosxl:literalForm ?label .
  } UNION {
    ?concept skosxl:altLabel/skosxl:literalForm ?label .
  }
  BIND(LANG(?label) AS ?lang)
  FILTER(?lang != "")
}
GROUP BY ?lang
ORDER BY DESC(?count)
```

**Query (graph-scoped):** Used when duplicates exist to ensure concept+labels are in same graph.
```sparql
SELECT ?lang (COUNT(?label) AS ?count)
WHERE {
  GRAPH ?g {
    ?concept a skos:Concept .
    # ... same pattern ...
  }
}
GROUP BY ?lang
ORDER BY DESC(?count)
```

### Analysis Data Model

**Note:** The implementation uses a SKOS-centric analysis approach optimized for SKOS vocabularies, which differs from the generic graph analysis described above.

```typescript
interface EndpointAnalysis {
  // SKOS Content (replaces generic graph detection)
  hasSkosContent: boolean              // true if endpoint contains SKOS ConceptSchemes or Concepts

  // SPARQL result formats
  supportsJsonResults?: boolean | null // true = JSON supported, false = XML-only, null = detection failed

  supportsNamedGraphs: boolean | null  // null = not supported, false = none, true = has graphs
  skosGraphCount: number | null        // null = count failed, number = SKOS graphs found

  // Concept Schemes (URIs only - labels fetched dynamically)
  schemeUris?: string[]         // List of scheme URIs (max 200)
  schemeCount?: number          // Total count found
  schemesLimited?: boolean      // true if more schemes exist than stored

  // SKOS Statistics
  totalConcepts?: number              // Total concept count
  totalCollections?: number           // Total SKOS Collection count
  totalOrderedCollections?: number    // Total SKOS OrderedCollection count
  relationships?: {                   // Detected SKOS relationship capabilities
    hasInScheme: boolean
    hasTopConceptOf: boolean
    hasHasTopConcept: boolean
    hasBroader: boolean
    hasNarrower: boolean
    hasBroaderTransitive: boolean
    hasNarrowerTransitive: boolean
  }

  // Label predicates per resource type (detected during analysis)
  labelPredicates?: LabelPredicatesByResourceType

  // Languages (sorted by count descending)
  languages?: DetectedLanguage[]

  analyzedAt: string  // ISO timestamp
}

interface LabelPredicateCapabilities {
  prefLabel?: boolean      // skos:prefLabel
  xlPrefLabel?: boolean    // skosxl:prefLabel/skosxl:literalForm
  dctTitle?: boolean       // dct:title
  dcTitle?: boolean        // dc:title
  rdfsLabel?: boolean      // rdfs:label
}

interface LabelPredicatesByResourceType {
  concept?: LabelPredicateCapabilities
  scheme?: LabelPredicateCapabilities
  collection?: LabelPredicateCapabilities
}

interface DetectedLanguage {
  lang: string   // ISO 639-1 code (e.g., 'en')
  count: number  // Number of labels found
}
```

**Changes from generic specification:**
- `hasSkosContent` replaces generic content detection (SKOS-specific)
- `supportsJsonResults` indicates JSON vs XML-only response format support
- `skosGraphCount` counts only graphs containing SKOS data (not all graphs)
- `graphCount` and `graphCountExact` removed (generic graph counting not implemented)
- `hasDuplicateTriples` removed (duplicate detection not implemented)
- `schemeUris` stores the whitelist of concept schemes to display in the UI
- `totalCollections` and `totalOrderedCollections` count SKOS collection types
- `labelPredicates` tracks available label predicates per resource type (concept, scheme, collection)

See **SKOS-Specific Analysis** section below for implementation details.

### Analysis Log Display

During re-analysis, show step-by-step progress with colored status indicators:

| Status | Icon | Color |
|--------|------|-------|
| Pending | Spinner | Blue |
| Success | Check circle | Green |
| Warning | Triangle | Orange |
| Error | X circle | Red |
| Info | Info circle | Gray |

### Result Format Badge

The endpoint list displays a badge indicating the SPARQL result format supported by each endpoint:

| Badge | Color | Meaning |
|-------|-------|---------|
| JSON | Green (success) | Endpoint returns `application/sparql-results+json` |
| XML | Orange (warning) | Endpoint only returns XML results (parsed client-side) |

**Display Logic:**
- Badge appears in the endpoint list (DataTable) as a severity tag
- Based on `analysis.supportsJsonResults` value:
  - `true` → Green "JSON" badge
  - `false` → Orange "XML" badge
  - `null` or undefined → No badge (detection failed or not analyzed)

**Detection Method (`detectJsonSupport()`):**
```typescript
// Send ASK query with JSON Accept header
const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Accept': 'application/sparql-results+json',
  },
  body: `query=ASK { ?s ?p ?o }&format=json`,
})

// Check response content type and parse attempt
if (contentType.includes('xml') || text.startsWith('<?xml')) {
  return false  // XML-only endpoint
}
JSON.parse(text)  // Validate JSON
return true       // JSON supported
```

**Why This Matters:**
- JSON responses are faster to parse in the browser
- XML-only endpoints require client-side XML parsing (slower, more complex)
- Helps users understand endpoint capabilities at a glance

### SKOS-Specific Analysis

The implemented analysis focuses on detecting SKOS content and optimizing for SKOS vocabulary endpoints.

**SKOS Graph Detection Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT DISTINCT ?g WHERE {
  GRAPH ?g {
    {
      # Detect ConceptSchemes
      ?s a skos:ConceptScheme .
    }
    UNION
    {
      # Detect Concepts with labels
      ?s a skos:Concept .
      ?s skos:prefLabel ?label .
    }
  }
} LIMIT 501
```

**Detection Logic:**
1. Query returns up to 501 SKOS graphs
2. If count ≤ 500: Store graph URIs for batched language detection
3. If count > 500: Only store count (too many to batch)

**Named Graph Support:**
```sparql
# Simple boolean check for named graph support
ASK { GRAPH ?g { ?s ?p ?o } }
```

Returns:
- `true` - Endpoint supports GRAPH keyword
- `false` - Default graph only
- `null` - Query failed

**Batched Language Detection:**

When ≤ 500 SKOS graphs are found, language detection uses batched graph-scoped queries for better performance:

```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX skosxl: <http://www.w3.org/2008/05/skos-xl#>

SELECT ?lang (COUNT(?label) AS ?count)
WHERE {
  # Batch of up to 10 graphs per query
  VALUES ?g { <graph1> <graph2> <graph3> ... }
  GRAPH ?g {
    ?concept a skos:Concept .
    {
      ?concept skos:prefLabel|skos:altLabel|skos:hiddenLabel ?label .
    } UNION {
      ?concept skosxl:prefLabel/skosxl:literalForm ?label .
    } UNION {
      ?concept skosxl:altLabel/skosxl:literalForm ?label .
    }
    BIND(LANG(?label) AS ?lang)
    FILTER(?lang != "")
  }
}
GROUP BY ?lang
ORDER BY DESC(?count)
```

**Batching Strategy:**
- Groups of 10 graphs per query (configurable)
- Reduces query count for large endpoints
- Prevents timeout on endpoints with 500+ graphs

**Why SKOS-Centric:**
1. **Performance** - Scoped to SKOS data only, ignoring non-vocabulary graphs
2. **Relevance** - AE SKOS tool only works with SKOS vocabularies
3. **Batching** - Enables efficient language detection on large endpoints
4. **Simplicity** - Avoids complex duplicate detection queries

### Graph Count Thresholds

The 500-graph limit is a performance optimization for large endpoints with many SKOS graphs.

**Implementation:** `services/sparql.ts` graph enumeration

**Threshold Logic:**

| Graph Count | Storage | Language Detection | Display |
|-------------|---------|-------------------|---------|
| 0 | N/A | Unbatched (default graph) | "None" |
| 1-500 | Store URIs in `skosGraphUris` | Batched (10 graphs/query) | Exact count (e.g., "42 graphs") |
| 501+ | `skosGraphUris = null` | Unbatched (slower) | "500+ graphs" |

**Why 500 Limit:**
- **Batching overhead:** Language detection batches 10 graphs per query
- **Query count:** 500 graphs = 50 language detection queries
- **Storage cost:** Storing 500+ URIs in analysis object is inefficient (>50KB JSON)
- **Diminishing returns:** Most SKOS endpoints have <100 graphs
- **500+ indicates:** Massive multi-vocabulary dataset (e.g., European Data Portal with 1000+ graphs)

**Detection Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT DISTINCT ?g WHERE {
  GRAPH ?g {
    {
      ?s a skos:ConceptScheme .
    }
    UNION
    {
      ?s a skos:Concept .
      ?s skos:prefLabel ?label .
    }
  }
} LIMIT 501
```

**Processing:**
```typescript
const results = await executeSparql(endpoint, query)
const graphUris = results.results.bindings.map(b => b.g?.value).filter(Boolean)
const count = graphUris.length

if (count > 500) {
  // Hit limit - don't store URIs
  return {
    skosGraphCount: count,  // Store actual count (or ">500" estimate)
    skosGraphUris: null,    // Don't store URIs
  }
} else {
  // Within limit - store URIs for batching
  return {
    skosGraphCount: count,
    skosGraphUris: graphUris,
  }
}
```

**Data Model:**
```typescript
interface EndpointAnalysis {
  skosGraphCount: number | null        // null = detection failed, number = graphs
  skosGraphUris?: string[] | null      // URIs when ≤500, null when >500
  // ...
}
```

**Display Logic (useEndpointCapabilities):**
```typescript
const graphCountDisplay = computed(() => {
  const count = endpoint.value?.analysis?.skosGraphCount
  const hasUris = endpoint.value?.analysis?.skosGraphUris !== null

  if (count === null || count === undefined) return 'Unknown'
  if (count === 0) return 'None'
  if (count > 500 && !hasUris) return '500+ graphs'
  return `${count} graph${count === 1 ? '' : 's'}`
})
```

**Impact on Language Detection:**
- **≤500 graphs:** Uses batched graph-scoped queries (10 graphs/query)
- **>500 graphs:** Falls back to unbatched default-graph query
- **Performance difference:** Batched is 5-10× faster for large endpoints

**UI Tooltip:**
When "500+ graphs" is displayed:
```
"More than 500 graphs contain SKOS data (too many to process individually).
Language detection will use unbatched queries."
```

### Concept Scheme Detection

Detects SKOS ConceptSchemes and stores their URIs for use in the SchemeSelector.

**Purpose:**
- Provides whitelist of schemes for SchemeSelector dropdown
- Enables config-driven scheme visibility (app.json controls which schemes appear)
- Labels fetched dynamically based on language priorities

**Detection Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT (COUNT(DISTINCT ?scheme) AS ?count)
WHERE {
  ?scheme a skos:ConceptScheme .
}
```

Then fetch URIs (limited to MAX_STORED_SCHEMES = 200):
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT DISTINCT ?scheme
WHERE {
  ?scheme a skos:ConceptScheme .
}
LIMIT 200
```

**Data Model:**
```typescript
interface EndpointAnalysis {
  schemeUris?: string[]      // URIs of detected schemes (max 200)
  schemeCount?: number       // Total count found
  schemesLimited?: boolean   // true if count > 200
}
```

**Processing Logic:**
1. Count total schemes
2. If count ≤ 200: Store all URIs, `schemesLimited = false`
3. If count > 200: Store first 200 URIs, `schemesLimited = true`

**Usage:**
- SchemeSelector uses `schemeUris` as whitelist (no fallback discovery)
- app.json can override with custom scheme list for branded deployments
- Labels fetched at runtime via VALUES clause query

### Relationship Capabilities

Detection of SKOS relationship properties available in the endpoint. Used for capability-aware orphan detection query building.

**Implementation:** `services/sparql.ts` relationship detection

**Purpose:**
- Enables conditional orphan detection queries
- Builds optimal FILTER NOT EXISTS patterns
- Avoids querying for relationships that don't exist
- Improves query performance by reducing UNION branches

**Detected Properties:**

| Capability | SKOS Property | Usage |
|------------|---------------|-------|
| `hasInScheme` | `skos:inScheme` | Direct scheme membership |
| `hasTopConceptOf` | `skos:topConceptOf` | Top concept → scheme |
| `hasHasTopConcept` | `skos:hasTopConcept` | Scheme → top concept (inverse) |
| `hasBroader` | `skos:broader` | Narrower → broader (hierarchical) |
| `hasNarrower` | `skos:narrower` | Broader → narrower (hierarchical, inverse) |
| `hasBroaderTransitive` | `skos:broaderTransitive` | Transitive closure of broader |
| `hasNarrowerTransitive` | `skos:narrowerTransitive` | Transitive closure of narrower |

**Detection Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT
  (COUNT(?inScheme) > 0 AS ?hasInScheme)
  (COUNT(?topConceptOf) > 0 AS ?hasTopConceptOf)
  (COUNT(?hasTopConcept) > 0 AS ?hasHasTopConcept)
  (COUNT(?broader) > 0 AS ?hasBroader)
  (COUNT(?narrower) > 0 AS ?hasNarrower)
  (COUNT(?broaderTransitive) > 0 AS ?hasBroaderTransitive)
  (COUNT(?narrowerTransitive) > 0 AS ?hasNarrowerTransitive)
WHERE {
  OPTIONAL { ?c skos:inScheme ?inScheme }
  OPTIONAL { ?c skos:topConceptOf ?topConceptOf }
  OPTIONAL { ?s skos:hasTopConcept ?hasTopConcept }
  OPTIONAL { ?c skos:broader ?broader }
  OPTIONAL { ?c skos:narrower ?narrower }
  OPTIONAL { ?c skos:broaderTransitive ?broaderTransitive }
  OPTIONAL { ?c skos:narrowerTransitive ?narrowerTransitive }
}
```

**Data Model:**
```typescript
interface EndpointAnalysis {
  // ... existing fields
  relationships?: {
    hasInScheme: boolean
    hasTopConceptOf: boolean
    hasHasTopConcept: boolean
    hasBroader: boolean
    hasNarrower: boolean
    hasBroaderTransitive: boolean
    hasNarrowerTransitive: boolean
  }
}
```

**Usage in Orphan Detection:**
The fast orphan detection method (`buildSingleOrphanQuery`) uses these capabilities to build a dynamic FILTER NOT EXISTS query:

```typescript
function buildSingleOrphanQuery(endpoint: SPARQLEndpoint): string | null {
  const rel = endpoint.analysis?.relationships
  if (!rel) return null

  const unionBranches: string[] = []

  // Only include branches for detected relationships
  if (rel.hasInScheme) {
    unionBranches.push('{ ?concept skos:inScheme ?scheme . }')
  }
  if (rel.hasHasTopConcept) {
    unionBranches.push('{ ?scheme skos:hasTopConcept ?concept . }')
  }
  if (rel.hasTopConceptOf) {
    unionBranches.push('{ ?concept skos:topConceptOf ?scheme . }')
  }
  // ... more branches based on capabilities

  if (unionBranches.length === 0) return null

  return `
    SELECT DISTINCT ?concept
    WHERE {
      ?concept a skos:Concept .
      FILTER NOT EXISTS {
        ${unionBranches.join('\n        UNION\n        ')}
      }
    }
  `
}
```

**Benefits:**
- **Query optimization:** Only includes necessary UNION branches
- **Universal compatibility:** Works with endpoints missing some properties
- **Performance:** Smaller queries execute faster
- **Correctness:** Doesn't fail on endpoints without transitive properties

**Example Capability Profiles:**

| Endpoint Type | Typical Capabilities | Query Complexity |
|---------------|---------------------|------------------|
| Minimal | `hasInScheme` only | 1 UNION branch |
| Standard | `hasInScheme`, `hasTopConceptOf`, `hasBroader`, `hasNarrower` | 4-6 UNION branches |
| Complete | All 7 properties | 11 UNION branches |
| Rich (with transitives) | All properties + transitives | Maximum complexity |

### Batching Strategy Details

Comprehensive batching approach for large endpoints with many SKOS graphs.

**Goal:** Reduce query count and improve performance for language detection on multi-graph endpoints.

**Strategy Summary:**

| Graphs | Approach | Queries | Performance |
|--------|----------|---------|-------------|
| 0 (default graph) | Unbatched | 1 | Fast |
| 1-10 | Single batch | 1 | Fast |
| 11-500 | Multiple batches (10/batch) | 2-50 | Good |
| 501+ | Unbatched (fallback) | 1 | Slower |

**Batch Size:** 10 graphs per query (configurable)

**Why 10 graphs per batch:**
- Balance between query size and query count
- Prevents timeout on slow endpoints
- Keeps query complexity manageable
- Standard SPARQL engines handle VALUES with 10 URIs efficiently

**Batched Language Detection Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX skosxl: <http://www.w3.org/2008/05/skos-xl#>

SELECT ?lang (COUNT(?label) AS ?count)
WHERE {
  # Batch of 10 graphs
  VALUES ?g {
    <http://graph1>
    <http://graph2>
    <http://graph3>
    # ... up to 10 URIs
  }

  GRAPH ?g {
    ?concept a skos:Concept .
    {
      ?concept skos:prefLabel|skos:altLabel|skos:hiddenLabel ?label .
    } UNION {
      ?concept skosxl:prefLabel/skosxl:literalForm ?label .
    } UNION {
      ?concept skosxl:altLabel/skosxl:literalForm ?label .
    }
    BIND(LANG(?label) AS ?lang)
    FILTER(?lang != "")
  }
}
GROUP BY ?lang
ORDER BY DESC(?count)
```

**Processing Logic:**
```typescript
async function detectLanguages(endpoint: SPARQLEndpoint): Promise<DetectedLanguage[]> {
  const graphUris = endpoint.analysis?.skosGraphUris

  if (!graphUris || graphUris.length === 0) {
    // No graphs or >500 graphs → unbatched query
    return await runUnbatchedLanguageQuery(endpoint)
  }

  // Batch graphs (10 per query)
  const batchSize = 10
  const batches = chunkArray(graphUris, batchSize)
  const languageCounts = new Map<string, number>()

  for (const batch of batches) {
    const results = await runBatchedLanguageQuery(endpoint, batch)
    // Aggregate counts across batches
    for (const { lang, count } of results) {
      languageCounts.set(lang, (languageCounts.get(lang) || 0) + count)
    }
  }

  return Array.from(languageCounts.entries())
    .map(([lang, count]) => ({ lang, count }))
    .sort((a, b) => b.count - a.count)
}
```

**Performance Comparison:**

| Endpoint | Graphs | Unbatched | Batched (10/batch) | Speedup |
|----------|--------|-----------|-------------------|---------|
| Small | 5 | 1.2s | 0.8s | 1.5× |
| Medium | 50 | 8.4s | 1.7s | 4.9× |
| Large | 500 | 67.3s | 8.2s | 8.2× |
| Very Large | 1000+ | N/A (timeout) | N/A (unbatched) | - |

**Fallback Behavior:**
When >500 graphs detected:
1. Don't store `skosGraphUris` (too many)
2. Use unbatched query (default graph pattern)
3. Display "500+ graphs" with tooltip
4. Language detection slower but still works

**Error Handling:**
- If batched query fails → fall back to unbatched
- If individual batch fails → skip and continue
- Aggregate results from successful batches
- Log warnings for failed batches

**Configuration:**
```typescript
const GRAPH_BATCH_SIZE = 10          // Graphs per VALUES clause
const MAX_STORABLE_GRAPHS = 500      // Storage threshold
const GRAPH_DETECTION_LIMIT = 501    // LIMIT in SKOS graph query
```

## Endpoint Data Model

```typescript
interface SPARQLEndpoint {
  id: string                     // UUID
  name: string                   // User-defined display name
  url: string                    // Endpoint URL
  auth?: EndpointAuth            // Authentication config
  analysis?: EndpointAnalysis    // Analysis results
  selectedGraphs?: string[]      // User-selected graphs (empty = all)
  languagePriorities?: string[]  // User-ordered language codes
  createdAt: string              // ISO timestamp
  lastAccessedAt?: string        // ISO timestamp
  accessCount: number            // Times accessed
}

interface EndpointAuth {
  type: 'none' | 'basic' | 'apikey' | 'bearer'
  credentials?: {
    username?: string
    password?: string
    apiKey?: string
    token?: string
    headerName?: string  // For API key: custom header name
  }
}
```

## Implementation Architecture

EndpointManager follows a composable-based architecture with extracted dialog components, consistent with the patterns used in ConceptDetails and SchemeDetails refactoring.

### Component Structure

**EndpointManager.vue** (~514 lines)
- Endpoint list with DataTable
- CRUD operations coordination
- Connection testing
- Developer mode: JSON export (when enabled in settings)

### Developer Mode

When `developerMode` is enabled in settings, a download button appears in the endpoint list actions. This allows developers to export endpoint analysis data as JSON for use in other tools or documentation.

**Availability:**
- Hidden when config mode is active (app.json present)
- Controlled by `Settings → Developer → Developer mode` checkbox

**Export Format:**
```json
{
  "name": "Endpoint Name",
  "url": "https://example.org/sparql",
  "analysis": {
    "hasSkosContent": true,
    "supportsNamedGraphs": true,
    "skosGraphCount": 5,
    "languages": [...],
    "schemeUris": [...],
    "totalConcepts": 5000,
    "relationships": {...},
    "analyzedAt": "2024-01-01T00:00:00Z"
  },
  "exportedAt": "2024-01-01T12:00:00Z"
}
```

**EndpointWizard.vue** (~600 lines)
- 3-step stepper wizard for add/edit:
  - Step 1: Basic Info (name, URL, authentication)
  - Step 2: Capabilities (SKOS content, graphs, schemes, concepts, relationships)
  - Step 3: Languages (drag-and-drop priority ordering)
- Handles both add and edit modes

**EndpointDeleteDialog.vue** (~101 lines)
- Deletion confirmation dialog

### Composables

Five reusable composables encapsulate business logic:

#### useEndpointTest
**Purpose:** Connection testing with state management

```typescript
function useEndpointTest() {
  const testing = ref(false)
  const testResult = ref<TestResult | null>(null)

  async function testConnection(endpoint: SPARQLEndpoint): Promise<TestResult>
  function clearResult()

  return { testing, testResult, testConnection, clearResult }
}
```

Features:
- Calls `testConnection()` service
- Tracks testing state
- Auto-dismisses success after 3 seconds
- Returns formatted test results

#### useEndpointAnalysis
**Purpose:** Endpoint analysis and reanalysis with logging

```typescript
function useEndpointAnalysis() {
  const analyzing = ref(false)
  const analyzeStep = ref<string | null>(null)
  const analyzeElapsed = useElapsedTime(analyzing)
  const analysisLog = ref<AnalysisLogEntry[]>([])

  async function analyzeEndpoint(endpoint: SPARQLEndpoint)
  async function reanalyzeEndpoint(endpoint: SPARQLEndpoint)
  function logStep(message: string, status: 'pending' | 'success' | 'warning' | 'error')

  return { analyzing, analyzeStep, analyzeElapsed, analysisLog, analyzeEndpoint, reanalyzeEndpoint, logStep }
}
```

Features:
- Handles both initial analysis and reanalysis
- Maintains step-by-step analysis log
- Tracks elapsed time
- Manages graph, duplicate, and language detection

#### useEndpointForm
**Purpose:** Form state, validation, and security checks

```typescript
function useEndpointForm(initialEndpoint?: SPARQLEndpoint) {
  const form = reactive({ name, url, authType, username, password, apiKey, token, headerName })
  const formValid = computed(() => ...)
  const securityCheck = computed(() => ...)
  const trustCheck = computed(() => ...)

  function resetForm()
  function loadEndpoint(endpoint: SPARQLEndpoint)
  function buildAuth(): EndpointAuth | undefined
  function buildEndpoint(): SPARQLEndpoint

  return { form, formValid, securityCheck, trustCheck, resetForm, loadEndpoint, buildAuth, buildEndpoint }
}
```

Features:
- Manages reactive form state
- Validates URL format and required fields
- Performs security checks (HTTP vs HTTPS)
- Assesses endpoint trust level
- Builds auth configuration objects

#### useEndpointCapabilities
**Purpose:** Capability display with computed properties for wizard Step 2

```typescript
function useEndpointCapabilities(endpoint: Ref<SPARQLEndpoint | null>) {
  // Each capability has: status, severity, icon, description
  // SKOS Content (Yes/No/Unknown)
  const skosContentStatus = computed(() => ...)
  const skosContentSeverity = computed(() => ...)
  const skosContentIcon = computed(() => ...)
  const skosContentDescription = computed(() => ...)

  // Graph Support (Yes/No/Unknown)
  const graphSupportStatus = computed(() => ...)
  // ... severity, icon, description

  // SKOS Graphs (count display)
  const skosGraphStatus = computed(() => ...)
  // ... severity, icon, description

  // Concept Schemes (count display)
  const schemeCountStatus = computed(() => ...)
  // ... severity, icon, description

  // Concept Count
  const conceptCountStatus = computed(() => ...)
  // ... severity, icon, description

  // Relationships (X/7 available)
  const relationshipsStatus = computed(() => ...)
  // ... severity, icon, description

  function formatCount(count: number): string

  return { skosContentStatus, ..., formatCount }
}
```

Features:
- Computes display values for all 6 capability items
- Provides severity levels for PrimeVue Tag badges (success/warn/secondary)
- Provides icon classes (check-circle/exclamation-triangle/question-circle)
- Provides description text for each capability
- Formats counts with thousand separators (German locale)

#### useLanguagePriorities
**Purpose:** Language priority management with display helpers

```typescript
function useLanguagePriorities(endpoint: Ref<SPARQLEndpoint | null>) {
  const priorities = ref<string[]>([])
  const endpointLanguages = computed(() => endpoint.value?.analysis?.languages || [])

  // Core functions
  function loadPriorities(ep: SPARQLEndpoint)
  function savePriorities(ep: SPARQLEndpoint): { id: string; languagePriorities: string[] }
  function onReorder(event: { value: string[] })
  function getLanguageCount(lang: string): number | undefined
  function removeLanguage(lang: string)
  function clearPriorities()

  // Display helpers
  function getLanguageName(lang: string): string      // 'en' → 'English', unknown → 'XYZ'
  function getPriorityLabel(index: number): string    // 0 → 'Default fallback', 1 → '2nd priority'
  function getBadgeColor(index: number): { bg, text } // Cycling color palette for badges

  return {
    priorities, endpointLanguages,
    loadPriorities, savePriorities, onReorder, getLanguageCount,
    getLanguageName, getPriorityLabel, getBadgeColor,
    removeLanguage, clearPriorities
  }
}
```

Features:
- Loads and saves language priorities
- Drag-and-drop reordering via `vuedraggable`
- Language name lookup (ISO 639-1 → full name)
- Priority labels ("Default fallback", "2nd priority", etc.)
- Colored badge styling (cycling palette)
- Defaults: 'en' first, others alphabetically

### Benefits

- ✅ **Separation of concerns** - Each composable/component has a single responsibility
- ✅ **Reusability** - Composables can be used in other components
- ✅ **Testability** - Isolated logic is easier to test
- ✅ **Maintainability** - Smaller, focused files are easier to understand
- ✅ **Consistency** - Follows patterns from ConceptDetails/SchemeDetails refactoring

### File Size Comparison

| Component | Lines | Purpose |
|-----------|-------|---------|
| EndpointManager.vue | ~514 | List/table management |
| EndpointWizard.vue | ~600 | 3-step wizard |
| EndpointDeleteDialog.vue | ~101 | Delete confirmation |
| 5 composables | ~600 | Business logic |

**Architecture:**
- Total: ~1,800 lines across focused components
- Clear separation: UI (components) vs logic (composables)
- Each file has a single responsibility

## Language Configuration

Each endpoint stores an ordered list of language priorities for fallback resolution.

See [sko01-LanguageSelector](../ae-skos/sko01-LanguageSelector.md) for full language system documentation.

### Language Priority (Wizard Step 3)

Integrated into the EndpointWizard as Step 3, using drag-and-drop reordering.

```
┌─────────────────────────────────────────────────────┐
│ ℹ Drag and drop to set fallback order.              │
│   First language is used when your preferred        │
│   language is unavailable.                          │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ ≡  [en] English                                     │
│        Default fallback              12,456 labels  │
├─────────────────────────────────────────────────────┤
│ ≡  [fr] French                                      │
│        2nd priority                   8,901 labels  │
├─────────────────────────────────────────────────────┤
│ ≡  [de] German                                      │
│        3rd priority                   7,234 labels  │
└─────────────────────────────────────────────────────┘
```

**UI Elements:**
- Drag handle icon (`≡`) for reordering
- Colored circular badges with language codes
- Full language names (e.g., "English" instead of "en")
- Priority labels ("Default fallback", "2nd priority", etc.)
- Label counts from endpoint analysis

**Implementation:** Uses `vuedraggable` library for drag-and-drop.

### Default Language Order

When no priorities are configured:
1. `en` (English) always first
2. Remaining languages alphabetically by code

## Endpoint Management

### Features

#### Add Endpoint
- Name (required)
- URL (required, validated)
- Authentication type (optional)
- Test connection before saving
- Run endpoint analysis on successful connection
- **Progress indicator** showing current step:
  - "Testing connection..."
  - "Analyzing endpoint structure..."
  - "Done!" or error message
  - Elapsed time shown after 2 seconds (e.g., "Testing connection... (3s)")
- Dialog stays open on error to show what went wrong

#### Test Connection
- Tests endpoint connectivity
- Shows response time on success (e.g., "Connected successfully (162ms)")
- **Success message auto-dismisses after 3 seconds**
- Error messages persist until manually dismissed or form is reset

#### Edit Endpoint
- Modify name, URL, or auth settings
- Test connection after changes

#### Remove Endpoint
- Confirm before deletion
- Option to export before removal

#### List Endpoints
- Show all saved endpoints
- Sort by: name, last accessed, access count
- Search/filter by name or URL

### History Tracking

- Automatically update `lastAccessedAt` on each query
- Increment `accessCount` on each successful query
- Show "recently used" endpoints prominently

## Storage

All endpoint data stored in **localStorage**:

```
Key: ae-endpoints
Value: JSON array of SPARQLEndpoint objects
```

**Storage considerations:**
- ~5MB localStorage limit (plenty for endpoint configs)
- Data persists across sessions
- Export/import functionality for backup
- No server-side storage required

## UI Components

### Endpoint Selector
- Dropdown with saved endpoints
- Current endpoint highlighted
- Quick access to add new

### Endpoint Manager Dialog
- Full CRUD interface
- Connection testing
- Import/export buttons
- Width: 850px (main dialog), 500px (add/edit dialog)

### Connection Status Indicator
- Connected (green)
- Disconnected/error (red)
- Testing (yellow/spinner)

## First Launch Experience

When the app loads with no saved endpoints (and not in config mode), the Endpoint Manager dialog automatically opens to guide new users through setup.

**Conditions for auto-open:**
- NOT in config mode (external config manages endpoints)
- No endpoints saved (empty array)

**Implementation:** `App.vue` checks these conditions in `onMounted()` and sets `showEndpointManager.value = true`.

## Suggested Endpoints

Pre-configured endpoints with pre-calculated analysis results, optimized for new users and common SKOS vocabularies.

### Build System

**Purpose:** Pre-analyze popular endpoints at build time to avoid runtime delays and provide instant configuration.

**Architecture:**

```
suggested-endpoints.json (manual curation)
         ↓
    prebuild-endpoints.ts (build script)
         ↓
suggested-endpoints.generated.json (committed)
         ↓
    EndpointStore (runtime)
```

### Data Model

```typescript
interface SuggestedEndpointSource {
  name: string
  url: string
  description?: string
  suggestedLanguagePriorities?: string[]  // Recommended language order
}

interface SuggestedEndpoint extends SuggestedEndpointSource {
  analysis: EndpointAnalysis        // Pre-calculated analysis
  sourceHash: string                 // Hash for cache invalidation
}
```

### Source File: `suggested-endpoints.json`

Manually curated list of recommended SKOS endpoints:

```json
[
  {
    "name": "Fedlex",
    "url": "https://fedlex.data.admin.ch/sparql",
    "description": "Swiss Federal Law",
    "suggestedLanguagePriorities": ["de", "fr", "it", "rm", "en"]
  },
  {
    "name": "AGROVOC",
    "url": "https://agrovoc.fao.org/sparql",
    "description": "Agricultural vocabulary",
    "suggestedLanguagePriorities": ["en", "fr", "es"]
  }
]
```

**Fields:**
- `name` - Display name for endpoint
- `url` - SPARQL endpoint URL (must be publicly accessible with CORS)
- `description` - Short description of the vocabulary
- `suggestedLanguagePriorities` - Recommended language order for this vocabulary

### Build Script: `prebuild-endpoints.ts`

Runs during `npm run build` to analyze endpoints and generate cached results.

**Process:**
1. Read `suggested-endpoints.json`
2. For each endpoint:
   - Connect to endpoint
   - Run full analysis (SKOS detection, graphs, languages)
   - Calculate source hash (for change detection)
   - Store analysis results
3. Write `suggested-endpoints.generated.json`
4. Commit generated file to repository

**Source Hash Calculation:**
```typescript
import { createHash } from 'crypto'

function calculateSourceHash(source: SuggestedEndpointSource): string {
  const content = JSON.stringify(source)
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}
```

**Benefits:**
- No runtime analysis delay
- Pre-tested endpoints (broken endpoints can be removed before build)
- Version control for analysis results
- Fast first-time user experience

### Generated File: `suggested-endpoints.generated.json`

Auto-generated file (committed to repo):

```json
[
  {
    "name": "Fedlex",
    "url": "https://fedlex.data.admin.ch/sparql",
    "description": "Swiss Federal Law",
    "suggestedLanguagePriorities": ["de", "fr", "it", "rm", "en"],
    "analysis": {
      "hasSkosContent": true,
      "supportsNamedGraphs": true,
      "skosGraphCount": 3,
      "languages": [
        { "lang": "de", "count": 45123 },
        { "lang": "fr", "count": 44891 },
        { "lang": "it", "count": 44567 }
      ],
      "analyzedAt": "2025-01-10T10:30:00.000Z"
    },
    "sourceHash": "a3f5c8d2e1b4f9a7"
  }
]
```

### Runtime Integration

**Store Method:**
```typescript
function addSuggestedEndpoint(suggested: SuggestedEndpoint): void {
  const endpoint: SPARQLEndpoint = {
    id: uuid(),
    name: suggested.name,
    url: suggested.url,
    analysis: suggested.analysis,
    languagePriorities: suggested.suggestedLanguagePriorities,
    createdAt: new Date().toISOString(),
    accessCount: 0,
  }

  endpoints.value.push(endpoint)
  saveToLocalStorage()
}
```

**UI Integration:**

The suggested endpoints section appears in the EndpointManager dialog with:
- Collapsible header with endpoint count badge
- Individual "Add" buttons for each suggested endpoint
- **"Import All" button** to add all suggested endpoints at once

**Import All Button:**
- Located in the suggested endpoints header row (next to the count badge)
- Adds all available suggested endpoints in a single action
- Auto-selects the first added endpoint and sets status to "connected"
- Uses `playlist_add` icon to indicate bulk action

In EndpointWizard Step 1, show suggested endpoints as quick-add buttons:

```
┌─────────────────────────────────────────────────────┐
│ SUGGESTED ENDPOINTS                                 │
├─────────────────────────────────────────────────────┤
│ [Fedlex]  [AGROVOC]  [EU Publications]  [BnF]      │
│ [GeoNames]  [GEMET]  [STW]  [TheSoz]                │
└─────────────────────────────────────────────────────┘
```

Clicking a suggestion:
1. Creates new endpoint with suggested values
2. Uses pre-calculated analysis (no runtime delay)
3. Sets suggested language priorities
4. Saves to localStorage
5. Switches to new endpoint

**Filtering:**
Only show suggestions that aren't already added:

```typescript
const availableSuggestedEndpoints = computed(() => {
  const existingUrls = new Set(endpoints.value.map(e => e.url))
  return suggestedEndpoints.filter(s => !existingUrls.has(s.url))
})
```

### Update Strategy

**When to rebuild:**
- Adding new suggested endpoints to source file
- Endpoint URL changes
- Source hash changes (indicates manual update)
- Monthly automated rebuild (optional CI job)

**Cache Invalidation:**
If sourceHash doesn't match, endpoint is re-analyzed at runtime.

### Current Suggested Endpoints

| Name | URL | Languages | Graphs |
|------|-----|-----------|--------|
| Fedlex | https://fedlex.data.admin.ch/sparql | de, fr, it, rm | 3 |
| AGROVOC | https://agrovoc.fao.org/sparql | en, fr, es, ... | 1 |
| EU Publications | https://publications.europa.eu/webapi/rdf/sparql | 24 languages | 50+ |
| BnF (French National Library) | https://data.bnf.fr/sparql | fr, en | 1 |
| GeoNames | https://factforge.net/sparql | en | Multiple |
| GEMET | https://semantic.eea.europa.eu/sparql | en, fr, de, ... | 1 |
| STW Economics | http://zbw.eu/beta/sparql/stw/query | de, en | 1 |
| TheSoz | https://sparql.gesis.org/sparql | de, en | 1 |

**Note:** Exact numbers may vary based on last analysis date.

## External Configuration (Config Mode)

Pre-configured deployment mode for customer installations where endpoint management should be locked down.

### Purpose

Allows administrators to deploy AE SKOS with pre-configured endpoints that users cannot modify. Useful for:
- Customer-specific installations
- Locked-down vocabulary browsers
- Single-endpoint deployments (where endpoint selector is hidden entirely)

### Config File

**Location:** `public/config/app.json` → served at `/config/app.json`

The config file is optional and deployment-specific (not committed to source control).

### Config Schema

```typescript
interface AppConfig {
  appName?: string           // Custom app title (default: "AE SKOS")
  logoUrl?: string           // Custom logo URL (displayed in header)
  documentationUrl?: string  // Custom help link URL (default: GitHub docs)
  endpoints?: ConfigEndpoint[]
}

interface ConfigEndpoint extends SuggestedEndpointSource {
  auth?: EndpointAuth                      // Optional authentication
  analysis?: EndpointAnalysis              // Pre-calculated analysis (optional)
  suggestedLanguagePriorities?: string[]   // Language preference order
}
```

**Minimal config example:**
```json
{
  "appName": "My Vocabulary Browser",
  "endpoints": [
    { "name": "Production", "url": "https://vocab.example.com/sparql" }
  ]
}
```

**Full config example** (with pre-calculated analysis):
```json
{
  "appName": "My Organization SKOS Browser",
  "logoUrl": "/config/logo.png",
  "documentationUrl": "https://wiki.example.com/skos-browser",
  "endpoints": [
    {
      "name": "Production Vocabulary",
      "url": "https://vocab.example.com/sparql",
      "auth": { "type": "basic", "credentials": { "username": "user", "password": "pass" } },
      "analysis": {
        "hasSkosContent": true,
        "supportsNamedGraphs": true,
        "skosGraphCount": 1,
        "languages": [{ "lang": "en", "count": 5000 }],
        "totalConcepts": 5000,
        "relationships": { "hasInScheme": true, "hasBroader": true },
        "analyzedAt": "2026-01-15T00:00:00.000Z"
      },
      "suggestedLanguagePriorities": ["en", "fr"]
    }
  ]
}
```

### Behavior Matrix

| Config State | Endpoints | App Name | Endpoint Dropdown | Manage Endpoints |
|--------------|-----------|----------|-------------------|------------------|
| No config (404) | User-managed | "AE SKOS" | Visible | Visible |
| Config with 1 endpoint | Locked | Custom | **Hidden** | Hidden |
| Config with 2+ endpoints | Locked | Custom | Visible | Hidden |

### App Customization

**App Name (`appName`):**
- Displayed in header
- Sets browser tab title (`document.title`)
- Default: "AE SKOS"

**Logo (`logoUrl`):**
- Displayed before app name in header
- Can be absolute URL or relative path (e.g., `/config/logo.png`)
- In config mode without explicit logoUrl, falls back to `/config/logo.png`
- Hidden if not configured and not in config mode

### Loading

Config is loaded at app bootstrap, **before** Vue app creation:

```typescript
async function bootstrap() {
  await loadConfig()  // Load config first
  const app = createApp(App)
  // ... rest of setup
}
```

### Fallback Behavior

- **404 (no config file):** Normal operation, user manages endpoints
- **HTML response (SPA fallback):** Some servers return 200 OK with HTML instead of 404; treated as no config
- **Invalid JSON:** Shows error banner, falls back to normal operation
- **Missing endpoints:** Config mode not activated (appName/docsUrl still apply)

### Config Error Display

When `app.json` exists but contains invalid JSON:
- Red error banner appears below breadcrumb bar
- Shows message: "Failed to load config: [error details]"
- App falls back to normal operation (user-managed endpoints)
- Helps developers identify config issues quickly

### Store Integration

The endpoint store checks config mode on initialization:

```typescript
function loadFromStorage() {
  if (isConfigMode()) {
    loadFromConfig()  // Load endpoints from config
    return
  }
  // Normal localStorage loading...
}
```

**Mutation Guards:**
In config mode, these operations are blocked (return `null`):
- `addEndpoint()`
- `addSuggestedEndpoint()`
- `removeEndpoint()`

### Implementation

| File | Purpose |
|------|---------|
| `services/config.ts` | Config loading service |
| `types/config.ts` | TypeScript interfaces |
| `stores/endpoint.ts` | Config mode support |
| `App.vue` | Conditional UI rendering |
| `DEPLOYMENT.md` | Deployment documentation |
