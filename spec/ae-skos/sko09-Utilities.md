# Utilities

Utility features: copy, raw view, history, keyboard shortcuts.

## Features

### Copy to Clipboard

Quick copy buttons for:
- Concept URI
- Preferred label
- Full label with URI: `"Label" <URI>`

**Implementation:**
```typescript
async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  showToast('Copied to clipboard');
}
```

### View Raw SPARQL Query

Developer tool to inspect generated queries.

**Features:**
- Show last executed query
- Syntax highlighting
- Copy query button
- Execute in external tool link

**UI:**
```
┌─────────────────────────────────────────────────────────────┐
│ SPARQL Query                                     [📋] [✕]  │
├─────────────────────────────────────────────────────────────┤
│ PREFIX skos: <http://www.w3.org/2004/02/skos/core#>         │
│                                                             │
│ SELECT ?concept ?label                                      │
│ WHERE {                                                     │
│   ?concept a skos:Concept ;                                 │
│            skos:prefLabel ?label .                          │
│   FILTER (LANGMATCHES(LANG(?label), "en"))                  │
│ }                                                           │
│ LIMIT 100                                                   │
└─────────────────────────────────────────────────────────────┘
```

### View Raw RDF

Display raw RDF data for selected concept.

**Query:**
```sparql
DESCRIBE <CONCEPT_URI>
```

Or construct:
```sparql
CONSTRUCT { <CONCEPT_URI> ?p ?o }
WHERE { <CONCEPT_URI> ?p ?o }
```

**Formats:**
- Turtle (default)
- JSON-LD
- N-Triples
- RDF/XML

**Accept headers:**
| Format | Accept Header |
|--------|---------------|
| Turtle | `text/turtle` |
| JSON-LD | `application/ld+json` |
| N-Triples | `application/n-triples` |
| RDF/XML | `application/rdf+xml` |

### Recently Viewed

Track and display recently viewed concepts and schemes across all endpoints.

**Storage:**
```
Key: ae-skos-history
Value: [
  { uri: "...", label: "...", accessedAt: "...", endpointUrl: "...", schemeUri: "...", type: "...", hasNarrower: ... },
  ...
]
```

**Features:**
- Show last 50 items (concepts and schemes)
- Click to navigate (auto-switches endpoint/scheme if different)
- Clear history button with confirmation dialog
- Persist across sessions
- Context display (endpoint name, scheme name)
- Visual distinction between concepts and schemes

**Context Display:**
Each history item shows contextual information below the label:
- Endpoint name (resolved from stored URL)
- Scheme name (resolved from stored URI)
- Format: `Endpoint Name · Scheme Name`

**Clear History:**
Clicking the delete button opens a confirmation dialog before clearing all history.
Uses `HistoryDeleteDialog` component with softer styling (info icon instead of warning).

**UI:**
```
┌─────────────────────────────────────────┐
│ Recent                            [🗑]  │
├─────────────────────────────────────────┤
│ 📁 Test Scheme              2 min ago   │
│    Test Endpoint                        │
│ 🏷 Wheat                    5 min ago   │
│    Test Endpoint · Agriculture          │
│ ⚫ Cereals                 10 min ago   │
│    Test Endpoint · Agriculture          │
└─────────────────────────────────────────┘
```

**Icons:**
- 📁 Folder: Scheme entries (`type: 'scheme'`)
- 🏷 Label: Concepts with narrower (`hasNarrower: true`)
- ⚫ Circle: Leaf concepts (no narrower)

### Export Concept

Export selected concept data.

**Formats:**
- JSON (structured data)
- Turtle (RDF)
- CSV (flat properties)

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `/` | Focus search |
| `Esc` | Close dialogs |
| `Ctrl+C` | Copy selected URI |
| `←` | Go to broader |
| `→` | Expand narrower |
| `↑` / `↓` | Navigate tree |

## Data Model

```typescript
interface HistoryEntry {
  uri: string;
  label: string;
  notation?: string;
  lang?: string;
  accessedAt: string;    // ISO timestamp
  endpointUrl?: string;  // Endpoint URL for cross-endpoint navigation
  schemeUri?: string;    // Scheme URI for cross-scheme navigation
  type?: 'concept' | 'scheme' | 'collection' | 'orderedCollection';  // Entry type for visual distinction
  hasNarrower?: boolean; // Has children (for icon selection)
}

interface UtilityState {
  history: HistoryEntry[];
  lastQuery: string | null;
  showQueryDialog: boolean;
  showRawRdfDialog: boolean;
  rawRdfFormat: 'turtle' | 'jsonld' | 'ntriples' | 'rdfxml';
}
```

## Storage Keys

| Key | Content |
|-----|---------|
| `ae-skos-history` | Recently viewed concepts |

## Related Specs

- [com02-StateManagement](../common/com02-StateManagement.md) - State architecture
- [com03-ErrorHandling](../common/com03-ErrorHandling.md) - Toast notifications
- [com04-URLRouting](../common/com04-URLRouting.md) - Share functionality

## Dependencies

- Clipboard API (`navigator.clipboard`)
- localStorage for history
- EndpointManager for raw RDF
