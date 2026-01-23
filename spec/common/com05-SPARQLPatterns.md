# SPARQLPatterns

Unified SPARQL query patterns used across all AE tools.

## Standard Prefixes

All queries should include these standard prefixes:

```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
```

## Language Filtering

### Standard Pattern

Use `COALESCE` for language fallback - ensures consistent behavior across all components.

```sparql
# Parameters: PREFERRED_LANG, FALLBACK_LANG
OPTIONAL {
  ?resource skos:prefLabel ?prefLabel_pref .
  FILTER (LANGMATCHES(LANG(?prefLabel_pref), "PREFERRED_LANG"))
}
OPTIONAL {
  ?resource skos:prefLabel ?prefLabel_fall .
  FILTER (LANGMATCHES(LANG(?prefLabel_fall), "FALLBACK_LANG"))
}
OPTIONAL {
  ?resource skos:prefLabel ?prefLabel_none .
  FILTER (LANG(?prefLabel_none) = "")
}
BIND(COALESCE(?prefLabel_pref, ?prefLabel_fall, ?prefLabel_none) AS ?label)
```

### Simplified Pattern (Single Property)

When only one label needed and performance is critical:

```sparql
?resource skos:prefLabel ?label .
FILTER (
  LANGMATCHES(LANG(?label), "PREFERRED_LANG") ||
  LANGMATCHES(LANG(?label), "FALLBACK_LANG") ||
  LANG(?label) = ""
)
```

**Note:** This may return multiple results if multiple language tags match. Use with `DISTINCT` or in subqueries.

### When to Use Each Pattern

| Pattern | Use When | Trade-off |
|---------|----------|-----------|
| **Standard (COALESCE)** | Need exactly one label per resource | More complex, guaranteed single result |
| **Simplified (FILTER OR)** | Listing resources, can handle duplicates | Simpler, may need DISTINCT |
| **All Labels** | Displaying all language variants | Returns all, client-side filtering |

**Guidelines:**
- **SchemeSelector, ConceptTree**: Use simplified pattern (listing with DISTINCT)
- **ConceptDetails**: Use all labels pattern (show all languages)
- **SearchBox autocomplete**: Use simplified pattern (speed critical)
- **Breadcrumb**: Use standard pattern (exactly one label per segment)

### All Labels Pattern

When displaying all available labels:

```sparql
?resource skos:prefLabel ?label .
BIND(LANG(?label) AS ?labelLang)
```

## Pagination

### Standard Pattern

```sparql
SELECT ?resource ?label
WHERE {
  # ... query body ...
}
ORDER BY ?label
LIMIT 100
OFFSET 0
```

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `LIMIT` | 100 | Results per page |
| `OFFSET` | 0 | Skip first N results |

### Count Query

Run alongside paginated query to show total:

```sparql
SELECT (COUNT(DISTINCT ?resource) AS ?total)
WHERE {
  # ... same query body without ORDER/LIMIT/OFFSET ...
}
```

## Graph-Aware Queries

### When Graphs Detected

If `EndpointAnalysis.hasNamedGraphs` is true and user selected specific graphs:

```sparql
SELECT ?resource ?label
FROM <http://example.org/graph1>
FROM <http://example.org/graph2>
WHERE {
  # ... query body ...
}
```

### Query All Graphs (Default)

When no specific graphs selected, omit `FROM` clause to query default graph union:

```sparql
SELECT ?resource ?label
WHERE {
  # ... query body ...
}
```

### Explicit Graph Query

When need to know which graph contains data:

```sparql
SELECT ?graph ?resource ?label
WHERE {
  GRAPH ?graph {
    ?resource a skos:Concept .
    ?resource skos:prefLabel ?label .
  }
}
```

## Error-Safe Patterns

### Optional Properties

Always use `OPTIONAL` for properties that may not exist:

```sparql
SELECT ?concept ?label ?definition
WHERE {
  ?concept a skos:Concept .
  ?concept skos:prefLabel ?label .
  OPTIONAL { ?concept skos:definition ?definition }
}
```

