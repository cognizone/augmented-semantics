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
import { sanitizeIri } from './rdfQueries'
import { sparqlFetch, setEndpointConcurrency } from './http'

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
  /** CONSTRUCT/DESCRIBE only: the raw N-Triples body as returned, for download.
   *  The full graph — not truncated to the rows the table renders. */
  raw?: string
}

// Request configuration
export interface SPARQLRequestConfig {
  timeout?: number
  signal?: AbortSignal
  retries?: number
  retryDelay?: number
  /** Queue this query in the BACKGROUND lane of the per-origin concurrency gate — it
   *  yields its slot to foreground queries (instance list, facet counts, open resource).
   *  For secondary, non-blocking work: type-tree discovery, orphan/composition counts,
   *  the slow facet "no value" scan. Default (undefined/false) = foreground. */
  background?: boolean
}

// Global timeout for SPARQL requests (1 minute)
const SPARQL_TIMEOUT_MS = 60000

// Dev-only: endpoints whose CORS allowlist rejects the localhost origin are
// routed through the Vite reverse proxy (see server.proxy in vite.config.ts —
// keep these paths in sync). Prod hits the real URL untouched.
const DEV_ENDPOINT_PROXY: Record<string, string> = {
  'https://rinf.data.era.europa.eu/api/v1/sparql/rinf': '/__proxy/rinf',
  'https://graph.tst.data.test-era.europa.eu/repositories/EVR-KG': '/__proxy/evr',
  'https://graph.dev.data.test-era.europa.eu/repositories/EVR-KG': '/__proxy/dev-evr',
  'https://graph.uat.data.test-era.europa.eu/repositories/OCR-KG': '/__proxy/uat-ocr',
  'https://graph.uat.data.test-era.europa.eu/repositories/ERADIS-KG': '/__proxy/uat-eradis',
  'https://graph.uat.data.test-era.europa.eu/repositories/VKM-KG': '/__proxy/uat-vkm',
}
const endpointUrl = (url: string): string =>
  import.meta.env.DEV ? (DEV_ENDPOINT_PROXY[url] ?? url) : url

/** sparqlFetch bound to an endpoint: resolves the (dev-proxied) URL AND registers the
 *  endpoint's concurrency cap under that same URL — so the per-endpoint gate keys match
 *  whether we're on the real origin (prod) or a dev proxy path. Every query path uses
 *  this, so registration can't be missed. */
function fetchForEndpoint(endpoint: SPARQLEndpoint, init: RequestInit, onAcquire?: () => void, background?: boolean): Promise<Response> {
  const url = endpointUrl(endpoint.url)
  if (endpoint.maxConcurrency != null) setEndpointConcurrency(url, endpoint.maxConcurrency)
  return sparqlFetch(url, init, onAcquire, background)
}

const DEFAULT_CONFIG: Required<Omit<SPARQLRequestConfig, 'signal'>> = {
  timeout: SPARQL_TIMEOUT_MS,
  retries: 3,
  retryDelay: 1000,
  background: false,
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

export function endpointHasCollections(endpoint?: SPARQLEndpoint | null): boolean {
  const analysis = endpoint?.analysis
  if (!analysis) return true
  const totalCollections = analysis.totalCollections
  const totalOrdered = analysis.totalOrderedCollections
  if (totalCollections === undefined && totalOrdered === undefined) return true
  return (totalCollections ?? 0) > 0 || (totalOrdered ?? 0) > 0
}

/** GraphDB: `&infer=<value>` for the POST body when the endpoint sets `infer`
 *  (false disables inferred triples); empty string when unset (send nothing). */
function inferParam(endpoint: SPARQLEndpoint): string {
  return endpoint.infer !== undefined ? `&infer=${endpoint.infer}` : ''
}

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
        // Must be a valid HTTP field-name token; otherwise the Headers/fetch
        // constructor throws a TypeError that the catch below misreads as a
        // retriable network error, burning retries and hiding the misconfig (R02).
        if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(headerName)) {
          throw createError(
            'AUTH_FAILED',
            'Invalid API key header name',
            `"${headerName}" is not a valid HTTP header name`
          )
        }
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
 * Parse SPARQL XML results to JSON format.
 * Some endpoints (e.g., Getty) return XML despite claiming JSON content-type.
 */
