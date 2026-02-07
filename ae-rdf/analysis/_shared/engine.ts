/**
 * Shared analysis helpers for ae-rdf endpoint analysis.
 *
 * @see /spec/ae-rdf/rdf00-EndpointAnalysis.md
 * @see /spec/ae-rdf/rdf01-QueryLibrary.md
 */

export interface EndpointConfig {
  name: string
  url: string
  description?: string
  defaultGraph?: string
  graphs?: string[]
  timeoutMs?: number
  pageSize?: number
  sampling?: 'none' | 'light' | 'standard' | 'deep'
  prefixes?: Record<string, string>
}

export interface CurationRules {
  typeRules?: Record<string, unknown>
  propertyRules?: Record<string, unknown>
  suppressedIssues?: string[]
  thresholds?: Record<string, number>
}

export interface CapabilityInfo {
  jsonResults: boolean
  xmlResults: boolean
  cors: boolean | null
  namedGraphs: boolean | null
  aggregates: boolean | null
  subqueries: boolean | null
  values: boolean | null
  bind: boolean | null
  propertyPaths: boolean | null
  orderBy: boolean | null
  limitOffset: boolean | null
  serviceDescription: boolean | null
}

export type AnalysisResult = Record<string, unknown>

interface SectionStatus {
  status: 'ok' | 'partial' | 'failed' | 'unknown'
  strategy: 'optimistic' | 'safe' | 'mixed'
  durationMs: number
  notes?: string
}

interface FailureRecord {
  section: string
  queryId: string
  reason: string
  durationMs: number
}

interface SparqlFetchResult {
  text: string
  contentType: string
}

const DEFAULT_TIMEOUT_MS = 20000
const DEFAULT_PAGE_SIZE = 200
const TYPE_LIMIT = 500
const PREDICATE_LIMIT = 500
const MATRIX_PAIR_LIMIT = 2000
const MATRIX_TYPE_LIMIT = 100
const MATRIX_PROPERTY_LIMIT = 200
const PROBE_IRI = '<urn:ae-rdf-probe>'
const PROBE_IRI_ALT = '<urn:ae-rdf-probe-alt>'

// =============================================================================
// SPARQL XML Parsing (ported from ae-skos)
// =============================================================================

/**
 * Parse SPARQL XML results into JSON format.
 * Handles both ASK (boolean) and SELECT (bindings) results.
 */
function parseSparqlXml(xml: string): any {
  const boolMatch = xml.match(/<boolean>(\w+)<\/boolean>/)
  if (boolMatch) {
    return { boolean: boolMatch[1] === 'true' }
  }

  const bindings: any[] = []
  const resultRegex = /<result>([\s\S]*?)<\/result>/g
  let resultMatch

  while ((resultMatch = resultRegex.exec(xml)) !== null) {
    const resultXml = resultMatch[1]
    const binding: any = {}

    const bindingRegex = /<binding name="(\w+)">([\s\S]*?)<\/binding>/g
    let bindingMatch

    while ((bindingMatch = bindingRegex.exec(resultXml)) !== null) {
      const name = bindingMatch[1]
      const valueXml = bindingMatch[2]

      const uriMatch = valueXml.match(/<uri>([^<]+)<\/uri>/)
      const literalMatch = valueXml.match(/<literal[^>]*>([^<]*)<\/literal>/)
      const bnodeMatch = valueXml.match(/<bnode>([^<]+)<\/bnode>/)

      if (uriMatch) {
        binding[name] = { type: 'uri', value: uriMatch[1] }
      } else if (literalMatch) {
        const langMatch = valueXml.match(/xml:lang="([^"]+)"/)
        const dtMatch = valueXml.match(/datatype="([^"]+)"/)
        binding[name] = {
          type: 'literal',
          value: literalMatch[1],
          ...(langMatch && { 'xml:lang': langMatch[1] }),
          ...(dtMatch && { datatype: dtMatch[1] }),
        }
      } else if (bnodeMatch) {
        binding[name] = { type: 'bnode', value: bnodeMatch[1] }
      }
    }

    bindings.push(binding)
  }

  return { results: { bindings } }
}

