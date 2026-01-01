# LanguageSelector

UI component for selecting language preferences in AE SKOS.

## Features

### Per-Endpoint Language Configuration

Each endpoint has its own language configuration:

1. **Priority List**: Ordered list of languages (e.g., `['en', 'fr', 'de', 'it', 'rm']`)
2. **Current Language**: Optional override that trumps the priority list

When resolving labels:
- If `current` is set → use only that language
- Else → walk priority list in order, first match wins

### Language Dropdown

Quick access to change current language from toolbar.

- Shows current language (or first priority if no override)
- Dropdown lists all detected languages
- Selected language becomes the "current" override
- Clear option to revert to priority-based selection

### Priority Settings Dialog

Full control over language order and priorities.

```
┌─────────────────────────────────────────────┐
│ Language Settings                       [×] │
├─────────────────────────────────────────────┤
│                                             │
│ Current Language Override                   │
│ ┌─────────────────────────────────────┐     │
│ │ (Use priority order)            [▼] │     │
│ └─────────────────────────────────────┘     │
│                                             │
│ Priority Order (drag to reorder)            │
│ ┌─────────────────────────────────────┐     │
│ │ ≡ 1. English (12,456)          [×] │     │
│ │ ≡ 2. Français (8,901)          [×] │     │
│ │ ≡ 3. Deutsch (7,234)           [×] │     │
│ │ ≡ 4. Italiano (5,123)          [×] │     │
│ │ ≡ 5. Rumantsch (2,345)         [×] │     │
│ └─────────────────────────────────────┘     │
│                                             │
│ Available Languages                         │
│ ┌─────────────────────────────────────┐     │
│ │ [+] Nederlands (4,567)              │     │
│ │ [+] Español (3,456)                 │     │
│ └─────────────────────────────────────┘     │
│                                             │
├─────────────────────────────────────────────┤
│               [Refresh]  [Save]             │
└─────────────────────────────────────────────┘
```

Features:
- Drag-and-drop reordering of priority list
- Add/remove languages from priority list
- Shows label counts per language
- Current override dropdown (or "Use priority order")

### SKOS-Specific Detection

Detect languages from SKOS labels with counts.

**Query:**
```sparql
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT DISTINCT (LANG(?label) AS ?lang) (COUNT(?label) AS ?count)
WHERE {
  ?concept a skos:Concept ;
           skos:prefLabel ?label .
  FILTER (LANG(?label) != "")
}
GROUP BY (LANG(?label))
ORDER BY DESC(?count)
```

## Data Model

### Per-Endpoint Language Config

```typescript
interface EndpointLanguageConfig {
  priorities: string[];      // Ordered language list, e.g., ['en', 'fr', 'de']
  current: string | null;    // Override language, null = use priorities
}
```

### Storage

Language config is stored per-endpoint:

```typescript
// Key format: ae-language-{endpointId}
interface StoredLanguageConfig {
  priorities: string[];
  current: string | null;
}
```

### State

```typescript
interface LanguageState {
  // Per-endpoint config (keyed by endpoint ID)
  configs: Record<string, EndpointLanguageConfig>;

  // Current endpoint's effective config
  priorities: string[];       // Current endpoint's priority list
  current: string | null;     // Current endpoint's override

  // Detection results
  detected: string[];         // All detected languages
  detectedWithCount: { lang: string; count: number }[];
}
```

## Label Resolution

### Priority Algorithm

```typescript
function selectLabel(labels: LabelValue[]): LabelValue | null {
  if (!labels || labels.length === 0) return null;

  // If current override is set, use only that
  if (current) {
    return labels.find(l => l.lang === current) || labels[0];
  }

  // Walk priority list in order
  for (const lang of priorities) {
    const match = labels.find(l => l.lang === lang);
    if (match) return match;
  }

  // Fallback: no-lang label, then first available
  return labels.find(l => !l.lang) || labels[0];
}
```

### Sort Order

Labels are sorted by priority position:

```typescript
function sortLabels(labels: LabelValue[]): LabelValue[] {
  return [...labels].sort((a, b) => {
    const aIndex = priorities.indexOf(a.lang || '');
    const bIndex = priorities.indexOf(b.lang || '');

    // Prioritized languages first, in order
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;

    // No-lang labels next
    if (!a.lang && b.lang) return -1;
    if (a.lang && !b.lang) return 1;

    // Rest alphabetically
    return (a.lang || '').localeCompare(b.lang || '');
  });
}
```

### Language Tag Display

Show language tag only when label is not from current/first-priority language:

```typescript
function shouldShowLangTag(lang?: string): boolean {
  if (!lang) return false;
  const displayLang = current || priorities[0];
  return lang !== displayLang;
}
```

## UI Component

### Toolbar Selector

```
┌────────────────────────────┐
│ 🌐 English           [▼]   │
├────────────────────────────┤
│ ✓ English (12,456)         │  ← Current override
│   Français (8,901)         │
│   Deutsch (7,234)          │
│ ────────────────────────── │
│   ○ Use priority order     │  ← Clears current override
│ ────────────────────────── │
│   ⚙ Language settings      │
└────────────────────────────┘
```

When "Use priority order" is selected:
- `current` is set to `null`
- Dropdown shows first priority language
- Label resolution uses full priority list

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `language:changed` | `{ current, priorities }` | Language config changed |
| `language:prioritiesChanged` | `string[]` | Priority order changed |
| `language:currentChanged` | `string \| null` | Current override changed |

## Persistence

### Per-Endpoint Storage

```typescript
// Save
const key = `ae-language-${endpoint.id}`;
localStorage.setItem(key, JSON.stringify({
  priorities: ['en', 'fr', 'de', 'it', 'rm'],
  current: null
}));

// Load (with defaults)
const stored = localStorage.getItem(key);
if (stored) {
  const config = JSON.parse(stored);
  return config;
} else {
  // Default: browser language first, then 'en'
  const browserLang = navigator.language.split('-')[0];
  return {
    priorities: browserLang !== 'en' ? [browserLang, 'en'] : ['en'],
    current: null
  };
}
```

### Migration

Old format (`ae-language`):
```json
{ "preferred": "en", "fallback": "fr" }
```

New format (`ae-language-{id}`):
```json
{ "priorities": ["en", "fr"], "current": null }
```

Migration: Convert `[preferred, fallback]` to `priorities` array.

## Loading States

### Detecting Languages

```
┌────────────────────────┐
│ 🌐 ◌ Detecting...  [▼] │
└────────────────────────┘
```

### No Languages Detected

```
┌────────────────────────┐
│ 🌐 (none)          [▼] │
├────────────────────────┤
│   No languages found   │
└────────────────────────┘
```

## Related Specs

- [com02-StateManagement](../common/com02-StateManagement.md) - State architecture
- [com03-ErrorHandling](../common/com03-ErrorHandling.md) - Error/loading states
