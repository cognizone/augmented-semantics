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
| Timeout | 30000ms | Request timeout (AbortController) |
| Method | POST | HTTP method for queries |
| Max retries | 3 | Automatic retry attempts |
| Retry delay | 1000ms | Initial retry delay (exponential backoff) |

See [com03-ErrorHandling](./com03-ErrorHandling.md) for retry logic details.

### Query Patterns

All SPARQL queries should follow patterns defined in [com05-SPARQLPatterns](./com05-SPARQLPatterns.md):
- Standard language filtering
- Pagination
- Graph-aware queries
- Error-safe patterns

## Endpoint Analysis

Run analysis queries on connection to detect endpoint characteristics.

### Graph Detection

Detect if endpoint uses named graphs.

**Query:**
```sparql
SELECT DISTINCT ?graph
WHERE {
  GRAPH ?graph { ?s ?p ?o }
}
LIMIT 100
```

**Results:**
- No results → Single default graph (graph-less)
- Results → Multiple named graphs

### Duplicate Triple Detection

Check if same triples exist in multiple graphs (common in quad stores).

**Query:**
```sparql
SELECT ?s ?p ?o (COUNT(DISTINCT ?graph) AS ?graphCount)
WHERE {
  GRAPH ?graph { ?s ?p ?o }
}
GROUP BY ?s ?p ?o
HAVING (COUNT(DISTINCT ?graph) > 1)
LIMIT 10
```

**Results:**
- No results → No duplicates across graphs
- Results → Duplicates exist (show warning to user)

### Analysis Data Model

```typescript
interface EndpointAnalysis {
  hasNamedGraphs: boolean;
  graphs: string[];              // List of detected graph URIs
  hasDuplicateTriples: boolean;
  duplicateSample?: {            // Sample of duplicates if found
    subject: string;
    predicate: string;
    object: string;
    graphCount: number;
  }[];
  analyzedAt: string;            // ISO timestamp
}
```

### Analysis UI

```
┌─────────────────────────────────────────────────────────────┐
│ Endpoint Analysis                                    [↻]    │
├─────────────────────────────────────────────────────────────┤
│ Named Graphs:  ✓ Yes (12 graphs detected)                   │
│                ├─ http://example.org/graph/main             │
│                ├─ http://example.org/graph/imported         │
│                └─ ... (10 more)                             │
│                                                             │
│ Duplicates:    ⚠ Warning - Triples found in multiple graphs │
│                This may affect query results.               │
│                [View details]                               │
└─────────────────────────────────────────────────────────────┘
```

### Graph Selection

When named graphs detected, allow user to:
- Query all graphs (default, union)
- Select specific graph(s) to query
- Query default graph only

**Query modifier:**
```sparql
# All graphs (default)
SELECT * WHERE { ?s ?p ?o }

# Specific graph
SELECT * FROM <http://example.org/graph/main>
WHERE { ?s ?p ?o }

# Multiple specific graphs
SELECT *
FROM <http://example.org/graph/main>
FROM <http://example.org/graph/imported>
WHERE { ?s ?p ?o }
```

## Language Preferences

Global language settings applied across all tools.

### Language Detection

Detect available languages from the endpoint on connection.

**Query:**
```sparql
SELECT DISTINCT (LANG(?label) AS ?lang)
WHERE {
  ?s ?p ?label .
  FILTER (isLiteral(?label) && LANG(?label) != "")
}
ORDER BY ?lang
LIMIT 50
```

### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Preferred language | Primary language for labels | Browser language |
| Fallback language | Used when preferred not available | `en` |

### Language Data Model

```typescript
interface LanguagePreferences {
  preferred: string;           // ISO 639-1 code (e.g., "nl", "en")
  fallback: string;            // ISO 639-1 code
  detected: string[];          // Languages found in endpoint
  detectedAt?: string;         // ISO timestamp
}
```

### Language Filter Pattern

All tools use this SPARQL pattern for language filtering:

```sparql
# Get label with preferred language, fallback, or no-lang
OPTIONAL {
  ?concept skos:prefLabel ?prefLangLabel .
  FILTER (LANGMATCHES(LANG(?prefLangLabel), "PREFERRED"))
}
OPTIONAL {
  ?concept skos:prefLabel ?fallbackLabel .
  FILTER (LANGMATCHES(LANG(?fallbackLabel), "FALLBACK"))
}
OPTIONAL {
  ?concept skos:prefLabel ?noLangLabel .
  FILTER (LANG(?noLangLabel) = "")
}
BIND (COALESCE(?prefLangLabel, ?fallbackLabel, ?noLangLabel) AS ?label)
```

### Language UI

```
┌─────────────────────────────────────────┐
│ Language Settings                       │
├─────────────────────────────────────────┤
│ Preferred:   [Nederlands        ▼]      │
│ Fallback:    [English           ▼]      │
│                                         │
│ Detected languages: nl, en, fr, de      │
└─────────────────────────────────────────┘
```

### Storage

```
Key: ae-language
Value: LanguagePreferences object
```

## Endpoint Management

### Data Model

```typescript
interface SPARQLEndpoint {
  id: string;                  // UUID
  name: string;                // User-defined display name
  url: string;                 // Endpoint URL
  auth?: {
    type: 'none' | 'basic' | 'apikey' | 'bearer';
    credentials?: {
      username?: string;
      password?: string;
      apiKey?: string;
      token?: string;
      headerName?: string;     // For API key: custom header name
    };
  };
  analysis?: EndpointAnalysis; // Graph detection results
  selectedGraphs?: string[];   // User-selected graphs (null = all)
  createdAt: string;           // ISO timestamp
  lastAccessedAt?: string;     // ISO timestamp
  accessCount: number;         // Times accessed
}
```

### Features

#### Add Endpoint
- Name (required)
- URL (required, validated)
- Authentication type (optional)
- Test connection before saving
- Run endpoint analysis on successful connection

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
