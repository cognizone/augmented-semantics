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
