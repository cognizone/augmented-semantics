/**
 * SPARQL Service - Query execution and endpoint analysis
 *
 * Provides:
 * - Query execution with retry and timeout
 * - Authentication handling (Basic, API Key, Bearer)
 * - Endpoint analysis (graphs, duplicates, languages)
 * - Standard SPARQL prefixes
 *
 * @see /spec/common/com05-SPARQLPatterns.md
 */
import type { SPARQLEndpoint, AppError, ErrorCode } from '../types'
import { logger } from './logger'

// SPARQL result types
export interface SPARQLBinding {
  [key: string]: {
    type: 'uri' | 'literal' | 'bnode'
    value: string
    'xml:lang'?: string
    datatype?: string
  }
}

export interface SPARQLResults {
  head: {
    vars: string[]
  }
  results: {
    bindings: SPARQLBinding[]
  }
}

// Request configuration
export interface SPARQLRequestConfig {
  timeout?: number
  signal?: AbortSignal
  retries?: number
  retryDelay?: number
}

const DEFAULT_CONFIG: Required<Omit<SPARQLRequestConfig, 'signal'>> = {
  timeout: 30000,
  retries: 3,
  retryDelay: 1000,
}

// Standard prefixes
export const SPARQL_PREFIXES = `
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX skosxl: <http://www.w3.org/2008/05/skos-xl#>
PREFIX dct: <http://purl.org/dc/terms/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
`.trim()

/**
 * Create Authorization header based on endpoint auth config
 */
function getAuthHeaders(endpoint: SPARQLEndpoint): HeadersInit {
  if (!endpoint.auth || endpoint.auth.type === 'none') {
    return {}
  }

  const { type, credentials } = endpoint.auth

  switch (type) {
    case 'basic':
      if (credentials?.username && credentials?.password) {
        const encoded = btoa(`${credentials.username}:${credentials.password}`)
        return { Authorization: `Basic ${encoded}` }
      }
      break
    case 'bearer':
      if (credentials?.token) {
        return { Authorization: `Bearer ${credentials.token}` }
      }
      break
    case 'apikey':
      if (credentials?.apiKey) {
        const headerName = credentials.headerName || 'X-API-Key'
        return { [headerName]: credentials.apiKey }
      }
      break
  }

  return {}
}

/**
 * Map HTTP status codes to error codes
 */
function mapHttpError(status: number, statusText: string): { code: ErrorCode; message: string } {
  switch (status) {
    case 400:
      return { code: 'QUERY_ERROR', message: 'Invalid SPARQL query' }
    case 401:
      return { code: 'AUTH_REQUIRED', message: 'Authentication required' }
    case 403:
      return { code: 'AUTH_FAILED', message: 'Access denied. Check credentials.' }
    case 404:
      return { code: 'NOT_FOUND', message: 'Endpoint not found' }
    case 408:
      return { code: 'TIMEOUT', message: 'Request timed out' }
    case 500:
    case 502:
    case 503:
    case 504:
      return { code: 'SERVER_ERROR', message: `Server error: ${statusText}` }
    default:
      return { code: 'UNKNOWN', message: `HTTP ${status}: ${statusText}` }
  }
}

/**
 * Create an AppError from various error sources
 */
