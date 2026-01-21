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
  showDeprecationIndicators: boolean

  // Deprecation Detection
  deprecationRules: {
    owlDeprecated: boolean      // owl:deprecated = "true"
    euvocStatus: boolean        // euvoc:status != CURRENT
  }

  // Orphan Detection
  orphanStrategy: 'auto' | 'fast' | 'slow'

  // Search
  searchSettings: SearchSettings

  // Developer
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

interface SearchSettings {
  labelScope: ('prefLabel' | 'altLabel' | 'hiddenLabel')[]
  schemeScope: 'current' | 'all'
  matchMode: 'contains' | 'startsWith' | 'exact' | 'regex'
}
```

## Settings Groups

### Display Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `darkMode` | boolean | `false` | Enable dark theme |
| `showOrphansSelector` | boolean | `true` | Show "Orphan Concepts" in scheme dropdown |
| `showDeprecationIndicators` | boolean | `true` | Show deprecation badges in tree |

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
| `orphanStrategy` | enum | `'auto'` | Algorithm for detecting orphan concepts |

**Strategies:**

| Value | Description |
|-------|-------------|
| `auto` | Try fast method first, fallback to slow on failure |
| `fast` | Single FILTER NOT EXISTS query (modern endpoints only) |
| `slow` | Multiple exclusion queries + client-side subtraction |

See [sko08-OrphanDetection](./sko08-OrphanDetection.md) for algorithm details.

### Search Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `searchSettings.labelScope` | array | `['prefLabel', 'altLabel']` | Label types to search |
| `searchSettings.schemeScope` | enum | `'current'` | Search in current or all schemes |
| `searchSettings.matchMode` | enum | `'contains'` | Match algorithm |

**Label Scope Options:**
- `prefLabel` - Preferred labels
- `altLabel` - Alternative labels
- `hiddenLabel` - Hidden labels

**Match Modes:**
- `contains` - Substring match (default)
- `startsWith` - Prefix match
- `exact` - Exact match
- `regex` - Regular expression

See [sko07-SearchBox](./sko07-SearchBox.md) for search behavior details.

### Developer Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `logLevel` | enum | `'info'` | Minimum log level to display |

**Log Levels:**
- `debug` - All messages (verbose)
- `info` - Info, warnings, errors (default)
- `warn` - Warnings and errors only
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
| +---------------------------------------+ |
|                                           |
| SEARCH                                    |
| +---------------------------------------+ |
| | Search in:                            | |
| |   [x] Preferred labels                | |
| |   [x] Alternative labels              | |
| |   [ ] Hidden labels                   | |
| |                                       | |
| | Default scope:                        | |
| |   (*) Current scheme                  | |
| |   ( ) All schemes                     | |
| |                                       | |
| | Default match:                        | |
| |   (*) Contains                        | |
| |   ( ) Starts with                     | |
| |   ( ) Exact                           | |
| +---------------------------------------+ |
|                                           |
| DEVELOPER                                 |
| +---------------------------------------+ |
| | Log level: [Info v]                   | |
| | [View Logs] [Clear Logs]              | |
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
  showDeprecationIndicators: true,

  // Deprecation
  deprecationRules: {
    owlDeprecated: true,
    euvocStatus: true,
  },

  // Orphan Detection
  orphanStrategy: 'auto',

  // Search
  searchSettings: {
    labelScope: ['prefLabel', 'altLabel'],
    schemeScope: 'current',
    matchMode: 'contains',
  },

  // Developer
  logLevel: 'info',
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

- [sko04-ConceptTree](./sko04-ConceptTree.md) - Deprecation display settings
- [sko07-SearchBox](./sko07-SearchBox.md) - Search settings
- [sko08-OrphanDetection](./sko08-OrphanDetection.md) - Orphan strategy setting
- [sko11-DeveloperTools](./sko11-DeveloperTools.md) - Log level setting
- [com02-StateManagement](../common/com02-StateManagement.md) - State architecture
