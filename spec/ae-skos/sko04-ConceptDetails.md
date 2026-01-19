# ConceptDetails

Component for displaying all properties of a selected SKOS concept.

## Features

### Core SKOS Properties

Display standard SKOS label and documentation properties:

| Property | Display | Multiple |
|----------|---------|----------|
| `skos:prefLabel` | Preferred Label | Per language |
| `skos:altLabel` | Alternative Labels | Yes |
| `skos:hiddenLabel` | Hidden Labels | Yes |
| `skos:definition` | Definition | Per language |
| `skos:scopeNote` | Scope Note | Yes |
| `skos:historyNote` | History Note | Yes |
| `skos:changeNote` | Change Note | Yes |
| `skos:editorialNote` | Editorial Note | Yes |
| `skos:example` | Example | Yes |
| `skos:notation` | Notation | Yes |

**Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?property ?value
WHERE {
  <CONCEPT_URI> ?property ?value .
  FILTER (?property IN (
    skos:prefLabel, skos:altLabel, skos:hiddenLabel,
    skos:definition, skos:scopeNote, skos:historyNote,
    skos:changeNote, skos:editorialNote, skos:example,
    skos:notation
  ))
}
```

### Semantic Relations

#### Hierarchical Relations

| Property | Display |
|----------|---------|
| `skos:broader` | Broader Concepts |
| `skos:narrower` | Narrower Concepts |

#### Associative Relations

| Property | Display |
|----------|---------|
| `skos:related` | Related Concepts |

#### Mapping Relations

| Property | Display |
|----------|---------|
| `skos:exactMatch` | Exact Match |
| `skos:closeMatch` | Close Match |
| `skos:broadMatch` | Broad Match |
| `skos:narrowMatch` | Narrow Match |
| `skos:relatedMatch` | Related Match |

**Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?relation ?concept ?label
WHERE {
  <CONCEPT_URI> ?relation ?concept .
  FILTER (?relation IN (
    skos:broader, skos:narrower, skos:related,
    skos:exactMatch, skos:closeMatch, skos:broadMatch,
    skos:narrowMatch, skos:relatedMatch
  ))
  OPTIONAL {
    ?concept skos:prefLabel ?label .
    FILTER (LANGMATCHES(LANG(?label), "LANG") || LANG(?label) = "")
  }
}
```

### Collection Membership

Show collections the concept belongs to.

**Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?collection ?label
WHERE {
  ?collection skos:member <CONCEPT_URI> .
  OPTIONAL {
    ?collection skos:prefLabel ?label .
    FILTER (LANGMATCHES(LANG(?label), "LANG") || LANG(?label) = "")
  }
}
```

### Concept Reference Enrichment

When loading related concepts (broader, narrower, related), the system enriches each `ConceptRef` with:

- **label**: Best matching label based on language priority
- **notation**: SKOS notation if available
- **hasNarrower**: Boolean indicating if the concept has children (for icon display)

The `hasNarrower` flag is determined by checking if `skos:narrower` relationships exist:

```sparql
OPTIONAL { ?concept skos:narrower ?narrowerChild }
BIND(BOUND(?narrowerChild) AS ?hasNarrower)
```

### Relation Chip Icons

Each relation chip displays an icon based on the type of reference:

| Chip Type | Icon | Class | Description |
|-----------|------|-------|-------------|
| Broader (with children) | `label` | `icon-label` | Concept has narrower concepts |
| Broader (leaf) | `circle` | `icon-leaf` | Concept has no narrower concepts |
| Narrower (with children) | `label` | `icon-label` | Child concept has its own children |
| Narrower (leaf) | `circle` | `icon-leaf` | Child concept is a leaf node |
| Related (with children) | `label` | `icon-label` | Related concept has children |
| Related (leaf) | `circle` | `icon-leaf` | Related concept has no children |
| Collection | `collections_bookmark` | `icon-collection` | Static icon for collections |
| Scheme | `folder` | `icon-folder` | Static icon for concept schemes |

**Icon Display Logic:**
```html
<!-- Concept refs (broader/narrower/related) - dynamic based on hasNarrower -->
<span class="chip-icon" :class="ref.hasNarrower ? 'icon-label' : 'icon-leaf'">
  {{ ref.hasNarrower ? 'label' : 'circle' }}
