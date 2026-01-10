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

### Three-Step Analysis

Analysis runs automatically on endpoint connection and can be re-triggered via "Re-analyze" button.

```
┌─────────────────────────────────────────────────────────────┐
│ SPARQL Capabilities                                    [×]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ✓ (1/3) Graphs: 12 graphs (empty graph pattern)            │
│ ✓ (2/3) Duplicates: none                                    │
│ ✓ (3/3) Languages: found 5 (default)                        │
│                                                             │
│ Named Graphs:  Yes (12 graphs)                              │
│ Duplicates:    No                                           │
│ Languages:     en, fr, de, it, rm                           │
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
  supportsNamedGraphs: boolean | null  // null = not supported, false = none, true = has graphs
  skosGraphCount: number | null        // null = count failed, number = SKOS graphs found

  // Languages (sorted by count descending)
  languages?: DetectedLanguage[]

  analyzedAt: string  // ISO timestamp
}

interface DetectedLanguage {
  lang: string   // ISO 639-1 code (e.g., 'en')
  count: number  // Number of labels found
}
```

**Changes from generic specification:**
- `hasSkosContent` replaces generic content detection (SKOS-specific)
- `skosGraphCount` counts only graphs containing SKOS data (not all graphs)
- `graphCount` and `graphCountExact` removed (generic graph counting not implemented)
- `hasDuplicateTriples` removed (duplicate detection not implemented)

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

**EndpointWizard.vue** (~600 lines)
- 3-step stepper wizard for add/edit:
  - Step 1: Basic Info (name, URL, authentication)
  - Step 2: Capabilities (graphs, duplicates)
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
**Purpose:** Capability display with computed properties

```typescript
function useEndpointCapabilities(endpoint: Ref<SPARQLEndpoint | null>) {
  const graphStatus = computed(() => ...)
  const graphSeverity = computed(() => ...)
  const duplicateStatus = computed(() => ...)
  const duplicateSeverity = computed(() => ...)

  function formatQueryMethod(method?: string): string
  function formatCount(count: number): string

  return { graphStatus, graphSeverity, duplicateStatus, duplicateSeverity, formatQueryMethod, formatCount }
}
```

Features:
- Computes graph capability status and display
- Computes duplicate detection status
- Provides severity levels for badges
- Formats display values

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
