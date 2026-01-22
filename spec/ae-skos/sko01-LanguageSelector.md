# Language Settings

Language configuration for AE SKOS label display.

## Architecture

The language system has two levels:

1. **Global Preferred Language**: User's preferred language for viewing labels (stored in Settings)
2. **Per-Endpoint Language Priorities**: Ordered fallback list for each endpoint

### Label Resolution Order

When displaying a label, the system tries languages in this order:

1. **Preferred language** (global setting)
2. **Endpoint priorities** (in configured order)
3. **Labels without language tag**
4. **First available label**

### Label Priority

The canonical label priority is defined in `/src/constants/labels.ts`:

| Priority | Predicate | Type | Description |
|----------|-----------|------|-------------|
| 1 | `skos:prefLabel` | `prefLabel` | Primary SKOS preferred label |
| 2 | `skosxl:prefLabel` | `xlPrefLabel` | SKOS-XL extended preferred label |
| 3 | `dct:title` | `dctTitle` | Dublin Core Terms title (preferred over dc:title) |
| 4 | `dc:title` | `dcTitle` | Dublin Core Elements title (legacy) |
| 5 | `rdfs:label` | `rdfsLabel` | RDFS generic label (fallback) |

**Why dct:title preferred over dc:title:** Dublin Core Terms has better-defined semantics and is the recommended namespace.

### Label Property Priority by Resource Type

Different resource types have different property fallback orders:

**Schemes and Collections** (unified priority):
1. `skos:prefLabel`
2. `skosxl:prefLabel` (SKOS-XL)
3. `dct:title` (Dublin Core Terms)
4. `dc:title` (Dublin Core Elements)
5. `rdfs:label`

**Concepts** (excludes title properties since concepts rarely have titles):
1. `skos:prefLabel`
2. `skosxl:prefLabel` (SKOS-XL)
3. `rdfs:label`

```typescript
// Using selectSchemeLabel or selectCollectionLabel with separate dc/dct fields
const schemeLabel = selectSchemeLabel({
  prefLabels: scheme.prefLabels,
  prefLabelsXL: scheme.prefLabelsXL,
  dctTitles: scheme.dctTitles,
  dcTitles: scheme.dcTitles,
  rdfsLabels: scheme.rdfsLabels,
})

const collectionLabel = selectCollectionLabel({
  prefLabels: collection.prefLabels,
  dctTitles: collection.dctTitles,
  dcTitles: collection.dcTitles,
  rdfsLabels: collection.rdfsLabels,
})

// Using selectLabelByPriority for typed labels from SPARQL queries
const bestLabel = selectLabelByPriority(labels) // Uses LABEL_PRIORITY constant
```

### Main Panel Property Display

The main panel displays title properties separately to show exact predicate origin:

- **Title (dct:title)** - Dublin Core Terms title values
- **Title (dc:title)** - Dublin Core Elements title values
- **Label (rdfs:label)** - RDFS label values

### Language Selection Within Property

For each property type, languages are tried in this order:

```typescript
function selectLabel(labels: LabelValue[]): LabelValue | null {
  if (!labels?.length) return null

  // 1. Try preferred language
  const preferred = labels.find(l => l.lang === languageStore.preferred)
  if (preferred) return preferred

  // 2. Try endpoint priorities in order
  const priorities = endpointStore.current?.languagePriorities || []
  for (const lang of priorities) {
    const match = labels.find(l => l.lang === lang)
    if (match) return match
  }

  // 3. Try labels without language tag
  const noLang = labels.find(l => !l.lang)
  if (noLang) return noLang

  // 4. First available
  return labels[0]
}
```

### Label Display Consistency

Labels are displayed consistently across all UI locations (breadcrumb, tree, main panel) for all resource types.

#### Consistency Matrix

| Type | Breadcrumb | Tree | Main Panel | Status |
|------|------------|------|------------|--------|
| **Scheme** | ✅ Full chain | ✅ (uses store) | ✅ Full chain | ✅ Consistent |
| **Collection** | ✅ Full chain | ✅ Full chain | ✅ Full chain | ✅ Consistent |
| **Concept** | ✅ Full chain | ✅ Full chain | ✅ Full chain | ✅ Consistent |

