# Security

Security considerations for browser-based SPARQL tools.

## Threat Model

Browser-only app connecting to external SPARQL endpoints. Key risks:

| Threat | Vector | Impact |
|--------|--------|--------|
| XSS | Malicious labels/URIs from endpoint | Session hijack, credential theft |
| SPARQL Injection | User input in queries | Data exfiltration, DoS |
| Credential Exposure | localStorage theft | Unauthorized endpoint access |
| Man-in-the-Middle | HTTP endpoints | Data interception |
| Malicious Endpoints | Phishing via fake endpoints | Credential harvesting |

## Input Sanitization

### User Input Sources

| Source | Risk | Mitigation |
|--------|------|------------|
| Search box | SPARQL injection | Escape special chars |
| URI input | XSS, injection | Validate URI format |
| URL parameters | XSS, injection | Sanitize before use |
| Endpoint URL | MITM, phishing | HTTPS validation |

### SPARQL Injection Prevention

Never interpolate user input directly into SPARQL:

```typescript
// BAD - vulnerable to injection
const query = `SELECT * WHERE { ?s ?p "${userInput}" }`;

// GOOD - escape special characters
function escapeSparqlString(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

const query = `SELECT * WHERE { ?s ?p "${escapeSparqlString(userInput)}" }`;
```

### URI Validation

```typescript
function isValidURI(uri: string): boolean {
  try {
    const url = new URL(uri);
    return ['http:', 'https:', 'urn:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function sanitizeURI(uri: string): string | null {
  if (!isValidURI(uri)) return null;

  // Prevent javascript: and data: URIs
  if (/^(javascript|data|vbscript):/i.test(uri)) {
    return null;
  }

  return uri;
}
```

### Search Input Sanitization

```typescript
function sanitizeSearchInput(input: string): string {
  return input
    .trim()
    .slice(0, 500)  // Max length
    .replace(/[<>]/g, '');  // Remove potential HTML
}
```

## Output Encoding

### Display Content from Endpoint

Always encode when rendering content from SPARQL results:

```typescript
// Vue template - auto-escaped by default
<span>{{ concept.label }}</span>

// If using v-html (avoid when possible)
<span v-html="sanitizeHtml(concept.description)"></span>

// Sanitize HTML content
import DOMPurify from 'dompurify';

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'br'],
    ALLOWED_ATTR: ['href', 'title'],
  });
}
```

### URI Display

```typescript
// When displaying URIs, encode for HTML context
function displayURI(uri: string): string {
  return uri
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// When using in href, validate first
<a v-if="isValidURI(uri)" :href="uri">{{ displayURI(uri) }}</a>
```

## Credential Security

### Storage Strategy

| Credential Type | Storage | Lifetime |
|-----------------|---------|----------|
| No auth | - | - |
| Basic Auth | sessionStorage | Session only |
| API Key | localStorage (encrypted) | Persistent |
| Bearer Token | Memory | Until refresh |

### Encryption for localStorage

```typescript
// Simple obfuscation (not true encryption - deters casual inspection)
const STORAGE_KEY = 'ae-credentials';

async function storeCredentials(endpointId: string, credentials: Credentials): Promise<void> {
  const existing = getStoredCredentials();
  existing[endpointId] = {
    ...credentials,
    // Encode but warn user this isn't secure
    encoded: btoa(JSON.stringify(credentials)),
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

async function getCredentials(endpointId: string): Promise<Credentials | null> {
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (!stored) return null;

  const all = JSON.parse(stored);
  const entry = all[endpointId];
  if (!entry) return null;

  return JSON.parse(atob(entry.encoded));
}
```

### User Warning

Display warning when storing credentials:

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠ Security Notice                                          │
│                                                             │
│  Credentials stored in browser are not fully secure.        │
│  For sensitive endpoints, re-enter credentials each session.│
│                                                             │
│  [ ] Remember credentials (not recommended for shared PCs)  │
│                                                             │
│  [Cancel]  [Save Anyway]                                    │
└─────────────────────────────────────────────────────────────┘
```

## Transport Security

### HTTPS Enforcement

```typescript
interface EndpointSecurityCheck {
  isHttps: boolean;
  warning?: string;
}

