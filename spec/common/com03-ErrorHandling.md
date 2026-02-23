# ErrorHandling

Error handling, loading states, and empty states for all AE tools.

## Error Types

### Error Data Model

```typescript
interface AppError {
  code: ErrorCode;        // Error code (e.g., "CORS_BLOCKED")
  message: string;        // User-friendly message
  details?: string;       // Technical details (for debugging)
  recoveryAction?: RecoveryAction;  // Suggested recovery action
  timestamp: string;      // ISO timestamp
}

type RecoveryAction =
  | { type: 'retry' }
  | { type: 'configure'; target: 'endpoint' | 'auth' }
  | { type: 'refresh' }
  | { type: 'dismiss' };
```

### Error Catalog

| Code | Message | Recovery |
|------|---------|----------|
| `NETWORK_ERROR` | Unable to reach the endpoint. Check your internet connection. | retry |
| `CORS_BLOCKED` | This endpoint doesn't allow browser connections. Contact the endpoint administrator. | dismiss |
| `TIMEOUT` | The request took too long. Try a simpler query or check the endpoint status. | retry |
| `INVALID_RESPONSE` | Received an unexpected response format. | dismiss |
| `AUTH_REQUIRED` | This endpoint requires authentication. | configure:auth |
| `AUTH_FAILED` | Authentication failed. Check your credentials. | configure:auth |
| `NOT_FOUND` | The requested resource was not found. | dismiss |
| `SERVER_ERROR` | The endpoint returned an error. Try again later. | retry |
| `QUERY_ERROR` | The SPARQL query failed. | dismiss |
| `PARSE_ERROR` | Failed to parse the response. | dismiss |
| `UNKNOWN` | An unexpected error occurred. | dismiss |

### Error Detection

```typescript
function classifyError(response: Response, error?: Error): AppError {
  // Network errors
  if (error?.name === 'TypeError' && error.message.includes('fetch')) {
    return { code: 'NETWORK_ERROR', ... };
  }

  // CORS errors (opaque response or blocked)
  if (response.type === 'opaque' || error?.message.includes('CORS')) {
    return { code: 'CORS_BLOCKED', ... };
  }

  // Timeout
  if (error?.name === 'AbortError') {
    return { code: 'TIMEOUT', ... };
  }

  // HTTP status codes
  switch (response.status) {
    case 401: return { code: 'AUTH_REQUIRED', ... };
    case 403: return { code: 'AUTH_FAILED', ... };
    case 404: return { code: 'NOT_FOUND', ... };
    case 408: return { code: 'TIMEOUT', ... };
    case 500:
    case 502:
    case 503: return { code: 'SERVER_ERROR', ... };
  }
}
```

## Error UI

### Inline Error (Component Level)

Small errors displayed within a component.

```
┌─────────────────────────────────────────────────────────────┐
│ Concept Tree                                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ⚠ Unable to load concepts                                │
│   The request timed out.                                    │
│   [Retry]                                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Toast Notification

Temporary notification for transient errors.

```
┌─────────────────────────────────────────┐
│ ✕  Connection lost. Retrying...         │
└─────────────────────────────────────────┘
```

- Auto-dismiss after 5 seconds
- Dismissible by user
- Stack multiple toasts

### Full-Screen Error

Critical errors that block the app.

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                         ⚠                                  │
│                                                             │
│              Unable to connect to endpoint                  │
│                                                             │
│   This endpoint doesn't allow browser connections.          │
│   Contact the endpoint administrator to enable CORS.        │
│                                                             │
│              [Choose Different Endpoint]                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Error Boundary

Catch unexpected JavaScript errors.

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                    Something went wrong                     │
│                                                             │
│   An unexpected error occurred. Please refresh the page.    │
│                                                             │
│   [Refresh] [Report Issue]                                  │
│                                                             │
│   Error details ▼                                           │
│   TypeError: Cannot read property 'uri' of undefined        │
│   at ConceptTree.render (ConceptTree.js:42)                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Loading States

### Loading Indicators

| Type | Use Case |
|------|----------|
| Spinner | Short operations (<2s), unknown duration |
| Skeleton | Content loading, known layout |
| Progress bar | Long operations, known progress |
| Inline text | Subtle loading ("Loading...") |

### Spinner

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                         ◌                                   │
│                    Loading...                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Skeleton UI

```
┌─────────────────────────────────────────────────────────────┐
│ Concept Details                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ████████████████████                      (label skeleton)  │
│ ██████████████████████████████████████    (uri skeleton)    │
│                                                             │
│ LABELS                                                      │
│ ─────────────────────────────────────────                   │
│ ████████████   ████████████   ████████    (labels skeleton) │
│                                                             │
│ DEFINITION                                                  │
│ ─────────────────────────────────────────                   │
│ ████████████████████████████████████████                    │
│ ██████████████████████████████                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Component Loading States