</span>

<!-- Collection refs - static icon -->
<span class="chip-icon icon-collection">collections_bookmark</span>

<!-- Scheme refs - static icon -->
<span class="chip-icon icon-folder">folder</span>
```

### Other Properties

Display any additional properties not covered by SKOS core.

**Query:**
```sparql
SELECT ?property ?value
WHERE {
  <CONCEPT_URI> ?property ?value .
  FILTER (!STRSTARTS(STR(?property), "http://www.w3.org/2004/02/skos/core#"))
}
```

**Display Behavior:**
- Properties displayed using **qualified names** (e.g., `dct:title` instead of full URI)
- Prefix resolution via local common prefixes map (fallback to prefix.cc API)
- Properties sorted **alphabetically** by qualified name
- Styled consistently with other sections (no distinct background)

**Prefix Resolution:**
1. Extract namespace from URI (up to last `/` or `#`)
2. Check local common prefixes map (dct, dc, rdfs, owl, foaf, schema, prov, dcat, etc.)
3. Fallback to prefix.cc API if not found locally
4. Cache resolved prefixes in localStorage for persistence

## Display Behavior

### Concept Header

The concept title in the header uses the following priority:

1. **notation + skos:prefLabel** (if both exist): `123 - Albania`
2. **notation + skosxl:prefLabel** (SKOS-XL fallback): `123 - Albania`
3. **notation only** or **label only** if just one exists
4. **URI fragment** as last resort

The SKOS-XL prefLabel (`skosxl:prefLabel/skosxl:literalForm`) is used as fallback when regular `skos:prefLabel` is not available.

### Label Display

