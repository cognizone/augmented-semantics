# SchemeSelector

Component for listing and selecting SKOS Concept Schemes.

## Features

### List Concept Schemes

Schemes are loaded from the endpoint's pre-configured `schemeUris` whitelist (stored during endpoint analysis). Labels are fetched dynamically using a VALUES clause query.

**Source:** `endpoint.analysis.schemeUris` - array of scheme URIs detected during endpoint creation/analysis (max 200)

**Behavior:**
- Only schemes in `schemeUris` are shown (no discovery fallback)
- If `schemeUris` is empty or missing, dropdown shows no schemes
- Labels are fetched dynamically based on current language priorities
- All configured URIs appear even if no label data is found (shows URI as fallback)

**Query (with VALUES clause):**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX skosxl: <http://www.w3.org/2008/05/skos-xl#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>

SELECT DISTINCT ?scheme ?label ?labelLang ?labelType ?deprecated
WHERE {
  VALUES ?scheme { <uri1> <uri2> ... }
  OPTIONAL { ?scheme owl:deprecated ?deprecated . }
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
```

**Why config-driven (not discovery):**
- Deployment can control which schemes are visible in the app
- `app.json` defines the exact schemes for a branded deployment
- Consistent with endpoint analysis flow (schemes detected once, stored)

### Scheme Filtering UI

When >5 schemes are available, a filter input field appears in the dropdown header to help users quickly find schemes.

**Visibility:** Shows only when `allSchemeOptions.length > 5`

**Implementation:** `ConceptBreadcrumb.vue` using PrimeVue Select `#header` slot

**Features:**
- **Case-insensitive label matching** - Filters schemes as user types
- **Pinned items** - "All Schemes" and "Orphan Concepts" always visible
- **Clear button (×)** - Appears when filter has text, clears on click
- **Keyboard shortcuts:**
  - `Escape` - Clear filter text
  - `Tab` - Navigate to first dropdown item
  - Arrow keys work normally after Tab
- **Empty state** - Shows "No schemes match your search" when no unpinned items match

**UI Example:**
```
┌─────────────────────────────────────┐
│ [Filter schemes... (Tab to nav)] × │
├─────────────────────────────────────┤
│   All Schemes            (pinned)  │
│   Orphan Concepts        (pinned)  │
│ ──────────────────────────────      │
│ ● Albania Thesaurus                 │
│   Europe Thesaurus                  │
│   Geographic Names                  │
└─────────────────────────────────────┘
```

**User Flow:**
1. Open scheme dropdown
2. Type to filter (e.g., "euro")
3. Pinned items remain visible
4. Only matching schemes shown
5. Press Tab to navigate list
6. Press Escape or click × to clear

### Orphan Concepts Pseudo-Scheme

A special pseudo-scheme represents concepts not associated with any ConceptScheme. Fully implemented with multiple detection strategies.

**URI:** `~orphans~` (constant)

**Purpose:**
- Helps identify concepts that lack proper scheme relationships
- Useful for data quality checking
- Provides navigation to orphaned concepts
- Supports multiple detection methods based on endpoint capabilities

**Data Model:**
```typescript
export const ORPHAN_SCHEME_URI = '~orphans~'

// Pseudo-scheme object added to scheme list
{
  uri: ORPHAN_SCHEME_URI,
  prefLabel: [{ value: 'Orphan Concepts', lang: 'en' }],
  isOrphan: true  // Flag for special handling
}
```

**Display in Dropdown:**
- Appears second in list (after "All Schemes", before real schemes)
- Icon: `link_off` (Material Symbol)
- Text style: Italic to differentiate from real schemes
- URI hidden (shows "Orphan Concepts" label only)
- Always visible (pinned item in filter)

**Behavior when selected:**
- Tree loads orphan concepts with progress tracking
- Breadcrumb shows "Orphan Concepts" instead of raw URI
- Search scope includes only orphan concepts
- Details view not available (pseudo-scheme has no properties)
- Detection strategy selected automatically or by user setting

**UI Example:**
```
┌─────────────────────────────────────┐
│   All Schemes                       │
│ 🔗 Orphan Concepts (italic)         │
│ ──────────────────────────────      │
│ ● Albania Thesaurus                 │
│   Europe Thesaurus                  │
│   Geographic Names                  │
└─────────────────────────────────────┘
```

### Orphan Detection Strategy Setting

Three strategies for detecting orphan concepts, selectable in app settings. The strategy affects performance and compatibility with different SPARQL endpoints.

**Implementation:** `stores/settings.ts` with localStorage persistence (`ae-skos-orphan-strategy`)

**Strategies:**

| Strategy | Method | Performance | Compatibility | When to Use |
|----------|--------|-------------|---------------|-------------|
| `auto` (default) | Fast first, fallback to slow | Best balance | Universal | Recommended for most users |
| `fast` | Single FILTER NOT EXISTS query | Fastest (single query) | Modern endpoints only | When endpoint supports complex queries |
| `slow` | Multiple exclusion queries + client-side subtraction | Slower (12+ queries) | All endpoints | When fast method fails or times out |

**Auto Strategy Behavior:**
1. Attempts fast method first
2. If fast method fails (error or timeout):
   - Logs warning with error details
   - Falls back to slow method automatically
   - User sees seamless experience
3. No manual intervention needed

**Fast Method Requirements:**
- Endpoint must support `FILTER NOT EXISTS` with UNION branches
- Query complexity depends on endpoint capabilities:
  - Minimum: `hasInScheme` OR `hasTopConceptOf` OR `hasTopConceptOf`
  - Optimal: All relationship types detected
- Good SPARQL query optimizer (for performance)

**Slow Method Characteristics:**
- Always works (no special endpoint requirements)
- Runs 1 query to fetch all concepts
- Runs 2-12 exclusion queries (based on endpoint capabilities)
- Performs client-side set subtraction
- Shows per-query progress metrics

**Performance Comparison Example:**

| Endpoint | Total Concepts | Fast Method | Slow Method | Speedup |
|----------|----------------|-------------|-------------|---------|
| UNESCO Thesaurus | 8,000 | 1.2s (1 query) | 15.4s (13 queries) | 12.8× faster |
| AGROVOC | 40,000 | 4.7s (1 query) | 78.2s (13 queries) | 16.6× faster |
| EuroVoc | 7,000 | 0.9s (1 query) | 12.1s (13 queries) | 13.4× faster |

**UI Integration:**
- Setting located in app settings panel
- Radio button group with three options
- Help text explains each strategy
- Default: `auto` (recommended)

**Implementation Files:**
- `stores/settings.ts` - Strategy state and persistence
- `composables/useTreePagination.ts` - Strategy selection logic
- `composables/useOrphanConcepts.ts` - Detection implementations
- `composables/useOrphanQueries.ts` - Query builders

### Graph Count Display

When analyzing an endpoint, the number of SKOS graphs is displayed with special handling for large endpoints.

**Implementation:** `useEndpointCapabilities.ts` composable

**Display Logic:**

| Condition | Display | Tooltip |
|-----------|---------|---------|
| `count === null \|\| undefined` | "Unknown" | - |
| `count === 0` | "None" | "No graphs contain SKOS concepts or schemes" |
| `count > 0 && count ≤ 500` | "42 graphs" | "42 graphs contain SKOS data" |
| `count > 500 && skosGraphUris === null` | "500+ graphs" | "More than 500 graphs contain SKOS data (too many to process individually)" |

**Why 500 Limit:**
- Language detection batches graphs (10 graphs per query)
- Processing >500 graphs becomes slow (>50 queries)
- Storing 500+ URIs in analysis object is inefficient
- Most endpoints have <100 graphs; 500+ indicates massive dataset

**When Limit Exceeded:**
- `skosGraphCount` stores actual count (e.g., 1247)
- `skosGraphUris` set to `null` (not stored)
- Display shows "500+" indicator
- Language detection falls back to unbatched queries
- Tooltip explains limitation

**Data Model:**
```typescript
interface EndpointAnalysis {
  skosGraphCount: number | null        // null = detection failed, number = count
  skosGraphUris?: string[] | null      // URIs when ≤500, null when >500
  // ...
}
```

**Batching Strategy:**
- **≤500 graphs:** Store URIs, use 10-per-batch for language detection
- **>500 graphs:** Don't store URIs, use unbatched language queries

**UI Example:**
```
┌────────────────────────────────────┐
│ Endpoint Analysis                  │
├────────────────────────────────────┤
│ SKOS Graphs: 500+ graphs      ⓘ   │
│ Total Concepts: 1.2M               │
│ Languages: en, fr, de (38 total)  │
└────────────────────────────────────┘

Tooltip: "More than 500 graphs contain SKOS data
(too many to process individually)"
```

**Implementation Files:**
- `types/endpoint.ts` - `skosGraphUris` field definition
- `services/sparql.ts` - Graph enumeration and limit handling
- `composables/useEndpointCapabilities.ts` - Display logic

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

**Header:**
- `owl:deprecated` - Shown as deprecation badge indicator (when true)

**Display Sections** (each shown only if properties exist):

1. **Labels**
   - `skos:prefLabel` - Preferred labels
   - `skos:altLabel` - Alternative labels
   - `skos:hiddenLabel` - Hidden labels
   - `rdfs:label` - Generic labels
   - `skos:notation` - Notations with datatype display
   - `skosxl:prefLabel` / `skosxl:altLabel` / `skosxl:hiddenLabel` - SKOS-XL extended labels with collapsible viewer

2. **Title** (if different from prefLabel)
   - `dct:title` - Dublin Core title

3. **Documentation**
   - `skos:definition` - Formal definitions
   - `dct:description` - General descriptions
   - `rdfs:comment` - Comments
   - `skos:scopeNote` - Usage scope notes
   - `skos:historyNote` - Historical information
   - `skos:changeNote` - Change documentation
   - `skos:editorialNote` - Editorial notes
   - `skos:note` - General notes
   - `skos:example` - Usage examples (styled italic)

4. **Metadata**
   - `dct:creator` - Creator(s) with URI links
   - `dct:publisher` - Publisher(s) with URI links
   - `rdfs:seeAlso` - Related resources with URI links
   - `dct:rights` - Rights information
   - `dct:license` - License information
   - `owl:versionInfo` - Version information
   - `dct:issued` - Issue date (formatted)
   - `dct:created` - Creation date (formatted)
   - `dct:modified` - Last modified date (formatted)

5. **Other Properties**
   - All other predicates not explicitly handled above
   - `rdf:type` is excluded
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
  deprecated?: boolean           // owl:deprecated
  // Labels
  prefLabels: LabelValue[]
  altLabels: LabelValue[]
  hiddenLabels: LabelValue[]
  labels: LabelValue[]           // rdfs:label
  notations: NotationValue[]     // skos:notation
  prefLabelsXL: XLLabel[]
  altLabelsXL: XLLabel[]
  hiddenLabelsXL: XLLabel[]
  // Documentation
  definitions: LabelValue[]
  scopeNotes: LabelValue[]
  historyNotes: LabelValue[]
  changeNotes: LabelValue[]
  editorialNotes: LabelValue[]
  notes: LabelValue[]            // skos:note
  examples: LabelValue[]
  comments: LabelValue[]         // rdfs:comment
  title: LabelValue[]
  description: LabelValue[]
  // Metadata
  creator: string[]
  publisher: string[]
  rights: string[]
  license: string[]
  seeAlso: string[]              // rdfs:seeAlso
  versionInfo?: string           // owl:versionInfo
  issued?: string                // dct:issued
  created?: string
  modified?: string
  // Other properties
  otherProperties: OtherProperty[]
  topConceptCount?: number
}

interface NotationValue {
  value: string
  datatype?: string
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
