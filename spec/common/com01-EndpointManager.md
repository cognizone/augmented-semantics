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

```typescript
interface EndpointAnalysis {
  // Named graphs
  supportsNamedGraphs: boolean | null  // null = not supported, false = none, true = has graphs
  graphCount: number | null            // null = count failed, number = exact or estimated
  graphCountExact: boolean             // true = exact count, false = estimated (10000+)

  // Duplicates
  hasDuplicateTriples: boolean | null  // null = detection not supported

  // Languages (sorted by count descending)
  languages?: { lang: string; count: number }[]

  analyzedAt: string  // ISO timestamp
}
```

### Analysis Log Display

During re-analysis, show step-by-step progress with colored status indicators:

| Status | Icon | Color |
|--------|------|-------|
| Pending | Spinner | Blue |
| Success | Check circle | Green |
| Warning | Triangle | Orange |
| Error | X circle | Red |
| Info | Info circle | Gray |

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

## Example Endpoints

Pre-configured suggestions for new users:

| Name | URL |
|------|-----|
| DBpedia | https://dbpedia.org/sparql |
| Wikidata | https://query.wikidata.org/sparql |
| EU Publications | https://publications.europa.eu/webapi/rdf/sparql |