All locations use the same:
- Label predicates (`prefLabel`, `xlPrefLabel`, `dctTitle`, `dcTitle`, `rdfsLabel`)
- Priority order (defined in `LABEL_PRIORITY` constant)
- Language selection logic

#### Label Resolution by Component

All components use the **centralized label resolution** in `useLabelResolver.ts`:

**Breadcrumb** (`ConceptBreadcrumb.vue`):
- SPARQL queries include all label predicates with BIND for labelType
- Uses `selectLabelByPriority()` from useLabelResolver
- Fallback: `getUriFragment(uri)` or full URI

**Tree** (`ConceptTree.vue` + composables):
- Metadata queries return nodes without labels
- `loadLabelsForNodes()` in useTreePagination enriches nodes with labels
- Uses `buildCapabilityAwareLabelUnionClause()` for capability-aware queries
- Uses `selectLabelByPriority()` from useLabelResolver for label selection
- Display format: `notation - label` or `notation || label || getUriFragment(uri)`

**Main Panel** (detail components):
- Stores labels separately by type (`dctTitles[]`, `dcTitles[]`, etc.)
- Uses type-specific selectors from useLabelResolver:
  - `selectSchemeLabel()` for schemes
  - `selectCollectionLabel()` for collections
  - `selectLabelWithXL()` for concepts
- Display format: Separate sections for each label type

#### Centralized Label Resolution Functions

| Function | Use Case | Priority |
|----------|----------|----------|
| `selectLabel()` | Base language selection | User pref > Endpoint > No-lang > First |
| `selectLabelWithXL()` | With XL fallback | Regular labels first, then XL |
| `selectConceptLabel()` | Concept headers | prefLabel > xlPrefLabel > rdfsLabel |
| `selectSchemeLabel()` | Scheme headers | prefLabel > xlPrefLabel > dctTitle > dcTitle > rdfsLabel |
| `selectCollectionLabel()` | Collection headers | prefLabel > xlPrefLabel > dctTitle > dcTitle > rdfsLabel |
| `selectLabelByPriority()` | SPARQL typed labels | Full LABEL_PRIORITY order |

#### Implementation Files Reference

| File | Purpose |
|------|---------|
| `/src/constants/labels.ts` | `LABEL_PRIORITY`, `LABEL_TYPES`, `LABEL_PREDICATES`, query builders |
| `/src/composables/useLabelResolver.ts` | All label selection functions (centralized) |
| `/src/composables/useProgressiveLabelLoader.ts` | Progressive label loading by language priority |
| `/src/composables/useTreePagination.ts` | Tree label loading via `loadLabelsForNodes()` |
| `/src/composables/useConceptTreeQueries.ts` | Metadata query builders (no labels) |
| `/src/composables/useConceptData.ts` | Related labels resolution |
| `/src/composables/useCollections.ts` | Collection list labels |
| `/src/composables/useCollectionQueries.ts` | Capability-aware collection query building |
| `/src/components/skos/ConceptBreadcrumb.vue` | Breadcrumb display |

## Label Constants API

The `/src/constants/labels.ts` module provides canonical definitions for label handling:

### Constants

| Export | Purpose |
|--------|---------|
| `LABEL_TYPES` | Type identifiers for labels (`prefLabel`, `xlPrefLabel`, etc.) |
| `LABEL_PRIORITY` | Priority order for display label selection |
| `ALT_LABEL_PRIORITY` | Priority order for alternative labels |
| `LABEL_PREDICATES` | URI and prefixed form for each label type |

### Query Builder Functions

| Function | Purpose |
|----------|---------|
| `buildLabelUnionClause()` | SPARQL UNION clause for all label predicates |
| `buildOptionalLabelClause()` | Wraps union clause in OPTIONAL |
| `buildCapabilityAwareLabelUnionClause()` | UNION clause using only detected predicates |
| `buildCapabilityAwareOptionalLabelClause()` | Capability-aware version with OPTIONAL |
| `buildSingleLanguageLabelClause()` | UNION clause filtered to a single language |
| `mergeCapabilities()` | Merge multiple `LabelPredicateCapabilities` |