function checkEndpointSecurity(url: string): EndpointSecurityCheck {
  const parsed = new URL(url);

  if (parsed.protocol === 'https:') {
    return { isHttps: true };
  }

  // Allow localhost for development
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
    return { isHttps: false, warning: 'Local endpoint - HTTPS not required' };
  }

  return {
    isHttps: false,
    warning: 'This endpoint uses HTTP. Your queries and credentials may be intercepted.',
  };
}
```

### HTTP Warning UI

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠ Insecure Connection                                      │
│                                                             │
│  This endpoint uses HTTP instead of HTTPS.                  │
│  Data sent to this endpoint can be intercepted.             │
│                                                             │
│  [ ] Don't show again for this endpoint                     │
│                                                             │
│  [Cancel]  [Connect Anyway]                                 │
└─────────────────────────────────────────────────────────────┘
```

## Content Security Policy

### Recommended CSP Headers

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  connect-src 'self' https: http://localhost:*;
  img-src 'self' data: https:;
  font-src 'self';
  frame-ancestors 'none';
```

### Meta Tag (if no server control)

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  connect-src 'self' https: http://localhost:*;
  style-src 'self' 'unsafe-inline';
">
```

**Note:** `connect-src https:` allows SPARQL connections to any HTTPS endpoint.

## Endpoint Trust

### Trust Indicators

```typescript
interface EndpointTrust {
  level: 'trusted' | 'unknown' | 'warning';
  reasons: string[];
}

function assessEndpointTrust(endpoint: SPARQLEndpoint): EndpointTrust {
  const reasons: string[] = [];
  let level: EndpointTrust['level'] = 'unknown';

  // Check HTTPS
  if (!endpoint.url.startsWith('https://')) {
    reasons.push('Uses HTTP (insecure)');
    level = 'warning';
  }

  // Check known trusted domains
  const trustedDomains = [
    'dbpedia.org',
    'wikidata.org',
    'data.europa.eu',
    'vocabularies.unesco.org',
  ];

  const url = new URL(endpoint.url);
  if (trustedDomains.some(d => url.hostname.endsWith(d))) {
    level = 'trusted';
    reasons.push('Known trusted vocabulary provider');
  }

  return { level, reasons };
}
```

### Trust UI

```
┌────────────────────────────────────┐
│ 🟢 DBpedia SPARQL                  │  ← Trusted
│ 🟡 Custom Endpoint                 │  ← Unknown
│ 🔴 http://suspicious.example       │  ← Warning
└────────────────────────────────────┘
```

## Error Information Disclosure

### Safe Error Messages

Don't expose internal details in error messages:

```typescript
// BAD - exposes internal info
throw new Error(`Query failed: ${sparqlQuery}`);

// GOOD - generic message, log details
console.error('Query failed:', sparqlQuery);
throw new AppError({
  code: 'QUERY_ERROR',
  message: 'Failed to load data. Please try again.',
});
```

### Debug Mode

Only show detailed errors in development:

```typescript
function formatError(error: AppError): string {
  if (import.meta.env.DEV) {
    return `${error.message}\n\nDebug: ${error.details}`;
  }
  return error.message;
}
```

## Security Checklist

### Before Release

- [ ] All user input sanitized before SPARQL queries
- [ ] URIs validated before rendering as links
- [ ] HTML content from endpoints sanitized with DOMPurify
- [ ] Credentials stored in sessionStorage (not localStorage)
- [ ] HTTP endpoints show security warning
- [ ] CSP headers configured
- [ ] No sensitive data in error messages
- [ ] Console logs removed in production

### Per Feature

| Feature | Security Check |
|---------|----------------|
| Search | Input sanitized, length limited |
| URI lookup | URI validated, protocol checked |
| Concept display | Labels HTML-escaped |
| Raw view | Content displayed as text, not HTML |
| Copy to clipboard | No injection risk |
| Share URL | Parameters encoded |

## Dependencies

Security-related npm packages:

```json
{
  "dependencies": {
    "dompurify": "^3.0.0"
  },
  "devDependencies": {
    "@types/dompurify": "^3.0.0"
  }
}
```

## Related Specs

- [com01-EndpointManager](./com01-EndpointManager.md) - Authentication
- [com03-ErrorHandling](./com03-ErrorHandling.md) - Error messages
- [com04-URLRouting](./com04-URLRouting.md) - URL parameter handling
- [com05-SPARQLPatterns](./com05-SPARQLPatterns.md) - Query construction
