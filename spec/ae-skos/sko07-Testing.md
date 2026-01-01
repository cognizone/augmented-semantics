# Testing Strategy

Comprehensive testing plan for AE SKOS browser.

## Current State

**No testing infrastructure exists:**
- No test files (`.test.ts` or `.spec.ts`)
- No Vitest/Jest configuration
- No testing dependencies installed
- Total codebase: ~6,400 lines of TypeScript/Vue

---

## Components By Testing Priority

### High Priority (Core Functionality)

| Component/Service | Lines | Why Test |
|-------------------|-------|----------|
| `sparql.ts` | 434 | Core SPARQL execution, retry logic, auth headers |
| `security.ts` | 300 | Security-critical: injection prevention, validation |
| `ConceptTree.vue` | 574 | Complex lazy-loading, recursive tree state |
| `ConceptDetails.vue` | 918 | Label resolution logic, section visibility |
| `SearchBox.vue` | 486 | Debounce timing, filter modes, async search |

### Medium Priority (Configuration)

| Component/Service | Lines | Why Test |
|-------------------|-------|----------|
| `endpoint.ts` (store) | 144 | Endpoint CRUD, localStorage persistence |
| `concept.ts` (store) | 239 | Tree state, history, search results |
| `EndpointManager.vue` | 691 | Auth forms, connection testing |
| `SchemeSelector.vue` | 436 | Scheme loading, selection |

### Lower Priority (Simple Logic)

| Component/Service | Lines | Why Test |
|-------------------|-------|----------|
| `language.ts` (store) | 103 | Preference persistence |
| `scheme.ts` (store) | 91 | Selection logic |
| `ui.ts` (store) | 154 | Responsive breakpoints |
| `RecentHistory.vue` | 150 | History display |
| `ConceptBreadcrumb.vue` | 254 | Navigation clicks |

---

## Testing Approach By Layer

### 1. Unit Tests (Services)

**sparql.ts:**
```typescript
describe('executeSparql', () => {
  it('retries on timeout with exponential backoff')
  it('stops retrying on auth errors')
  it('adds correct auth headers for Basic auth')
  it('adds correct auth headers for Bearer token')
  it('adds correct auth headers for API key')
  it('maps HTTP 401 to AUTH_REQUIRED error')
  it('maps HTTP 500 to SERVER_ERROR')
  it('detects CORS errors from TypeError')
})

describe('withPrefixes', () => {
  it('adds standard SKOS prefixes')
  it('does not duplicate existing prefixes')
})

describe('detectLanguages', () => {
  it('extracts unique language tags from results')
  it('returns empty array on query failure')
})
```

**security.ts:**
```typescript
describe('escapeSparqlString', () => {
  it('escapes backslashes')
  it('escapes double quotes')
  it('escapes newlines and tabs')
  it('handles empty string')
})

describe('validateURI', () => {
  it('accepts http:// URIs')
  it('accepts https:// URIs')
  it('accepts urn: URIs')
  it('rejects javascript: URIs')
  it('rejects data: URIs')
  it('rejects empty strings')
})

describe('sanitizeHtml', () => {
  it('removes script tags')
  it('preserves allowed HTML elements')
})
```

### 2. Unit Tests (Stores)

**concept.ts:**
```typescript
describe('concept store', () => {
  describe('tree operations', () => {
    it('sets top concepts')
    it('expands node and adds to expanded set')
    it('collapses node and removes from expanded set')
    it('updates node children recursively')
  })

  describe('history', () => {
    it('adds entry to front of history')
    it('removes duplicate before adding')
    it('limits history to 50 entries')
    it('persists history to localStorage')
    it('loads history from localStorage on init')
  })

  describe('search', () => {
    it('sets search query')
    it('sets search results')
    it('clears search on reset')
  })
})
```

**endpoint.ts:**
```typescript
describe('endpoint store', () => {
  it('adds endpoint with generated UUID')
  it('removes endpoint by ID')
  it('selects endpoint and updates currentId')
  it('updates lastAccessedAt on selection')
  it('persists endpoints to localStorage')
  it('loads endpoints from localStorage on init')
  it('sorts endpoints by lastAccessedAt')
})
```

### 3. Component Tests

**ConceptTree.vue:**
```typescript
describe('ConceptTree', () => {
  it('renders loading state when loadingTree is true')
  it('renders empty state when no top concepts')
  it('renders tree nodes from store')
  it('displays notation + label format')
  it('calls loadChildren on node expand')
  it('updates store on node selection')
  it('handles "Go to URI" input')
})
```

