# StateManagement

Application state architecture for all AE tools.

## Overview

AE tools use a centralized state store with reactive updates. Components subscribe to state changes and dispatch actions to modify state.

```
┌─────────────────────────────────────────────────────────────┐
│                        State Store                          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │Endpoint │ │Language │ │ Scheme  │ │ SKOS    │           │
│  │ State   │ │ State   │ │ State   │ │ State   │           │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘           │
└───────┼──────────┼──────────┼──────────┼───────────────────┘
        │          │          │          │
        ▼          ▼          ▼          ▼
   ┌─────────────────────────────────────────────────────┐
   │                   Event Bus                          │
   │  subscribe() / dispatch() / on() / emit()           │
   └─────────────────────────────────────────────────────┘
        │          │          │          │
        ▼          ▼          ▼          ▼
   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
   │Endpoint│ │Language│ │Scheme  │ │Concept │
   │Selector│ │Selector│ │Selector│ │Tree    │
   └────────┘ └────────┘ └────────┘ └────────┘
```

## Global State Structure

```typescript
interface AppState {
  // Common state (all tools)
  endpoint: EndpointState;
  language: LanguageState;
  ui: UIState;

  // Tool-specific state (AE SKOS)
  skos?: SKOSState;
}

interface EndpointState {
  current: SPARQLEndpoint | null;
  all: SPARQLEndpoint[];
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error?: AppError;
}

// Note: SPARQLEndpoint includes languagePriorities for per-endpoint fallback order
// See com01-EndpointManager.md for full SPARQLEndpoint definition

interface LanguageState {
  preferred: string;  // Global preferred language (e.g., 'en')
}

interface SettingsState {
  // Display settings
  darkMode: boolean;                  // Use dark color scheme
  showDatatypes: boolean;             // Show datatype tags on property values
  showLanguageTags: boolean;          // Show language tags on labels
  showPreferredLanguageTag: boolean;  // Show tag even when matching preferred

  // Deprecation settings
  showDeprecationIndicator: boolean;  // Show deprecation badges/styling
  deprecationRules: DeprecationRule[]; // Configurable detection rules
}

interface DeprecationRule {
  id: string;                       // Unique identifier
  label: string;                    // Display name
  predicate: string;                // Full predicate URI
  condition: 'equals' | 'not-equals' | 'exists';
  value?: string;                   // Value to compare (for equals/not-equals)
  enabled: boolean;                 // Whether rule is active
}

interface UIState {
  loading: Record<string, boolean>;  // Loading flags by component
  errors: AppError[];                 // Active errors
  dialogs: string[];                  // Open dialog IDs
}

interface SKOSState {
  scheme: {
    current: ConceptScheme | null;
    all: ConceptScheme[];
  };
  concept: {
    selected: string | null;         // Current concept URI
    details: ConceptDetails | null;
    breadcrumb: ConceptRef[];
  };
  tree: {
    expanded: Set<string>;           // Expanded node URIs
    topConcepts: ConceptNode[];
  };
  search: {
    query: string;
    results: SearchResult[];
    settings: SearchSettings;
  };
  history: HistoryEntry[];
}

// Concept reference types - see note below
interface ConceptRef {
  uri: string;
  label?: string;
}

interface ConceptNode extends ConceptRef {
  hasNarrower: boolean;
  children?: ConceptNode[];
  expanded: boolean;
}
```

### ConceptRef vs ConceptNode

Two types for concept references serve different purposes:

| Type | Use Case | Defined In |
|------|----------|------------|
| `ConceptRef` | Simple reference (breadcrumb, relations, search results) | com02, sko04 |
| `ConceptNode` | Tree node with expansion state | sko03 |

- **ConceptRef**: Minimal data for display and navigation (uri + label)
- **ConceptNode**: Extends ConceptRef with tree state (hasNarrower, children, expanded)

## State Persistence

### localStorage Keys

| Key | Content | Sync |
|-----|---------|------|
| `ae-endpoints` | Saved endpoints (includes languagePriorities) | Cross-tab |
| `ae-language` | Global preferred language | Cross-tab |
| `ae-skos-settings` | App settings (display, deprecation) | Cross-tab |
| `ae-skos-scheme` | Last selected scheme | Per-endpoint |
| `ae-skos-history` | Recently viewed | Per-endpoint |
| `ae-skos-tree-expanded` | Expanded nodes | Per-session |

### Default Deprecation Rules

```typescript
const DEFAULT_DEPRECATION_RULES: DeprecationRule[] = [
  {
    id: 'owl-deprecated',
    label: 'OWL Deprecated',
    predicate: 'http://www.w3.org/2002/07/owl#deprecated',
    condition: 'equals',
    value: 'true',
    enabled: true,
  },
  {
    id: 'euvoc-status',
    label: 'EU Vocabularies Status',
    predicate: 'http://publications.europa.eu/ontology/euvoc#status',
    condition: 'not-equals',
    value: 'http://publications.europa.eu/resource/authority/concept-status/CURRENT',
    enabled: true,
  },
];
```

