# URLRouting

Deep linking and URL-based state management for all AE tools.

## Overview

The URL reflects application state, enabling:
- Bookmarking specific views
- Sharing links to concepts
- Browser back/forward navigation
- Opening links in new tabs

## URL Structure

### Base Pattern

```
https://app.example.com/?endpoint=...&lang=...&scheme=...&concept=...
```

### Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `endpoint` | Endpoint ID or URL (encoded) | `endpoint=dbpedia` or `endpoint=https%3A%2F%2Fdbpedia.org%2Fsparql` |
| `lang` | Preferred language | `lang=nl` |
| `scheme` | Concept scheme URI (encoded) | `scheme=http%3A%2F%2Fexample.org%2Fscheme` |
| `concept` | Selected concept URI (encoded) | `concept=http%3A%2F%2Fexample.org%2Fconcept%2F123` |
| `search` | Search query | `search=agriculture` |
| `view` | Active view | `view=tree` or `view=search` |

### Examples

```
# Basic - just endpoint
/?endpoint=dbpedia

# With language
/?endpoint=dbpedia&lang=en

# With scheme selected
/?endpoint=dbpedia&lang=en&scheme=http%3A%2F%2Fdbpedia.org%2Fontology

# Full deep link to concept
/?endpoint=dbpedia&lang=en&scheme=http%3A%2F%2Fdbpedia.org%2Fontology&concept=http%3A%2F%2Fdbpedia.org%2Fresource%2FAgriculture

# Search results
/?endpoint=dbpedia&lang=en&search=agriculture&view=search
```

## URL Encoding

### Encoding Rules

```typescript
// Encode URI components
const encodeParam = (value: string): string => {
  return encodeURIComponent(value);
};

// Decode URI components
const decodeParam = (value: string): string => {
  return decodeURIComponent(value);
};

// Build URL
function buildURL(state: AppState): string {
  const params = new URLSearchParams();

  if (state.endpoint.current) {
    // Use endpoint ID if saved, otherwise full URL
    const endpointRef = state.endpoint.current.id || state.endpoint.current.url;
    params.set('endpoint', endpointRef);
  }

  if (state.language.preferred) {
    params.set('lang', state.language.preferred);
  }

  if (state.skos?.scheme.current) {
    params.set('scheme', state.skos.scheme.current.uri);
  }

  if (state.skos?.concept.selected) {
    params.set('concept', state.skos.concept.selected);
  }

  return `?${params.toString()}`;
}
```

### Special Characters

URIs often contain characters that need encoding:

| Character | Encoded |
|-----------|---------|
| `:` | `%3A` |
| `/` | `%2F` |
| `#` | `%23` |
| `?` | `%3F` |
| `&` | `%26` |
| `=` | `%3D` |
| space | `%20` or `+` |

## State Restoration

### On Page Load

```typescript
async function restoreFromURL(): Promise<void> {
  const params = new URLSearchParams(window.location.search);

  // 1. Restore endpoint
  const endpointRef = params.get('endpoint');
  if (endpointRef) {
    const endpoint = await resolveEndpoint(endpointRef);
    if (endpoint) {
      await connectToEndpoint(endpoint);
    }
  }

  // 2. Restore language (after endpoint connected)
  const lang = params.get('lang');
  if (lang) {
    dispatch({ type: 'SET_LANGUAGE', payload: { preferred: lang, fallback: state.language.fallback } });
  }

  // 3. Restore scheme (after language set)
  const schemeUri = params.get('scheme');
  if (schemeUri) {
    const scheme = await loadScheme(schemeUri);
    if (scheme) {
      dispatch({ type: 'SELECT_SCHEME', payload: scheme });
    }
  }

  // 4. Restore concept (after scheme set)
  const conceptUri = params.get('concept');
  if (conceptUri) {
    dispatch({ type: 'SELECT_CONCEPT', payload: conceptUri });
    await loadConceptDetails(conceptUri);
    await expandTreeTo(conceptUri);
  }

  // 5. Restore search
  const search = params.get('search');
  if (search) {
    dispatch({ type: 'SET_SEARCH_QUERY', payload: search });
    await executeSearch(search);
  }
}
```

### Endpoint Resolution

```typescript
async function resolveEndpoint(ref: string): Promise<SPARQLEndpoint | null> {
  // Check if it's a saved endpoint ID
  const saved = state.endpoint.all.find(e => e.id === ref);
  if (saved) {
    return saved;
  }

  // Check if it's a known endpoint name
  const known = KNOWN_ENDPOINTS.find(e => e.name.toLowerCase() === ref.toLowerCase());
  if (known) {
    return known;
  }

  // Treat as URL
  try {
    const url = decodeURIComponent(ref);
    return { id: '', name: url, url, accessCount: 0, createdAt: new Date().toISOString() };
  } catch {
    return null;
  }
}
```

