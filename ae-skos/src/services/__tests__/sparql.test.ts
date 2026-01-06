/**
 * SPARQL Service Tests
 *
 * Tests for query execution, retry logic, authentication, error handling.
 * @see /spec/common/com05-SPARQLPatterns.md
 * @see /spec/ae-skos/sko07-Testing.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  executeSparql,
  testConnection,
  detectGraphs,
  detectSkosGraphs,
  detectDuplicates,
  detectLanguages,
  withPrefixes,
  buildQueryWithGraphs,
} from '../sparql'
import {
  createMockEndpoint,
  createBasicAuthEndpoint,
  createBearerAuthEndpoint,
  createApiKeyEndpoint,
  createSparqlResults,
  createEmptyResults,
  mockFetchSuccess,
  mockFetchError,
  mockFetchNetworkError,
} from '../../test-utils/mocks'

// Mock the logger to avoid console noise
vi.mock('../logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('executeSparql', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('successful queries', () => {
    it('executes a simple query', async () => {
      const mockResults = createSparqlResults([
        { s: 'http://example.org/s1', p: 'http://example.org/p1', o: 'value1' },
      ])
      global.fetch = mockFetchSuccess(mockResults)

      const endpoint = createMockEndpoint()
      const result = await executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }')

      expect(result).toEqual(mockResults)
      expect(fetch).toHaveBeenCalledWith(
        endpoint.url,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/sparql-results+json',
          }),
        })
      )
    })

    it('returns empty results for empty response', async () => {
      const mockResults = createEmptyResults()
      global.fetch = mockFetchSuccess(mockResults)

      const endpoint = createMockEndpoint()
      const result = await executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }')

      expect(result.results.bindings).toHaveLength(0)
    })
  })

  describe('authentication', () => {
    it('adds Basic auth header', async () => {
      global.fetch = mockFetchSuccess(createEmptyResults())

      const endpoint = createBasicAuthEndpoint('myuser', 'mypass')
      await executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }')

      const expectedAuth = 'Basic ' + btoa('myuser:mypass')
      expect(fetch).toHaveBeenCalledWith(
        endpoint.url,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expectedAuth,
          }),
        })
      )
    })

    it('adds Bearer token header', async () => {
      global.fetch = mockFetchSuccess(createEmptyResults())

      const endpoint = createBearerAuthEndpoint('my-token-123')
      await executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }')

      expect(fetch).toHaveBeenCalledWith(
        endpoint.url,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-token-123',
          }),
        })
      )
    })

    it('adds API key header with default name', async () => {
      global.fetch = mockFetchSuccess(createEmptyResults())

      const endpoint = createApiKeyEndpoint('api-key-456')
      await executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }')

      expect(fetch).toHaveBeenCalledWith(
        endpoint.url,
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'api-key-456',
          }),
        })
      )
    })

    it('adds API key header with custom name', async () => {
      global.fetch = mockFetchSuccess(createEmptyResults())

      const endpoint = createApiKeyEndpoint('api-key-789', 'X-Custom-Key')
      await executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }')

      expect(fetch).toHaveBeenCalledWith(
        endpoint.url,
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Custom-Key': 'api-key-789',
          }),
        })
      )
    })

    it('sends no auth header when auth type is none', async () => {
      global.fetch = mockFetchSuccess(createEmptyResults())

      const endpoint = createMockEndpoint({ auth: { type: 'none' } })
      await executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }')

      const call = vi.mocked(fetch).mock.calls[0]
      const callArgs = call?.[1] as RequestInit
      expect(callArgs.headers).not.toHaveProperty('Authorization')
    })
  })

  describe('error handling', () => {
    it('maps HTTP 400 to QUERY_ERROR', async () => {
      global.fetch = mockFetchError(400, 'Bad Request')

      const endpoint = createMockEndpoint()
      await expect(executeSparql(endpoint, 'INVALID', { retries: 0 })).rejects.toMatchObject({
        code: 'QUERY_ERROR',
      })
    })

    it('maps HTTP 401 to AUTH_REQUIRED and does not retry', async () => {
      global.fetch = mockFetchError(401, 'Unauthorized')

      const endpoint = createMockEndpoint()
      await expect(executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }', { retries: 3 })).rejects.toMatchObject({
        code: 'AUTH_REQUIRED',
      })

      // Should only be called once (no retries)
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('maps HTTP 403 to AUTH_FAILED and does not retry', async () => {
      global.fetch = mockFetchError(403, 'Forbidden')

      const endpoint = createMockEndpoint()
      await expect(executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }', { retries: 3 })).rejects.toMatchObject({
        code: 'AUTH_FAILED',
      })

      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('maps HTTP 404 to NOT_FOUND', async () => {
      global.fetch = mockFetchError(404, 'Not Found')

      const endpoint = createMockEndpoint()
      await expect(executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }', { retries: 0 })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('maps HTTP 500 to SERVER_ERROR', async () => {
      global.fetch = mockFetchError(500, 'Internal Server Error')

      const endpoint = createMockEndpoint()
      await expect(executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }', { retries: 0 })).rejects.toMatchObject({
        code: 'SERVER_ERROR',
      })
    })

    it('maps HTTP 502 to SERVER_ERROR', async () => {
      global.fetch = mockFetchError(502, 'Bad Gateway')

      const endpoint = createMockEndpoint()
      await expect(executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }', { retries: 0 })).rejects.toMatchObject({
        code: 'SERVER_ERROR',
      })
    })

    it('maps HTTP 503 to SERVER_ERROR', async () => {
      global.fetch = mockFetchError(503, 'Service Unavailable')

      const endpoint = createMockEndpoint()
      await expect(executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }', { retries: 0 })).rejects.toMatchObject({
        code: 'SERVER_ERROR',
      })
    })

    it('maps HTTP 504 to SERVER_ERROR', async () => {
      global.fetch = mockFetchError(504, 'Gateway Timeout')

      const endpoint = createMockEndpoint()
      await expect(executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }', { retries: 0 })).rejects.toMatchObject({
        code: 'SERVER_ERROR',
      })
    })

    it('detects CORS errors from TypeError', async () => {
      global.fetch = mockFetchNetworkError('Failed to fetch: CORS error')

      const endpoint = createMockEndpoint()
      await expect(executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }', { retries: 0 })).rejects.toMatchObject({
        code: 'CORS_BLOCKED',
      })
    })

    it('maps network errors to NETWORK_ERROR', async () => {
      global.fetch = mockFetchNetworkError('Network unavailable')

      const endpoint = createMockEndpoint()
      await expect(executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }', { retries: 0 })).rejects.toMatchObject({
        code: 'NETWORK_ERROR',
      })
    })

    it('throws INVALID_RESPONSE for non-JSON content type', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'text/html' }),
        json: vi.fn(),
      })

      const endpoint = createMockEndpoint()
      await expect(executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }', { retries: 0 })).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      })
    })
  })

  describe('retry behavior', () => {
    it('retries on timeout and succeeds eventually', async () => {
      vi.useRealTimers() // Use real timers for this test

      let callCount = 0
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount < 2) {
          return Promise.reject(new DOMException('Aborted', 'AbortError'))
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve(createEmptyResults()),
        })
      })

      const endpoint = createMockEndpoint()
      const result = await executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }', {
        retries: 2,
        retryDelay: 10, // Short delay for test speed
      })

      expect(result).toEqual(createEmptyResults())
      expect(callCount).toBe(2)
    })

    it('retries on server errors and succeeds', async () => {
      vi.useRealTimers()

      let callCount = 0
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount < 2) {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            headers: new Headers(),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve(createEmptyResults()),
        })
      })

      const endpoint = createMockEndpoint()
      const result = await executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }', {
        retries: 2,
        retryDelay: 10,
      })

      expect(result).toEqual(createEmptyResults())
      expect(callCount).toBe(2)
    })

    it('does not retry on auth errors', async () => {
      global.fetch = mockFetchError(401, 'Unauthorized')

      const endpoint = createMockEndpoint()
      await expect(
        executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }', { retries: 5 })
      ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })

      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('exhausts retries and throws last error', async () => {
      vi.useRealTimers()

      global.fetch = mockFetchError(500, 'Server Error')

      const endpoint = createMockEndpoint()
      await expect(
        executeSparql(endpoint, 'SELECT * WHERE { ?s ?p ?o }', {
          retries: 2,
          retryDelay: 10,
        })
      ).rejects.toMatchObject({ code: 'SERVER_ERROR' })

      expect(fetch).toHaveBeenCalledTimes(3) // Initial + 2 retries
    })
  })
})

describe('testConnection', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns success for valid endpoint', async () => {
    global.fetch = mockFetchSuccess(createEmptyResults())

    const endpoint = createMockEndpoint()
    const result = await testConnection(endpoint)

    expect(result.success).toBe(true)
    expect(result.responseTime).toBeDefined()
    expect(result.error).toBeUndefined()
  })

  it('returns error for failed connection', async () => {
    global.fetch = mockFetchError(401, 'Unauthorized')

    const endpoint = createMockEndpoint()
    const result = await testConnection(endpoint)

    expect(result.success).toBe(false)
    expect(result.error).toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(result.responseTime).toBeDefined()
  })
})

describe('detectGraphs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns graph count from endpoint', async () => {
    // COUNT query returns count result
    const mockResults = createSparqlResults([
      { count: '5' },
    ])
    global.fetch = mockFetchSuccess(mockResults)

    const endpoint = createMockEndpoint()
    const result = await detectGraphs(endpoint)

    expect(result.supportsNamedGraphs).toBe(true)
    expect(result.graphCount).toBe(5)
    expect(result.graphCountExact).toBe(true)
  })

  it('returns zero for endpoints without named graphs', async () => {
    // All three steps return 0/empty, so we end up at Step 3 with no graphs
    global.fetch = mockFetchSuccess(createEmptyResults())

    const endpoint = createMockEndpoint()
    const result = await detectGraphs(endpoint)

    expect(result.supportsNamedGraphs).toBe(false)
    expect(result.graphCount).toBe(0)
  })

  it('returns null on query failure', async () => {
    global.fetch = mockFetchError(500, 'Server Error')

    const endpoint = createMockEndpoint()
    const result = await detectGraphs(endpoint)

    expect(result.supportsNamedGraphs).toBe(null)
    expect(result.graphCount).toBe(null)
  })
})

describe('detectSkosGraphs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns count and URIs of graphs with SKOS data', async () => {
    const mockResults = createSparqlResults([
      { g: 'http://example.org/graph1' },
      { g: 'http://example.org/graph2' },
      { g: 'http://example.org/graph3' },
    ])
    global.fetch = mockFetchSuccess(mockResults)

    const endpoint = createMockEndpoint()
    const result = await detectSkosGraphs(endpoint)

    expect(result.skosGraphCount).toBe(3)
    expect(result.skosGraphUris).toEqual([
      'http://example.org/graph1',
      'http://example.org/graph2',
      'http://example.org/graph3',
    ])
  })

  it('returns null URIs when over maxGraphs threshold', async () => {
    // Create 6 graphs but set maxGraphs to 5
    const mockResults = createSparqlResults([
      { g: 'http://example.org/graph1' },
      { g: 'http://example.org/graph2' },
      { g: 'http://example.org/graph3' },
      { g: 'http://example.org/graph4' },
      { g: 'http://example.org/graph5' },
      { g: 'http://example.org/graph6' },
    ])
    global.fetch = mockFetchSuccess(mockResults)

    const endpoint = createMockEndpoint()
    const result = await detectSkosGraphs(endpoint, { maxGraphs: 5 })

    expect(result.skosGraphCount).toBe(6)
    expect(result.skosGraphUris).toBe(null)
  })

  it('returns 0 when no graphs have SKOS data', async () => {
    global.fetch = mockFetchSuccess(createEmptyResults())

    const endpoint = createMockEndpoint()
    const result = await detectSkosGraphs(endpoint)

    expect(result.skosGraphCount).toBe(0)
    expect(result.skosGraphUris).toEqual([])
  })

  it('returns null on query failure', async () => {
    global.fetch = mockFetchError(500, 'Server Error')

    const endpoint = createMockEndpoint()
    const result = await detectSkosGraphs(endpoint)

    expect(result.skosGraphCount).toBe(null)
    expect(result.skosGraphUris).toBe(null)
  })
})

describe('detectDuplicates', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('detects duplicates when present', async () => {
    // ASK queries return { boolean: true/false }
    global.fetch = mockFetchSuccess({ boolean: true })

    const endpoint = createMockEndpoint()
    const result = await detectDuplicates(endpoint)

    expect(result.hasDuplicates).toBe(true)
  })

  it('returns no duplicates when none found', async () => {
    // ASK queries return { boolean: true/false }
    global.fetch = mockFetchSuccess({ boolean: false })

    const endpoint = createMockEndpoint()
    const result = await detectDuplicates(endpoint)

    expect(result.hasDuplicates).toBe(false)
  })

  it('handles query failure gracefully', async () => {
    global.fetch = mockFetchError(500, 'Server Error')

    const endpoint = createMockEndpoint()
    const result = await detectDuplicates(endpoint)

    expect(result.hasDuplicates).toBe(false)
  })
})

describe('detectLanguages', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns available languages with counts', async () => {
    const mockResults = {
      head: { vars: ['lang', 'count'] },
      results: {
        bindings: [
          { lang: { type: 'literal', value: 'en' }, count: { type: 'literal', value: '100' } },
          { lang: { type: 'literal', value: 'fr' }, count: { type: 'literal', value: '50' } },
          { lang: { type: 'literal', value: 'de' }, count: { type: 'literal', value: '25' } },
        ],
      },
    }
    global.fetch = mockFetchSuccess(mockResults)

    const endpoint = createMockEndpoint()
    const result = await detectLanguages(endpoint)

    expect(result).toEqual([
      { lang: 'en', count: 100 },
      { lang: 'fr', count: 50 },
      { lang: 'de', count: 25 },
    ])
  })

  it('returns empty array on failure', async () => {
    global.fetch = mockFetchError(500, 'Server Error')

    const endpoint = createMockEndpoint()
    const result = await detectLanguages(endpoint)

    expect(result).toEqual([])
  })

  it('filters out empty language values', async () => {
    const mockResults = {
      head: { vars: ['lang', 'count'] },
      results: {
        bindings: [
          { lang: { type: 'literal', value: 'en' }, count: { type: 'literal', value: '100' } },
          { lang: { type: 'literal', value: '' }, count: { type: 'literal', value: '10' } },
          { lang: { type: 'literal', value: 'fr' }, count: { type: 'literal', value: '50' } },
        ],
      },
    }
    global.fetch = mockFetchSuccess(mockResults)

    const endpoint = createMockEndpoint()
    const result = await detectLanguages(endpoint)

    expect(result).toEqual([
      { lang: 'en', count: 100 },
      { lang: 'fr', count: 50 },
    ])
  })

  it('uses GRAPH pattern when useGraphScope is true', async () => {
    const mockResults = {
      head: { vars: ['lang', 'count'] },
      results: {
        bindings: [
          { lang: { type: 'literal', value: 'en' }, count: { type: 'literal', value: '100' } },
        ],
      },
    }
    let capturedBody = ''
    global.fetch = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
      capturedBody = options.body as string
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/sparql-results+json' }),
        json: () => Promise.resolve(mockResults),
      })
    })

    const endpoint = createMockEndpoint()
    await detectLanguages(endpoint, true)

    // Verify the query contains GRAPH pattern
    const query = decodeURIComponent(capturedBody.replace('query=', ''))
    expect(query).toContain('GRAPH ?g')
  })
})

describe('withPrefixes', () => {
  it('adds standard SKOS prefixes to query', () => {
    const query = 'SELECT * WHERE { ?s ?p ?o }'
    const result = withPrefixes(query)

    expect(result).toContain('PREFIX skos:')
    expect(result).toContain('PREFIX dct:')
    expect(result).toContain('PREFIX rdfs:')
    expect(result).toContain('PREFIX rdf:')
    expect(result).toContain('PREFIX owl:')
    expect(result).toContain(query)
  })

  it('does not duplicate existing prefixes', () => {
    const query = 'PREFIX skos: <http://www.w3.org/2004/02/skos/core#>\nSELECT * WHERE { ?s ?p ?o }'
    const result = withPrefixes(query)

    expect(result).toBe(query)
  })

  it('handles query with leading whitespace', () => {
    const query = '  PREFIX skos: <http://test>\nSELECT * WHERE { ?s ?p ?o }'
    const result = withPrefixes(query)

    expect(result).toBe(query)
  })
})

describe('buildQueryWithGraphs', () => {
  it('returns original query when no graphs selected', () => {
    const query = 'SELECT * WHERE { ?s ?p ?o }'
    expect(buildQueryWithGraphs(query, undefined)).toBe(query)
    expect(buildQueryWithGraphs(query, [])).toBe(query)
  })

  it('adds FROM clauses before WHERE', () => {
    const query = 'SELECT * WHERE { ?s ?p ?o }'
    const result = buildQueryWithGraphs(query, [
      'http://example.org/graph1',
      'http://example.org/graph2',
    ])

    expect(result).toContain('FROM <http://example.org/graph1>')
    expect(result).toContain('FROM <http://example.org/graph2>')
    expect(result.indexOf('FROM')).toBeLessThan(result.indexOf('WHERE'))
  })

  it('handles case-insensitive WHERE', () => {
    const query = 'SELECT * where { ?s ?p ?o }'
    const result = buildQueryWithGraphs(query, ['http://example.org/graph1'])

    expect(result).toContain('FROM <http://example.org/graph1>')
    expect(result).toContain('where')
  })
})
