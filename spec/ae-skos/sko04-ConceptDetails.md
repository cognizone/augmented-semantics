# ConceptDetails

Component for displaying all properties of a selected SKOS concept.

## Features

### Core SKOS Properties

Display standard SKOS label and documentation properties:

| Property | Display | Multiple |
|----------|---------|----------|
| `skos:prefLabel` | Preferred Label | Per language |
| `skos:altLabel` | Alternative Labels | Yes |
| `skos:hiddenLabel` | Hidden Labels (toggleable) | Yes |
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

### Other Properties

Display any additional properties not covered above.

**Query:**
```sparql
SELECT ?property ?value
WHERE {
  <CONCEPT_URI> ?property ?value .
  FILTER (!STRSTARTS(STR(?property), "http://www.w3.org/2004/02/skos/core#"))
}
```

## Display Behavior

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

## Data Model

```typescript
interface ConceptDetails {
  uri: string;
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
