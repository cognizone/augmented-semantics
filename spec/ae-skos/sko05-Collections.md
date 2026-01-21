# Collections

SKOS Collections support for grouping concepts without hierarchical relationships.

## Overview

SKOS Collections (`skos:Collection`) group concepts without implying hierarchical relationships. Collections support hierarchical nesting: top-level collections appear at the scheme root, while nested collections (contained by another collection via `skos:member`) appear under their parent collection and load on-demand when expanded.

## Collection Loading

Collections are loaded when a scheme is selected. Only collections with members belonging to the current scheme are shown.

**Implementation:** `useCollections.ts` composable

**Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX skosxl: <http://www.w3.org/2008/05/skos-xl#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX dc: <http://purl.org/dc/elements/1.1/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT DISTINCT ?collection ?label ?labelLang ?labelType ?notation WHERE {
  ?collection a skos:Collection .
  ?collection skos:member ?concept .

  # Concept belongs to scheme via various paths
  {
    ?concept skos:inScheme <SCHEME_URI> .
  } UNION {
    ?concept skos:topConceptOf <SCHEME_URI> .
  } UNION {
    <SCHEME_URI> skos:hasTopConcept ?concept .
  } UNION {
    ?concept skos:broader+ ?top .
    { ?top skos:topConceptOf <SCHEME_URI> } UNION { <SCHEME_URI> skos:hasTopConcept ?top }
  }

  # Label resolution with priority tracking
  OPTIONAL {
    {
      ?collection skos:prefLabel ?label .
      BIND("prefLabel" AS ?labelType)
    } UNION {
      ?collection skosxl:prefLabel/skosxl:literalForm ?label .
      BIND("xlPrefLabel" AS ?labelType)
    } UNION {
      ?collection dct:title ?label .
      BIND("title" AS ?labelType)
    } UNION {
      ?collection dc:title ?label .
      BIND("dcTitle" AS ?labelType)
    } UNION {
      ?collection rdfs:label ?label .
      BIND("rdfsLabel" AS ?labelType)
    }
    BIND(LANG(?label) AS ?labelLang)
  }

  OPTIONAL { ?collection skos:notation ?notation }
}
ORDER BY ?collection
```

## Nested Collections

Collections can contain other collections via `skos:member`. The tree displays this hierarchy with lazy loading.

**Display Rules:**
- **Top-level collections**: Collections not contained by any other collection appear at the scheme root
- **Nested collections**: Collections that are members of another collection appear under their parent
- **Expandable**: Collections with child collections show an expand arrow
- **Lazy loading**: Child collections load on-demand when parent is expanded
- **Concept members**: Clicking any collection shows its concept members in the details panel (not in the tree)

**Tree Structure:**
```
+----------------------------------------+
| > UNESCO Thesaurus                      |
|   +-- > Domains (expandable)            |
|   |     +-- Social Sciences             |  <- Nested collection
|   |     +-- Natural Sciences            |  <- Nested collection
|   +-- Microthesauri (leaf)              |
|   +-- > Agriculture                     |
|   +-- > Economics                       |
+----------------------------------------+
```

### Nesting Detection

The main collections query includes nesting detection via `EXISTS` patterns:

```sparql
# Added to SELECT clause
?hasParentCollection ?hasChildCollections

# Added to WHERE clause
BIND(EXISTS {
  ?parentCol a skos:Collection .
  ?parentCol skos:member ?collection .
} AS ?hasParentCollection)

BIND(EXISTS {
  ?collection skos:member ?childCol .
  ?childCol a skos:Collection .
} AS ?hasChildCollections)
```

### Child Collections Query

When a collection with children is expanded, child collections are loaded:

```sparql
SELECT DISTINCT ?collection ?label ?labelLang ?labelType ?notation
       ?hasChildCollections WHERE {
  <PARENT_URI> skos:member ?collection .
  ?collection a skos:Collection .

  BIND(EXISTS {
    ?collection skos:member ?childCol .
    ?childCol a skos:Collection .
  } AS ?hasChildCollections)

  # Label resolution (same pattern as main query)
  OPTIONAL {
    { ?collection skos:prefLabel ?label . BIND("prefLabel" AS ?labelType) }
    UNION { ?collection skosxl:prefLabel/skosxl:literalForm ?label . BIND("xlPrefLabel" AS ?labelType) }
    UNION { ?collection dct:title ?label . BIND("dctTitle" AS ?labelType) }
    UNION { ?collection dc:title ?label . BIND("dcTitle" AS ?labelType) }
    UNION { ?collection rdfs:label ?label . BIND("rdfsLabel" AS ?labelType) }
    BIND(LANG(?label) AS ?labelLang)
  }
  OPTIONAL { ?collection skos:notation ?notation }
}
ORDER BY ?collection
```

**Implementation:** `useCollections.ts` composable with `loadChildCollections()` function

### Top-Level Collection Filtering

The `topLevelCollections` computed property filters nested collections from the root level:

```typescript
// In useCollections.ts
const topLevelCollections = computed(() =>
  collections.value.filter(c => !c.isNested)
)
```

**Filtering Logic:**
- Collections with `hasParentCollection = true` are marked as `isNested = true`
- Only collections where `isNested = false` appear at the tree root
- Nested collections appear under their parent when the parent is expanded

### Lazy Loading Mechanism

Child collections load on-demand when a parent collection is expanded:

```typescript
async function loadChildCollections(parentUri: string): Promise<CollectionNode[]>
```

**Parameters:**
- `parentUri` - URI of the parent collection to load children for

**Returns:**
- Array of `CollectionNode` objects representing child collections

**Loading Flow:**
```
User clicks expand arrow on collection
         |
