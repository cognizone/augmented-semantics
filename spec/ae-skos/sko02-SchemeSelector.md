# SchemeSelector

Component for listing and selecting SKOS Concept Schemes.

## Features

### List Concept Schemes

Query all available concept schemes from the endpoint.

**Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX dct: <http://purl.org/dc/terms/>

SELECT ?scheme ?label ?description
WHERE {
  ?scheme a skos:ConceptScheme .
  OPTIONAL {
    ?scheme skos:prefLabel ?label .
    FILTER (LANGMATCHES(LANG(?label), "en") || LANG(?label) = "")
  }
  OPTIONAL {
    ?scheme dct:description ?description .
  }
}
ORDER BY ?label
```

### Scheme Selection

- Dropdown selector in toolbar
- "All Schemes" option to browse without filter
- Selection affects:
  - Top concepts shown in navigation
  - Search scope
  - Language detection scope

### Scheme Details

Display metadata for selected scheme:
- URI
- `skos:prefLabel`
- `dct:title`
- `dct:description`
- `dct:creator`
- `dct:created`
- `dct:modified`

### Scheme Persistence

Store selected scheme in localStorage:

```
Key: ae-skos-scheme
Value: "http://example.org/scheme/1" | null
```

## UI Component

### Scheme Selector

```
┌─────────────────────────────┐
│ Concept Scheme        [▼]  │
├─────────────────────────────┤
│   All Schemes               │
│ ──────────────────────────  │
│ ● UNESCO Thesaurus          │
│   AGROVOC                   │
│   EuroVoc                   │
└─────────────────────────────┘
```

### Scheme Info Panel (optional)

```
┌─────────────────────────────────────────┐
│ UNESCO Thesaurus                        │
│ ─────────────────────────────────────── │
│ URI: http://vocabularies.unesco.org/    │
│ Description: Multidisciplinary...       │
│ Created: 1974                           │
└─────────────────────────────────────────┘
```

## Data Model

```typescript
interface ConceptScheme {
  uri: string;
  label?: string;
  description?: string;
  title?: string;
  creator?: string;
  created?: string;
  modified?: string;
}

interface SchemeState {
  available: ConceptScheme[];
  selected: ConceptScheme | null;  // null = all schemes
  loading: boolean;
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `scheme:loaded` | `ConceptScheme[]` | Schemes fetched from endpoint |
| `scheme:selected` | `ConceptScheme \| null` | User selected a scheme |

## Loading & Error States

See [com03-ErrorHandling](../common/com03-ErrorHandling.md) for details.

### Loading

```
┌─────────────────────────────┐
│ Concept Scheme        [▼]  │
├─────────────────────────────┤
│   ◌ Loading schemes...      │
└─────────────────────────────┘
```

### Empty State

```
┌─────────────────────────────┐
│ Concept Scheme        [▼]  │
├─────────────────────────────┤
│   No schemes found          │
└─────────────────────────────┘
```

### Error State

```
┌─────────────────────────────┐
│ Concept Scheme        [▼]  │
├─────────────────────────────┤
│   ⚠ Failed to load          │
│   [Retry]                   │
└─────────────────────────────┘
```

## Related Specs

- [com01-EndpointManager](../common/com01-EndpointManager.md) - Endpoint connection
- [com02-StateManagement](../common/com02-StateManagement.md) - State architecture
- [com03-ErrorHandling](../common/com03-ErrorHandling.md) - Error/loading states
- [com05-SPARQLPatterns](../common/com05-SPARQLPatterns.md) - Query patterns
- [sko03-ConceptTree](./sko03-ConceptTree.md) - Top concepts filtered by selected scheme

## Dependencies

- EndpointManager (for SPARQL connection)
- LanguageSelector (for label language)
- localStorage for persistence
