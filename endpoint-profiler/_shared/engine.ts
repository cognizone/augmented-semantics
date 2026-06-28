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

export type StepCallback = (
  step: number,
  total: number,
  name: string,
  durationMs: number,
  result: string,
  detail?: string,
) => void

export interface TypeReport {
  type: string
  typeQName?: string
  typeCount?: number
  properties: Array<{
    property: string
    propertyQName?: string
    count?: number
    subjectCount?: number
    cardinality?: { min?: number; max?: number; avg?: number; subjects?: number }
    cardinalityCounts?: Record<string, number>
    topValues?: Array<{ value: string; count: number; type?: string; datatype?: string; lang?: string }>
    datatypes?: Array<{ datatype: string; count: number; uriTypes?: Array<{ type: string | null; count: number }> }>
    datatypeQNames?: Array<{ datatype: string; qname: string; count: number }>
    languages?: Array<{ lang: string; count: number }>
    bnodeCount?: number
    distinctCount?: number
    numericRange?: { min?: number; max?: number }
    dateRange?: { min?: string; max?: string }
  }>
}

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
const TOP_VALUES_LIMIT = 250
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

function extractBinding(row: any, key: string): { value: string; type?: string; datatype?: string; lang?: string } | undefined {
  const binding = row?.[key]
  if (!binding || typeof binding.value !== 'string') return undefined
  const result: { value: string; type?: string; datatype?: string; lang?: string } = { value: binding.value }
  if (typeof binding.type === 'string') result.type = binding.type
  if (typeof binding.datatype === 'string') result.datatype = binding.datatype
  if (typeof binding['xml:lang'] === 'string') result.lang = binding['xml:lang']
  return result
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

export async function analyzeEndpointWithSteps(
  config: EndpointConfig,
  _rules?: CurationRules,
  onStep?: StepCallback,
  onTypeReport?: (report: TypeReport) => void | Promise<void>,
  options?: { namespacesOnly?: boolean; getTypeLabel?: (iri: string) => string | Promise<string> },
): Promise<AnalysisResult> {
  const startedAt = Date.now()
  const failures: FailureRecord[] = []

  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const totalSteps = options?.namespacesOnly ? 4 : 5
  let currentStep = 0

  const runStep = async <T>(
    name: string,
    fn: (progress: (current: number, total: number, detail?: string) => void) => Promise<T>,
    formatResult: (result: T) => string,
    errorResult = 'error',
  ): Promise<T | null> => {
    currentStep += 1
    const stepStart = Date.now()
    const progress = (current: number, total: number, detail?: string) => {
      if (!onStep) return
      onStep(currentStep, totalSteps, name, Date.now() - stepStart, `${current}/${total}`, detail)
    }
    try {
      const result = await fn(progress)
      onStep?.(currentStep, totalSteps, name, Date.now() - stepStart, formatResult(result))
      return result
    } catch {
      onStep?.(currentStep, totalSteps, name, Date.now() - stepStart, errorResult)
      return null
    }
  }

  let jsonResults = false
  let xmlResults = false
  let cors: boolean | null = null

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

  await runStep(
    'Capabilities',
    async () => {
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

      try {
        cors = await detectCors(config.url, timeoutMs)
      } catch {
        cors = null
      }

      capabilities.jsonResults = jsonResults
      capabilities.xmlResults = xmlResults
      capabilities.cors = cors

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

      return capabilities
    },
    (caps) => {
      const json = caps.jsonResults
      const xml = caps.xmlResults
      if (json && xml) return 'json+xml'
      if (json) return 'json'
      if (xml) return 'xml'
      return 'none'
    },
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

  const graphsSectionStart = Date.now()
  let graphsData: { items: Array<{ graph: string; triples?: number }>; limited: boolean } | null = null

  await runStep(
    'Graphs',
    async () => {
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

      return graphsData
    },
    (graphs) => {
      if (!graphs) return 'unknown'
      return `${graphs.items.length}${graphs.limited ? '+' : ''}`
    },
  )

  // =============================================================================
  // Type Inventory
  // =============================================================================

  const typesSectionStart = Date.now()
  let typesData: { items: Array<{ type: string; count?: number }>; limited: boolean } | null = null

  await runStep(
    'Types',
    async () => {
      const typesPageSize = config.pageSize ?? DEFAULT_PAGE_SIZE
      let typesUsedStrategy: SectionStatus['strategy'] = 'safe'
      let typesPartial = false
      const typesNotes: string[] = []

      if (capabilities.aggregates) {
        const optimisticQuery =
          `SELECT ?type (COUNT(?s) AS ?count) WHERE { ?s a ?type } ` +
          `GROUP BY ?type ORDER BY DESC(?count)`
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
            typesData = { items, limited: false }
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

        while (!listDone) {
          const listQuery = supportsOffset
            ? `SELECT DISTINCT ?type WHERE { ?s a ?type } LIMIT ${typesPageSize} OFFSET ${offset}`
            : 'SELECT DISTINCT ?type WHERE { ?s a ?type }'

          try {
            const data = await executeSparql(config.url, listQuery, timeoutMs)
            const bindings = getBindings(data)
            const pageItems = bindings
              .map((row: any) => extractValue(row, 'type'))
              .filter((value: any) => typeof value === 'string') as string[]

            for (const value of pageItems) {
              items.push({ type: value })
            }

            if (!supportsOffset || pageItems.length < typesPageSize) {
              listDone = true
            } else {
              offset += typesPageSize
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

          typesData = { items, limited: false }
          typesUsedStrategy = 'safe'
        }
      }

      if (typesData) {
        sections.types = {
          status: typesPartial ? 'partial' : 'ok',
          strategy: typesUsedStrategy,
          durationMs: Date.now() - typesSectionStart,
          ...(typesNotes.length > 0 ? { notes: typesNotes.join(' | ') } : {}),
        }
      } else {
        sections.types = {
          status: 'unknown',
          strategy: 'safe',
          durationMs: Date.now() - typesSectionStart,
          notes: 'Type inventory failed or unsupported',
        }
      }

      return typesData
    },
    (types) => {
      if (!types) return 'unknown'
      return `${types.items.length}`
    },
  )

  // =============================================================================
  // Predicate Inventory
  // =============================================================================

  const propertiesSectionStart = Date.now()
  let propertiesData: { items: Array<{ property: string; count?: number }>; limited: boolean } | null = null

  await runStep(
    'Predicates',
    async () => {
      const propertiesPageSize = config.pageSize ?? DEFAULT_PAGE_SIZE
      let propertiesUsedStrategy: SectionStatus['strategy'] = 'safe'
      let propertiesPartial = false
      const propertiesNotes: string[] = []

      if (capabilities.aggregates) {
        const optimisticQuery =
          `SELECT ?p (COUNT(*) AS ?count) WHERE { ?s ?p ?o } ` +
          `GROUP BY ?p ORDER BY DESC(?count)`
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
            propertiesData = { items, limited: false }
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

        while (!listDone) {
          const listQuery = supportsOffset
            ? `SELECT DISTINCT ?p WHERE { ?s ?p ?o } LIMIT ${propertiesPageSize} OFFSET ${offset}`
            : 'SELECT DISTINCT ?p WHERE { ?s ?p ?o }'

          try {
            const data = await executeSparql(config.url, listQuery, timeoutMs)
            const bindings = getBindings(data)
            const pageItems = bindings
              .map((row: any) => extractValue(row, 'p'))
              .filter((value: any) => typeof value === 'string') as string[]

            for (const value of pageItems) {
              items.push({ property: value })
            }

            if (!supportsOffset || pageItems.length < propertiesPageSize) {
              listDone = true
            } else {
              offset += propertiesPageSize
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

          propertiesData = { items, limited: false }
          propertiesUsedStrategy = 'safe'
        }
      }

      if (propertiesData) {
        sections.properties = {
          status: propertiesPartial ? 'partial' : 'ok',
          strategy: propertiesUsedStrategy,
          durationMs: Date.now() - propertiesSectionStart,
          ...(propertiesNotes.length > 0 ? { notes: propertiesNotes.join(' | ') } : {}),
        }
      } else {
        sections.properties = {
          status: 'unknown',
          strategy: 'safe',
          durationMs: Date.now() - propertiesSectionStart,
          notes: 'Predicate inventory failed or unsupported',
        }
      }

      return propertiesData
    },
    (props) => {
      if (!props) return 'unknown'
      return `${props.items.length}`
    },
  )

  // =============================================================================
  // Per-Type Reports (streamed)
  // =============================================================================

  const reportSectionStart = Date.now()

  if (!options?.namespacesOnly) {
    await runStep(
      'Type reports',
      async (progress) => {
      if (!capabilities.aggregates) {
        sections.typePropertyMatrix = {
          status: 'unknown',
          strategy: 'safe',
          durationMs: Date.now() - reportSectionStart,
          notes: 'Aggregate support missing; type reports skipped',
        }
        sections.cardinality = {
          status: 'unknown',
          strategy: 'safe',
          durationMs: Date.now() - reportSectionStart,
          notes: 'Aggregate support missing; cardinality skipped',
        }
        sections.valueDistributions = {
          status: 'unknown',
          strategy: 'safe',
          durationMs: Date.now() - reportSectionStart,
          notes: 'Aggregate support missing; value distributions skipped',
        }
        return null
      }

      if (!typesData || typesData.items.length === 0) {
        sections.typePropertyMatrix = {
          status: 'unknown',
          strategy: 'safe',
          durationMs: Date.now() - reportSectionStart,
          notes: 'Type inventory unavailable; type reports skipped',
        }
        sections.cardinality = {
          status: 'unknown',
          strategy: 'safe',
          durationMs: Date.now() - reportSectionStart,
          notes: 'Type inventory unavailable; cardinality skipped',
        }
        sections.valueDistributions = {
          status: 'unknown',
          strategy: 'safe',
          durationMs: Date.now() - reportSectionStart,
          notes: 'Type inventory unavailable; value distributions skipped',
        }
        return null
      }

      const supportsOrderBy = capabilities.orderBy === true
      const supportsSubqueries = capabilities.subqueries === true
      const totalTypes = typesData.items.length
      let processedTypes = 0
      let partial = false

      const sortedTypes = [...typesData.items].sort((a, b) => {
        const aCount = typeof a.count === 'number' ? a.count : Number.POSITIVE_INFINITY
        const bCount = typeof b.count === 'number' ? b.count : Number.POSITIVE_INFINITY
        return aCount - bCount
      })

      for (const typeEntry of sortedTypes) {
        const typeIri = typeEntry.type
        if (!typeIri) continue
        const fallbackLabel = typeIri.split(/[\/#]/).filter(Boolean).pop() ?? typeIri
        const typeLabel = options?.getTypeLabel ? await options.getTypeLabel(typeIri) : fallbackLabel
        const typeIndex = processedTypes + 1

        const propsQuery =
          `SELECT ?p (COUNT(*) AS ?count) WHERE { ?s a <${typeIri}> ; ?p ?o } ` +
          `GROUP BY ?p ORDER BY DESC(?count)`

        let propertyRows: Array<{ property: string; count?: number }> = []
        try {
          const data = await executeSparql(config.url, propsQuery, timeoutMs)
          const bindings = getBindings(data)
          propertyRows = bindings
            .map((row: any) => ({
              property: extractValue(row, 'p'),
              count: extractNumber(row, 'count'),
            }))
            .filter((row: any) => typeof row.property === 'string') as Array<{
            property: string
            count?: number
          }>
        } catch (err) {
          failures.push({
            section: 'typePropertyMatrix',
            queryId: 'properties-per-type',
            reason: err instanceof Error ? err.message : 'Unknown error',
            durationMs: Date.now() - reportSectionStart,
          })
          partial = true
          processedTypes += 1
          progress(processedTypes, totalTypes)
          continue
        }

        const properties: TypeReport['properties'] = []
        const typeCount = typeof typeEntry.count === 'number' ? typeEntry.count : undefined

        const propertyTotal = propertyRows.length
        let propertyIndex = 0

        for (const prop of propertyRows) {
          const propertyIri = prop.property
          if (!propertyIri) continue
          propertyIndex += 1
          progress(typeIndex, totalTypes, `${typeLabel} ${propertyIndex}/${propertyTotal}`)

          const entry: TypeReport['properties'][number] = {
            property: propertyIri,
            ...(prop.count !== undefined ? { count: prop.count } : {}),
          }

          if (supportsSubqueries) {
            const statsQuery =
              `SELECT (MIN(?c) AS ?min) (MAX(?c) AS ?max) (AVG(?c) AS ?avg) (COUNT(?s) AS ?subjects) WHERE { ` +
              `{ SELECT ?s (COUNT(?o) AS ?c) WHERE { ?s a <${typeIri}> ; <${propertyIri}> ?o } GROUP BY ?s } }`
            try {
              const statsData = await executeSparql(config.url, statsQuery, timeoutMs)
              const statsBindings = getBindings(statsData)
              const row = statsBindings[0]
              if (row) {
                entry.cardinality = {
                  min: extractNumber(row, 'min'),
                  max: extractNumber(row, 'max'),
                  avg: extractNumber(row, 'avg'),
                  subjects: extractNumber(row, 'subjects'),
                }
                const subjectCount = extractNumber(row, 'subjects')
                if (subjectCount !== undefined) {
                  entry.subjectCount = subjectCount
                }
              }
            } catch (err) {
              failures.push({
                section: 'cardinality',
                queryId: 'cardinality-per-pair',
                reason: err instanceof Error ? err.message : 'Unknown error',
                durationMs: Date.now() - reportSectionStart,
              })
              partial = true
            }

            const counts: Record<string, number> = {}

            // Count subjects without this property (cardinality 0)
            const zeroCountQuery =
              `SELECT (COUNT(?s) AS ?count) WHERE { ` +
              `?s a <${typeIri}> . ` +
              `FILTER NOT EXISTS { ?s <${propertyIri}> ?o } }`
            try {
              const zeroData = await executeSparql(config.url, zeroCountQuery, timeoutMs)
              const zeroBindings = getBindings(zeroData)
              const zeroCount = extractNumber(zeroBindings[0], 'count')
              if (zeroCount !== undefined) {
                counts["0"] = zeroCount
              }
            } catch (err) {
              failures.push({
                section: 'cardinality',
                queryId: 'cardinality-zero-count',
                reason: err instanceof Error ? err.message : 'Unknown error',
                durationMs: Date.now() - reportSectionStart,
              })
              partial = true
            }

            // Count subjects grouped by cardinality (1, 2, 3, ...)
            const countsQuery =
              `SELECT ?c (COUNT(?s) AS ?subjects) WHERE { ` +
              `{ SELECT ?s (COUNT(?o) AS ?c) WHERE { ?s a <${typeIri}> ; <${propertyIri}> ?o } GROUP BY ?s } } ` +
              `GROUP BY ?c ORDER BY ?c`
            try {
              const countsData = await executeSparql(config.url, countsQuery, timeoutMs)
              const countBindings = getBindings(countsData)
              for (const row of countBindings) {
                const c = extractNumber(row, 'c')
                const subjects = extractNumber(row, 'subjects')
                if (c === undefined || subjects === undefined) continue
                counts[String(c)] = subjects
              }
            } catch (err) {
              failures.push({
                section: 'cardinality',
                queryId: 'cardinality-counts-per-pair',
                reason: err instanceof Error ? err.message : 'Unknown error',
                durationMs: Date.now() - reportSectionStart,
              })
              partial = true
            }

            if (Object.keys(counts).length > 0) {
              entry.cardinalityCounts = counts
              if (entry.subjectCount === undefined) {
                let subjectsWithProperty = 0
                for (const [key, value] of Object.entries(counts)) {
                  if (key === '0') continue
                  subjectsWithProperty += value
                }
                entry.subjectCount = subjectsWithProperty
              }

              // Adjust cardinality stats to include zeros
              if (entry.cardinality) {
                const zeroCount = counts["0"] ?? 0
                const nonzeroSubjects = entry.cardinality.subjects ?? 0
                const totalSubjects = typeCount ?? (nonzeroSubjects + zeroCount)

                if (zeroCount > 0) {
                  entry.cardinality.min = 0
                }

                if (totalSubjects > 0) {
                  entry.cardinality.subjects = totalSubjects
                  if (entry.cardinality.avg !== undefined) {
                    entry.cardinality.avg = (entry.cardinality.avg * nonzeroSubjects) / totalSubjects
                  }
                }
              }
            }
          } else {
            partial = true
          }

          if (supportsOrderBy) {
            const valuesQuery =
              `SELECT ?value (COUNT(*) AS ?count) WHERE { ?s a <${typeIri}> ; <${propertyIri}> ?value FILTER(!isBlank(?value)) } ` +
              `GROUP BY ?value ORDER BY DESC(?count) LIMIT ${TOP_VALUES_LIMIT}`
            try {
              const valuesData = await executeSparql(config.url, valuesQuery, timeoutMs)
              const valueBindings = getBindings(valuesData)
              const topValues = valueBindings
                .map((row: any) => {
                  const binding = extractBinding(row, 'value')
                  const count = extractNumber(row, 'count')
                  if (!binding || count === undefined) return null
                  return {
                    value: binding.value,
                    count,
                    ...(binding.type ? { type: binding.type } : {}),
                    ...(binding.datatype ? { datatype: binding.datatype } : {}),
                    ...(binding.lang ? { lang: binding.lang } : {}),
                  }
                })
                .filter((value: any) => value !== null) as Array<{
                value: string
                count: number
                type?: string
                datatype?: string
                lang?: string
              }>
              entry.topValues = topValues
            } catch (err) {
              failures.push({
                section: 'valueDistributions',
                queryId: 'top-values-per-pair',
                reason: err instanceof Error ? err.message : 'Unknown error',
                durationMs: Date.now() - reportSectionStart,
              })
              partial = true
            }
          } else {
            partial = true
          }

          if (capabilities.aggregates) {
            const distinctQuery =
              `SELECT (COUNT(DISTINCT ?value) AS ?count) WHERE { ` +
              `?s a <${typeIri}> ; <${propertyIri}> ?value }`
            try {
              const distinctData = await executeSparql(config.url, distinctQuery, timeoutMs)
              const distinctBindings = getBindings(distinctData)
              const distinctCount = extractNumber(distinctBindings[0], 'count')
              if (typeof distinctCount === 'number') {
                entry.distinctCount = distinctCount
              }
            } catch (err) {
              failures.push({
                section: 'valueDistributions',
                queryId: 'distinct-per-pair',
                reason: err instanceof Error ? err.message : 'Unknown error',
                durationMs: Date.now() - reportSectionStart,
              })
              partial = true
            }

            const bnodeQuery =
              `SELECT (COUNT(*) AS ?count) WHERE { ` +
              `?s a <${typeIri}> ; <${propertyIri}> ?value FILTER(isBlank(?value)) }`
            try {
              const bnodeData = await executeSparql(config.url, bnodeQuery, timeoutMs)
              const bnodeBindings = getBindings(bnodeData)
              const bnodeCount = extractNumber(bnodeBindings[0], 'count')
              if (typeof bnodeCount === 'number' && bnodeCount > 0) {
                entry.bnodeCount = bnodeCount
              }
            } catch (err) {
              failures.push({
                section: 'valueDistributions',
                queryId: 'bnode-count-per-pair',
                reason: err instanceof Error ? err.message : 'Unknown error',
                durationMs: Date.now() - reportSectionStart,
              })
              partial = true
            }

            let hasNumericDatatype = false
            let hasDateDatatype = false
            let hasLangString = false

            const datatypeQuery =
              `SELECT ?datatype (COUNT(*) AS ?count) WHERE { ` +
              `?s a <${typeIri}> ; <${propertyIri}> ?value . FILTER(isLiteral(?value)) ` +
              `BIND(IF(LANG(?value) != "", <http://www.w3.org/1999/02/22-rdf-syntax-ns#langString>, ` +
              `COALESCE(DATATYPE(?value), <http://www.w3.org/2001/XMLSchema#string>)) AS ?datatype) } ` +
              `GROUP BY ?datatype ORDER BY DESC(?count)`
            try {
              const datatypeData = await executeSparql(config.url, datatypeQuery, timeoutMs)
              const datatypeBindings = getBindings(datatypeData)
              const datatypes = datatypeBindings
                .map((row: any) => ({
                  datatype: extractValue(row, 'datatype') ?? 'none',
                  count: extractNumber(row, 'count'),
                }))
                .filter((row: any) => typeof row.count === 'number') as Array<{ datatype: string; count: number }>

              const literalTotal = datatypes.reduce((sum, dt) => sum + (dt.count ?? 0), 0)
              const tripleCount = entry.count ?? 0
              const bnodeCount = entry.bnodeCount ?? 0
              const iriCount = tripleCount - bnodeCount - literalTotal
              if (Number.isFinite(iriCount) && iriCount > 0) {
                // Query rdf:type distribution for URI values
                // Use UNION with literal string marker for untyped (endpoint compatibility)
                const UNTYPED_MARKER = 'untyped'
                let uriTypes: Array<{ type: string | null; count: number }> | undefined
                const uriTypeQuery =
                  `SELECT ?type (COUNT(*) AS ?count) WHERE { ` +
                  `?s a <${typeIri}> ; <${propertyIri}> ?o . ` +
                  `FILTER(isIRI(?o)) ` +
                  `{ ?o a ?type } UNION { FILTER NOT EXISTS { ?o a ?anyType } BIND('${UNTYPED_MARKER}' AS ?type) } } ` +
                  `GROUP BY ?type ORDER BY DESC(?count)`
                try {
                  const uriTypeData = await executeSparql(config.url, uriTypeQuery, timeoutMs)
                  const uriTypeBindings = getBindings(uriTypeData)
                  uriTypes = uriTypeBindings
                    .map((row: any) => {
                      const typeValue = extractValue(row, 'type')
                      return {
                        type: typeValue === UNTYPED_MARKER ? null : (typeValue ?? null),
                        count: extractNumber(row, 'count'),
                      }
                    })
                    .filter((row: any) => typeof row.count === 'number') as Array<{ type: string | null; count: number }>
                } catch (err) {
                  failures.push({
                    section: 'datatypes',
                    queryId: 'uri-types-per-pair',
                    reason: err instanceof Error ? err.message : 'Unknown error',
                    durationMs: Date.now() - reportSectionStart,
                  })
                  partial = true
                }
                datatypes.push({
                  datatype: 'iri',
                  count: iriCount,
                  ...(uriTypes && uriTypes.length > 0 ? { uriTypes } : {}),
                })
              }

              for (const dt of datatypes) {
                if (dt.datatype === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString') {
                  hasLangString = true
                }
                if (dt.datatype === 'http://www.w3.org/2001/XMLSchema#date' ||
                    dt.datatype === 'http://www.w3.org/2001/XMLSchema#dateTime' ||
                    dt.datatype === 'http://www.w3.org/2001/XMLSchema#dateTimeStamp') {
                  hasDateDatatype = true
                }
                if (dt.datatype === 'http://www.w3.org/2001/XMLSchema#integer' ||
                    dt.datatype === 'http://www.w3.org/2001/XMLSchema#decimal' ||
                    dt.datatype === 'http://www.w3.org/2001/XMLSchema#double' ||
                    dt.datatype === 'http://www.w3.org/2001/XMLSchema#float' ||
                    dt.datatype === 'http://www.w3.org/2001/XMLSchema#long' ||
                    dt.datatype === 'http://www.w3.org/2001/XMLSchema#int' ||
                    dt.datatype === 'http://www.w3.org/2001/XMLSchema#short' ||
                    dt.datatype === 'http://www.w3.org/2001/XMLSchema#byte' ||
                    dt.datatype === 'http://www.w3.org/2001/XMLSchema#nonNegativeInteger' ||
                    dt.datatype === 'http://www.w3.org/2001/XMLSchema#positiveInteger' ||
                    dt.datatype === 'http://www.w3.org/2001/XMLSchema#nonPositiveInteger' ||
                    dt.datatype === 'http://www.w3.org/2001/XMLSchema#negativeInteger' ||
                    dt.datatype === 'http://www.w3.org/2001/XMLSchema#unsignedInt' ||
                    dt.datatype === 'http://www.w3.org/2001/XMLSchema#unsignedLong' ||
                    dt.datatype === 'http://www.w3.org/2001/XMLSchema#unsignedShort' ||
                    dt.datatype === 'http://www.w3.org/2001/XMLSchema#unsignedByte') {
                  hasNumericDatatype = true
                }
              }

              if (datatypes.length > 0) {
                entry.datatypes = datatypes
              }
            } catch (err) {
              failures.push({
                section: 'datatypes',
                queryId: 'datatypes-per-pair',
                reason: err instanceof Error ? err.message : 'Unknown error',
                durationMs: Date.now() - reportSectionStart,
              })
              partial = true
            }

            if (hasNumericDatatype) {
              const numericQuery =
                `SELECT (MIN(?value) AS ?min) (MAX(?value) AS ?max) WHERE { ` +
                `?s a <${typeIri}> ; <${propertyIri}> ?value FILTER(isNumeric(?value)) }`
              try {
                const numericData = await executeSparql(config.url, numericQuery, timeoutMs)
                const numericBindings = getBindings(numericData)
                const row = numericBindings[0]
                if (row) {
                  const min = extractNumber(row, 'min')
                  const max = extractNumber(row, 'max')
                  if (min !== undefined || max !== undefined) {
                    entry.numericRange = { min, max }
                  }
                }
              } catch (err) {
                failures.push({
                  section: 'valueDistributions',
                  queryId: 'numeric-range-per-pair',
                  reason: err instanceof Error ? err.message : 'Unknown error',
                  durationMs: Date.now() - reportSectionStart,
                })
                partial = true
              }
            }

            if (hasDateDatatype) {
              const dateQuery =
                `SELECT (MIN(?value) AS ?min) (MAX(?value) AS ?max) WHERE { ` +
                `?s a <${typeIri}> ; <${propertyIri}> ?value FILTER(` +
                `datatype(?value) IN (` +
                `<http://www.w3.org/2001/XMLSchema#date>, ` +
                `<http://www.w3.org/2001/XMLSchema#dateTime>, ` +
                `<http://www.w3.org/2001/XMLSchema#dateTimeStamp>` +
                `)) }`
              try {
                const dateData = await executeSparql(config.url, dateQuery, timeoutMs)
                const dateBindings = getBindings(dateData)
                const row = dateBindings[0]
                if (row) {
                  const min = extractValue(row, 'min')
                  const max = extractValue(row, 'max')
                  if (min || max) {
                    entry.dateRange = { min, max }
                  }
                }
              } catch (err) {
                failures.push({
                  section: 'valueDistributions',
                  queryId: 'date-range-per-pair',
                  reason: err instanceof Error ? err.message : 'Unknown error',
                  durationMs: Date.now() - reportSectionStart,
                })
                partial = true
              }
            }

            if (hasLangString) {
              const langQuery =
                `SELECT ?lang (COUNT(*) AS ?count) WHERE { ` +
                `?s a <${typeIri}> ; <${propertyIri}> ?value . FILTER(isLiteral(?value)) ` +
                `BIND(LANG(?value) AS ?lang) } ` +
                `GROUP BY ?lang ORDER BY DESC(?count)`
              try {
                const langData = await executeSparql(config.url, langQuery, timeoutMs)
                const langBindings = getBindings(langData)
                const languages = langBindings
                  .map((row: any) => ({
                    lang: extractValue(row, 'lang') ?? 'none',
                    count: extractNumber(row, 'count'),
                  }))
                  .filter((row: any) => typeof row.count === 'number') as Array<{ lang: string; count: number }>
                if (languages.length > 0) {
                  entry.languages = languages
                }
              } catch (err) {
                failures.push({
                  section: 'languages',
                  queryId: 'languages-per-pair',
                  reason: err instanceof Error ? err.message : 'Unknown error',
                  durationMs: Date.now() - reportSectionStart,
                })
                partial = true
              }
            }
          }

          properties.push(entry)
        }

        if (propertyTotal === 0) {
          progress(typeIndex, totalTypes, `${typeLabel} 0/0`)
        }

        if (onTypeReport) {
          await onTypeReport({ type: typeIri, typeCount, properties })
        }
        processedTypes += 1
        progress(processedTypes, totalTypes, `${typeLabel} ${propertyTotal}/${propertyTotal}`)
      }

      sections.typePropertyMatrix = {
        status: partial ? 'partial' : 'ok',
        strategy: 'safe',
        durationMs: Date.now() - reportSectionStart,
        notes: 'Details streamed to per-type files',
      }
      sections.cardinality = {
        status: partial ? 'partial' : 'ok',
        strategy: 'safe',
        durationMs: Date.now() - reportSectionStart,
        notes: 'Details streamed to per-type files',
      }
      sections.valueDistributions = {
        status: partial ? 'partial' : 'ok',
        strategy: 'safe',
        durationMs: Date.now() - reportSectionStart,
        notes: 'Details streamed to per-type files',
      }

      return { total: totalTypes, partial }
      },
      (result) => {
        if (!result) return 'unknown'
        return `${result.total}`
      },
    )
  } else {
    sections.typePropertyMatrix = {
      status: 'unknown',
      strategy: 'safe',
      durationMs: 0,
      notes: 'Skipped in namespaces-only mode',
    }
    sections.cardinality = {
      status: 'unknown',
      strategy: 'safe',
      durationMs: 0,
      notes: 'Skipped in namespaces-only mode',
    }
    sections.valueDistributions = {
      status: 'unknown',
      strategy: 'safe',
      durationMs: 0,
      notes: 'Skipped in namespaces-only mode',
    }
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
    typePropertyMatrix: null,
    cardinality: null,
    valueDistributions: null,
    sections,
    failures,
  }
}

export async function analyzeEndpoint(
  config: EndpointConfig,
  rules?: CurationRules,
): Promise<AnalysisResult> {
  return analyzeEndpointWithSteps(config, rules)
}