**Rule conditions:**
- `equals`: Deprecated when predicate value equals configured value
- `not-equals`: Deprecated when predicate value does NOT equal configured value
- `exists`: Deprecated when predicate exists with any value

### Settings Dialog

The Settings dialog (accessible via toolbar) is organized into sections:

```
┌─────────────────────────────────────┐
│ Settings                            │
├─────────────────────────────────────┤
│ PREFERRED LANGUAGE                  │
│ ┌─────────────────────────────────┐ │
│ │ [Language dropdown        ▾]    │ │
│ │ Labels shown in this language   │ │
│ └─────────────────────────────────┘ │
│                                     │
│ DISPLAY                             │
│ ┌─────────────────────────────────┐ │
│ │ ☑ Show datatypes                │ │
│ │ ☑ Show language tags            │ │
│ │   ☐ Include preferred language  │ │
│ └─────────────────────────────────┘ │
│                                     │
│ DEPRECATION                         │
│ ┌─────────────────────────────────┐ │
│ │ ☑ Show deprecation indicators   │ │
│ │   DETECTION RULES               │ │
│ │   ☑ OWL Deprecated (= true)     │ │
│ │   ☑ EU Vocabularies (≠ CURRENT) │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ [Reset to defaults]        [Close]  │
└─────────────────────────────────────┘
```

### Persistence Rules

```typescript
// Persist endpoints (includes languagePriorities per endpoint)
persist('ae-endpoints', state.endpoint.all);

// Persist global preferred language
persist('ae-language', state.language.preferred);

// Persist settings
persist('ae-skos-settings', {
  darkMode: state.settings.darkMode,
  showDatatypes: state.settings.showDatatypes,
  showLanguageTags: state.settings.showLanguageTags,
  showPreferredLanguageTag: state.settings.showPreferredLanguageTag,
  showDeprecationIndicator: state.settings.showDeprecationIndicator,
  deprecationRules: state.settings.deprecationRules,
});

// Restore on init
const endpoints = restore('ae-endpoints') ?? [];
const preferred = restore('ae-language') ?? navigator.language.split('-')[0] ?? 'en';
const settings = restore('ae-skos-settings') ?? {
  darkMode: false,
  showDatatypes: true,
  showLanguageTags: true,
  showPreferredLanguageTag: false,
  showDeprecationIndicator: true,
  deprecationRules: DEFAULT_DEPRECATION_RULES,
};
```

### Per-Endpoint Storage

Some state is scoped to the current endpoint:

```typescript
// Key includes endpoint ID
const key = `ae-skos-history-${endpoint.id}`;
```

## Event Bus

### Core Events

| Event | Payload | Triggered When |
|-------|---------|----------------|
| `endpoint:changed` | `SPARQLEndpoint` | User selects endpoint |
| `endpoint:connected` | `SPARQLEndpoint` | Connection successful |
| `endpoint:error` | `AppError` | Connection failed |
| `language:preferred` | `string` | Global preferred language changed |
| `settings:changed` | `SettingsState` | Settings changed |

### SKOS Events

| Event | Payload | Triggered When |
|-------|---------|----------------|
| `scheme:selected` | `ConceptScheme \| null` | User selects scheme |
| `scheme:loaded` | `ConceptScheme[]` | Schemes fetched from endpoint |
| `concept:selected` | `string` (URI) | User clicks concept |
| `details:loaded` | `ConceptDetails` | Concept details fetched |
| `tree:expanded` | `string` (URI) | Node expanded |
| `tree:collapsed` | `string` (URI) | Node collapsed |
| `search:executed` | `{ query, results }` | Search completed |

**Event naming convention:**
- `*:selected` - User action (e.g., user clicks)
- `*:loaded` - Data fetched successfully
- `*:changed` - State changed (any cause)

### Event Handler Pattern

```typescript
// Subscribe to events
eventBus.on('endpoint:changed', async (endpoint) => {
  // Clear scheme-specific state
  dispatch({ type: 'RESET_SKOS_STATE' });

  // Reload data for new endpoint
  await loadSchemes(endpoint);
  await detectLanguages(endpoint);
});

eventBus.on('language:changed', () => {
  // Invalidate cached labels
  dispatch({ type: 'INVALIDATE_LABEL_CACHE' });

  // Reload visible components
  await reloadCurrentView();
});
```

## Initialization Sequence

