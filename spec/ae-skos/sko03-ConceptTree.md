# ConceptTree

Component for hierarchical browsing of SKOS concepts.

## Features

### Top Concepts

Display root concepts (no broader concept) within selected scheme.

**Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?concept ?label
WHERE {
  ?concept a skos:Concept .
  ?concept skos:inScheme <SCHEME_URI> .
  FILTER NOT EXISTS { ?concept skos:broader ?broader }
  ?concept skos:prefLabel ?label .
  FILTER (LANGMATCHES(LANG(?label), "LANG") || LANG(?label) = "")
}
ORDER BY ?label
```

### Hierarchical Expansion

Load narrower concepts on demand when user expands a node.

**Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?concept ?label
WHERE {
  ?concept skos:broader <PARENT_URI> .
  ?concept skos:prefLabel ?label .
  FILTER (LANGMATCHES(LANG(?label), "LANG") || LANG(?label) = "")
}
ORDER BY ?label
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

## Label Resolution (Consistent Across All Components)

All components (Tree, Breadcrumb, Details, Search) MUST use the same label resolution logic:

### Property Priority
1. `skos:prefLabel`
2. `rdfs:label`
3. `dct:title`

### Language Priority (for each property)
1. Preferred language (user selected)
2. Fallback language (user configured)
3. No language tag (untagged literals)
4. Any available language

### Implementation
Fetch all labels with all language tags, then pick the best one in code:

```typescript
function pickBestLabel(labels: { value: string; lang: string; type: string }[]): string | undefined {
  const labelPriority = ['prefLabel', 'rdfsLabel', 'title']

  for (const labelType of labelPriority) {
    const labelsOfType = labels.filter(l => l.type === labelType)
    if (!labelsOfType.length) continue

    const preferred = labelsOfType.find(l => l.lang === preferredLang)
    const fallback = labelsOfType.find(l => l.lang === fallbackLang)
    const noLang = labelsOfType.find(l => l.lang === '')
    const any = labelsOfType[0]

    const best = preferred?.value || fallback?.value || noLang?.value || any?.value
    if (best) return best
  }
  return undefined
}
```

### Direct URI Lookup

Input field to navigate directly to a concept by URI.

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

### Breadcrumb

```
┌──────────────────────────────────────────────────────────┐
│ 🏠 > Agriculture > Crops > Cereals > Wheat               │
└──────────────────────────────────────────────────────────┘
```

Each segment is clickable for navigation.

## Data Model

```typescript
interface ConceptNode {
  uri: string;
  label: string;
  hasNarrower: boolean;    // Has children (for expand indicator)
  children?: ConceptNode[]; // Loaded on demand
  expanded: boolean;
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

## Performance

- Lazy load children on expand (not all at once)
- Cache expanded nodes to avoid re-fetching
- Virtual scrolling for large lists (>100 items)

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