### Capability-Aware Query Building

When endpoint analysis detects which label predicates exist, queries can be optimized to include only relevant predicates:

```typescript
// Before (queries all 5 predicates even if only 2 exist)
const clause = buildLabelUnionClause('?concept')

// After (queries only detected predicates)
const capabilities = endpoint.analysis?.labelPredicates?.concept
const clause = buildCapabilityAwareLabelUnionClause('?concept', capabilities)
```

**Benefits:**
- Smaller SPARQL queries (fewer UNION branches)
- Faster execution (no pointless pattern matching)
- Graceful fallback (uses all predicates if no capabilities detected)

### Label Predicate Capabilities

The `LabelPredicateCapabilities` type tracks which predicates exist per resource type:

```typescript
interface LabelPredicateCapabilities {
  prefLabel?: boolean
  xlPrefLabel?: boolean
  dctTitle?: boolean
  dcTitle?: boolean
  rdfsLabel?: boolean
}
```

Capabilities are stored in endpoint analysis:
- `endpoint.analysis.labelPredicates.concept` - Concept label predicates
- `endpoint.analysis.labelPredicates.scheme` - Scheme label predicates
- `endpoint.analysis.labelPredicates.collection` - Collection label predicates

### Merging Capabilities

When querying resources that can be multiple types (e.g., collection members can be concepts or collections), merge capabilities:

```typescript
const conceptCaps = endpoint.analysis?.labelPredicates?.concept
const collectionCaps = endpoint.analysis?.labelPredicates?.collection
const mergedCaps = mergeCapabilities(conceptCaps, collectionCaps)

// Query will include predicates from EITHER type
const clause = buildCapabilityAwareLabelUnionClause('?member', mergedCaps)
```

## Progressive Label Loading

For large result sets, labels are loaded progressively by language priority to minimize latency.

### Strategy

The `useProgressiveLabelLoader` composable implements a progressive loading algorithm:

1. **Query preferred language first** - Get labels in user's preferred language
2. **Remove resolved concepts** - Track which concepts now have labels
3. **Query next priority language** - For remaining concepts without labels
4. **Threshold check** - When remaining count ≤ threshold, do full query
5. **Final pass** - Query all predicates for any still-unresolved concepts

### Configuration

```typescript
interface ProgressiveLabelConfig {
  threshold?: number           // Switch to full query below this count (default: 5)
  maxLanguageIterations?: number  // Max languages to try (default: 5)
  signal?: AbortSignal         // For cancellation support
}
```

### Example Flow

For 100 concepts with user preference `en` and endpoint priorities `[fr, de, es]`:

```
Iteration 1: Query "en" labels → 72 resolved, 28 remaining
Iteration 2: Query "fr" labels → 15 resolved, 13 remaining
Iteration 3: Query "de" labels → 6 resolved, 7 remaining
Iteration 4: Query "es" labels → 3 resolved, 4 remaining
(4 ≤ threshold 5) → Switch to full query
Final: Full query for 4 concepts → 3 resolved, 1 unresolved (no label)
```

### Callback-Based Resolution

Labels are reported incrementally via callback as they resolve:

```typescript
const { loadLabelsProgressively } = useProgressiveLabelLoader()

await loadLabelsProgressively(
  conceptUris,
  'concept',  // resourceType
  (resolved: Map<string, LabelValue>) => {
    // Update UI with resolved labels
    for (const [uri, label] of resolved) {
      updateConceptLabel(uri, label)
    }
  },
  { threshold: 5, maxLanguageIterations: 5 }
)
```

### When to Use

Use progressive loading when:
- Loading labels for many concepts (>10)
- Network latency is noticeable
- Most concepts have labels in preferred/priority languages