```
┌──────────────────────────────────────────────────────────────┐
│ 1. App Start                                                 │
│    ├─ Restore state from localStorage                        │
│    ├─ Parse URL parameters                                   │
│    └─ Initialize event bus                                   │
├──────────────────────────────────────────────────────────────┤
│ 2. Endpoint Resolution                                       │
│    ├─ URL param `?endpoint=` takes priority                  │
│    ├─ Else: last used endpoint from localStorage             │
│    └─ Else: show endpoint selector                           │
├──────────────────────────────────────────────────────────────┤
│ 3. Connect to Endpoint (parallel)                            │
│    ├─ Test connection                                        │
│    ├─ Run endpoint analysis (graphs, duplicates)             │
│    └─ Detect available languages                             │
├──────────────────────────────────────────────────────────────┤
│ 4. Language Resolution                                       │
│    ├─ URL param `?lang=` takes priority                      │
│    ├─ Else: stored preference                                │
│    └─ Else: browser language → fallback to 'en'              │
├──────────────────────────────────────────────────────────────┤
│ 5. Load Tool Data (AE SKOS)                                  │
│    ├─ Load concept schemes                                   │
│    ├─ URL param `?scheme=` or last used                      │
│    ├─ Load top concepts                                      │
│    └─ URL param `?concept=` → load & select                  │
├──────────────────────────────────────────────────────────────┤
│ 6. Ready                                                     │
│    └─ Emit 'app:ready' event                                 │
└──────────────────────────────────────────────────────────────┘
```

## State Updates

### Action Pattern

```typescript
type Action =
  | { type: 'SET_ENDPOINT'; payload: SPARQLEndpoint }
  | { type: 'SET_LANGUAGE'; payload: { priorities: string[]; current: string | null } }
  | { type: 'SELECT_SCHEME'; payload: ConceptScheme | null }
  | { type: 'SELECT_CONCEPT'; payload: string }
  | { type: 'EXPAND_NODE'; payload: string }
  | { type: 'COLLAPSE_NODE'; payload: string }
  | { type: 'SET_SEARCH_RESULTS'; payload: SearchResult[] }
  | { type: 'SET_LOADING'; payload: { key: string; loading: boolean } }
  | { type: 'SET_ERROR'; payload: AppError }
  | { type: 'CLEAR_ERROR'; payload: string }
  | { type: 'RESET_SKOS_STATE' };
```

### Reducer Pattern

```typescript
function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_ENDPOINT':
      return {
        ...state,
        endpoint: {
          ...state.endpoint,
          current: action.payload,
          status: 'connected'
        }
      };

    case 'RESET_SKOS_STATE':
      return {
        ...state,
        skos: initialSKOSState
      };

    // ... other cases
  }
}
```

## Multi-Tab Sync

### Storage Event Listener

```typescript
window.addEventListener('storage', (event) => {
  if (event.key === 'ae-endpoints') {
    // Another tab updated endpoints
    dispatch({ type: 'SYNC_ENDPOINTS', payload: JSON.parse(event.newValue) });
  }

  if (event.key === 'ae-language') {
    // Another tab changed language
    dispatch({ type: 'SET_LANGUAGE', payload: JSON.parse(event.newValue) });
  }
});
```

### Sync Rules

| State | Sync Across Tabs |
|-------|------------------|
| Endpoint list | Yes |
| Language preference | Yes |
| Current endpoint | No (per-tab) |
| Selected concept | No (per-tab) |
| Search query | No (per-tab) |
| Tree expansion | No (per-tab) |

## Cache Management

### Query Cache

```typescript
interface QueryCache {
  key: string;          // Hash of query + endpoint
  data: any;
  timestamp: number;
  ttl: number;          // Time to live in ms
}

// Cache durations
const CACHE_TTL = {
  schemes: 5 * 60 * 1000,      // 5 minutes
  topConcepts: 5 * 60 * 1000,  // 5 minutes
  narrower: 2 * 60 * 1000,     // 2 minutes
  details: 2 * 60 * 1000,      // 2 minutes
  search: 1 * 60 * 1000,       // 1 minute
};
```

### Cache Invalidation

| Event | Invalidate |
|-------|------------|
| `endpoint:changed` | All cache |
| `language:changed` | Label-dependent cache |
| `scheme:selected` | Scheme-scoped cache |
| Manual refresh | All cache |

## Component State Binding

### Subscribe Pattern

```typescript
// Component subscribes to relevant state slices
const ConceptTree = () => {
  const scheme = useSelector(state => state.skos.scheme.current);
  const expanded = useSelector(state => state.skos.tree.expanded);
  const topConcepts = useSelector(state => state.skos.tree.topConcepts);

  // Re-render only when these values change
};
```

### Dispatch Pattern

```typescript
const handleNodeClick = (uri: string) => {
  dispatch({ type: 'SELECT_CONCEPT', payload: uri });
  eventBus.emit('concept:selected', uri);
};
```
