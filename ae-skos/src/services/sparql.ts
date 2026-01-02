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

// Global timeout for SPARQL requests (1 minute)
const SPARQL_TIMEOUT_MS = 60000

const DEFAULT_CONFIG: Required<Omit<SPARQLRequestConfig, 'signal'>> = {
  timeout: SPARQL_TIMEOUT_MS,
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

export type GraphQueryMethod = 'empty-pattern' | 'blank-node-pattern' | 'fallback-limit' | 'none'

/**
 * Detect named graphs in endpoint
 */
export async function detectGraphs(
  endpoint: SPARQLEndpoint
): Promise<{
  supportsNamedGraphs: boolean | null
  graphCount: number | null
  graphCountExact: boolean
  queryMethod: GraphQueryMethod
}> {
  // Step 1: Try COUNT with empty graph pattern (fastest)
  const countQuery1 = `
    SELECT (COUNT(DISTINCT ?g) AS ?count)
    WHERE { GRAPH ?g { } }
  `

  try {
    const results = await executeSparql(endpoint, countQuery1, { retries: 1 })
    const count = parseInt(results.results.bindings[0]?.count?.value || '0', 10)

    // Only return if we found graphs - count=0 might be a false negative
    // (some endpoints don't support empty graph patterns properly)
    if (count > 0) {
      return {
        supportsNamedGraphs: true,
        graphCount: count,
        graphCountExact: true,
        queryMethod: 'empty-pattern',
      }
    }
    // count=0: continue to next step
  } catch {
    // Empty pattern not supported, try next
  }

  // Step 2: Try COUNT with blank node pattern
  const countQuery2 = `
    SELECT (COUNT(DISTINCT ?graph) AS ?count)
    WHERE { GRAPH ?graph { [] [] [] } }
  `

  try {
    const results = await executeSparql(endpoint, countQuery2, { retries: 1 })
    const count = parseInt(results.results.bindings[0]?.count?.value || '0', 10)

    // Only return if we found graphs - count=0 might be a false negative
    if (count > 0) {
      return {
        supportsNamedGraphs: true,
        graphCount: count,
        graphCountExact: true,
        queryMethod: 'blank-node-pattern',
      }
    }
    // count=0: continue to fallback
  } catch {
    // COUNT failed, try fallback
  }

  // Step 3: Fallback - check if at least 10001 graphs exist
  const fallbackQuery = `
    SELECT DISTINCT ?graph
    WHERE { GRAPH ?graph { ?s ?p ?o } }
    LIMIT 10001
  `

  try {
    const results = await executeSparql(endpoint, fallbackQuery, { retries: 1 })
    const count = results.results.bindings.length

    return {
      supportsNamedGraphs: count > 0,
      graphCount: count === 10001 ? 10000 : count, // 10001 means "10000+"
      graphCountExact: count < 10001, // exact only if < 10001
      queryMethod: 'fallback-limit',
    }
  } catch {
    // GRAPH queries not supported by this endpoint
    return {
      supportsNamedGraphs: null, // unknown/not supported
      graphCount: null,
      graphCountExact: false,
      queryMethod: 'none',
    }
  }
}

/**
 * Detect duplicate triples across graphs
 */
export async function detectDuplicates(
  endpoint: SPARQLEndpoint
): Promise<{ hasDuplicates: boolean }> {
  // ASK query: returns true if any triple exists in multiple graphs
  const query = `
    ASK {
      GRAPH ?g1 { ?s ?p ?o }
      GRAPH ?g2 { ?s ?p ?o }
      FILTER (?g1 != ?g2)
    }
  `

  try {
    const results = await executeSparql(endpoint, query, { retries: 1 })
    // ASK queries return { boolean: true/false }
    const hasDuplicates = (results as unknown as { boolean: boolean }).boolean === true

    return { hasDuplicates }
  } catch {
    return { hasDuplicates: false }
  }
}

/**
 * Detect available languages in endpoint (SKOS concepts only).
 * Note: Collections and ConceptSchemes are ignored, but concepts
 * typically have the same languages so this should be good enough.
 *
 * @param useGraphScope - If true, wraps query in GRAPH pattern to ensure
 *   concept and labels are in the same graph (use when duplicates exist)
 */
export async function detectLanguages(
  endpoint: SPARQLEndpoint,
  useGraphScope: boolean = false
): Promise<{ lang: string; count: number }[]> {
  // Core pattern for finding concept labels
  const corePattern = `
      ?concept a skos:Concept .
      {
        ?concept skos:prefLabel|skos:altLabel|skos:hiddenLabel|skos:definition|skos:scopeNote ?label .
      } UNION {
        ?concept skosxl:prefLabel/skosxl:literalForm ?label .
      } UNION {
        ?concept skosxl:altLabel/skosxl:literalForm ?label .
      }`

  // Wrap in GRAPH if needed (when duplicates exist across graphs)
  const whereClause = useGraphScope
    ? `GRAPH ?g {${corePattern}
    }`
    : corePattern

  const query = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    PREFIX skosxl: <http://www.w3.org/2008/05/skos-xl#>
    SELECT ?lang (COUNT(?label) AS ?count)
    WHERE {${whereClause}
      BIND(LANG(?label) AS ?lang)
      FILTER(?lang != "")
    }
    GROUP BY ?lang
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
  supportsNamedGraphs: boolean | null
  graphCount: number | null
  graphCountExact: boolean
  hasDuplicateTriples: boolean | null
  languages: { lang: string; count: number }[]
  analyzedAt: string
}> {
  // Step 1: Detect named graphs
  const graphResult = await detectGraphs(endpoint)

  // Step 2: Check for duplicates (only if multiple graphs exist)
  let hasDuplicateTriples: boolean | null = null
  if (graphResult.supportsNamedGraphs === true && graphResult.graphCount && graphResult.graphCount > 1) {
    const duplicateResult = await detectDuplicates(endpoint)
    hasDuplicateTriples = duplicateResult.hasDuplicates
  }

  // Step 3: Detect languages
  // Use GRAPH scope if duplicates exist to ensure concept+labels are in same graph
  const useGraphScope = hasDuplicateTriples === true
  const languages = await detectLanguages(endpoint, useGraphScope)

  return {
    supportsNamedGraphs: graphResult.supportsNamedGraphs,
    graphCount: graphResult.graphCount,
    graphCountExact: graphResult.graphCountExact,
    hasDuplicateTriples,
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