Stick to full queries when:
- Loading labels for few concepts (≤5)
- Labels are needed atomically (all-or-nothing)

## Global Settings

### Preferred Language

The user selects their preferred language in the global Settings dialog:

```
┌─────────────────────────────────────────────┐
│ Settings                                [×] │
├─────────────────────────────────────────────┤
│                                             │
│ Preferred Language                          │
│ ┌─────────────────────────────────────┐     │
│ │ en (12,456)                     [▼] │     │
│ └─────────────────────────────────────┘     │
│                                             │
│ ☑ Show datatypes                            │
│   Display datatype tags on property values  │
│                                             │
│ ☑ Show language tags                        │
│   Display language tags when different      │
│   from preferred                            │
│                                             │
│   ☑ Include preferred language              │
│     Also show tag when matching preferred   │
│                                             │
└─────────────────────────────────────────────┘
```

The language dropdown shows languages detected from the current endpoint's analysis, ordered by the endpoint's language priorities.

### Language Tag Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `showLanguageTags` | `true` | Show language tags on labels |
| `showPreferredLanguageTag` | `false` | Show tag even when matching preferred |

## Per-Endpoint Configuration

### Language Priorities

Each endpoint stores an ordered list of language priorities:

```typescript
interface SPARQLEndpoint {
  // ... other fields ...
  languagePriorities?: string[]  // e.g., ['en', 'fr', 'de']
}
```

Users can reorder languages in the Endpoint Manager's "Language Priority" dialog:

```
┌─────────────────────────────────────────────┐
│ Language Priority - DBpedia             [×] │
├─────────────────────────────────────────────┤
│                                             │
│ Use the buttons to reorder. First language  │
│ is used when preferred is unavailable.      │
│                                             │
│ ┌─────────────────────────────────────┐     │
│ │ [▲][▼] 1. en (12,456)               │     │
│ │ [▲][▼] 2. fr (8,901)                │     │
│ │ [▲][▼] 3. de (7,234)                │     │
│ │ [▲][▼] 4. it (5,123)                │     │
│ └─────────────────────────────────────┘     │
│                                             │
├─────────────────────────────────────────────┤
│                    [Cancel]  [Save]         │
└─────────────────────────────────────────────┘
```

### Default Order

When no priorities are configured, languages are ordered:
1. `en` (English) always first
2. Remaining languages alphabetically by code

### Language Detection

Languages are detected during endpoint analysis via SPARQL:

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

When duplicates exist across graphs, the query uses `GRAPH ?g { ... }` scope.

## Language Tag Display

Language tags appear as small badges next to labels:

```
Economic indicators  en
```

### When Tags Are Shown

Tags are shown when:
1. `showLanguageTags` setting is enabled
2. Label has a language tag
3. Either:
   - Language differs from preferred, OR
   - `showPreferredLanguageTag` is enabled

```typescript
function shouldShowLangTag(lang?: string): boolean {
  if (!settingsStore.showLanguageTags) return false
  if (!lang) return false
  if (settingsStore.showPreferredLanguageTag) return true
  return lang !== languageStore.preferred
}
```

### Tag Styling

```css
.lang-tag {
  font-size: 0.625rem;
  font-weight: normal;
  background: var(--p-surface-200);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  margin-left: 0.25rem;
}
```

## Data Storage

### Settings Store

```typescript
interface AppSettings {
  showDatatypes: boolean
  showLanguageTags: boolean
  showPreferredLanguageTag: boolean  // NEW
}
// Key: ae-skos-settings
```

### Language Store

```typescript
interface LanguageState {
  preferred: string  // Global preferred language
}
// Key: ae-language
```

### Endpoint Store

```typescript
interface SPARQLEndpoint {
  languagePriorities?: string[]  // Per-endpoint priority order
  analysis?: {
    languages?: { lang: string; count: number }[]
  }
}
// Key: ae-endpoints
```

## Related Specs

- [com01-EndpointManager](../common/com01-EndpointManager.md) - Endpoint configuration
- [com02-StateManagement](../common/com02-StateManagement.md) - State architecture
