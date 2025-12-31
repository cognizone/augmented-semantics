# LanguageSelector

UI component for selecting language preferences in AE SKOS.

> **Note:** Core language settings (preferred + fallback) are defined in [com01-EndpointManager](../common/com01-EndpointManager.md#language-preferences).

## Features

### Language Dropdown

Quick access to change preferred language from toolbar.

- Shows current preferred language
- Dropdown lists all detected languages
- Changes sync to common `LanguagePreferences`

### SKOS-Specific Detection

Optionally detect languages specifically from SKOS labels (more relevant than generic detection).

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

Shows language with count of labels available.

## UI Component

### Toolbar Selector

```
┌────────────────────────┐
│ 🌐 Nederlands    [▼]   │
├────────────────────────┤
│ ● Nederlands (12,456)  │
│   English (11,230)     │
│   Français (8,901)     │
│   Deutsch (7,234)      │
│ ──────────────────────│
│   ⚙ Language settings  │
└────────────────────────┘
```

"Language settings" opens the full settings dialog from common component.

## Data Model

Uses common `LanguagePreferences` from EndpointManager.

```typescript
// Local UI state only
interface LanguageSelectorState {
  open: boolean;              // Dropdown open
  loading: boolean;           // Detection in progress
  detectedWithCount: {        // SKOS-specific detection
    lang: string;
    count: number;
  }[];
}
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `language:changed` | `string` | User selected different language |
| `language:openSettings` | - | User clicked settings link |

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

- [com01-EndpointManager](../common/com01-EndpointManager.md) - Language preferences
- [com02-StateManagement](../common/com02-StateManagement.md) - State architecture
- [com03-ErrorHandling](../common/com03-ErrorHandling.md) - Error/loading states

## Dependencies

- EndpointManager (for language preferences and detection)