// =============================================================================
// Fetch helpers
// =============================================================================

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchSparql(url: string, query: string, accept: string, timeoutMs: number): Promise<SparqlFetchResult> {
  const trimmedQuery = query.trim()
  const postBody = `query=${encodeURIComponent(trimmedQuery)}&format=json`

  let response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': accept,
      },
      body: postBody,
    },
    timeoutMs,
  )

  let contentType = response.headers.get('Content-Type') || ''

  const needsGet = !response.ok || contentType.includes('text/html')
  if (needsGet) {
    const getUrl = `${url}?query=${encodeURIComponent(trimmedQuery)}&format=json`
    response = await fetchWithTimeout(
      getUrl,
      {
        method: 'GET',
        headers: { 'Accept': accept },
      },
      timeoutMs,
    )
    contentType = response.headers.get('Content-Type') || ''
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  const text = await response.text()
  return { text, contentType }
}

function parseSparqlText(text: string, contentType: string): { data: any; format: 'json' | 'xml' } {
  const trimmed = text.trimStart()
  const looksXml = contentType.includes('xml') || trimmed.startsWith('<?xml') || trimmed.startsWith('<sparql')

  if (looksXml) {
    return { data: parseSparqlXml(text), format: 'xml' }
  }

  try {
    return { data: JSON.parse(text), format: 'json' }
  } catch {
    if (trimmed.startsWith('<?xml') || trimmed.startsWith('<sparql')) {
      return { data: parseSparqlXml(text), format: 'xml' }
    }
    throw new Error('Unsupported SPARQL results format')
  }
}

function getBindings(data: unknown): any[] {
  return (data as any)?.results?.bindings ?? []
}

function extractValue(row: any, key: string): string | undefined {
  const value = row?.[key]?.value
  return typeof value === 'string' ? value : undefined
}

function extractNumber(row: any, key: string): number | undefined {
  const value = row?.[key]?.value
  if (value === undefined || value === null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

// =============================================================================
// Public API
// =============================================================================

export async function executeSparql(url: string, query: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  const accept = 'application/sparql-results+json, application/sparql-results+xml;q=0.9'
  const { text, contentType } = await fetchSparql(url, query, accept, timeoutMs)
  return parseSparqlText(text, contentType).data
}

export async function detectResultSupport(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{
  jsonResults: boolean
  xmlResults: boolean
}> {
  const query = 'ASK { ?s ?p ?o }'

  let jsonResults = false
  let xmlResults = false

  const jsonAccept = 'application/sparql-results+json'
  const xmlAccept = 'application/sparql-results+xml'

  try {
    const { text, contentType } = await fetchSparql(url, query, jsonAccept, timeoutMs)
    const parsed = parseSparqlText(text, contentType)
    if (parsed.format === 'json') {
      jsonResults = true
    } else {
      xmlResults = true
    }
  } catch {
    // ignore and continue
  }

  if (!xmlResults) {
    try {
      const { text, contentType } = await fetchSparql(url, query, xmlAccept, timeoutMs)
      const parsed = parseSparqlText(text, contentType)
      if (parsed.format === 'xml') {
        xmlResults = true
      } else {
        jsonResults = true
      }
    } catch {
      // ignore and continue
    }
  }

  return { jsonResults, xmlResults }
}

async function probeSupport(
  url: string,
  queryId: string,
  query: string,
  failures: FailureRecord[],
  timeoutMs: number,
): Promise<boolean | null> {
  const startedAt = Date.now()
  try {
    await executeSparql(url, query, timeoutMs)
    return true
  } catch (err) {
    failures.push({
      section: 'capabilities',
      queryId,
      reason: err instanceof Error ? err.message : 'Unknown error',
      durationMs: Date.now() - startedAt,
    })
    return null
  }
}

async function probeAskValue(
  url: string,
  queryId: string,
  query: string,
  failures: FailureRecord[],
  timeoutMs: number,
): Promise<boolean | null> {
  const startedAt = Date.now()
  try {
    const data = await executeSparql(url, query, timeoutMs)
    if (typeof (data as any)?.boolean === 'boolean') {
      return (data as any).boolean
    }
    return null
  } catch (err) {
    failures.push({
      section: 'capabilities',
      queryId,
      reason: err instanceof Error ? err.message : 'Unknown error',
      durationMs: Date.now() - startedAt,
    })
    return null
  }
}

const CORS_TEST_ORIGIN = 'https://example.com'

export async function detectCors(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
  const query = 'ASK { ?s ?p ?o }'
  const postBody = `query=${encodeURIComponent(query)}&format=json`

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/sparql-results+json',
          'Origin': CORS_TEST_ORIGIN,
        },
        body: postBody,
      },
      timeoutMs,
    )

    const allowOrigin = response.headers.get('access-control-allow-origin')
    if (!allowOrigin) {
      return false
    }

    if (allowOrigin === '*') {
      const allowMethods = response.headers.get('access-control-allow-methods')
      return allowMethods ? allowMethods.toUpperCase().includes('POST') : true
    }

    const origins = allowOrigin.split(',').map(o => o.trim())
    if (!origins.includes(CORS_TEST_ORIGIN)) {
      return false
    }

    const allowMethods = response.headers.get('access-control-allow-methods')
    return allowMethods ? allowMethods.toUpperCase().includes('POST') : true
  } catch {
    return false
  }
}