Concept labels follow the unified label priority defined in [sko01-LanguageSelector.md](./sko01-LanguageSelector.md#label-priority).

The main panel displays label properties in separate sections showing the exact predicate origin:
- **Preferred Label** (`skos:prefLabel`)
- **Title (dct:title)** - Dublin Core Terms
- **Title (dc:title)** - Dublin Core Elements
- **Label (rdfs:label)** - RDFS generic label

### Deprecation Badge

Deprecated concepts display a warning badge in the header:

```
┌─────────────────────────────────────────────────────────────┐
│ Wheat [en] [DEPRECATED]                          [📋] [</>] │
│ http://example.org/concepts/wheat                [📋]       │
└─────────────────────────────────────────────────────────────┘
```

**Detection:** Deprecation status is determined from `otherProperties` using configurable rules:
1. `owl:deprecated = "true"` - Standard OWL deprecation
2. `euvoc:status ≠ CURRENT` - EU Vocabularies status

**Styling:**
- Badge: Orange background with uppercase "DEPRECATED" text
- Positioned after language tag in header

**Settings:** Visibility controlled via Settings → Deprecation → "Show deprecation indicators"

### Conditional Sections

Properties and sections are **only displayed when they have values**:

- **Labels section**: shown if any of prefLabel, altLabel, or notation exists
- **Documentation section**: shown if any of definition, scopeNote, historyNote, changeNote, editorialNote, or example exists
- **Hierarchy section**: shown if broader or narrower exists
- **Relations section**: shown if related exists
- **Mappings section**: shown if any of exactMatch, closeMatch, broadMatch, narrowMatch, or relatedMatch exists
- **Schemes section**: shown if inScheme exists

Within each section, individual properties are only displayed if they have values.

## UI Component

```
┌─────────────────────────────────────────────────────────────┐
│ Wheat                                            [📋] [</>] │
│ http://example.org/concepts/wheat                [📋]       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ LABELS                                                      │
│ ─────────────────────────────────────────────────────────── │
│ Preferred:    Wheat (en), Tarwe (nl), Blé (fr)              │
│ Alternative:  Common wheat, Bread wheat                     │
│ Notation:     AGR-123                                       │
│                                                             │
│ DOCUMENTATION                                               │
│ ─────────────────────────────────────────────────────────── │
│ Definition:   A cereal grain cultivated worldwide...        │
│ Scope Note:   Use for Triticum species only                 │
│                                                             │
│ HIERARCHY                                                   │
│ ─────────────────────────────────────────────────────────── │
│ Broader:      [Cereals] [Grains]                            │
│ Narrower:     [Durum wheat] [Spelt] [Einkorn]               │
│                                                             │
│ RELATIONS                                                   │
│ ─────────────────────────────────────────────────────────── │
│ Related:      [Flour] [Bread]                               │
│                                                             │
│ MAPPINGS                                                    │
│ ─────────────────────────────────────────────────────────── │
│ exactMatch:   [Wikidata: Q15645384]                         │
│ closeMatch:   [AGROVOC: c_8373]                             │
│                                                             │
│ COLLECTIONS                                                 │
│ ─────────────────────────────────────────────────────────── │
│ Member of:    [Staple Crops] [European Agriculture]         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Legend:**
- `[📋]` = Copy to clipboard
- `[</>]` = View raw RDF
- `[Concept]` = Clickable link to navigate

### Raw RDF Dialog

View the raw RDF representation of the concept.

**Features:**
- Format selector: Turtle, JSON-LD, N-Triples, RDF/XML
- Copy to clipboard button
- Read-only text area with monospace font

**Dialog Styling:**
- Width: 900px
- Max height: 90vh
- Font size: 0.7rem (compact for readability)
- Textarea: 28 rows

## Data Model

```typescript
interface ConceptDetails {
  uri: string;
  deprecated?: boolean;  // Deprecation status
  labels: {
    prefLabel: LangLiteral[];
    altLabel: LangLiteral[];
    hiddenLabel: LangLiteral[];
  };
  documentation: {
    definition: LangLiteral[];
    scopeNote: LangLiteral[];
    historyNote: LangLiteral[];
    changeNote: LangLiteral[];
    editorialNote: LangLiteral[];
    example: LangLiteral[];
  };
  notation: string[];
  relations: {
    broader: ConceptRef[];
    narrower: ConceptRef[];
    related: ConceptRef[];
  };
  mappings: {
    exactMatch: ConceptRef[];
    closeMatch: ConceptRef[];
    broadMatch: ConceptRef[];
    narrowMatch: ConceptRef[];
    relatedMatch: ConceptRef[];
  };
  collections: ConceptRef[];
  otherProperties: PropertyValue[];
}

interface LangLiteral {
  value: string;
  lang?: string;
}

interface ConceptRef {
  uri: string;
  label?: string;
  notation?: string;
  lang?: string;
  hasNarrower?: boolean;  // For dynamic icon display
  type?: 'collection' | 'scheme';  // For static icon display
}

interface PropertyValue {
  property: string;
  propertyLabel?: string;
  value: string;
  lang?: string;
  datatype?: string;
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `details:loaded` | `ConceptDetails` | Details fetched |
| `relation:clicked` | `string` | Related concept clicked |
| `copy:uri` | `string` | URI copied |
| `copy:label` | `string` | Label copied |

## Loading & Error States

See [com03-ErrorHandling](../common/com03-ErrorHandling.md) for details.

### Loading

Skeleton layout matching content structure.

### Empty State (No Selection)

```
┌─────────────────────────────────────────────────────────────┐
│ Concept Details                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Select a concept from the tree or search results          │
│   to view its details.                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Error State

```
┌─────────────────────────────────────────────────────────────┐
│ Concept Details                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ⚠ Failed to load concept details                         │
│   [Retry]                                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Related Specs

- [com02-StateManagement](../common/com02-StateManagement.md) - State architecture
- [com03-ErrorHandling](../common/com03-ErrorHandling.md) - Error/loading states
- [com04-URLRouting](../common/com04-URLRouting.md) - Deep linking to concepts
- [com05-SPARQLPatterns](../common/com05-SPARQLPatterns.md) - Query patterns

## Dependencies

- EndpointManager (for SPARQL connection)
- LanguageSelector (for label display)
- ConceptTree (for relation clicks)