function parseSparqlXml(xmlText: string): SPARQLResults | null {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, 'text/xml')

    // Check for parse errors
    const parseError = doc.querySelector('parsererror')
    if (parseError) {
      return null
    }

    const sparqlNs = 'http://www.w3.org/2005/sparql-results#'

    // Verify this is a SPARQL results document (must have <sparql> root element)
    const sparqlRoot = doc.getElementsByTagNameNS(sparqlNs, 'sparql')[0]
    if (!sparqlRoot) {
      return null
    }

    // Handle ASK query results (boolean)
    const booleanEl = doc.getElementsByTagNameNS(sparqlNs, 'boolean')[0]
    if (booleanEl) {
      return {
        head: { vars: [] },
        results: { bindings: [] },
        boolean: booleanEl.textContent?.trim().toLowerCase() === 'true'
      }
    }

    // Handle SELECT query results
    const vars: string[] = []
    const variableEls = doc.getElementsByTagNameNS(sparqlNs, 'variable')
    for (let i = 0; i < variableEls.length; i++) {
      const varEl = variableEls[i]
      if (!varEl) continue
      const name = varEl.getAttribute('name')
      if (name) vars.push(name)
    }

    const bindings: SPARQLBinding[] = []
    const resultEls = doc.getElementsByTagNameNS(sparqlNs, 'result')
    for (let i = 0; i < resultEls.length; i++) {
      const resultEl = resultEls[i]
      if (!resultEl) continue
      const binding: SPARQLBinding = {}
      const bindingEls = resultEl.getElementsByTagNameNS(sparqlNs, 'binding')

      for (let j = 0; j < bindingEls.length; j++) {
        const bindingEl = bindingEls[j]
        if (!bindingEl) continue
        const varName = bindingEl.getAttribute('name')
        if (!varName) continue

        // Check for uri, literal, or bnode
        const uriEl = bindingEl.getElementsByTagNameNS(sparqlNs, 'uri')[0]
        const literalEl = bindingEl.getElementsByTagNameNS(sparqlNs, 'literal')[0]
        const bnodeEl = bindingEl.getElementsByTagNameNS(sparqlNs, 'bnode')[0]

        if (uriEl) {
          binding[varName] = {
            type: 'uri',
            value: uriEl.textContent || ''
          }
        } else if (literalEl) {
          const value: SPARQLBinding[string] = {
            type: 'literal',
            value: literalEl.textContent || ''
          }
          const lang = literalEl.getAttribute('xml:lang')
          const datatype = literalEl.getAttribute('datatype')
          if (lang) value['xml:lang'] = lang
          if (datatype) value.datatype = datatype
          binding[varName] = value
        } else if (bnodeEl) {
          binding[varName] = {
            type: 'bnode',
            value: bnodeEl.textContent || ''
          }
        }
      }

      bindings.push(binding)
    }

    return {
      head: { vars },
      results: { bindings }
    }
  } catch {
    return null
  }
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

    // Create abort controller for timeout. The timer is armed via onAcquire — only
    // once the concurrency gate grants a slot and the request actually goes to the
    // wire — so time spent WAITING IN THE QUEUE never counts against the timeout.
    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    // Merge with external signal if provided
    if (config.signal) {
      config.signal.addEventListener('abort', () => controller.abort())
    }

    try {
      const response = await fetchForEndpoint(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/sparql-results+json',
          ...getAuthHeaders(endpoint),
        },
        body: `query=${encodeURIComponent(query)}${inferParam(endpoint)}`,
        signal: controller.signal,
        // Don't follow cross-origin redirects: fetch would re-send our custom
        // auth headers (e.g. X-API-Key) to the redirect target (R03).
        redirect: 'error',
      }, () => { timeoutId = setTimeout(() => controller.abort(), timeout) }, config.background)

      clearTimeout(timeoutId)

      if (!response.ok) {
        const { code, message } = mapHttpError(response.status, response.statusText)
        // The body carries the endpoint's real diagnostic — e.g. Virtuoso's
        // "37000 Error SP030: SPARQL compiler … syntax error at '…'" — which the
        // generic statusText ("Bad Request") drops. Surface it so a broken query
        // shows WHAT's wrong, not just "HTTP 400".
        const body = await response.text().catch(() => '')
        const detail = body.trim().slice(0, 600) || undefined
        logger.warn('SPARQL', `HTTP ${response.status}: ${message}`, {
          status: response.status,
          statusText: response.statusText,
          detail,
        })

        // Only TRANSIENT failures are worth retrying. A 4xx (except 408 timeout /
        // 429 rate-limit) means the REQUEST itself is wrong — a malformed query, a
        // bad IRI, a missing graph — so an identical retry fails identically. Fail
        // fast instead of burning ~7s of exponential backoff. 5xx / 408 / 429 (and
        // network/timeout errors in the catch below) stay retriable. Auth is fatal.
        const retriable = response.status >= 500 || response.status === 408 || response.status === 429
        if (!retriable || code === 'AUTH_REQUIRED' || code === 'AUTH_FAILED') {
          throw createError(code, message, detail)
        }

        lastError = createError(code, message, detail)
        continue // Retry (transient)
      }

      const contentType = response.headers.get('content-type') || ''
      const responseText = await response.text()

      // Try JSON first (most endpoints return JSON)
      let data: SPARQLResults | null = null

      if (contentType.includes('json')) {
        try {
          data = JSON.parse(responseText)
        } catch {
          // JSON parse failed - endpoint may return XML despite claiming JSON (e.g., Getty)
          logger.debug('SPARQL', 'JSON parse failed despite json content-type, trying XML fallback')
        }
      }

      // Try XML fallback (for endpoints that return XML or claim JSON but send XML)
      if (!data) {
        data = parseSparqlXml(responseText)
        if (data) {
          logger.debug('SPARQL', 'Parsed response as XML (fallback)')
        }
      }

      if (!data) {
        // An HTML body on a 200 is almost always a proxy/WAF interstitial ("URL
        // blocked"), not the SPARQL endpoint — flag it so it isn't mistaken for an
        // empty result (which silently surfaces as dangling links / missing labels).
        const looksHtml = /^\s*<(?:!doctype|html)/i.test(responseText)
        if (looksHtml) {
          // WAF blocks often have a rate/transient component, so retry with the
          // loop's backoff before giving up. (Content-based blocks just exhaust
          // retries and surface the error — no worse than failing immediately.)
          logger.warn('SPARQL', 'Blocked by a proxy/WAF (HTML response, not SPARQL) — retrying', { contentType, sample: responseText.slice(0, 160) })
          lastError = createError('INVALID_RESPONSE', 'Request blocked by a proxy/WAF', `Non-SPARQL HTML response. Content-Type: ${contentType}`)
          continue
        }
        logger.error('SPARQL', 'Invalid response format', { contentType, sample: responseText.slice(0, 200) })
        throw createError(
          'INVALID_RESPONSE',
          'Unexpected response format',
          `Could not parse response as JSON or XML. Content-Type: ${contentType}`
        )
      }

      // A 200 with a JSON body that parsed but isn't a SPARQL result set (e.g.
      // an endpoint error object `{"error":"…"}`) would otherwise slip through
      // and crash callers on `.results.bindings`. Require SELECT or ASK shape.
      if (!Array.isArray(data.results?.bindings) && typeof data.boolean !== 'boolean') {
        logger.error('SPARQL', 'Response is not a SPARQL result set', { contentType })
        throw createError(
          'INVALID_RESPONSE',
          'Unexpected response format',
          `Response parsed but is not a SPARQL result set. Content-Type: ${contentType}`
        )
      }

      const resultCount = data?.results?.bindings?.length ?? 0
      logger.info('SPARQL', `Query successful: ${resultCount} results`)
      return data
    } catch (error) {
      clearTimeout(timeoutId)

      // Check AbortError FIRST: a DOMException carries a numeric `.code`, so the
      // generic `'code' in error` (AppError) test below would otherwise swallow a
      // timeout and mislabel it "Query failed … signal aborted". Fail fast — a query
      // that already burned the full timeout won't beat it on an identical retry.
      if (error instanceof DOMException && error.name === 'AbortError') {
        // Caller-cancelled (superseded load, navigation) is NOT a timeout — it's the
        // system working as intended; log quietly and don't alarm.
        if (config.signal?.aborted) {
          logger.debug('SPARQL', 'Request cancelled by caller')
          throw createError('UNKNOWN', 'Cancelled')
        }
        logger.warn('SPARQL', 'Request timed out')
        throw createError('TIMEOUT', 'Request timed out')
      }

      if (error && typeof error === 'object' && 'code' in error) {
        // Already an AppError
        logger.error('SPARQL', 'Query failed', error)
        throw error
      }

      if (error instanceof TypeError) {
        // fetch rejected with TypeError = no HTTP response reached us. Browsers
        // strip "cors" from the message for security, so we can't tell CORS from
        // offline/DNS by string — but for a browser-only SPARQL tool a reachable
        // endpoint that blocks the origin (CORS) is by far the common cause.
        // Don't retry: a CORS block fails identically, so retrying just delays
        // the answer by the full backoff (~7s). (redirect:'error' also lands here.)
        logger.error('SPARQL', 'Network error (likely CORS)', { message: error.message })
        throw createError(
          'CORS_BLOCKED',
          'Endpoint unreachable or blocks browser access (CORS)',
          `The endpoint must send CORS headers allowing this origin, or be reachable. (${error.message})`
        )
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

/**
 * Probe whether the default (no-GRAPH) graph is a redundant MERGE of the named
 * graphs — so queries can drop the default branch (useDefault=false) instead of
 * the `{GRAPH …} UNION {…}` safe superset. Only meaningful when named graphs
 * exist. Samples up to `sample` default triples and asks whether ANY is absent
 * from every named graph:
 *   - false (none unique / default empty) → 'merged' → skip the default branch
 *   - true  (some unique)                 → 'own'    → must query the default too
 *
 * Returns undefined on error/timeout so the caller keeps the safe superset.
 * ponytail: it's a SAMPLE — a default-only triple rarer than 1-in-`sample`
 * could be missed and misread as 'merged' (dropping that data). Deployers with
 * genuinely-own default data should declare `graph.defaultView` in config.
 */
export async function detectDefaultView(
  endpoint: SPARQLEndpoint,
  sample = 20000
): Promise<'merged' | 'own' | undefined> {
  const n = Math.max(1, Math.floor(sample))
  const query = `ASK { { SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT ${n} } FILTER NOT EXISTS { GRAPH ?g { ?s ?p ?o } } }`
  try {
    const results = await executeSparql(endpoint, query, { retries: 1 })
    if (typeof results.boolean !== 'boolean') return undefined
    return results.boolean ? 'own' : 'merged'
  } catch {
    return undefined
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

/** Parse an EXISTS-probe binding value — some endpoints return "true"/"false", others "1"/"0". */
function parseExists(value?: string): boolean {
  if (!value) return false
  return value === 'true' || value === '1'
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

  // Sanitize before interpolation — a `>`-bearing IRI would otherwise close the
  // <...> early and inject live CONSTRUCT/WHERE syntax (encodeURIComponent on the
  // body does NOT neutralize metachars inside the SPARQL string). Throws on unsafe. (R30)
  const iri = sanitizeIri(conceptUri)
  const query = withPrefixes(`
    CONSTRUCT { <${iri}> ?p ?o }
    WHERE { <${iri}> ?p ?o }
  `)

  logger.debug('SPARQL', `Fetching raw RDF for ${conceptUri}`, { format })

  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    const response = await fetchForEndpoint(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: RDF_ACCEPT_HEADERS[format],
        ...getAuthHeaders(endpoint),
      },
      body: `query=${encodeURIComponent(query)}${inferParam(endpoint)}`,
      signal: controller.signal,
      redirect: 'error', // don't leak auth headers to a redirect target (R03)
    }, () => { timeoutId = setTimeout(() => controller.abort(), timeout) }) // arm only once the slot is granted

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

// ── CONSTRUCT / DESCRIBE (graph results) ────────────────────────────────────
// The read-only panel runs these too. Endpoints return an RDF graph, not a
// bindings table, so executeSparql (SPARQL-results JSON only) can't consume them.
// We request N-Triples — the one RDF syntax that parses line-by-line without a
// parser library — and reshape it into subject/predicate/object bindings the
// existing results table already renders (clickable URIs, lang/datatype tags).

/** Decode N-Triples string-escape sequences (\", \\, \n, \t, \uXXXX, \UXXXXXXXX, …). */
function unescapeNt(s: string): string {
  return s.replace(/\\(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|[tbnrf"'\\])/g, (_m, esc: string) => {
    const c = esc[0]!
    if (c === 'u' || c === 'U') return String.fromCodePoint(parseInt(esc.slice(1), 16))
    return ({ t: '\t', b: '\b', n: '\n', r: '\r', f: '\f', '"': '"', "'": "'", '\\': '\\' } as Record<string, string>)[c] ?? esc
  })
}

/** Parse one N-Triples term: <IRI>, _:bnode, or "literal"(@lang|^^<datatype>). */
function parseNtTerm(tok: string): SPARQLBinding[string] | null {
  if (tok.startsWith('<') && tok.endsWith('>')) {
    return { type: 'uri', value: unescapeNt(tok.slice(1, -1)) }
  }
  if (tok.startsWith('_:')) {
    return { type: 'bnode', value: tok }
  }
  const lit = /^"((?:\\.|[^"\\])*)"(?:@([A-Za-z][A-Za-z0-9-]*)|\^\^<([^>]*)>)?$/.exec(tok)
  if (lit) {
    const value: SPARQLBinding[string] = { type: 'literal', value: unescapeNt(lit[1]!) }
    if (lit[2]) value['xml:lang'] = lit[2]
    if (lit[3]) value.datatype = unescapeNt(lit[3])
    return value
  }
  return null
}

// subject (IRI|bnode)  predicate (IRI)  object (IRI|bnode|literal)  '.'  — the
// object is lazy so an interior '.'/quote survives; only the trailing ' .' ends it.
const NT_LINE = /^(<[^>]*>|_:\S+)\s+(<[^>]*>)\s+(.+?)\s*\.\s*$/

/** Parse an N-Triples document into subject/predicate/object bindings. */
export function parseNTriples(text: string): SPARQLBinding[] {
  const out: SPARQLBinding[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = NT_LINE.exec(line)
    if (!m) continue
    const subject = parseNtTerm(m[1]!)
    const predicate = parseNtTerm(m[2]!)
    const object = parseNtTerm(m[3]!)
    if (subject && predicate && object) out.push({ subject, predicate, object })
  }
  return out
}

/**
 * Execute a CONSTRUCT/DESCRIBE query and return its graph as subject/predicate/
 * object bindings (via N-Triples). Separate from executeSparql because that path
 * only consumes SPARQL-results JSON (SELECT/ASK) and rejects a graph body.
 *
 * ponytail: N-Triples only, single attempt (no retry — re-run to retry, like
 * fetchRawRdf). An endpoint that ignores the Accept header and returns
 * Turtle/RDF-XML surfaces as INVALID_RESPONSE rather than being mis-parsed.
 */
export async function executeConstruct(
  endpoint: SPARQLEndpoint,
  query: string,
  config: SPARQLRequestConfig = {}
): Promise<SPARQLResults> {
  const { timeout } = { ...DEFAULT_CONFIG, ...config }
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  if (config.signal) config.signal.addEventListener('abort', () => controller.abort())

  try {
    const response = await fetchForEndpoint(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/n-triples, text/plain;q=0.9',
        ...getAuthHeaders(endpoint),
      },
      body: `query=${encodeURIComponent(query)}${inferParam(endpoint)}`,
      signal: controller.signal,
      redirect: 'error', // don't leak auth headers to a redirect target (R03)
    }, () => { timeoutId = setTimeout(() => controller.abort(), timeout) }) // arm only once the slot is granted

    clearTimeout(timeoutId)

    if (!response.ok) {
      const { code, message } = mapHttpError(response.status, response.statusText)
      const body = await response.text().catch(() => '')
      const detail = body.trim().slice(0, 600) || undefined
      logger.warn('SPARQL', `Graph query HTTP ${response.status}: ${message}`, { detail })
      throw createError(code, message, detail)
    }

    const text = await response.text()
    const bindings = parseNTriples(text)

    // Nothing parsed but the body clearly carries triples in another syntax → the
    // endpoint ignored our N-Triples Accept. Say so instead of a bare "No results".
    if (bindings.length === 0 && /@prefix|@base|<\?xml|<rdf:RDF/i.test(text)) {
      throw createError(
        'INVALID_RESPONSE',
        'Unsupported RDF serialization',
        'The endpoint returned the graph in a format this panel can’t display (expected N-Triples).'
      )
    }

    logger.info('SPARQL', `Graph query parsed ${bindings.length} triples`)
    return { head: { vars: ['subject', 'predicate', 'object'] }, results: { bindings }, raw: text }
  } catch (error) {
    clearTimeout(timeoutId)

    if (error && typeof error === 'object' && 'code' in error) throw error

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw createError('TIMEOUT', 'Request timed out')
    }

    if (error instanceof TypeError) {
      throw createError(
        'CORS_BLOCKED',
        'Endpoint unreachable or blocks browser access (CORS)',
        String((error as Error).message)
      )
    }

    throw createError('UNKNOWN', 'Failed to run graph query', String(error))
  }
}
