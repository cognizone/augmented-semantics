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
import type { SPARQLEndpoint, AppError, ErrorCode, LabelPredicateCapabilities, LabelPredicatesByResourceType } from '../types'
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
  boolean?: boolean  // For ASK queries
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
PREFIX dc: <http://purl.org/dc/elements/1.1/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX cc: <http://creativecommons.org/ns#>
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
 * Detect if endpoint supports named graphs using a simple ASK query.
 * Returns true if any named graph exists, false if none, null if not supported.
 *
 * @see /spec/ae-skos/sko01-LanguageSelector.md
 */
export async function detectGraphs(
  endpoint: SPARQLEndpoint
): Promise<{
  supportsNamedGraphs: boolean | null
}> {
  const query = `ASK { GRAPH ?g { ?s ?p ?o } }`

  try {
    const results = await executeSparql(endpoint, query, { retries: 1 })
    // ASK queries return { boolean: true/false }
    const hasGraphs = results.boolean === true

    return { supportsNamedGraphs: hasGraphs }
  } catch {
    // GRAPH queries not supported by this endpoint
    return { supportsNamedGraphs: null }
  }
}

// Configuration constants for language detection optimization
export const LANGUAGE_DETECTION_BATCH_SIZE = 10
export const LANGUAGE_DETECTION_MAX_GRAPHS = 500

// Configuration constant for scheme detection
export const MAX_STORED_SCHEMES = 200

export interface SkosGraphResult {
  skosGraphCount: number | null
  skosGraphUris: string[] | null  // URIs when count <= maxGraphs, null otherwise
}

export interface DetectSkosGraphsOptions {
  maxGraphs?: number  // default: LANGUAGE_DETECTION_MAX_GRAPHS
}

/**
 * Detect graphs containing SKOS data.
 * Counts graphs that have either:
 * - A skos:ConceptScheme, OR
 * - A skos:Concept with a skos:prefLabel
 * Graphs with concepts lacking prefLabels are excluded.
 *
 * Returns both the count and the list of graph URIs (if count <= maxGraphs).
 * When there are too many graphs, skosGraphUris is null to avoid memory issues.
 */