### Safe URI Binding

When building URIs from user input:

```sparql
# Don't interpolate directly - use BIND
BIND(IRI(CONCAT("http://example.org/", ?userInput)) AS ?uri)
```

### Timeout Hints

Some endpoints support timeout hints (non-standard):

```sparql
# Virtuoso
DEFINE sql:log-enable 2
SELECT ...

# Fuseki
# Use HTTP header: Timeout: 30
```

## Response Parsing

### JSON Results (Standard)

Most endpoints return `application/sparql-results+json`:

```json
{
  "head": { "vars": ["concept", "label"] },
  "results": {
    "bindings": [
      {
        "concept": { "type": "uri", "value": "http://example.org/c1" },
        "label": { "type": "literal", "value": "Example", "xml:lang": "en" }
      }
    ]
  }
}
```

### XML Fallback

Some endpoints (e.g., Getty) may return XML despite claiming JSON content-type. The SPARQL service automatically detects and parses SPARQL Results XML format:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<sparql xmlns="http://www.w3.org/2005/sparql-results#">
  <head>
    <variable name="concept"/>
    <variable name="label"/>
  </head>
  <results>
    <result>
      <binding name="concept">
        <uri>http://example.org/c1</uri>
      </binding>
      <binding name="label">
        <literal xml:lang="en">Example</literal>
      </binding>
    </result>
  </results>
</sparql>
```

**Automatic Detection:**
1. Try parsing response as JSON
2. If JSON parse fails, attempt SPARQL XML parsing
3. Return normalized JSON format to callers

This ensures compatibility with endpoints that have inconsistent content-type headers.

## Common Query Templates

### List Top Concepts

```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT DISTINCT ?concept ?label
WHERE {
  ?concept a skos:Concept .
  ?concept skos:topConceptOf|^skos:hasTopConcept ?scheme .
  # Or fallback: no broader
  # FILTER NOT EXISTS { ?concept skos:broader ?b }

  # Language filter (use standard pattern)
  ?concept skos:prefLabel ?label .
  FILTER (LANGMATCHES(LANG(?label), "LANG") || LANG(?label) = "")
}
ORDER BY ?label
LIMIT 100
```

**Detecting children efficiently (for expand arrow):**

Use `EXISTS` instead of `COUNT` - stops at first match:

```sparql
# Fast - short-circuit evaluation
BIND(EXISTS { [] skos:broader ?concept } AS ?hasNarrower)