ConceptTree: onCollectionExpand(collectionUri)
         |
Check if children already cached
         |
    Cached? --Yes--> Use cached children
         |
         No
         |
loadChildCollections(collectionUri)
         |
Execute child collections query
         |
Process results into CollectionNode[]
         |
Cache in expandedCollectionChildren map
         |
Update tree with children
```

### Collection Expansion State

Expansion state is tracked using two mechanisms:

```typescript
// Track which collections are expanded (PrimeVue Tree)
const expandedKeys = ref<Record<string, boolean>>({})

// Cache loaded child collections
const expandedCollectionChildren = ref<Map<string, CollectionNode[]>>(new Map())
```

**State Management:**
- `expandedKeys` controls visual expand/collapse state in the tree component
- `expandedCollectionChildren` caches loaded children to avoid re-fetching
- When scheme changes, both are cleared to avoid stale data

### Capability-Aware Queries

Collection queries use capability-aware label resolution:

```typescript
// In useCollectionQueries.ts
const collectionCapabilities = endpoint.analysis?.labelPredicates?.collection
const labelClause = buildCapabilityAwareLabelUnionClause('?collection', collectionCapabilities)
```

This ensures queries only include label predicates that exist for collections in the current endpoint.

## Collection Display in Tree

Top-level collections appear at the root level with a distinct icon. Collections with child collections are expandable:

```
+--------------------------------+
| [Go to URI...]                 |
+--------------------------------+
| > Subject Categories           |  <- Expandable collection
|     +-- Geographic Groups      |  <- Nested collection
| Alphabetical Index             |  <- Leaf collection
| > Agriculture                  |  <- Top concept
| > Economics                    |  <- Top concept
+--------------------------------+
```

**Icon:** `collections_bookmark` (Material Symbol)

## Collection Selection

When a collection is clicked:
1. Concept selection is cleared
2. Collection URI stored in `conceptStore.selectedCollectionUri`
3. CollectionDetails component renders in right panel
4. Breadcrumb updates to show collection

**Events:**
- `collection:selecting` - Before selection
- `collection:selected` - After selection

## Collection Details

**Implementation:** `useCollectionData.ts` composable

Loads collection properties and members via SPARQL queries.

### Properties Query

Loads all collection properties including SKOS core labels, SKOS-XL extended labels, documentation properties, and metadata.

```sparql
SELECT ?p ?o ?lang ?labelType WHERE {
  # SKOS core properties
  {
    <COLLECTION_URI> ?p ?o .
    BIND(LANG(?o) AS ?lang)
    FILTER(?p IN (
      skos:prefLabel, skos:altLabel, skos:hiddenLabel, skos:notation,
      skos:definition, skos:scopeNote, skos:historyNote, skos:changeNote,
      skos:editorialNote, skos:note, skos:example
    ))
    BIND(IF(?p = skos:prefLabel, "prefLabel",
         IF(?p = skos:altLabel, "altLabel",
         IF(?p = skos:hiddenLabel, "hiddenLabel", ""))) AS ?labelType)
  }
  # SKOS-XL extended labels
  UNION { <COLLECTION_URI> skosxl:prefLabel/skosxl:literalForm ?o . BIND(skosxl:prefLabel AS ?p) BIND("xlPrefLabel" AS ?labelType) BIND(LANG(?o) AS ?lang) }
  UNION { <COLLECTION_URI> skosxl:altLabel/skosxl:literalForm ?o . BIND(skosxl:altLabel AS ?p) BIND("xlAltLabel" AS ?labelType) BIND(LANG(?o) AS ?lang) }
  UNION { <COLLECTION_URI> skosxl:hiddenLabel/skosxl:literalForm ?o . BIND(skosxl:hiddenLabel AS ?p) BIND("xlHiddenLabel" AS ?labelType) BIND(LANG(?o) AS ?lang) }
  # Dublin Core / RDFS labels
  UNION { <COLLECTION_URI> dct:title ?o . BIND(dct:title AS ?p) BIND("dctTitle" AS ?labelType) BIND(LANG(?o) AS ?lang) }
  UNION { <COLLECTION_URI> dc:title ?o . BIND(dc:title AS ?p) BIND("dcTitle" AS ?labelType) BIND(LANG(?o) AS ?lang) }
  UNION { <COLLECTION_URI> rdfs:label ?o . BIND(rdfs:label AS ?p) BIND("rdfsLabel" AS ?labelType) BIND(LANG(?o) AS ?lang) }
  # Documentation properties
  UNION { <COLLECTION_URI> rdfs:comment ?o . BIND(rdfs:comment AS ?p) BIND("comment" AS ?labelType) BIND(LANG(?o) AS ?lang) }
  UNION { <COLLECTION_URI> dct:description ?o . BIND(dct:description AS ?p) BIND("description" AS ?labelType) BIND(LANG(?o) AS ?lang) }
  # Metadata properties (owl, dct, dc, cc)
  UNION { <COLLECTION_URI> owl:deprecated ?o . BIND(owl:deprecated AS ?p) BIND("deprecated" AS ?labelType) }
  UNION { <COLLECTION_URI> dct:created ?o . BIND(dct:created AS ?p) BIND("created" AS ?labelType) }
  UNION { <COLLECTION_URI> dct:modified ?o . BIND(dct:modified AS ?p) BIND("modified" AS ?labelType) }
  UNION { <COLLECTION_URI> dct:issued ?o . BIND(dct:issued AS ?p) BIND("issued" AS ?labelType) }
  UNION { <COLLECTION_URI> owl:versionInfo ?o . BIND(owl:versionInfo AS ?p) BIND("versionInfo" AS ?labelType) }
  UNION { <COLLECTION_URI> dct:status ?o . BIND(dct:status AS ?p) BIND("status" AS ?labelType) }
  UNION { <COLLECTION_URI> dc:identifier ?o . BIND(dc:identifier AS ?p) BIND("identifier" AS ?labelType) }
  UNION { <COLLECTION_URI> dct:creator ?o . BIND(dct:creator AS ?p) BIND("creator" AS ?labelType) }
  UNION { <COLLECTION_URI> dct:publisher ?o . BIND(dct:publisher AS ?p) BIND("publisher" AS ?labelType) }
  UNION { <COLLECTION_URI> dct:rights ?o . BIND(dct:rights AS ?p) BIND("rights" AS ?labelType) }
  UNION { <COLLECTION_URI> dct:license ?o . BIND(dct:license AS ?p) BIND("license" AS ?labelType) }
  UNION { <COLLECTION_URI> cc:license ?o . BIND(cc:license AS ?p) BIND("ccLicense" AS ?labelType) }
  UNION { <COLLECTION_URI> rdfs:seeAlso ?o . BIND(rdfs:seeAlso AS ?p) BIND("seeAlso" AS ?labelType) }
}
```

**Note:** XL label values from this query are merged into the regular label arrays. Full XL label resources (with URIs) are loaded separately via `loadXLLabels()`.

### Members Query

```sparql
SELECT DISTINCT ?member ?label ?labelLang ?labelType ?notation WHERE {
  <COLLECTION_URI> skos:member ?member .

  OPTIONAL {
    { ?member skos:prefLabel ?label . BIND("prefLabel" AS ?labelType) }
    UNION { ?member skosxl:prefLabel/skosxl:literalForm ?label . BIND("xlPrefLabel" AS ?labelType) }
    UNION { ?member dct:title ?label . BIND("title" AS ?labelType) }
    UNION { ?member dc:title ?label . BIND("dcTitle" AS ?labelType) }
    UNION { ?member rdfs:label ?label . BIND("rdfsLabel" AS ?labelType) }
    BIND(LANG(?label) AS ?labelLang)
  }
  OPTIONAL { ?member skos:notation ?notation }
}
ORDER BY ?member
LIMIT 500
```

## Collection Breadcrumb

When a collection is selected, the breadcrumb shows only the collection (scheme is visible in dropdown):

```
+----------------------------------------------------------+
| [Scheme v] > Subject Categories                           |
+----------------------------------------------------------+
```

**Implementation:** `loadCollectionBreadcrumb()` in ConceptBreadcrumb.vue

The breadcrumb fetches collection labels via SPARQL query (same pattern as concept breadcrumb) rather than relying on cached collections state. This ensures correct label display regardless of component initialization order.

**Query:**
```sparql
SELECT ?label ?labelLang ?labelType ?notation
WHERE {
  OPTIONAL { <COLLECTION_URI> skos:notation ?notation }
  OPTIONAL {
    { <COLLECTION_URI> skos:prefLabel ?label . BIND("prefLabel" AS ?labelType) }
    UNION { <COLLECTION_URI> skosxl:prefLabel/skosxl:literalForm ?label . BIND("xlPrefLabel" AS ?labelType) }
    UNION { <COLLECTION_URI> dct:title ?label . BIND("title" AS ?labelType) }
    UNION { <COLLECTION_URI> dc:title ?label . BIND("dcTitle" AS ?labelType) }
    UNION { <COLLECTION_URI> rdfs:label ?label . BIND("rdfsLabel" AS ?labelType) }
    BIND(LANG(?label) AS ?labelLang)
  }
}
```

## Go to URI - Collection Detection

The "Go to URI" input detects whether a URI is a collection before treating it as a concept.

**Detection Order:**
1. Check if URI matches a known scheme -> navigate to scheme
2. Query if URI is `skos:Collection` -> navigate to collection
3. Query if URI is `skos:Concept` -> navigate to concept
4. Show warning if none match

**Collection Detection Query:**
```sparql
ASK { <URI> a skos:Collection }
```

**Concept Detection Query:**
```sparql
ASK { <URI> a skos:Concept }
```

**Invalid URI Handling:**
- Warning message displayed below input
- Auto-dismisses after 3 seconds
- Clears when user starts typing

## Label Resolution

Collections use the same label priority as concepts and schemes:

1. `skos:prefLabel`
2. `skosxl:prefLabel/skosxl:literalForm`
3. `dct:title` (Dublin Core Terms)
4. `dc:title` (Dublin Core Elements)
5. `rdfs:label`

**Note:** Both `dct:title` and `dc:title` are supported as different endpoints use different Dublin Core namespaces.

## Data Model

```typescript
interface CollectionNode {
  uri: string
  label?: string
  labelLang?: string
  notation?: string
  hasChildCollections?: boolean  // True = expandable (has nested collections)
  isNested?: boolean             // True = has parent collection (hide from root)
}

