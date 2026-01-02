# SchemeSelector

Component for listing and selecting SKOS Concept Schemes.

## Features

### List Concept Schemes

Query all available concept schemes from the endpoint with all label types.

**Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX skosxl: <http://www.w3.org/2008/05/skos-xl#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT DISTINCT ?scheme ?label ?labelLang ?labelType
WHERE {
  ?scheme a skos:ConceptScheme .
  OPTIONAL {
    {
      ?scheme skos:prefLabel ?label .
      BIND("prefLabel" AS ?labelType)
    } UNION {
      ?scheme skosxl:prefLabel/skosxl:literalForm ?label .
      BIND("xlPrefLabel" AS ?labelType)
    } UNION {
      ?scheme dct:title ?label .
      BIND("title" AS ?labelType)
    } UNION {
      ?scheme rdfs:label ?label .
      BIND("rdfsLabel" AS ?labelType)
    }
    BIND(LANG(?label) AS ?labelLang)
  }
}
LIMIT 500
```

### Label Resolution

Same logic as concepts for consistency:

**Priority order:** `prefLabel` > `xlPrefLabel` > `title` > `rdfsLabel`

**Language selection (for each label type):**
1. Current language override (if set)
2. Walk through language priorities in order
3. Labels without language tag
4. First available label

### Scheme Selection

- Dropdown selector in toolbar
- "All Schemes" option to browse without filter
- Selection affects:
  - Top concepts shown in navigation
  - Search scope
  - Language detection scope

### Scheme Details

Full property display panel for selected concept scheme, organized in sections.

**Implementation:** `SchemeDetails.vue` with `useSchemeData.ts` composable

**Display Sections** (each shown only if properties exist):

1. **Labels**
   - `skos:prefLabel` - Preferred labels
   - `skos:altLabel` - Alternative labels
   - `skosxl:prefLabel` - SKOS-XL extended labels with collapsible viewer

2. **Title** (if different from prefLabel)
   - `dct:title` - Dublin Core title

3. **Documentation**
   - `skos:definition` - Formal definitions
   - `dct:description` - General descriptions
   - `skos:scopeNote` - Usage scope notes
   - `skos:historyNote` - Historical information
   - `skos:changeNote` - Change documentation
   - `skos:editorialNote` - Editorial notes
   - `skos:example` - Usage examples (styled italic)

4. **Metadata**
   - `dct:creator` - Creator(s) with URI links
   - `dct:created` - Creation date (formatted)
   - `dct:modified` - Last modified date (formatted)

5. **Other Properties**
   - Non-SKOS/non-DCT predicates
   - Predicates resolved to `prefix:localName` format
   - URI values shown as links

**Template Rendering:**

Uses config-driven approach to minimize duplication:
- Documentation properties rendered via `documentationConfig` array
- Label properties rendered via `labelConfig` array
- Sorted properties use `getSorted()` helper function

**Actions:**
- Browse scheme - Navigate to concept tree filtered by this scheme
- View RDF - Show raw RDF in multiple formats (Turtle, JSON-LD, etc.)
- Export - Download as JSON or Turtle
- Copy URI - Copy scheme URI to clipboard

**Data Loading:**

Three-phase SPARQL query pattern via `useSchemeData`:

1. **Main Query** - Load core SKOS and Dublin Core properties
2. **XL Labels Query** - Load SKOS-XL extended labels (optional)
3. **Other Properties Query** - Load non-SKOS predicates (optional)

Queries use retries for robustness. XL and Other queries fail gracefully if not supported.

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
  labelLang?: string;    // Language of the selected label
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

// Full scheme details for property display
interface SchemeDetails {
  uri: string
  // Labels
  prefLabels: LabelValue[]
  altLabels: LabelValue[]
  prefLabelsXL: XLLabel[]
  // Documentation
  definitions: LabelValue[]
  scopeNotes: LabelValue[]
  historyNotes: LabelValue[]
  changeNotes: LabelValue[]
  editorialNotes: LabelValue[]
  examples: LabelValue[]
  title: LabelValue[]
  description: LabelValue[]
  // Metadata
  creator: string[]
  created?: string
  modified?: string
  // Other properties
  otherProperties: OtherProperty[]
  topConceptCount?: number
}

interface LabelValue {
  value: string
  lang?: string
}

interface XLLabel {
  uri: string
  literalForm: LabelValue
}

interface OtherProperty {
  predicate: string
  values: PropertyValue[]
}

interface PropertyValue {
  value: string
  lang?: string
  isUri: boolean
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