**ConceptDetails.vue:**
```typescript
describe('ConceptDetails', () => {
  it('renders empty state when no concept selected')
  it('renders loading state during fetch')
  it('displays preferred label with notation')
  it('shows Labels section only when labels exist')
  it('shows Documentation section only when notes exist')
  it('resolves label by priority: prefLabel > title > rdfsLabel')
  it('resolves label by language: preferred > fallback > no lang')
  it('navigates on relation chip click')
  it('copies URI to clipboard')
})
```

**SearchBox.vue:**
```typescript
describe('SearchBox', () => {
  it('debounces input by 300ms')
  it('does not search for queries under 2 chars')
  it('clears results on clear button click')
  it('applies contains/startsWith/exact filter modes')
  it('filters by selected scheme when not "all"')
  it('emits selectConcept on result click')
})
```

### 4. Integration Tests

```typescript
describe('Concept Selection Flow', () => {
  it('loads details when concept is selected')
  it('updates breadcrumb when concept changes')
  it('adds to history on concept selection')
  it('updates URL with concept parameter')
})

describe('Endpoint Change Flow', () => {
  it('resets scheme store on endpoint change')
  it('resets concept store on endpoint change')
  it('loads schemes for new endpoint')
})

describe('URL State Sync', () => {
  it('restores endpoint from URL on mount')
  it('restores scheme from URL on mount')
  it('restores concept from URL on mount')
  it('updates URL when state changes')
  it('prevents circular updates')
})
```

---

## Recommended Test Stack

| Package | Purpose |
|---------|---------|
| `vitest` | Fast test runner, Vue 3 native |
| `@vue/test-utils` | Vue component mounting |
| `@testing-library/vue` | User-centric component testing |
| `msw` (optional) | Mock Service Worker for SPARQL mocking |

### Setup Files Needed

```
ae-skos/
├── vitest.config.ts              # Vitest configuration
├── src/
│   ├── test-utils/
│   │   ├── setup.ts              # Test setup (mocks, globals)
│   │   ├── mocks.ts              # Mock factories
│   │   └── sparql-fixtures.ts    # SPARQL response fixtures
│   ├── services/__tests__/
│   │   ├── sparql.test.ts
│   │   └── security.test.ts
│   ├── stores/__tests__/
│   │   ├── concept.test.ts
│   │   ├── endpoint.test.ts
│   │   └── ...
│   └── components/__tests__/
│       ├── ConceptTree.test.ts
│       ├── ConceptDetails.test.ts
│       └── ...
```

---

## Estimated Test Count

| Category | Count |
|----------|-------|
| Service unit tests | ~85 |
| Store unit tests | ~60 |
| Component tests | ~70 |
| Integration tests | ~40 |
| **Total** | **~255** |

---

## Key Testing Challenges

| Challenge | Solution |
|-----------|----------|
| Async SPARQL queries | Mock fetch API or use MSW |
| localStorage/sessionStorage | Mock or clear between tests |
| Debounced inputs | Use `vi.useFakeTimers()` |
| Vue Router query params | Use `createRouter` with memory history |
| Responsive breakpoints | Mock `window.innerWidth` |
| PrimeVue Tree component | Test expansion via emitted events |
| Label resolution logic | Use fixtures with multiple label types |

---

## External Dependencies

### Browser APIs to Mock

| API | Used By |
|-----|---------|
| `fetch` | sparql.ts |
| `localStorage` | stores (4 keys) |
| `sessionStorage` | security.ts (credentials) |
| `navigator.language` | language.ts |
| `crypto.randomUUID()` | endpoint.ts |
| `AbortController` | sparql.ts (timeout) |
| `window.addEventListener` | ui.ts (resize) |

### SPARQL Response Fixtures

Create fixtures for common query responses:
- Concept schemes list
- Top concepts (no broader)
- Narrower concepts
- Concept details (all properties)
- Search results
- Language detection
- Graph detection

---

## Related Specs

- [com03-ErrorHandling](../common/com03-ErrorHandling.md) - Error states to test
- [com05-SPARQLPatterns](../common/com05-SPARQLPatterns.md) - Query patterns to validate
- [com06-Security](../common/com06-Security.md) - Security behaviors to verify