## URL Updates

### When to Update URL

| Event | Update URL |
|-------|------------|
| Endpoint changed | Yes |
| Language changed | Yes |
| Scheme changed | Yes |
| Concept selected | Yes |
| Search executed | Yes |
| Tree expanded/collapsed | No |
| Dialog opened/closed | No |
| Details tab changed | No |

### Update Pattern

```typescript
function updateURL(state: AppState): void {
  const url = buildURL(state);
  window.history.pushState(state, '', url);
}

// Use replaceState for minor updates (avoid polluting history)
function updateURLSilent(state: AppState): void {
  const url = buildURL(state);
  window.history.replaceState(state, '', url);
}
```

### Debounced Updates

```typescript
// Debounce URL updates to avoid excessive history entries
const debouncedUpdateURL = debounce(updateURL, 500);

eventBus.on('concept:selected', (uri) => {
  debouncedUpdateURL(getState());
});
```

## Browser Navigation

### Back/Forward Handling

```typescript
window.addEventListener('popstate', (event) => {
  if (event.state) {
    // Restore from history state
    restoreState(event.state);
  } else {
    // Parse URL parameters
    restoreFromURL();
  }
});
```

### History State Structure

```typescript
interface HistoryState {
  endpoint: string;
  lang: string;
  scheme: string | null;
  concept: string | null;
  search: string | null;
  timestamp: number;
}
```

## Share Functionality

### Share Button UI

```
┌─────────────────────────────────────────────────────────────┐
│ Wheat                                          [📋] [🔗]    │
│ http://example.org/concepts/wheat              [📋]         │
└─────────────────────────────────────────────────────────────┘

[🔗] = Share button
```

### Share Dialog

```
┌─────────────────────────────────────────────────────────────┐
│ Share Concept                                         [✕]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Link to this concept:                                       │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ https://app.example.com/?endpoint=dbpedia&lang=en&...   │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [Copy Link]  [Open in New Tab]                              │
│                                                             │
│ ─────────────────────────────────────────────────────────── │
│                                                             │
│ Or share concept URI directly:                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ http://example.org/concepts/wheat                       │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [Copy URI]                                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Share Actions

```typescript
async function shareLink(): Promise<void> {
  const url = window.location.href;

  // Try native share API (mobile)
  if (navigator.share) {
    await navigator.share({
      title: `${concept.label} - AE SKOS`,
      url: url
    });
  } else {
    // Fall back to copy to clipboard
    await navigator.clipboard.writeText(url);
    showToast('Link copied to clipboard');
  }
}
```

## External Links

### Concept URI as External Link

When concept URI is clicked (not the app link):

```typescript
function openConceptExternal(uri: string): void {
  // Open in new tab - let user view raw RDF or external viewer
  window.open(uri, '_blank', 'noopener,noreferrer');
}
```

### Handling External SKOS Browser Links

If user pastes a concept URI from another system:

```
┌─────────────────────────────────────────────────────────────┐
│ 🔍 [http://example.org/concepts/wheat                    ] │
│    [Go] or press Enter                                     │
└─────────────────────────────────────────────────────────────┘
```

Attempt to resolve in current endpoint, show error if not found.

## URL Validation

### On Load

```typescript
function validateURLParams(params: URLSearchParams): ValidationResult {
  const errors: string[] = [];

  const endpoint = params.get('endpoint');
  if (endpoint && !isValidEndpointRef(endpoint)) {
    errors.push('Invalid endpoint parameter');
  }

  const lang = params.get('lang');
  if (lang && !isValidLanguageCode(lang)) {
    errors.push('Invalid language code');
  }

  const scheme = params.get('scheme');
  if (scheme && !isValidURI(scheme)) {
    errors.push('Invalid scheme URI');
  }

  const concept = params.get('concept');
  if (concept && !isValidURI(concept)) {
    errors.push('Invalid concept URI');
  }

  return { valid: errors.length === 0, errors };
}
```

### Error Handling

If URL parameters are invalid:
1. Show warning toast
2. Ignore invalid parameters
3. Continue with valid parameters or defaults

## Security

### URL Parameter Sanitization

```typescript
// Never use URL parameters directly in queries without validation
function sanitizeURI(uri: string): string {
  // Decode
  const decoded = decodeURIComponent(uri);

  // Validate it's a proper URI
  try {
    new URL(decoded);
    return decoded;
  } catch {
    throw new Error('Invalid URI');
  }
}
```

### Prevent XSS

- Never render URL parameters as HTML
- Always escape when displaying
- Use `textContent` instead of `innerHTML`

### Prevent Open Redirect

- Only allow known endpoint URLs
- Warn user before connecting to unknown endpoints