function createError(
  code: ErrorCode,
  message: string,
  details?: string
): AppError {
  return {
    code,
    message,
    details,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Sleep for exponential backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Execute a SPARQL query against an endpoint
 */
export async function executeSparql(
  endpoint: SPARQLEndpoint,
  query: string,
  config: SPARQLRequestConfig = {}
): Promise<SPARQLResults> {
  const { timeout, retries, retryDelay } = { ...DEFAULT_CONFIG, ...config }

  // Log the query (truncate for readability)
  const queryPreview = query.trim().slice(0, 200).replace(/\s+/g, ' ')
  logger.debug('SPARQL', `Executing query on ${endpoint.url}`, {
    query: queryPreview + (query.length > 200 ? '...' : ''),
    timeout,
    retries,
  })

  let lastError: AppError | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Exponential backoff for retries
    if (attempt > 0) {
      logger.debug('SPARQL', `Retry attempt ${attempt}/${retries}`)
      await sleep(retryDelay * Math.pow(2, attempt - 1))
    }

    // Create abort controller for timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    // Merge with external signal if provided
    if (config.signal) {
      config.signal.addEventListener('abort', () => controller.abort())
    }

    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/sparql-results+json',
          ...getAuthHeaders(endpoint),
        },
        body: `query=${encodeURIComponent(query)}`,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const { code, message } = mapHttpError(response.status, response.statusText)
        logger.warn('SPARQL', `HTTP ${response.status}: ${message}`, {
          status: response.status,
          statusText: response.statusText,
        })

        // Don't retry auth errors
        if (code === 'AUTH_REQUIRED' || code === 'AUTH_FAILED') {
          throw createError(code, message)
        }

        lastError = createError(code, message)
        continue // Retry
      }

      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('json')) {
        logger.error('SPARQL', 'Invalid response format', { contentType })
        throw createError(
          'INVALID_RESPONSE',
          'Unexpected response format',
          `Expected JSON, got: ${contentType}`
        )
      }

      const data = await response.json()
      const resultCount = data?.results?.bindings?.length ?? 0
      logger.info('SPARQL', `Query successful: ${resultCount} results`)
      return data as SPARQLResults
    } catch (error) {
      clearTimeout(timeoutId)

      if (error && typeof error === 'object' && 'code' in error) {
        // Already an AppError
        logger.error('SPARQL', 'Query failed', error)
        throw error
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        logger.warn('SPARQL', 'Request timed out')
        lastError = createError('TIMEOUT', 'Request timed out')
        continue // Retry
      }

      if (error instanceof TypeError) {
        // Network error (CORS, offline, etc.)
        const message = error.message.toLowerCase()
        logger.error('SPARQL', 'Network error', { message: error.message })
        if (message.includes('cors') || message.includes('cross-origin')) {
          throw createError(
            'CORS_BLOCKED',
            'CORS error: Endpoint does not allow browser access',
            'The endpoint needs to enable CORS headers'
          )
        }
        lastError = createError('NETWORK_ERROR', 'Network error', error.message)
        continue // Retry
      }

      logger.error('SPARQL', 'Unknown error', { error: String(error) })
      lastError = createError('UNKNOWN', 'Unknown error', String(error))
    }
  }

  // All retries exhausted
  throw lastError ?? createError('UNKNOWN', 'Request failed after retries')
}

/**
 * Test connection to an endpoint
 */
export async function testConnection(
  endpoint: SPARQLEndpoint
): Promise<{ success: boolean; error?: AppError; responseTime?: number }> {
  const startTime = performance.now()
  const testQuery = 'SELECT * WHERE { ?s ?p ?o } LIMIT 1'

  try {
    await executeSparql(endpoint, testQuery, { retries: 0, timeout: 10000 })
    return {
      success: true,
      responseTime: Math.round(performance.now() - startTime),
    }
  } catch (error) {
    return {
      success: false,
      error: error as AppError,
      responseTime: Math.round(performance.now() - startTime),
    }
  }
}

/**
 * Detect named graphs in endpoint
 */
export async function detectGraphs(
  endpoint: SPARQLEndpoint
): Promise<{ hasNamedGraphs: boolean; graphs: string[] }> {
  const query = `
    SELECT DISTINCT ?graph
    WHERE {
      GRAPH ?graph { ?s ?p ?o }
    }
    LIMIT 100
  `

  try {
    const results = await executeSparql(endpoint, query, { retries: 1 })
    const graphs = results.results.bindings
      .map(b => b.graph?.value)
      .filter((g): g is string => !!g)

    return {
      hasNamedGraphs: graphs.length > 0,
      graphs,
    }
  } catch {
    // Some endpoints don't support GRAPH queries
    return { hasNamedGraphs: false, graphs: [] }
  }
}

/**
 * Detect duplicate triples across graphs
 */
export async function detectDuplicates(
  endpoint: SPARQLEndpoint
): Promise<{ hasDuplicates: boolean; count?: number }> {
  const query = `
    SELECT ?s ?p ?o (COUNT(DISTINCT ?graph) AS ?graphCount)
    WHERE {
      GRAPH ?graph { ?s ?p ?o }
    }
    GROUP BY ?s ?p ?o
    HAVING (COUNT(DISTINCT ?graph) > 1)
    LIMIT 10
  `

  try {
    const results = await executeSparql(endpoint, query, { retries: 1 })
    const count = results.results.bindings.length

    return {
      hasDuplicates: count > 0,
      count: count > 0 ? count : undefined,
    }
  } catch {
    return { hasDuplicates: false }
  }
}

