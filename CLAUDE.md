# Augmented Semantics

AI-powered toolkit for Semantic Web technologies.

## Architecture

Browser-only tools that connect directly to SPARQL endpoints via HTTP. No backend server required.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Vue 3 + Composition API |
| Language | TypeScript (strict) |
| Build | Vite |
| State | Pinia |
| Routing | Vue Router |
| UI | PrimeVue |

## Project Structure

- `/spec` - Tool specifications and documentation
  - `/spec/overview.md` - High-level overview of all tools
  - `/spec/common/` - Common components (prefix: `com`)
    - `com01-EndpointManager.md` - SPARQL endpoint management
    - `com02-StateManagement.md` - State architecture and events
    - `com03-ErrorHandling.md` - Errors, loading, empty states
    - `com04-URLRouting.md` - Deep linking and sharing
    - `com05-SPARQLPatterns.md` - Unified query patterns
    - `com06-Security.md` - Security considerations
  - `/spec/ae-skos/` - AE SKOS specifications (prefix: `sko`)
    - `sko00-overview.md` - Overview and architecture
    - `sko01-LanguageSelector.md` - Language detection/selection
    - `sko02-SchemeSelector.md` - Scheme selection
    - `sko03-ConceptTree.md` - Hierarchical browsing
    - `sko04-ConceptDetails.md` - Concept property display
    - `sko05-SearchBox.md` - Search and autocomplete
    - `sko06-Utilities.md` - Copy, raw view, history
  - `/spec/ae-rdf/` - AE RDF specifications
  - `/spec/ae-owl/` - AE OWL specifications
  - `/spec/ae-shacl/` - AE SHACL specifications
  - `/spec/task/` - Implementation task lists
    - `ae-skos-tasks.md` - AE SKOS implementation plan

## Tools

| Tool | Folder | Status | Description |
|------|--------|--------|-------------|
| AE SKOS | `ae-skos` | Spec ready | SKOS vocabulary browser |
| AE RDF | `ae-rdf` | Planned | RDF data browser |
| AE OWL | `ae-owl` | Planned | OWL ontology viewer |
| AE SHACL | `ae-shacl` | Planned | SHACL validation |

## Conventions

- Folder names: lowercase with hyphens (e.g., `ae-skos`)
- Tool names: uppercase with space (e.g., `AE SKOS`)
- Spec file prefix: `com` (common), `sko` (skos), `rdf` (rdf), `owl` (owl), `sha` (shacl)
- Vue components: `<script setup lang="ts">` syntax
- State: Pinia stores per com02-StateManagement
- Composables: Reusable logic in `composables/` folder (e.g., `useDelayedLoading`)
- Spec references: All components/services include `@see /spec/...` JSDoc comments

## Storage Keys

| Key | Purpose |
|-----|---------|
| `ae-endpoints` | Saved SPARQL endpoints |
| `ae-language` | Language preferences |
| `ae-skos-scheme` | Last selected scheme |
| `ae-skos-history` | Recently viewed concepts |

## Implementation Patterns

### Delayed Loading (com03)

Show spinners only after 300ms delay to prevent flicker on fast operations:

```typescript
import { useDelayedLoading } from '@/composables'

const loading = computed(() => store.loading)
const showLoading = useDelayedLoading(loading)  // Shows after 300ms
```

### Elapsed Time (com03)

Show elapsed seconds for long-running operations (appears after 2 seconds):

```typescript
import { useElapsedTime } from '@/composables'

const loading = ref(true)
const elapsed = useElapsedTime(loading)
// Template: {{ stepName }}{{ elapsed ? ` (${elapsed})` : '' }}
// After 2 seconds: "Loading... (3s)"
```

### Error Boundary (com03)

Wrap content with ErrorBoundary to catch unexpected JavaScript errors:

```vue
<ErrorBoundary>
  <RouterView />
</ErrorBoundary>
```

### ARIA Accessibility (com03)

Use UIStore for screen reader announcements:

```typescript
uiStore.announceLoading('Loading concepts...')
uiStore.announceError('Failed to load data')
uiStore.announceSuccess('Data loaded')
```

Live regions in App.vue announce these to screen readers.

## Styling Rules

### CSS Reuse (MANDATORY)

1. **Check existing styles first** - Before writing any CSS, search `style.css` and existing components for similar patterns
2. **Create reusable classes** - If a pattern appears 2+ times, create a global class in `style.css`
3. **No duplicate CSS** - Never copy-paste styles between components
4. **Prefer global over `:deep()`** - Global styles in `style.css` work better for PrimeVue components (especially teleported ones like Dialog, Menu, Select overlays)

### Established Patterns

| Class | Purpose |
|-------|---------|
| `.dropdown-trigger` | Button that opens any dropdown (endpoint, language, scheme) |
| `.p-menu` | Global PrimeVue Menu overrides |
| `.p-select` | Global PrimeVue Select overrides |
| `.p-dialog` | Global PrimeVue Dialog overrides |

### Font Sizes

| Size | Usage |
|------|-------|
| `0.75rem` | Labels, buttons, small text |
| `0.8125rem` | Body text, form inputs |
| `0.875rem` | Dialog titles |

### Colors

Always use CSS variables from `style.css`:
- `--ae-bg-*` for backgrounds
- `--ae-text-*` for text colors
- `--ae-border-color` for borders
- `--ae-accent` for interactive elements

## User Environment

- Screenshots are located in `~/Documents`

## Debugging

### Logger

Always use the logger service for debugging. Logs are visible in browser console (F12).

```typescript
import { logger } from '@/services'

// Usage
logger.debug('ComponentName', 'Debug message', { data })
logger.info('ComponentName', 'Info message', { data })
logger.warn('ComponentName', 'Warning message', { data })
logger.error('ComponentName', 'Error message', { error })
```

### Browser Console

In development mode, access logger from console:
```javascript
__logger.dump()        // Show all recent logs
__logger.getHistory()  // Get log array
__logger.clearHistory() // Clear logs
```

### Best Practices

1. **Always log** at entry points of async operations (API calls, data loading)
2. **Log success and failure** - both paths should have logs
3. **Include context** - pass relevant data as the third argument
4. **Use appropriate levels**:
   - `debug` - Verbose info for development
   - `info` - Important state changes
   - `warn` - Recoverable issues
   - `error` - Failures that need attention
