import DOMPurify from 'dompurify'

/**
 * Escape special characters for SPARQL string literals
 * Prevents SPARQL injection attacks
 */
export function escapeSparqlString(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

/**
 * Escape for SPARQL regex patterns
 */
export function escapeSparqlRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Validate URI format and protocol
 * Returns null if invalid or dangerous
 */
export function validateURI(uri: string): string | null {
  if (!uri || typeof uri !== 'string') {
    return null
  }

  // Trim whitespace
  const trimmed = uri.trim()

  // Check for dangerous protocols
  const dangerousProtocols = /^(javascript|data|vbscript|file):/i
  if (dangerousProtocols.test(trimmed)) {
    return null
  }

  try {
    const url = new URL(trimmed)

    // Only allow http, https, and urn schemes
    const allowedProtocols = ['http:', 'https:', 'urn:']
    if (!allowedProtocols.includes(url.protocol)) {
      return null
    }

    return trimmed
  } catch {
    // Not a valid URL - could be a URN or relative URI
    // Allow if it looks like a URN
    if (trimmed.startsWith('urn:')) {
      return trimmed
    }

    return null
  }
}

/**
 * Check if URI is valid (boolean version)
 */
export function isValidURI(uri: string): boolean {
  return validateURI(uri) !== null
}

/**
 * Sanitize search input
 * - Trims whitespace
 * - Limits length
 * - Removes potential HTML
 */
export function sanitizeSearchInput(input: string, maxLength = 500): string {
  if (!input || typeof input !== 'string') {
    return ''
  }

  return input
    .trim()
    .slice(0, maxLength)
    .replace(/[<>]/g, '') // Remove potential HTML tags
}

/**
 * Sanitize HTML content from SPARQL results
 * Only allows safe tags for display
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'br', 'p', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: ['href', 'title', 'target'],
    ALLOW_DATA_ATTR: false,
  })
}

/**
 * Escape HTML entities for safe display
 * Use when you need to show content as plain text
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

/**
 * Check endpoint URL security
 */
export interface EndpointSecurityCheck {
  isHttps: boolean
  isLocalhost: boolean
  warning?: string
}

export function checkEndpointSecurity(url: string): EndpointSecurityCheck {
  try {
    const parsed = new URL(url)

    const isLocalhost =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]'

    if (parsed.protocol === 'https:') {
      return { isHttps: true, isLocalhost }
    }

    if (isLocalhost) {
      return {
        isHttps: false,
        isLocalhost: true,
        warning: 'Local endpoint - HTTPS not required',
      }
    }

    return {
      isHttps: false,
      isLocalhost: false,
      warning:
        'This endpoint uses HTTP. Your queries and credentials may be intercepted.',
    }
  } catch {
    return {
      isHttps: false,
      isLocalhost: false,
      warning: 'Invalid endpoint URL',
    }
  }
}

/**
 * Known trusted SPARQL endpoint domains
 */
const TRUSTED_DOMAINS = [
  'dbpedia.org',
  'wikidata.org',
  'data.europa.eu',
  'publications.europa.eu',
  'vocabularies.unesco.org',
  'id.loc.gov',
  'data.bnf.fr',
  'linkeddata.uriburner.com',
]

export type TrustLevel = 'trusted' | 'unknown' | 'warning'

export interface EndpointTrust {
  level: TrustLevel
  reasons: string[]
}

/**
 * Assess trust level of an endpoint
 */
export function assessEndpointTrust(url: string): EndpointTrust {
  const reasons: string[] = []
  let level: TrustLevel = 'unknown'

  try {
    const parsed = new URL(url)

    // Check HTTPS
    if (parsed.protocol !== 'https:') {
      const isLocalhost =
        parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
      if (!isLocalhost) {
        reasons.push('Uses HTTP (insecure)')
        level = 'warning'
      }
    }

    // Check trusted domains
    const hostname = parsed.hostname.toLowerCase()
    const isTrusted = TRUSTED_DOMAINS.some(
      domain => hostname === domain || hostname.endsWith('.' + domain)
    )

    if (isTrusted) {
      level = 'trusted'
      reasons.push('Known trusted vocabulary provider')
    }
  } catch {
    reasons.push('Invalid URL')
    level = 'warning'
  }

  return { level, reasons }
}

/**
 * Validate endpoint URL format
 */
export function isValidEndpointUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false
  }

  try {
    const parsed = new URL(url.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Credential storage helpers
 * Uses sessionStorage for better security (cleared on tab close)
 */
const CREDENTIALS_KEY = 'ae-credentials'

interface StoredCredentials {
  [endpointId: string]: {
    encoded: string
    storedAt: string
  }
}

export function storeCredentials(
  endpointId: string,
  credentials: { username?: string; password?: string; apiKey?: string; token?: string }
): void {
  try {
    const existing = getStoredCredentials()
    existing[endpointId] = {
      encoded: btoa(JSON.stringify(credentials)),
      storedAt: new Date().toISOString(),
    }
    sessionStorage.setItem(CREDENTIALS_KEY, JSON.stringify(existing))
  } catch (e) {
    console.error('Failed to store credentials:', e)
  }
}

export function getCredentials(
  endpointId: string
): { username?: string; password?: string; apiKey?: string; token?: string } | null {
  try {
    const all = getStoredCredentials()
    const entry = all[endpointId]
    if (!entry) return null
    return JSON.parse(atob(entry.encoded))
  } catch {
    return null
  }
}

export function clearCredentials(endpointId: string): void {
  try {
    const existing = getStoredCredentials()
    delete existing[endpointId]
    sessionStorage.setItem(CREDENTIALS_KEY, JSON.stringify(existing))
  } catch (e) {
    console.error('Failed to clear credentials:', e)
  }
}

function getStoredCredentials(): StoredCredentials {
  try {
    const stored = sessionStorage.getItem(CREDENTIALS_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}