export async function analyzeEndpoint(
  config: EndpointConfig,
  _rules?: CurationRules,
  logger: (message: string) => void = () => {},
): Promise<AnalysisResult> {
  const startedAt = Date.now()
  const failures: FailureRecord[] = []

  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  logger(`Analyzing ${config.name}...`)

  let jsonResults = false
  let xmlResults = false
  try {
    const support = await detectResultSupport(config.url, timeoutMs)
    jsonResults = support.jsonResults
    xmlResults = support.xmlResults
  } catch (err) {
    failures.push({
      section: 'capabilities',
      queryId: 'result-format-probe',
      reason: err instanceof Error ? err.message : 'Unknown error',
      durationMs: Date.now() - startedAt,
    })
  }
  if (!jsonResults && !xmlResults) {
    failures.push({
      section: 'capabilities',
      queryId: 'result-format-unsupported',
      reason: 'Endpoint does not return JSON or XML SPARQL results',
      durationMs: Date.now() - startedAt,
    })
  }

  let cors: boolean | null = null
  try {
    cors = await detectCors(config.url, timeoutMs)
  } catch {
    cors = null
  }

  const capabilities: CapabilityInfo = {
    jsonResults,
    xmlResults,
    cors,
    namedGraphs: null,
    aggregates: null,
    subqueries: null,
    values: null,
    bind: null,
    propertyPaths: null,
    orderBy: null,
    limitOffset: null,
    serviceDescription: null,
  }

  const probeTimeoutMs = Math.min(timeoutMs, DEFAULT_TIMEOUT_MS)

  capabilities.namedGraphs = await probeSupport(
    config.url,
    'probe-named-graphs',
    'ASK { GRAPH ?g { ?s ?p ?o } }',
    failures,
    probeTimeoutMs,
  )

  capabilities.aggregates = await probeSupport(
    config.url,
    'probe-aggregates',
    `SELECT (COUNT(*) AS ?count) WHERE { VALUES ?s { ${PROBE_IRI} } ?s ?p ?o }`,
    failures,
    probeTimeoutMs,
  )

  capabilities.subqueries = await probeSupport(
    config.url,
    'probe-subqueries',
    `SELECT ?s WHERE { { SELECT ?s WHERE { VALUES ?s { ${PROBE_IRI} } ?s ?p ?o } LIMIT 1 } } LIMIT 1`,
    failures,
    probeTimeoutMs,
  )

  capabilities.values = await probeSupport(
    config.url,
    'probe-values',
    `SELECT ?s WHERE { VALUES ?s { ${PROBE_IRI} } }`,
    failures,
    probeTimeoutMs,
  )

  capabilities.bind = await probeSupport(
    config.url,
    'probe-bind',
    'SELECT ?o WHERE { BIND(1 AS ?o) }',
    failures,
    probeTimeoutMs,
  )

  capabilities.propertyPaths = await probeSupport(
    config.url,
    'probe-property-paths',
    `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\nASK { VALUES ?s { ${PROBE_IRI} } ?s (rdf:type|rdf:value) ?o }`,
    failures,
    probeTimeoutMs,
  )

  capabilities.orderBy = await probeSupport(
    config.url,
    'probe-order-by',
    `SELECT ?s WHERE { VALUES ?s { ${PROBE_IRI} ${PROBE_IRI_ALT} } } ORDER BY ?s LIMIT 1`,
    failures,
    probeTimeoutMs,
  )

  capabilities.limitOffset = await probeSupport(
    config.url,
    'probe-limit-offset',
    `SELECT ?s WHERE { VALUES ?s { ${PROBE_IRI} ${PROBE_IRI_ALT} } } LIMIT 1 OFFSET 1`,
    failures,
    probeTimeoutMs,
  )

  capabilities.serviceDescription = await probeAskValue(
    config.url,
    'probe-service-description',
    'PREFIX sd: <http://www.w3.org/ns/sparql-service-description#> ASK { ?s a sd:Service }',
    failures,
    probeTimeoutMs,
  )

  const unknownSection: SectionStatus = {
    status: 'unknown',
    strategy: 'safe',
    durationMs: 0,
  }

  const sections: Record<string, SectionStatus> = {
    graphs: { ...unknownSection },
    types: { ...unknownSection },
    properties: { ...unknownSection },
    typePropertyMatrix: { ...unknownSection },
    cardinality: { ...unknownSection },
    datatypes: { ...unknownSection },
    languages: { ...unknownSection },
    valueDistributions: { ...unknownSection },
    suspectValues: { ...unknownSection },
  }

  logger(`Capabilities: JSON=${jsonResults ? 'yes' : 'no'} XML=${xmlResults ? 'yes' : 'no'} CORS=${cors ? 'yes' : 'no'}`)

  const graphsSectionStart = Date.now()
  let graphsData: { items: Array<{ graph: string; triples?: number }>; limited: boolean } | null = null

  if (capabilities.namedGraphs) {
    const graphLimit = 200
    const optimisticQuery = `SELECT ?g (COUNT(*) AS ?triples) WHERE { GRAPH ?g { ?s ?p ?o } } GROUP BY ?g ORDER BY DESC(?triples) LIMIT ${graphLimit}`
    const listQuery = `SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } } LIMIT ${graphLimit}`

    let items: Array<{ graph: string; triples?: number }> = []
    let limited = false
    let usedStrategy: SectionStatus['strategy'] = 'safe'

    if (capabilities.aggregates) {
      try {
        const data = await executeSparql(config.url, optimisticQuery, timeoutMs)
        const bindings = (data as any)?.results?.bindings ?? []
        items = bindings
          .map((row: any) => ({
            graph: row.g?.value as string,
            triples: row.triples?.value ? Number(row.triples.value) : undefined,
          }))
          .filter((row: any) => typeof row.graph === 'string')
        limited = items.length >= graphLimit
        usedStrategy = 'optimistic'
      } catch (err) {
        failures.push({
          section: 'graphs',
          queryId: 'graphs-optimistic',
          reason: err instanceof Error ? err.message : 'Unknown error',
          durationMs: Date.now() - graphsSectionStart,
        })
      }
    }

    if (items.length === 0) {
      try {
        const data = await executeSparql(config.url, listQuery, timeoutMs)
        const bindings = (data as any)?.results?.bindings ?? []
        items = bindings
          .map((row: any) => ({ graph: row.g?.value as string }))
          .filter((row: any) => typeof row.graph === 'string')
        limited = items.length >= graphLimit
        usedStrategy = capabilities.aggregates ? 'mixed' : 'safe'
      } catch (err) {
        failures.push({
          section: 'graphs',
          queryId: 'graphs-list',
          reason: err instanceof Error ? err.message : 'Unknown error',
          durationMs: Date.now() - graphsSectionStart,
        })
      }
    }

    if (items.length > 0) {
      graphsData = { items, limited }
      sections.graphs = {
        status: limited ? 'partial' : 'ok',
        strategy: usedStrategy,
        durationMs: Date.now() - graphsSectionStart,
        ...(limited ? { notes: `Limited to ${graphLimit} graphs` } : {}),
      }
    } else {
      sections.graphs = {
        status: 'unknown',
        strategy: 'safe',
        durationMs: Date.now() - graphsSectionStart,
        notes: 'No graphs detected or graph queries failed',
      }
    }
  } else {
    sections.graphs = {
      status: 'unknown',
      strategy: 'safe',
      durationMs: Date.now() - graphsSectionStart,
      notes: 'Named graphs not supported',
    }
  }

  if (graphsData) {
    logger(`Graphs: ${graphsData.items.length}${graphsData.limited ? '+' : ''}`)
  } else {
    logger('Graphs: unknown')
  }

  // =============================================================================
  // Type Inventory
  // =============================================================================

  const typesSectionStart = Date.now()
  let typesData: { items: Array<{ type: string; count?: number }>; limited: boolean } | null = null
  const typesPageSize = Math.min(config.pageSize ?? DEFAULT_PAGE_SIZE, TYPE_LIMIT)
  let typesUsedStrategy: SectionStatus['strategy'] = 'safe'
  let typesLimited = false
  let typesPartial = false
  const typesNotes: string[] = []

  if (capabilities.aggregates) {
    const optimisticQuery =
      `SELECT ?type (COUNT(?s) AS ?count) WHERE { ?s a ?type } ` +
      `GROUP BY ?type ORDER BY DESC(?count) LIMIT ${TYPE_LIMIT}`
    try {
      const data = await executeSparql(config.url, optimisticQuery, timeoutMs)
      const bindings = getBindings(data)
      const items = bindings
        .map((row: any) => ({
          type: extractValue(row, 'type'),
          count: extractNumber(row, 'count'),
        }))
        .filter((row: any) => typeof row.type === 'string')
      if (items.length > 0) {
        typesData = { items, limited: items.length >= TYPE_LIMIT }
        typesLimited = typesData.limited
        typesUsedStrategy = 'optimistic'
      }
    } catch (err) {
      failures.push({
        section: 'types',
        queryId: 'types-optimistic',
        reason: err instanceof Error ? err.message : 'Unknown error',
        durationMs: Date.now() - typesSectionStart,
      })
      typesPartial = true
    }
  }

  if (!typesData) {
    const supportsOffset = capabilities.limitOffset === true
    const items: Array<{ type: string; count?: number }> = []
    let offset = 0
    let listDone = false

    while (!listDone && items.length < TYPE_LIMIT) {
      const remaining = TYPE_LIMIT - items.length
      const limit = Math.min(typesPageSize, remaining)
      const listQuery =
        `SELECT DISTINCT ?type WHERE { ?s a ?type } LIMIT ${limit}` +
        (supportsOffset ? ` OFFSET ${offset}` : '')

      try {
        const data = await executeSparql(config.url, listQuery, timeoutMs)
        const bindings = getBindings(data)
        const pageItems = bindings
          .map((row: any) => extractValue(row, 'type'))
          .filter((value: any) => typeof value === 'string') as string[]

        for (const value of pageItems) {
          items.push({ type: value })
        }

        if (!supportsOffset || pageItems.length < limit) {
          listDone = true
        } else {
          offset += limit
        }
      } catch (err) {
        failures.push({
          section: 'types',
          queryId: 'types-list',
          reason: err instanceof Error ? err.message : 'Unknown error',
          durationMs: Date.now() - typesSectionStart,
        })
        typesPartial = true
        listDone = true
      }
    }

    if (!supportsOffset && items.length >= typesPageSize) {
      typesNotes.push('LIMIT/OFFSET unsupported; results may be partial')
      typesLimited = true
    }

    if (items.length > 0) {
      if (capabilities.aggregates) {
        for (const item of items) {
          const countQuery = `SELECT (COUNT(?s) AS ?count) WHERE { ?s a <${item.type}> }`
          try {
            const data = await executeSparql(config.url, countQuery, timeoutMs)
            const bindings = getBindings(data)
            const first = bindings[0]
            item.count = extractNumber(first, 'count')
          } catch (err) {
            failures.push({
              section: 'types',
              queryId: 'types-count',
              reason: err instanceof Error ? err.message : 'Unknown error',
              durationMs: Date.now() - typesSectionStart,
            })
            typesPartial = true
          }
        }
      } else {
        typesNotes.push('Aggregate support missing; counts unavailable')
        typesPartial = true
      }

      typesData = { items, limited: items.length >= TYPE_LIMIT || typesLimited }
      typesLimited = typesData.limited
      typesUsedStrategy = 'safe'
    }
  }

  if (typesData) {
    sections.types = {
      status: typesLimited || typesPartial ? 'partial' : 'ok',
      strategy: typesUsedStrategy,
      durationMs: Date.now() - typesSectionStart,
      ...(typesNotes.length > 0 ? { notes: typesNotes.join(' | ') } : {}),
    }
    logger(`Types: ${typesData.items.length}${typesData.limited ? '+' : ''}`)
  } else {
    sections.types = {
      status: 'unknown',
      strategy: 'safe',
      durationMs: Date.now() - typesSectionStart,
      notes: 'Type inventory failed or unsupported',
    }
    logger('Types: unknown')
  }

  // =============================================================================
  // Predicate Inventory
  // =============================================================================

  const propertiesSectionStart = Date.now()
  let propertiesData: { items: Array<{ property: string; count?: number }>; limited: boolean } | null = null
  const propertiesPageSize = Math.min(config.pageSize ?? DEFAULT_PAGE_SIZE, PREDICATE_LIMIT)
  let propertiesUsedStrategy: SectionStatus['strategy'] = 'safe'
  let propertiesLimited = false
  let propertiesPartial = false
  const propertiesNotes: string[] = []

  if (capabilities.aggregates) {
    const optimisticQuery =
      `SELECT ?p (COUNT(*) AS ?count) WHERE { ?s ?p ?o } ` +
      `GROUP BY ?p ORDER BY DESC(?count) LIMIT ${PREDICATE_LIMIT}`
    try {
      const data = await executeSparql(config.url, optimisticQuery, timeoutMs)
      const bindings = getBindings(data)
      const items = bindings
        .map((row: any) => ({
          property: extractValue(row, 'p'),
          count: extractNumber(row, 'count'),
        }))
        .filter((row: any) => typeof row.property === 'string')
      if (items.length > 0) {
        propertiesData = { items, limited: items.length >= PREDICATE_LIMIT }
        propertiesLimited = propertiesData.limited
        propertiesUsedStrategy = 'optimistic'
      }
    } catch (err) {
      failures.push({
        section: 'properties',
        queryId: 'properties-optimistic',
        reason: err instanceof Error ? err.message : 'Unknown error',
        durationMs: Date.now() - propertiesSectionStart,
      })
      propertiesPartial = true
    }
  }

  if (!propertiesData) {
    const supportsOffset = capabilities.limitOffset === true
    const items: Array<{ property: string; count?: number }> = []
    let offset = 0
    let listDone = false

    while (!listDone && items.length < PREDICATE_LIMIT) {
      const remaining = PREDICATE_LIMIT - items.length
      const limit = Math.min(propertiesPageSize, remaining)
      const listQuery =
        `SELECT DISTINCT ?p WHERE { ?s ?p ?o } LIMIT ${limit}` +
        (supportsOffset ? ` OFFSET ${offset}` : '')

      try {
        const data = await executeSparql(config.url, listQuery, timeoutMs)
        const bindings = getBindings(data)
        const pageItems = bindings
          .map((row: any) => extractValue(row, 'p'))
          .filter((value: any) => typeof value === 'string') as string[]

        for (const value of pageItems) {
          items.push({ property: value })
        }

        if (!supportsOffset || pageItems.length < limit) {
          listDone = true
        } else {
          offset += limit
        }
      } catch (err) {
        failures.push({
          section: 'properties',
          queryId: 'properties-list',
          reason: err instanceof Error ? err.message : 'Unknown error',
          durationMs: Date.now() - propertiesSectionStart,
        })
        propertiesPartial = true
        listDone = true
      }
    }

    if (!supportsOffset && items.length >= propertiesPageSize) {
      propertiesNotes.push('LIMIT/OFFSET unsupported; results may be partial')
      propertiesLimited = true
    }

    if (items.length > 0) {
      if (capabilities.aggregates) {
        for (const item of items) {
          const countQuery = `SELECT (COUNT(*) AS ?count) WHERE { ?s <${item.property}> ?o }`
          try {
            const data = await executeSparql(config.url, countQuery, timeoutMs)
            const bindings = getBindings(data)
            const first = bindings[0]
            item.count = extractNumber(first, 'count')
          } catch (err) {
            failures.push({
              section: 'properties',
              queryId: 'properties-count',
              reason: err instanceof Error ? err.message : 'Unknown error',
              durationMs: Date.now() - propertiesSectionStart,
            })
            propertiesPartial = true
          }
        }
      } else {
        propertiesNotes.push('Aggregate support missing; counts unavailable')
        propertiesPartial = true
      }

      propertiesData = { items, limited: items.length >= PREDICATE_LIMIT || propertiesLimited }
      propertiesLimited = propertiesData.limited
      propertiesUsedStrategy = 'safe'
    }
  }

  if (propertiesData) {
    sections.properties = {
      status: propertiesLimited || propertiesPartial ? 'partial' : 'ok',
      strategy: propertiesUsedStrategy,
      durationMs: Date.now() - propertiesSectionStart,
      ...(propertiesNotes.length > 0 ? { notes: propertiesNotes.join(' | ') } : {}),
    }
    logger(`Properties: ${propertiesData.items.length}${propertiesData.limited ? '+' : ''}`)
  } else {
    sections.properties = {
      status: 'unknown',
      strategy: 'safe',
      durationMs: Date.now() - propertiesSectionStart,
      notes: 'Predicate inventory failed or unsupported',
    }
    logger('Properties: unknown')
  }

  // =============================================================================
  // Type → Property Matrix
  // =============================================================================

  const matrixSectionStart = Date.now()
  let matrixData:
    | { items: Array<{ type: string; property: string; count?: number }>; limited: boolean }
    | null = null
  let matrixUsedStrategy: SectionStatus['strategy'] = 'safe'
  let matrixLimited = false
  let matrixPartial = false
  const matrixNotes: string[] = []

  if (capabilities.aggregates) {
    const optimisticQuery =
      `SELECT ?type ?p (COUNT(*) AS ?count) WHERE { ?s a ?type ; ?p ?o } ` +
      `GROUP BY ?type ?p ORDER BY DESC(?count) LIMIT ${MATRIX_PAIR_LIMIT}`
    try {
      const data = await executeSparql(config.url, optimisticQuery, timeoutMs)
      const bindings = getBindings(data)
      const items = bindings
        .map((row: any) => ({
          type: extractValue(row, 'type'),
          property: extractValue(row, 'p'),
          count: extractNumber(row, 'count'),
        }))
        .filter((row: any) => typeof row.type === 'string' && typeof row.property === 'string')

      if (items.length > 0) {
        matrixData = { items, limited: items.length >= MATRIX_PAIR_LIMIT }
        matrixLimited = matrixData.limited
        matrixUsedStrategy = 'optimistic'
      }
    } catch (err) {
      failures.push({
        section: 'typePropertyMatrix',
        queryId: 'matrix-optimistic',
        reason: err instanceof Error ? err.message : 'Unknown error',
        durationMs: Date.now() - matrixSectionStart,
      })
      matrixPartial = true
    }
  }

  if (!matrixData) {
    if (!typesData || typesData.items.length === 0) {
      sections.typePropertyMatrix = {
        status: 'unknown',
        strategy: 'safe',
        durationMs: Date.now() - matrixSectionStart,
        notes: 'Type inventory unavailable; matrix skipped',
      }
    } else {
      const typeItems = typesData.items.slice(0, MATRIX_TYPE_LIMIT)
      if (typesData.items.length > MATRIX_TYPE_LIMIT) {
        matrixNotes.push(`Limited to top ${MATRIX_TYPE_LIMIT} types`)
        matrixLimited = true
      }

      const items: Array<{ type: string; property: string; count?: number }> = []

      for (const typeEntry of typeItems) {
        const typeIri = typeEntry.type
        if (!typeIri) continue

        const query = capabilities.aggregates
          ? `SELECT ?p (COUNT(*) AS ?count) WHERE { ?s a <${typeIri}> ; ?p ?o } GROUP BY ?p ORDER BY DESC(?count) LIMIT ${MATRIX_PROPERTY_LIMIT}`
          : `SELECT DISTINCT ?p WHERE { ?s a <${typeIri}> ; ?p ?o } LIMIT ${MATRIX_PROPERTY_LIMIT}`

        try {
          const data = await executeSparql(config.url, query, timeoutMs)
          const bindings = getBindings(data)
          const pageItems = bindings
            .map((row: any) => ({
              property: extractValue(row, 'p'),
              count: extractNumber(row, 'count'),
            }))
            .filter((row: any) => typeof row.property === 'string')

          for (const row of pageItems) {
            items.push({
              type: typeIri,
              property: row.property as string,
              ...(row.count !== undefined ? { count: row.count } : {}),
            })
          }

          if (pageItems.length >= MATRIX_PROPERTY_LIMIT) {
            matrixLimited = true
          }
        } catch (err) {
          failures.push({
            section: 'typePropertyMatrix',
            queryId: 'matrix-per-type',
            reason: err instanceof Error ? err.message : 'Unknown error',
            durationMs: Date.now() - matrixSectionStart,
          })
          matrixPartial = true
        }
      }

      if (!capabilities.aggregates) {
        matrixNotes.push('Aggregate support missing; counts unavailable')
        matrixPartial = true
      }

      if (items.length > 0) {
        matrixData = { items, limited: matrixLimited }
        matrixUsedStrategy = 'safe'
      } else {
        sections.typePropertyMatrix = {
          status: 'unknown',
          strategy: 'safe',
          durationMs: Date.now() - matrixSectionStart,
          notes: 'No matrix data returned',
        }
      }
    }
  }

  if (matrixData) {
    sections.typePropertyMatrix = {
      status: matrixLimited || matrixPartial ? 'partial' : 'ok',
      strategy: matrixUsedStrategy,
      durationMs: Date.now() - matrixSectionStart,
      ...(matrixNotes.length > 0 ? { notes: matrixNotes.join(' | ') } : {}),
    }
    logger(`Type/Property pairs: ${matrixData.items.length}${matrixData.limited ? '+' : ''}`)
  } else if (!sections.typePropertyMatrix.notes) {
    sections.typePropertyMatrix = {
      status: 'unknown',
      strategy: 'safe',
      durationMs: Date.now() - matrixSectionStart,
      notes: 'Type/property matrix failed or unsupported',
    }
    logger('Type/Property pairs: unknown')
  }

  return {
    meta: {
      analyzedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      endpoint: {
        name: config.name,
        url: config.url,
        description: config.description,
      },
    },
    capabilities,
    graphs: graphsData,
    types: typesData,
    properties: propertiesData,
    typePropertyMatrix: matrixData,
    sections,
    failures,
  }
}