interface CollectionDetails {
  uri: string
  deprecated?: boolean           // owl:deprecated
  prefLabels: LabelValue[]
  altLabels: LabelValue[]
  hiddenLabels: LabelValue[]     // skos:hiddenLabel
  // Title/label properties (stored separately by predicate)
  dctTitles: LabelValue[]        // dct:title (Dublin Core Terms)
  dcTitles: LabelValue[]         // dc:title (Dublin Core Elements)
  rdfsLabels: LabelValue[]       // rdfs:label
  // Documentation properties
  comments: LabelValue[]         // rdfs:comment
  description: LabelValue[]      // dct:description
  definitions: LabelValue[]
  scopeNotes: LabelValue[]
  historyNotes: LabelValue[]
  changeNotes: LabelValue[]
  editorialNotes: LabelValue[]
  notes: LabelValue[]
  examples: LabelValue[]
  notations: NotationValue[]
  // Metadata (Dublin Core / RDFS / OWL)
  identifier: string[]           // dc:identifier
  created?: string               // dct:created
  modified?: string              // dct:modified
  issued?: string                // dct:issued
  versionInfo?: string           // owl:versionInfo
  status?: string                // dct:status
  creator: string[]              // dct:creator
  publisher: string[]            // dct:publisher
  rights: string[]               // dct:rights
  license: string[]              // dct:license
  ccLicense: string[]            // cc:license
  seeAlso: string[]              // rdfs:seeAlso
  // SKOS-XL extended labels
  prefLabelsXL: XLLabel[]
  altLabelsXL: XLLabel[]
  hiddenLabelsXL: XLLabel[]
  // Other properties (non-SKOS predicates)
  otherProperties: OtherProperty[]
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `collection:selecting` | `string` | Before collection selection |
| `collection:selected` | `string` | Collection URI selected |

## Related Specs

- [sko04-ConceptTree](./sko04-ConceptTree.md) - Tree display integration
- [sko06-ConceptDetails](./sko06-ConceptDetails.md) - Details panel display
- [com02-StateManagement](../common/com02-StateManagement.md) - State architecture
- [com05-SPARQLPatterns](../common/com05-SPARQLPatterns.md) - Query patterns
- [sko13-PropertyAnalysis](./sko13-PropertyAnalysis.md) - Property comparison across detail types
