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
    - `sko03-Settings.md` - Centralized application settings
    - `sko04-ConceptTree.md` - Hierarchical browsing
    - `sko05-Collections.md` - SKOS Collections support
    - `sko06-ConceptDetails.md` - Concept property display
    - `sko07-SearchBox.md` - Search and autocomplete
    - `sko08-OrphanDetection.md` - Orphan concept detection
    - `sko09-Utilities.md` - Copy, raw view, history
    - `sko10-Testing.md` - Testing strategy and patterns
    - `sko11-DeveloperTools.md` - Developer tools and debugging
    - `sko12-CurationWorkflow.md` - Endpoint curation
    - `sko13-PropertyAnalysis.md` - Property comparison
  - `/spec/ae-rdf/` - AE RDF specifications
  - `/spec/ae-owl/` - AE OWL specifications
  - `/spec/ae-shacl/` - AE SHACL specifications

## Packages

| Package | Folder | Description |
|---------|--------|-------------|
| @ae/styles | `packages/styles` | Shared CSS (theme, base, PrimeVue overrides) |

See `/packages/styles/STYLES.md` for design tokens and usage.
See `/packages/styles/DECISIONS.md` for what's shared vs app-specific.

## Tools

| Tool | Folder | Status | Description |
|------|--------|--------|-------------|
| AE SKOS | `ae-skos` | Spec ready | SKOS vocabulary browser |
| AE RDF | `ae-rdf` | Barebones | RDF data browser |
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
| `ae-preferred-language` | Language preferences |
| `ae-skos-scheme` | Last selected scheme |
| `ae-skos-history` | Recently viewed concepts |
| `ae-skos-settings` | App settings (dark mode, etc.) |

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

### Shared vs App-Specific

- **@ae/styles** (`packages/styles/`) - Shared CSS used by 2+ apps
- **App style.css** (`ae-*/src/style.css`) - App-specific styles

Only move styles to @ae/styles when used by multiple apps. See `packages/styles/DECISIONS.md`.

### CSS Reuse (MANDATORY)

1. **Check existing styles first** - Before writing any CSS, search @ae/styles and app's `style.css`
2. **Create reusable classes** - If a pattern appears 2+ times in same app, add to app's `style.css`
3. **Extract to @ae/styles** - If a pattern is used by 2+ apps, move to shared package
4. **Prefer global over `:deep()`** - Global styles work better for PrimeVue components

### Shared (in @ae/styles)

Only CSS variables and base setup - no utility classes yet.

| File | Purpose |
|------|---------|
| `theme.css` | CSS variables (colors, fonts) |
| `base.css` | Reset, body, scrollbar, focus |
| `icons.css` | Material Symbols setup |

### SKOS-Specific (in ae-skos/src/style.css)

| Class | Purpose |
|-------|---------|
| `.icon-folder`, `.icon-label`, `.icon-leaf` | SKOS semantic type colors |
| `.action-btn`, `.section-title`, `.lang-tag` | Component patterns |
| `.datatype-tag`, `.deprecated-badge` | Data type and status indicators |
| `.sr-only`, `.mono`, `.truncate` | Utility classes |
| `.dropdown-trigger`, `.select-compact` | Dropdown patterns |
| `.p-menu`, `.p-select`, `.p-dialog`, `.p-button` | PrimeVue overrides |
| `.p-datatable`, `.p-stepper` | PrimeVue data display overrides |

### Font Sizes

| Size | Usage |
|------|-------|
| `0.75rem` | Labels, buttons, small text |
| `0.8125rem` | Body text, form inputs |
| `0.875rem` | Dialog titles |

### Colors

Always use CSS variables from `style.css`:
- `--ae-bg-*` for backgrounds (`--ae-bg-elevated`, `--ae-bg-hover`)
- `--ae-text-*` for text colors
- `--ae-border-color` for borders
- `--ae-accent`, `--ae-accent-hover` for interactive elements
- `--ae-status-warning` for deprecation/warning indicators
- `--ae-icon-folder`, `--ae-icon-label`, `--ae-icon-leaf` for SKOS icons

### Font Variables

| Variable | Usage |
|----------|-------|
| `--ae-font-sans` | Primary UI font (Inter) |
| `--ae-font-mono` | Code, URIs, technical values |

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