| Component | Loading State |
|-----------|---------------|
| EndpointSelector | Spinner in dropdown |
| LanguageSelector | Spinner in dropdown |
| SchemeSelector | Spinner in dropdown |
| ConceptTree | Skeleton tree (3-5 fake nodes) |
| ConceptDetails | Skeleton layout |
| SearchBox | Spinner in input field |
| Search Results | Skeleton list |

### Loading Timing

| Operation | Expected Duration | Show Spinner After |
|-----------|-------------------|-------------------|
| Connection test | 1-3s | 500ms |
| Load schemes | 0.5-2s | 300ms |
| Load top concepts | 0.5-2s | 300ms |
| Expand node | 0.3-1s | 200ms |
| Load details | 0.3-1s | 200ms |
| Search | 0.5-2s | 300ms |

Don't show spinner for very fast operations (<200ms).

## Empty States

### No Endpoint Selected

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                         🔌                                  │
│                                                             │
│                   No endpoint selected                      │
│                                                             │
│   Select a SPARQL endpoint to start browsing.               │
│                                                             │
│              [Select Endpoint]                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### No Schemes Found

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                         📂                                  │
│                                                             │
│                   No concept schemes                        │
│                                                             │
│   This endpoint doesn't contain any SKOS concept schemes.   │
│   Try a different endpoint or check the data.               │
│                                                             │
│              [Change Endpoint]                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### No Top Concepts

```
┌─────────────────────────────────────────────────────────────┐
│ Concept Tree                                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   This scheme has no top concepts.                          │
│   Use search to find concepts.                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### No Narrower Concepts

```
│   └─ Wheat (leaf node)                                      │
│        No narrower concepts                                 │
```

### No Search Results

```
┌─────────────────────────────────────────────────────────────┐
│ Search Results                                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                         🔍                                  │
│                                                             │
│               No results for "xyz123"                       │
│                                                             │
│   Try different keywords or check spelling.                 │
│   Search is case-insensitive.                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### No Concept Selected

```
┌─────────────────────────────────────────────────────────────┐
│ Concept Details                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Select a concept from the tree or search results          │
│   to view its details.                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### No Relations

```
│ RELATIONS                                                   │
│ ─────────────────────────────────────────────────────────── │
│ No related concepts                                         │
```

## Retry Logic

### Automatic Retry

```typescript
const RETRY_CONFIG = {
  maxAttempts: 3,
  initialDelay: 1000,    // 1 second
  maxDelay: 10000,       // 10 seconds
  backoffFactor: 2,      // Exponential backoff
  retryOn: ['NETWORK_ERROR', 'TIMEOUT', 'SERVER_ERROR']
};

async function fetchWithRetry(url, options) {
  let attempt = 0;
  let delay = RETRY_CONFIG.initialDelay;

  while (attempt < RETRY_CONFIG.maxAttempts) {
    try {
      return await fetch(url, options);
    } catch (error) {
      const errorCode = classifyError(error).code;

      if (!RETRY_CONFIG.retryOn.includes(errorCode)) {
        throw error;  // Don't retry non-retryable errors
      }

      attempt++;
      if (attempt >= RETRY_CONFIG.maxAttempts) {
        throw error;
      }

      await sleep(delay);
      delay = Math.min(delay * RETRY_CONFIG.backoffFactor, RETRY_CONFIG.maxDelay);
    }
  }
}
```

### Manual Retry

Each error UI with `recoverable: true` should show a retry button.

```typescript
const handleRetry = () => {
  dispatch({ type: 'CLEAR_ERROR', payload: error.code });
  dispatch({ type: 'SET_LOADING', payload: { key: 'conceptTree', loading: true } });
  loadTopConcepts();
};
```

## Request Cancellation

### AbortController Pattern

```typescript
let controller: AbortController | null = null;

async function loadConcepts() {
  // Cancel previous request
  if (controller) {
    controller.abort();
  }

  controller = new AbortController();

  try {
    const response = await fetch(url, {
      signal: controller.signal
    });
    // ...
  } catch (error) {
    if (error.name === 'AbortError') {
      // Request was cancelled, don't show error
      return;
    }
    throw error;
  }
}
```

### Cancel on Navigation

```typescript
eventBus.on('scheme:changed', () => {
  cancelPendingRequests();
});

eventBus.on('concept:selected', () => {
  cancelDetailRequests();
});
```

## Accessibility

### Error Announcements

```html
<!-- Live region for error announcements -->
<div role="alert" aria-live="assertive" class="sr-only">
  {{ currentError?.message }}
</div>
```

### Loading Announcements

```html
<!-- Live region for loading status -->
<div role="status" aria-live="polite" class="sr-only">
  {{ isLoading ? 'Loading...' : 'Content loaded' }}
</div>
```

### Focus Management

- After error dismissed: return focus to trigger element
- After retry: keep focus on retry button until resolved
- After load complete: don't move focus unexpectedly
