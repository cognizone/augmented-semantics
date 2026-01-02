# ConceptTree

Component for hierarchical browsing of SKOS concepts.

## Features

### Top Concepts

Display root concepts within selected scheme. Top concepts are identified via:

1. **Explicit marking**: `skos:topConceptOf` or scheme's `skos:hasTopConcept`
2. **Fallback**: Concepts with no `skos:broader` relationship

**Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX skosxl: <http://www.w3.org/2008/05/skos-xl#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT DISTINCT ?concept ?label ?labelLang ?labelType ?notation
       (COUNT(DISTINCT ?narrower) AS ?narrowerCount)
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
    # Fallback: concepts with no broader relationship
    ?concept a skos:Concept .
    ?concept skos:inScheme <SCHEME_URI> .
    FILTER NOT EXISTS { ?concept skos:broader ?broader }
  }
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
  OPTIONAL { ?narrower skos:broader ?concept }
}
GROUP BY ?concept ?label ?labelLang ?labelType ?notation
ORDER BY ?concept ?label
LIMIT 2000
```

**Note:** Label selection happens in code using priority-based resolution (see Label Resolution section below).

### Hierarchical Expansion

Load narrower concepts on demand when user expands a node.

**Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX skosxl: <http://www.w3.org/2008/05/skos-xl#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT DISTINCT ?concept ?label ?labelLang ?labelType ?notation
       (COUNT(DISTINCT ?narrower) AS ?narrowerCount)
WHERE {
  ?concept skos:broader <PARENT_URI> .
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
  OPTIONAL { ?narrower skos:broader ?concept }
}
GROUP BY ?concept ?label ?labelLang ?labelType ?notation
ORDER BY ?concept ?label
LIMIT 1000
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
1. `skos:prefLabel` - primary SKOS label
2. `skosxl:prefLabel/skosxl:literalForm` - SKOS-XL extended label
3. `dct:title` - common for schemes and resources
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

### Label Fetching
Fetch all labels with all language tags, then pick the best one in code:

```typescript
function pickBestLabel(labels: { value: string; lang: string; type: string }[]): string | undefined {
  const labelPriority = ['prefLabel', 'title', 'rdfsLabel']

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