# Slow - scans all children
# (COUNT(DISTINCT ?narrower) AS ?narrowerCount)
```

See [sko04-ConceptTree](../ae-skos/sko04-ConceptTree.md#performance-optimizations) for detailed performance notes.

### Get Narrower Concepts

```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT DISTINCT ?concept ?label
WHERE {
  ?concept skos:broader <PARENT_URI> .

  ?concept skos:prefLabel ?label .
  FILTER (LANGMATCHES(LANG(?label), "LANG") || LANG(?label) = "")
}
ORDER BY ?label
```

**Note:** Same `EXISTS` pattern applies for detecting grandchildren (expand arrow).

### Search Concepts

```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT DISTINCT ?concept ?label ?matchedIn
WHERE {
  ?concept a skos:Concept .

  # Search in prefLabel and altLabel
  {
    ?concept skos:prefLabel ?searchLabel .
    BIND("prefLabel" AS ?matchedIn)
  } UNION {
    ?concept skos:altLabel ?searchLabel .
    BIND("altLabel" AS ?matchedIn)
  }

  FILTER (CONTAINS(LCASE(STR(?searchLabel)), LCASE("SEARCH_TERM")))

  # Get display label
  ?concept skos:prefLabel ?label .
  FILTER (LANGMATCHES(LANG(?label), "LANG") || LANG(?label) = "")
}
ORDER BY ?label
LIMIT 100
```

### Get Concept Details

```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?property ?value ?valueLang
WHERE {
  <CONCEPT_URI> ?property ?value .
  BIND(LANG(?value) AS ?valueLang)
}
```

### Get Relations

```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?relationType ?related ?relatedLabel
WHERE {
  {
    <CONCEPT_URI> skos:broader ?related .
    BIND("broader" AS ?relationType)
  } UNION {
    <CONCEPT_URI> skos:narrower ?related .
    BIND("narrower" AS ?relationType)
  } UNION {
    <CONCEPT_URI> skos:related ?related .
    BIND("related" AS ?relationType)
  }

  OPTIONAL {
    ?related skos:prefLabel ?relatedLabel .
    FILTER (LANGMATCHES(LANG(?relatedLabel), "LANG") || LANG(?relatedLabel) = "")
  }
}
```

## Performance Guidelines

### DO

- Use `DISTINCT` when results may have duplicates
- Use `LIMIT` to prevent runaway queries
- Use `OPTIONAL` for properties that may not exist
- Use indexed properties first in WHERE clause (usually `rdf:type`)
- Cancel pending requests when user navigates

### DON'T

- Don't use `SELECT *` - specify needed variables
- Don't use `FILTER` on unbound variables
- Don't use complex regex when simple `CONTAINS` suffices
- Don't nest too many `OPTIONAL` clauses (performance hit)
- Don't query without timeout protection

## Request Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| Timeout | 30000ms | Request timeout |
| Method | POST | Prefer POST for longer queries |
| Accept | `application/sparql-results+json` | JSON results |
| Content-Type | `application/x-www-form-urlencoded` | Query encoding |

## SPARQL Version Requirements

**Minimum: SPARQL 1.1**

Required features:
- `BIND`
- `COALESCE`
- `CONCAT`
- `CONTAINS`, `STRSTARTS`
- `LANGMATCHES`
- Subqueries
- Property paths (`/`, `|`, `*`, `+`)

## Prefix Resolution Service

Convert full URIs to qualified names (e.g., `http://purl.org/dc/terms/title` → `dct:title`).

### Algorithm

1. Extract namespace from URI (up to last `/` or `#`)
2. Check **local common prefixes** map first (30+ common RDF vocabularies)
3. Fallback to **prefix.cc API** if not found locally
4. Cache resolved prefixes in **localStorage** for persistence

### Common Prefixes (Built-in)

```typescript
const COMMON_PREFIXES = {
  'http://purl.org/dc/terms/': 'dct',
  'http://purl.org/dc/elements/1.1/': 'dc',
  'http://www.w3.org/2000/01/rdf-schema#': 'rdfs',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#': 'rdf',
  'http://www.w3.org/2002/07/owl#': 'owl',
  'http://www.w3.org/2001/XMLSchema#': 'xsd',
  'http://xmlns.com/foaf/0.1/': 'foaf',
  'http://www.w3.org/2004/02/skos/core#': 'skos',
  'http://www.w3.org/2008/05/skos-xl#': 'skosxl',
  'http://schema.org/': 'schema',
  'http://www.w3.org/ns/prov#': 'prov',
  'http://www.w3.org/ns/dcat#': 'dcat',
  // ... and more
}
```

### prefix.cc API

```
GET https://prefix.cc/reverse?uri={namespace}&format=json
→ { "prefix": "namespace" }
```

**Note:** prefix.cc SSL certificate may be expired. Local common prefixes provide reliable fallback.

### Storage

```typescript
// localStorage key
const STORAGE_KEY = 'ae-prefixes'

// Cache format
interface PrefixCache {
  [namespace: string]: string | null  // null = lookup attempted, not found
}
```

### Usage

```typescript
import { resolveUris, formatQualifiedName } from '@/services/prefix'

// Resolve multiple URIs at once (batch)
const resolved = await resolveUris(uris)

// Format for display
for (const [uri, { prefix, localName }] of resolved) {
  console.log(formatQualifiedName({ prefix, localName }))
  // "dct:title" or just "unknownProp" if prefix not found
}
```