/**
 * Detect available languages in endpoint
 */
export async function detectLanguages(
  endpoint: SPARQLEndpoint
): Promise<{ lang: string; count: number }[]> {
  const query = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    SELECT (LANG(?label) AS ?lang) (COUNT(?label) AS ?count)
    WHERE {
      ?s ?p ?label .
      FILTER (isLiteral(?label) && LANG(?label) != "")
    }
    GROUP BY (LANG(?label))
    ORDER BY DESC(?count)
  `

  try {
    const results = await executeSparql(endpoint, query, { retries: 1 })
    return results.results.bindings
      .map(b => ({
        lang: b.lang?.value || '',
        count: parseInt(b.count?.value || '0', 10)
      }))
      .filter(item => item.lang.length > 0)
  } catch {
    return []
  }
}

/**
 * Run full endpoint analysis
 */
export async function analyzeEndpoint(
  endpoint: SPARQLEndpoint
): Promise<{
  hasNamedGraphs: boolean
  graphs: string[]
  hasDuplicateTriples: boolean
  duplicateCount?: number
  languages: { lang: string; count: number }[]
  analyzedAt: string
}> {
  const [graphResult, duplicateResult, languages] = await Promise.all([
    detectGraphs(endpoint),
    detectDuplicates(endpoint),
    detectLanguages(endpoint),
  ])

  return {
    hasNamedGraphs: graphResult.hasNamedGraphs,
    graphs: graphResult.graphs,
    hasDuplicateTriples: duplicateResult.hasDuplicates,
    duplicateCount: duplicateResult.count,
    languages,
    analyzedAt: new Date().toISOString(),
  }
}

/**
 * Build a query with selected graphs (FROM clauses)
 */
export function buildQueryWithGraphs(
  query: string,
  selectedGraphs?: string[]
): string {
  if (!selectedGraphs || selectedGraphs.length === 0) {
    return query
  }

  // Find WHERE clause and insert FROM clauses before it
  const fromClauses = selectedGraphs
    .map(g => `FROM <${g}>`)
    .join('\n')

  // Simple regex to find WHERE (case insensitive)
  const whereMatch = query.match(/\bWHERE\b/i)
  if (whereMatch && whereMatch.index !== undefined) {
    return (
      query.slice(0, whereMatch.index) +
      fromClauses +
      '\n' +
      query.slice(whereMatch.index)
    )
  }

  return query
}

/**
 * Add standard prefixes to a query if not already present
 */
export function withPrefixes(query: string): string {
  // Check if query already has prefixes
  if (query.trim().toUpperCase().startsWith('PREFIX')) {
    return query
  }
  return SPARQL_PREFIXES + '\n\n' + query
}

/**
 * RDF format types for raw RDF export
 */
export type RdfFormat = 'turtle' | 'jsonld' | 'ntriples' | 'rdfxml'

const RDF_ACCEPT_HEADERS: Record<RdfFormat, string> = {
  turtle: 'text/turtle',
  jsonld: 'application/ld+json',
  ntriples: 'application/n-triples',
  rdfxml: 'application/rdf+xml',
}

/**
 * Fetch raw RDF data for a concept using CONSTRUCT query
 */
export async function fetchRawRdf(
  endpoint: SPARQLEndpoint,
  conceptUri: string,
  format: RdfFormat = 'turtle',
  config: SPARQLRequestConfig = {}
): Promise<string> {
  const { timeout } = { ...DEFAULT_CONFIG, ...config }

  const query = withPrefixes(`
    CONSTRUCT { <${conceptUri}> ?p ?o }
    WHERE { <${conceptUri}> ?p ?o }
  `)

  logger.debug('SPARQL', `Fetching raw RDF for ${conceptUri}`, { format })

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: RDF_ACCEPT_HEADERS[format],
        ...getAuthHeaders(endpoint),
      },
      body: `query=${encodeURIComponent(query)}`,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const { code, message } = mapHttpError(response.status, response.statusText)
      throw createError(code, message)
    }

    const text = await response.text()
    logger.info('SPARQL', `Raw RDF fetched: ${text.length} bytes`)
    return text
  } catch (error) {
    clearTimeout(timeoutId)

    if (error && typeof error === 'object' && 'code' in error) {
      throw error
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw createError('TIMEOUT', 'Request timed out')
    }

    throw createError('UNKNOWN', 'Failed to fetch RDF', String(error))
  }
}
