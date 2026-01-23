# Settings

Centralized application settings with persistence and UI configuration.

## Overview

AE SKOS provides configurable settings that persist across sessions via localStorage. Settings are organized into logical groups and accessible via a Settings dialog.

**Implementation:** `stores/settings.ts`
**Storage Key:** `ae-skos-settings`

## Settings Store

```typescript
interface SettingsState {
  // Display
  darkMode: boolean
  showOrphansSelector: boolean
  showDeprecationIndicator: boolean
  showNotationInLabels: boolean

  // Labels & Tags
  showLanguageTags: boolean
  showPreferredLanguageTag: boolean
  showDatatypes: boolean
  showStringDatatypes: boolean

  // Deprecation Detection
  deprecationRules: DeprecationRule[]

  // Orphan Detection
  orphanDetectionStrategy: 'auto' | 'fast' | 'slow'
  orphanFastPrefilter: boolean

  // Developer
  developerMode: boolean
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

interface DeprecationRule {
  id: string
  name: string
  enabled: boolean
  predicate: string
  valueCheck: 'equals' | 'notEquals'
  value: string
}
```

## Settings Groups

### Display Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `darkMode` | boolean | `false` | Enable dark theme |
| `showOrphansSelector` | boolean | `true` | Show "Orphan Concepts" in scheme dropdown |
| `showDeprecationIndicator` | boolean | `true` | Show deprecation badges in tree |
| `showNotationInLabels` | boolean | `true` | Show notation prefix in concept/collection labels |

### Labels & Tags Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `showLanguageTags` | boolean | `true` | Show language tags on labels (e.g., `@en`) |
| `showPreferredLanguageTag` | boolean | `false` | Show tag even for preferred language |
| `showDatatypes` | boolean | `true` | Show datatype tags on literal values |
| `showStringDatatypes` | boolean | `false` | Show `xsd:string` datatype explicitly |

See [com07-DatatypeDisplay](../common/com07-DatatypeDisplay.md) for datatype rendering rules.

### Deprecation Rules

Configure which rules determine if a concept is deprecated.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `deprecationRules.owlDeprecated` | boolean | `true` | Detect via `owl:deprecated = "true"` |
| `deprecationRules.euvocStatus` | boolean | `true` | Detect via `euvoc:status != CURRENT` |

See [sko04-ConceptTree](./sko04-ConceptTree.md#deprecation-display) for visual display details.

### Orphan Detection

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `orphanDetectionStrategy` | enum | `'auto'` | Algorithm for detecting orphan concepts |
| `orphanFastPrefilter` | boolean | `false` | Prefilter direct scheme links before UNION checks |

**Strategies:**

| Value | Description |
|-------|-------------|
| `auto` | Try fast method first, fallback to slow on failure |
| `fast` | Single FILTER NOT EXISTS query (modern endpoints only) |
| `slow` | Multiple exclusion queries + client-side subtraction |

**Fast Prefilter:** When enabled, adds `FILTER NOT EXISTS` clauses for direct `skos:inScheme` and `skos:topConceptOf` links before hierarchical UNION checks. Can speed up queries on endpoints where most concepts have direct scheme links.

See [sko08-OrphanDetection](./sko08-OrphanDetection.md) for algorithm details.

### Developer Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `developerMode` | boolean | `false` | Enable developer features (query viewer, etc.) |
| `logLevel` | enum | `'warn'` | Minimum log level to display |

**Log Levels:**
- `debug` - All messages (verbose)
- `info` - Info and above
- `warn` - Warnings and errors only (default)
- `error` - Errors only

See [sko11-DeveloperTools](./sko11-DeveloperTools.md) for logging details.

## Settings UI

### Dialog Structure

```
+-------------------------------------------+
| Settings                              [X] |
+-------------------------------------------+
| DISPLAY                                   |
| +---------------------------------------+ |
| | [x] Dark mode                         | |
| | [x] Show orphans selector             | |
| | [x] Show deprecation indicators       | |
| | [x] Show notation in labels           | |
| +---------------------------------------+ |
|                                           |
| LABELS & TAGS                             |
| +---------------------------------------+ |
| | [x] Show datatypes                    | |
| |   [ ] Show xsd:string                 | |
| | [x] Show language tags                | |
| |   [ ] Show preferred language tag     | |
| +---------------------------------------+ |
|                                           |
| DEPRECATION RULES                         |
| +---------------------------------------+ |
| | [x] OWL deprecated (owl:deprecated)   | |
| | [x] EU Vocabularies status            | |
| +---------------------------------------+ |
|                                           |
| ORPHAN DETECTION                          |
| +---------------------------------------+ |
| | Strategy:                             | |
| |   (*) Auto (recommended)              | |
| |   ( ) Fast only                       | |
| |   ( ) Slow only                       | |
| |                                       | |
| | [ ] Fast prefilter                    | |
| +---------------------------------------+ |
|                                           |
| DEVELOPER                                 |
| +---------------------------------------+ |
| | [ ] Developer mode                    | |
| | Log level: [Warn v]                   | |
| +---------------------------------------+ |
+-------------------------------------------+
```

### Access

- **Toolbar:** Settings icon (gear) in header
- **Keyboard:** `Ctrl+,` / `Cmd+,`

## Persistence

Settings auto-save to localStorage on change:

```typescript
watch(
  () => state,
  (newState) => {
    localStorage.setItem('ae-skos-settings', JSON.stringify(newState))
  },
  { deep: true }
)
```

**Load on startup:**
```typescript
function loadSettings(): SettingsState {
  const saved = localStorage.getItem('ae-skos-settings')
  return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings
}
```

## Default Values

```typescript
const defaultSettings: SettingsState = {
  // Display
  darkMode: false,
  showOrphansSelector: true,
  showDeprecationIndicator: true,
  showNotationInLabels: true,

  // Labels & Tags
  showLanguageTags: true,
  showPreferredLanguageTag: false,
  showDatatypes: true,
  showStringDatatypes: false,

  // Deprecation
  deprecationRules: [
    { id: 'owl-deprecated', name: 'OWL Deprecated', enabled: true,
      predicate: 'owl:deprecated', valueCheck: 'equals', value: 'true' },
    { id: 'euvoc-status', name: 'EU Vocabularies Status', enabled: true,
      predicate: 'euvoc:status', valueCheck: 'notEquals', value: 'http://publications.europa.eu/resource/authority/concept-status/CURRENT' },
  ],

  // Orphan Detection
  orphanDetectionStrategy: 'auto',
  orphanFastPrefilter: false,

  // Developer
  developerMode: false,
  logLevel: 'warn',
}
```

## Reset Settings

**UI:** "Reset to Defaults" button in Settings dialog footer.

```typescript
function resetSettings() {
  Object.assign(state, defaultSettings)
  // Triggers watcher to persist
}
```

## Related Specs

- [sko04-ConceptTree](./sko04-ConceptTree.md) - Deprecation display, notation in labels
- [sko08-OrphanDetection](./sko08-OrphanDetection.md) - Orphan strategy and prefilter settings
- [sko11-DeveloperTools](./sko11-DeveloperTools.md) - Developer mode and log level
- [com02-StateManagement](../common/com02-StateManagement.md) - State architecture
- [com07-DatatypeDisplay](../common/com07-DatatypeDisplay.md) - Datatype display rules