export async function detectSkosGraphs(
  endpoint: SPARQLEndpoint,
  options: DetectSkosGraphsOptions = {}
): Promise<SkosGraphResult> {
  const maxGraphs = options.maxGraphs ?? LANGUAGE_DETECTION_MAX_GRAPHS

  // Query with LIMIT to get URIs (limit + 1 to detect if over threshold)
  const query = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    SELECT DISTINCT ?g
    WHERE {
      GRAPH ?g {
        { ?s a skos:ConceptScheme }
        UNION
        { ?s a skos:Concept . ?s skos:prefLabel ?label }
      }
    }
    LIMIT ${maxGraphs + 1}
  `

  try {
    const results = await executeSparql(endpoint, query, { retries: 1 })
    const graphUris = results.results.bindings
      .map(b => b.g?.value)
      .filter((uri): uri is string => !!uri)

    // If we got more than maxGraphs, return count only (too many to batch)
    if (graphUris.length > maxGraphs) {
      return {
        skosGraphCount: graphUris.length,  // At least this many (could be more)
        skosGraphUris: null
      }
    }

    return {
      skosGraphCount: graphUris.length,
      skosGraphUris: graphUris
    }
  } catch {
    return { skosGraphCount: null, skosGraphUris: null }
  }
}

export interface SchemeDetectionResult {
  schemeUris: string[]
  schemeCount: number
  schemesLimited: boolean
}

/**
 * Detect concept schemes in the endpoint.
 * Returns URIs only (no labels) for storage efficiency.
 *
 * Strategy:
 * 1. Count total schemes first
 * 2. If count <= limit, fetch all URIs
 * 3. If count > limit, fetch first N and mark as limited
 */
export async function detectConceptSchemes(
  endpoint: SPARQLEndpoint,
  maxSchemes: number = MAX_STORED_SCHEMES
): Promise<SchemeDetectionResult> {
  // First, count schemes
  const countQuery = withPrefixes(`
    SELECT (COUNT(DISTINCT ?scheme) AS ?count)
    WHERE {
      ?scheme a skos:ConceptScheme .
    }
  `)

  let totalCount = 0
  try {
    const countResult = await executeSparql(endpoint, countQuery, { retries: 1 })
    totalCount = parseInt(countResult.results.bindings[0]?.count?.value || '0', 10)
  } catch (e) {
    logger.warn('sparql', 'Failed to count schemes', { error: e })
    return { schemeUris: [], schemeCount: 0, schemesLimited: false }
  }

  // If no schemes, return early
  if (totalCount === 0) {
    return { schemeUris: [], schemeCount: 0, schemesLimited: false }
  }

  // Fetch URIs (limited to maxSchemes)
  const urisQuery = withPrefixes(`
    SELECT DISTINCT ?scheme
    WHERE {
      ?scheme a skos:ConceptScheme .
    }
    LIMIT ${maxSchemes}
  `)

  try {
    const urisResult = await executeSparql(endpoint, urisQuery, { retries: 1 })
    const schemeUris = urisResult.results.bindings
      .map(b => b.scheme?.value)
      .filter((uri): uri is string => !!uri)

    return {
      schemeUris,
      schemeCount: totalCount,
      schemesLimited: totalCount > maxSchemes
    }
  } catch (e) {
    logger.warn('sparql', 'Failed to fetch scheme URIs', { error: e })
    return { schemeUris: [], schemeCount: totalCount, schemesLimited: false }
  }
}

/**
 * Detect languages from specific graphs in batches.
 * Runs parallel queries per batch, then merges results.
 */
async function detectLanguagesForGraphs(
  endpoint: SPARQLEndpoint,
  graphUris: string[],
  batchSize: number = LANGUAGE_DETECTION_BATCH_SIZE
): Promise<{ lang: string; count: number }[]> {
  if (graphUris.length === 0) {
    return []
  }

  // Split into batches
  const batches: string[][] = []
  for (let i = 0; i < graphUris.length; i += batchSize) {
    batches.push(graphUris.slice(i, i + batchSize))
  }

  // Run batches sequentially to avoid overwhelming the endpoint
  const batchResults: { lang: string; count: number }[][] = []
  for (const batch of batches) {
    const valuesClause = batch.map(uri => `<${uri}>`).join(' ')
    const query = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    PREFIX skosxl: <http://www.w3.org/2008/05/skos-xl#>
    SELECT ?lang (COUNT(*) AS ?count)
    WHERE {
      VALUES ?g { ${valuesClause} }
      GRAPH ?g {
        { ?concept skos:prefLabel ?label }
        UNION
        { ?concept skosxl:prefLabel/skosxl:literalForm ?label }
        FILTER(LANG(?label) != "")
        BIND(LANG(?label) AS ?lang)
      }
    }
    GROUP BY ?lang
  `
    try {
      const results = await executeSparql(endpoint, query, { retries: 1 })
      batchResults.push(results.results.bindings.map(b => ({
        lang: b.lang?.value || '',
        count: parseInt(b.count?.value || '0', 10)
      })))
    } catch (e) {
      logger.warn('sparql', 'Batch language detection failed', { batch, error: e })
      batchResults.push([])
    }
  }

  // Merge results: aggregate counts per language
  const langMap = new Map<string, number>()
  for (const batch of batchResults) {
    for (const item of batch) {
      if (item.lang) {
        langMap.set(item.lang, (langMap.get(item.lang) || 0) + item.count)
      }
    }
  }

  // Convert to array and sort by count descending
  return Array.from(langMap.entries())
    .map(([lang, count]) => ({ lang, count }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Detect available languages in endpoint (SKOS concepts only).
 * Note: Collections and ConceptSchemes are ignored, but concepts
 * typically have the same languages so this should be good enough.
 *
 * @param useGraphScope - If true, wraps query in GRAPH pattern to ensure
 *   concept and labels are in the same graph (use when duplicates exist)
 * @param skosGraphUris - If provided, use batched detection on these specific graphs
 * @param batchSize - Number of graphs per batch (default: 10)
 */
export async function detectLanguages(
  endpoint: SPARQLEndpoint,
  useGraphScope: boolean = false,
  skosGraphUris?: string[] | null,
  batchSize: number = LANGUAGE_DETECTION_BATCH_SIZE
): Promise<{ lang: string; count: number }[]> {
  // Use batched detection if we have specific graph URIs
  if (skosGraphUris && skosGraphUris.length > 0) {
    return detectLanguagesForGraphs(endpoint, skosGraphUris, batchSize)
  }

  // Fall back to full query (original behavior)
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
 * Detect which label predicates exist for each resource type (Concept, ConceptScheme, Collection).
 * Uses EXISTS queries to efficiently check predicate availability.
 */
export async function detectLabelPredicates(
  endpoint: SPARQLEndpoint
): Promise<LabelPredicatesByResourceType> {
  const resourceTypes = [
    { key: 'concept', type: 'skos:Concept' },
    { key: 'scheme', type: 'skos:ConceptScheme' },
    { key: 'collection', type: 'skos:Collection' },
  ] as const

  const result: LabelPredicatesByResourceType = {}

  for (const { key, type } of resourceTypes) {
    const query = withPrefixes(`
      SELECT
        (EXISTS { ?r a ${type} . ?r skos:prefLabel ?x } AS ?hasPrefLabel)
        (EXISTS { ?r a ${type} . ?r skosxl:prefLabel/skosxl:literalForm ?x } AS ?hasXlPrefLabel)
        (EXISTS { ?r a ${type} . ?r dct:title ?x } AS ?hasDctTitle)
        (EXISTS { ?r a ${type} . ?r dc:title ?x } AS ?hasDcTitle)
        (EXISTS { ?r a ${type} . ?r rdfs:label ?x } AS ?hasRdfsLabel)
      WHERE {}
    `)

    try {
      const results = await executeSparql(endpoint, query, { retries: 1 })
      const binding = results.results.bindings[0]

      if (binding) {
        const parseExists = (value?: string): boolean => {
          if (!value) return false
          return value === 'true' || value === '1'
        }

        const capabilities: LabelPredicateCapabilities = {}

        if (parseExists(binding.hasPrefLabel?.value)) capabilities.prefLabel = true
        if (parseExists(binding.hasXlPrefLabel?.value)) capabilities.xlPrefLabel = true
        if (parseExists(binding.hasDctTitle?.value)) capabilities.dctTitle = true
        if (parseExists(binding.hasDcTitle?.value)) capabilities.dcTitle = true
        if (parseExists(binding.hasRdfsLabel?.value)) capabilities.rdfsLabel = true

        // Only add if at least one predicate exists
        if (Object.keys(capabilities).length > 0) {
          result[key] = capabilities
        }
      }
    } catch (e) {
      logger.warn('sparql', `Failed to detect label predicates for ${key}`, { error: e })
    }
  }

  return result
}

/**
 * Run full endpoint analysis
 */
export async function analyzeEndpoint(
  endpoint: SPARQLEndpoint
): Promise<{
  supportsNamedGraphs: boolean | null
  skosGraphCount: number | null
  skosGraphUris?: string[] | null
  languages: { lang: string; count: number }[]
  analyzedAt: string
  totalConcepts?: number
  relationships?: {
    hasInScheme: boolean
    hasTopConceptOf: boolean
    hasHasTopConcept: boolean
    hasBroader: boolean
    hasNarrower: boolean
    hasBroaderTransitive: boolean
    hasNarrowerTransitive: boolean
  }
  schemeUris?: string[]
  schemeCount?: number
  schemesLimited?: boolean
  labelPredicates?: LabelPredicatesByResourceType
}> {
  // Step 1: Detect named graphs support
  const graphResult = await detectGraphs(endpoint)

  // Step 2: Detect SKOS graphs (only if graphs supported)
  let skosGraphCount: number | null = null
  let skosGraphUris: string[] | null = null
  if (graphResult.supportsNamedGraphs === true) {
    const skosResult = await detectSkosGraphs(endpoint)
    skosGraphCount = skosResult.skosGraphCount
    skosGraphUris = skosResult.skosGraphUris
  }

  // Step 3: Detect languages
  // Use GRAPH scope if we found SKOS graphs to ensure concept+labels are in same graph
  const useGraphScope = skosGraphUris !== null && skosGraphUris.length > 0
  const languages = await detectLanguages(endpoint, useGraphScope, skosGraphUris)

  // Step 4: Count total concepts
  const countQuery = withPrefixes(`
    SELECT (COUNT(DISTINCT ?concept) AS ?count)
    WHERE {
      ?concept a skos:Concept .
    }
  `)
  let totalConcepts: number | undefined
  try {
    const countResult = await executeSparql(endpoint, countQuery, { retries: 1 })
    totalConcepts = parseInt(countResult.results.bindings[0]?.count?.value || '0', 10)
  } catch (e) {
    logger.warn('sparql', 'Failed to count concepts', { error: e })
  }

  // Step 5: Detect relationship availability
  // Use EXISTS at dataset level to check if ANY concept has these relationships
  const relQuery = withPrefixes(`
    SELECT
      (EXISTS { ?c a skos:Concept . ?c skos:inScheme ?x } AS ?hasInScheme)
      (EXISTS { ?c a skos:Concept . ?c skos:topConceptOf ?x } AS ?hasTopConceptOf)
      (EXISTS { ?s skos:hasTopConcept ?x } AS ?hasHasTopConcept)
      (EXISTS { ?c a skos:Concept . ?c skos:broader ?x } AS ?hasBroader)
      (EXISTS { ?c a skos:Concept . ?c skos:narrower ?x } AS ?hasNarrower)
      (EXISTS { ?c a skos:Concept . ?c skos:broaderTransitive ?x } AS ?hasBroaderTransitive)
      (EXISTS { ?c a skos:Concept . ?c skos:narrowerTransitive ?x } AS ?hasNarrowerTransitive)
    WHERE {}
  `)
  let relationships: {
    hasInScheme: boolean
    hasTopConceptOf: boolean
    hasHasTopConcept: boolean
    hasBroader: boolean
    hasNarrower: boolean
    hasBroaderTransitive: boolean
    hasNarrowerTransitive: boolean
  } | undefined
  try {
    const relResult = await executeSparql(endpoint, relQuery, { retries: 1 })
    const binding = relResult.results.bindings[0]
    if (binding) {
      // Helper to parse EXISTS results - some endpoints return "true"/"false", others return "1"/"0"
      const parseExists = (value?: string): boolean => {
        if (!value) return false
        return value === 'true' || value === '1'
      }

      relationships = {
        hasInScheme: parseExists(binding.hasInScheme?.value),
        hasTopConceptOf: parseExists(binding.hasTopConceptOf?.value),
        hasHasTopConcept: parseExists(binding.hasHasTopConcept?.value),
        hasBroader: parseExists(binding.hasBroader?.value),
        hasNarrower: parseExists(binding.hasNarrower?.value),
        hasBroaderTransitive: parseExists(binding.hasBroaderTransitive?.value),
        hasNarrowerTransitive: parseExists(binding.hasNarrowerTransitive?.value),
      }
    }
  } catch (e) {
    logger.warn('sparql', 'Failed to detect relationships', { error: e })
  }

  // Step 6: Detect concept schemes
  const schemeResult = await detectConceptSchemes(endpoint)

  // Step 7: Detect label predicates per resource type
  const labelPredicates = await detectLabelPredicates(endpoint)

  return {
    supportsNamedGraphs: graphResult.supportsNamedGraphs,
    skosGraphCount,
    skosGraphUris,
    languages,
    analyzedAt: new Date().toISOString(),
    totalConcepts,
    relationships,
    schemeUris: schemeResult.schemeUris,
    schemeCount: schemeResult.schemeCount,
    schemesLimited: schemeResult.schemesLimited,
    labelPredicates: Object.keys(labelPredicates).length > 0 ? labelPredicates : undefined,
  }
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
