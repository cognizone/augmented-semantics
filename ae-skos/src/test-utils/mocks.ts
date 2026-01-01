/**
 * Mock Factories for Tests
 *
 * Provides factory functions for creating test data.
 * @see /spec/ae-skos/sko07-Testing.md
 */
import { vi } from 'vitest'
import type { SPARQLEndpoint } from '../types'
import type { SPARQLResults } from '../services/sparql'

// --- Endpoint Mocks ---

export function createMockEndpoint(overrides: Partial<SPARQLEndpoint> = {}): SPARQLEndpoint {
  return {
    id: 'test-endpoint-1',
    name: 'Test Endpoint',
    url: 'https://example.org/sparql',
    auth: { type: 'none' },
    createdAt: '2024-01-01T00:00:00Z',
    lastAccessedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

export function createBasicAuthEndpoint(
  username = 'testuser',
  password = 'testpass'
): SPARQLEndpoint {
  return createMockEndpoint({
    auth: {
      type: 'basic',
      credentials: { username, password },
    },
  })
}

export function createBearerAuthEndpoint(token = 'test-bearer-token'): SPARQLEndpoint {
  return createMockEndpoint({
    auth: {
      type: 'bearer',
      credentials: { token },
    },
  })
}

export function createApiKeyEndpoint(
  apiKey = 'test-api-key',
  headerName = 'X-API-Key'
): SPARQLEndpoint {
  return createMockEndpoint({
    auth: {
      type: 'apikey',
      credentials: { apiKey, headerName },
    },
  })
}

// --- SPARQL Results Mocks ---

export function createSparqlResults(bindings: Record<string, unknown>[]): SPARQLResults {
  const vars = bindings.length > 0 ? Object.keys(bindings[0]) : []
  return {
    head: { vars },
    results: {
      bindings: bindings.map((b) =>
        Object.fromEntries(
          Object.entries(b).map(([key, value]) => {
            if (typeof value === 'string') {
              // Check if it's a URI
              if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('urn:')) {
                return [key, { type: 'uri', value }]
              }
              // Check for language tag pattern: "text"@lang
              const langMatch = value.match(/^(.+)@([a-z]{2,3})$/i)
              if (langMatch) {
                return [key, { type: 'literal', value: langMatch[1], 'xml:lang': langMatch[2] }]
              }
              return [key, { type: 'literal', value }]
            }
            // Already formatted binding
            return [key, value]
          })
        )
      ),
    },
  } as SPARQLResults
}

export function createEmptyResults(): SPARQLResults {
  return {
    head: { vars: [] },
    results: { bindings: [] },
  }
}

// --- Fetch Mock Helpers ---

export interface FetchMockOptions {
  status?: number
  statusText?: string
  body?: unknown
  contentType?: string
  delay?: number
}

export function mockFetchSuccess(body: unknown, options: Partial<FetchMockOptions> = {}) {
  const { status = 200, statusText = 'OK', contentType = 'application/sparql-results+json', delay = 0 } = options

  return vi.fn().mockImplementation(async () => {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    return {
      ok: true,
      status,
      statusText,
      headers: new Headers({ 'content-type': contentType }),
      json: async () => body,
      text: async () => JSON.stringify(body),
    }
  })
}

export function mockFetchError(status: number, statusText: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
    headers: new Headers(),
  })
}

export function mockFetchNetworkError(message = 'Failed to fetch') {
  return vi.fn().mockRejectedValue(new TypeError(message))
}

export function mockFetchTimeout() {
  return vi.fn().mockImplementation(() => {
    const controller = new AbortController()
    return new Promise((_, reject) => {
      setTimeout(() => {
        const error = new DOMException('Aborted', 'AbortError')
        reject(error)
      }, 10)
    })
  })
}

// --- Store State Mocks ---

export function createMockTreeNode(
  uri: string,
  label: string,
  hasChildren = false,
  notation?: string
) {
  return {
    key: uri,
    label,
    notation,
    data: { uri, label, notation },
    leaf: !hasChildren,
    children: hasChildren ? [] : undefined,
  }
}

export function createMockConceptDetails(uri: string, overrides = {}) {
  return {
    uri,
    prefLabels: [{ value: 'Test Concept', lang: 'en' }],
    altLabels: [],
    hiddenLabels: [],
    definitions: [{ value: 'A test concept definition', lang: 'en' }],
    scopeNotes: [],
    historyNotes: [],
    changeNotes: [],
    editorialNotes: [],
    examples: [],
    notations: [],
    broader: [],
    narrower: [],
    related: [],
    inScheme: [],
    exactMatch: [],
    closeMatch: [],
    broadMatch: [],
    narrowMatch: [],
    relatedMatch: [],
    otherProperties: [],
    ...overrides,
  }
}

export function createMockScheme(uri: string, label: string, notation?: string) {
  return {
    uri,
    label,
    notation,
  }
}
