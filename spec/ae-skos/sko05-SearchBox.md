# SearchBox

Component for searching SKOS concepts.

## Features

### Basic Search

Text search across concept labels.

**Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT DISTINCT ?concept ?label ?matchedLabel
WHERE {
  ?concept a skos:Concept ;
           skos:prefLabel ?label .

  # Search in prefLabel and altLabel
  {
    ?concept skos:prefLabel ?matchedLabel .
    FILTER (CONTAINS(LCASE(?matchedLabel), LCASE("SEARCH_TERM")))
  }
  UNION
  {
    ?concept skos:altLabel ?matchedLabel .
    FILTER (CONTAINS(LCASE(?matchedLabel), LCASE("SEARCH_TERM")))
  }

  # Display label in preferred language
  FILTER (LANGMATCHES(LANG(?label), "LANG") || LANG(?label) = "")
}
ORDER BY ?label
LIMIT 100
```

### Search Scope

#### Label Scope

Toggle which labels to search:
- `skos:prefLabel` only (default)
- `skos:prefLabel` + `skos:altLabel`
- `skos:prefLabel` + `skos:altLabel` + `skos:hiddenLabel`

#### Scheme Scope

- Current scheme only (default when scheme selected)
- All schemes

Add scheme filter to query:
```sparql
?concept skos:inScheme <SCHEME_URI> .
```

### Search Modes

| Mode | SPARQL | Use Case |
|------|--------|----------|
| Contains | `CONTAINS(LCASE(?l), LCASE("term"))` | Default, flexible |
| Starts with | `STRSTARTS(LCASE(?l), LCASE("term"))` | Faster, prefix match |
| Exact | `LCASE(?l) = LCASE("term")` | Precise lookup |
| Regex | `REGEX(?l, "pattern", "i")` | Advanced users |

### Autocomplete

Real-time suggestions as user types.

**Trigger:** After 2+ characters, 300ms debounce

**Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT DISTINCT ?label
WHERE {
  ?concept skos:prefLabel ?label .
  FILTER (STRSTARTS(LCASE(?label), LCASE("PARTIAL")))
  FILTER (LANGMATCHES(LANG(?label), "LANG") || LANG(?label) = "")
}
ORDER BY ?label
LIMIT 10
```

### Search Results

Display matching concepts with:
- Label (highlighted match)
- URI
- Scheme (if searching all schemes)
- Matched property indicator (prefLabel vs altLabel)

## UI Components

### Search Box

```
┌──────────────────────────────────────────────────────┐
│ 🔍 [Search concepts...                        ] [⚙] │
│   ┌──────────────────────────────────────────────┐  │
│   │ agriculture                                  │  │
│   │ agricultural economics                       │  │
│   │ agricultural policy                          │  │
│   │ agricultural production                      │  │
│   └──────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### Search Settings (⚙)

```
┌─────────────────────────────────┐
│ Search in:                      │
│ ☑ Preferred labels              │
│ ☑ Alternative labels            │
│ ☐ Hidden labels                 │
├─────────────────────────────────┤
│ Scope:                          │
│ ● Current scheme                │
│ ○ All schemes                   │
├─────────────────────────────────┤
│ Match:                          │
│ ● Contains                      │
│ ○ Starts with                   │
│ ○ Exact                         │
└─────────────────────────────────┘
```

### Search Results

```
┌─────────────────────────────────────────────────────────────┐
│ Results for "wheat" (15 found)                              │
├─────────────────────────────────────────────────────────────┤
│ 🏷 Wheat                                                    │
│   http://example.org/concepts/wheat                         │
│   matched: prefLabel                                        │
├─────────────────────────────────────────────────────────────┤
│ 🏷 Wheat flour                                              │
│   http://example.org/concepts/wheat-flour                   │
│   matched: prefLabel                                        │
├─────────────────────────────────────────────────────────────┤
│ 🏷 Bread                                                    │
│   http://example.org/concepts/bread                         │
│   matched: altLabel "wheat bread"                           │
└─────────────────────────────────────────────────────────────┘
```

## Data Model

```typescript
interface SearchState {
  query: string;
  results: SearchResult[];
  loading: boolean;
  settings: SearchSettings;
  autocomplete: string[];
}

interface SearchSettings {
  labelScope: ('prefLabel' | 'altLabel' | 'hiddenLabel')[];
  schemeScope: 'current' | 'all';
  matchMode: 'contains' | 'startsWith' | 'exact' | 'regex';
}

interface SearchResult {
  uri: string;
  label: string;
  scheme?: string;
  matchedProperty: string;
  matchedValue: string;
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `search:query` | `string` | Search submitted |
| `search:results` | `SearchResult[]` | Results loaded |
| `search:select` | `string` | Result clicked (URI) |
| `autocomplete:select` | `string` | Suggestion selected |

## Performance

- Debounce search input (300ms)
- Limit results (default 100)
- Cancel pending requests on new search
- Cache recent searches

## Loading & Error States

See [com03-ErrorHandling](../common/com03-ErrorHandling.md) for details.

### Searching

```
┌──────────────────────────────────────────────────────┐
│ 🔍 [agriculture                               ] ◌    │
└──────────────────────────────────────────────────────┘
```

### No Results

```
┌─────────────────────────────────────────────────────────────┐
│                         🔍                                  │
│               No results for "xyz123"                       │
│   Try different keywords or check spelling.                 │
└─────────────────────────────────────────────────────────────┘
```

### Error

```
┌─────────────────────────────────────────────────────────────┐
│   ⚠ Search failed                                          │
│   [Retry]                                                   │
└─────────────────────────────────────────────────────────────┘
```

## Related Specs

- [com02-StateManagement](../common/com02-StateManagement.md) - State architecture
- [com03-ErrorHandling](../common/com03-ErrorHandling.md) - Error/loading states
- [com04-URLRouting](../common/com04-URLRouting.md) - Search in URL params
- [com05-SPARQLPatterns](../common/com05-SPARQLPatterns.md) - Query patterns

## Dependencies

- EndpointManager (for SPARQL connection)
- LanguageSelector (for label language)
- SchemeSelector (for scope filtering)
- ConceptTree (for result selection)
