/**
 * Shared curation utilities for SPARQL endpoint analysis.
 *
 * @see /spec/ae-skos/sko09-CurationWorkflow.md
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

// =============================================================================
// Types
// =============================================================================

export interface DetectedLanguage {
  lang: string
  count: number
}

/**
 * Label predicate capabilities for a specific resource type.
 */
export interface LabelPredicateCapabilities {
  prefLabel?: boolean
  xlPrefLabel?: boolean
  dctTitle?: boolean
  dcTitle?: boolean
  rdfsLabel?: boolean
}

/**
 * Label predicates available per resource type.
 */
export interface LabelPredicatesByResourceType {
  concept?: LabelPredicateCapabilities
  scheme?: LabelPredicateCapabilities
  collection?: LabelPredicateCapabilities
}

export interface EndpointAnalysis {
  hasSkosContent: boolean
  supportsJsonResults?: boolean | null
  supportsNamedGraphs: boolean | null
  skosGraphCount: number | null
  schemeUris?: string[]
  schemeCount?: number
  schemesLimited?: boolean
  languages?: DetectedLanguage[]
  totalConcepts?: number
  totalCollections?: number
  totalOrderedCollections?: number
  relationships?: {
    hasInScheme: boolean
    hasTopConceptOf: boolean
    hasHasTopConcept: boolean
    hasBroader: boolean
    hasNarrower: boolean
    hasBroaderTransitive: boolean
    hasNarrowerTransitive: boolean
  }
  labelPredicates?: LabelPredicatesByResourceType
  analyzedAt: string
}

export interface InputConfig {
  name: string
  url: string
  description?: string
}

export interface CuratedEndpoint {
  name: string
  url: string
  description?: string
  analysis: EndpointAnalysis
  suggestedLanguagePriorities: string[]
}

export interface StepResult<T> {
  data: T
  durationMs: number
}

export type StepCallback = (step: number, total: number, name: string, durationMs: number, result: string) => void

// =============================================================================
// SPARQL Execution
// =============================================================================

/**
 * Parse SPARQL XML results into JSON format.
 * Handles both ASK (boolean) and SELECT (bindings) results.
 */
function parseSparqlXml(xml: string): any {
  // ASK query result
  const boolMatch = xml.match(/<boolean>(\w+)<\/boolean>/)
  if (boolMatch) {
    return { boolean: boolMatch[1] === 'true' }
  }

  // SELECT query result - extract bindings
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

      // Extract value based on type (uri, literal, bnode)
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

export async function executeSparql(url: string, query: string, retries = 2): Promise<any> {
  // Trim query - some endpoints (e.g., Getty) return empty results with leading whitespace
  const trimmedQuery = query.trim()

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Try POST first
      let response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/sparql-results+json, application/sparql-results+xml;q=0.9',
        },
        // format=json helps endpoints like Getty that ignore Accept header
        body: `query=${encodeURIComponent(trimmedQuery)}&format=json`,
      })

      let contentType = response.headers.get('Content-Type') || ''

      // Some endpoints return HTML form on POST (e.g., UNESCO) - try GET instead
      const needsGet = !response.ok || contentType.includes('text/html')
      if (needsGet) {
        const getUrl = `${url}?query=${encodeURIComponent(trimmedQuery)}&format=json`
        response = await fetch(getUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/sparql-results+json, application/sparql-results+xml;q=0.9',
          },
        })
        contentType = response.headers.get('Content-Type') || ''
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const text = await response.text()

      // Handle XML responses (some endpoints like Getty only return XML)
      if (contentType.includes('xml') || text.trimStart().startsWith('<?xml') || text.trimStart().startsWith('<sparql')) {
        return parseSparqlXml(text)
      }

      // Handle JSON responses
      return JSON.parse(text)
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      if (attempt < retries) {
        // Wait before retry (100ms, 200ms, ...)
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)))
      }
    }
  }

  throw lastError
}

export async function detectJsonSupport(url: string): Promise<boolean> {
  const query = 'ASK { ?s ?p ?o }'
  const trimmedQuery = query.trim()

  let response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/sparql-results+json',
    },
    body: `query=${encodeURIComponent(trimmedQuery)}&format=json`,
  })

  let contentType = response.headers.get('Content-Type') || ''

  const needsGet = !response.ok || contentType.includes('text/html')
  if (needsGet) {
    const getUrl = `${url}?query=${encodeURIComponent(trimmedQuery)}&format=json`
    response = await fetch(getUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/sparql-results+json',
      },
    })
    contentType = response.headers.get('Content-Type') || ''
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  const text = await response.text()
  const trimmed = text.trimStart()

  if (contentType.includes('xml') || trimmed.startsWith('<?xml') || trimmed.startsWith('<sparql')) {
    return false
  }

  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

// =============================================================================
// Analysis Steps (exported for fine-grained control)
// =============================================================================

export async function checkSkosContent(url: string): Promise<boolean> {
  const query = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    ASK {
      { ?s a skos:Concept }
      UNION
      { ?s a skos:ConceptScheme }
    }
  `

  // Let errors propagate - runStep will catch and show "error"
  const results = await executeSparql(url, query)
  return results.boolean === true
}

export async function detectGraphs(url: string): Promise<boolean> {
  const query = `ASK { GRAPH ?g { ?s ?p ?o } }`

  // Let errors propagate - runStep will catch and show "error"
  const results = await executeSparql(url, query)
  return results.boolean === true
}

export async function detectSkosGraphs(url: string): Promise<{ count: number; uris: string[] | null }> {
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
    LIMIT 501
  `

  // Let errors propagate - runStep will catch and show "error"
  const results = await executeSparql(url, query)
  const uris = results.results.bindings
    .map((b: any) => b.g?.value)
    .filter((uri: string | undefined): uri is string => !!uri)

  if (uris.length > 500) {
    return { count: uris.length, uris: null }
  }

  return { count: uris.length, uris }
}

export async function countConcepts(url: string): Promise<number> {
  const query = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    SELECT (COUNT(DISTINCT ?concept) AS ?count)
    WHERE {
      ?concept a skos:Concept .
    }
  `

  // Let errors propagate - runStep will catch and show "error"
  const results = await executeSparql(url, query)
  return parseInt(results.results.bindings[0]?.count?.value || '0', 10)
}

export async function countCollections(url: string): Promise<number> {
  const query = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    SELECT (COUNT(DISTINCT ?collection) AS ?count)
    WHERE {
      ?collection a skos:Collection .
    }
  `

  const results = await executeSparql(url, query)
  return parseInt(results.results.bindings[0]?.count?.value || '0', 10)
}

export async function countOrderedCollections(url: string): Promise<number> {
  const query = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    SELECT (COUNT(DISTINCT ?collection) AS ?count)
    WHERE {
      ?collection a skos:OrderedCollection .
    }
  `

  const results = await executeSparql(url, query)
  return parseInt(results.results.bindings[0]?.count?.value || '0', 10)
}

const MAX_STORED_SCHEMES = 200

export async function detectSchemes(url: string): Promise<{
  schemeUris: string[]
  schemeCount: number
  schemesLimited: boolean
}> {
  // Fetch URIs directly - COUNT(DISTINCT) times out on some endpoints (e.g. AGROVOC)
  // We do distinct in code instead
  const query = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    SELECT ?scheme
    WHERE {
      ?scheme a skos:ConceptScheme .
    }
    LIMIT ${MAX_STORED_SCHEMES + 1}
  `

  // Let errors propagate - runStep will catch and show "error"
  const result = await executeSparql(url, query)
  const allUris = result.results.bindings
    .map((b: any) => b.scheme?.value)
    .filter((uri: string | undefined): uri is string => !!uri)

  // Distinct in code
  const schemeUris = [...new Set(allUris)].slice(0, MAX_STORED_SCHEMES)
  const schemesLimited = allUris.length > MAX_STORED_SCHEMES

  return {
    schemeUris,
    schemeCount: schemeUris.length,
    schemesLimited,
  }
}

export async function detectLanguages(url: string, graphUris?: string[] | null): Promise<DetectedLanguage[]> {
  const parseResults = (results: any): DetectedLanguage[] => {
    return results.results.bindings
      .map((b: any) => ({
        lang: b.lang?.value || '',
        count: parseInt(b.count?.value || '0', 10)
      }))
      .filter((item: DetectedLanguage) => item.lang.length > 0)
  }

  const simpleQuery = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    PREFIX skosxl: <http://www.w3.org/2008/05/skos-xl#>
    SELECT ?lang (COUNT(?label) AS ?count)
    WHERE {
      ?concept a skos:Concept .
      {
        ?concept skos:prefLabel|skos:altLabel ?label .
      } UNION {
        ?concept skosxl:prefLabel/skosxl:literalForm ?label .
      }
      BIND(LANG(?label) AS ?lang)
      FILTER(?lang != "")
    }
    GROUP BY ?lang
    ORDER BY DESC(?count)
  `

  // If we have graph URIs, try GRAPH-based query first (more accurate)
  // but fall back to simple query if it fails (e.g., timeout on large endpoints)
  if (graphUris && graphUris.length > 0) {
    const valuesClause = graphUris.slice(0, 50).map(uri => `<${uri}>`).join(' ')
    const graphQuery = `
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
      ORDER BY DESC(?count)
    `

    try {
      const results = await executeSparql(url, graphQuery)
      return parseResults(results)
    } catch {
      // GRAPH-based query failed (likely timeout) - fall back to simple query
    }
  }

  // Simple query without GRAPH clause
  const results = await executeSparql(url, simpleQuery)
  return parseResults(results)
}

export async function detectRelationships(url: string): Promise<NonNullable<EndpointAnalysis['relationships']>> {
  const query = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    SELECT
      (EXISTS { ?c a skos:Concept . ?c skos:inScheme ?x } AS ?hasInScheme)
      (EXISTS { ?c a skos:Concept . ?c skos:topConceptOf ?x } AS ?hasTopConceptOf)
      (EXISTS { ?s skos:hasTopConcept ?x } AS ?hasHasTopConcept)
      (EXISTS { ?c a skos:Concept . ?c skos:broader ?x } AS ?hasBroader)
      (EXISTS { ?c a skos:Concept . ?c skos:narrower ?x } AS ?hasNarrower)
      (EXISTS { ?c a skos:Concept . ?c skos:broaderTransitive ?x } AS ?hasBroaderTransitive)
      (EXISTS { ?c a skos:Concept . ?c skos:narrowerTransitive ?x } AS ?hasNarrowerTransitive)
    WHERE {}
  `

  // Let errors propagate - runStep will catch and show "error"
  const results = await executeSparql(url, query)
  const binding = results.results.bindings[0]

  if (!binding) {
    throw new Error('No binding returned from relationships query')
  }

  const parseExists = (value?: string): boolean => {
    if (!value) return false
    return value === 'true' || value === '1'
  }

  return {
    hasInScheme: parseExists(binding.hasInScheme?.value),
    hasTopConceptOf: parseExists(binding.hasTopConceptOf?.value),
    hasHasTopConcept: parseExists(binding.hasHasTopConcept?.value),
    hasBroader: parseExists(binding.hasBroader?.value),
    hasNarrower: parseExists(binding.hasNarrower?.value),
    hasBroaderTransitive: parseExists(binding.hasBroaderTransitive?.value),
    hasNarrowerTransitive: parseExists(binding.hasNarrowerTransitive?.value),
  }
}

function isValidLanguageCode(lang: string): boolean {
  return /^[a-z]{2,3}$/.test(lang)
}

/**
 * Detect languages using sampling approach for large datasets.
 * Used as fallback when full language detection times out.
 */
async function detectLanguagesSampled(url: string, sampleSize = 100000): Promise<DetectedLanguage[]> {
  const query = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    SELECT ?lang (COUNT(*) AS ?count)
    WHERE {
      {
        SELECT ?concept WHERE { ?concept a skos:Concept } LIMIT ${sampleSize}
      }
      ?concept skos:prefLabel ?label .
      BIND(LANG(?label) AS ?lang)
      FILTER(?lang != "")
    }
    GROUP BY ?lang
    ORDER BY DESC(?count)
  `

  const results = await executeSparql(url, query)
  return results.results.bindings
    .map((b: any) => ({
      lang: b.lang?.value || '',
      count: parseInt(b.count?.value || '0', 10),
    }))
    .filter((item: DetectedLanguage) => item.lang.length > 0)
}

/**
 * Detect which label predicates exist for each resource type (Concept, ConceptScheme, Collection).
 * Uses EXISTS queries to efficiently check predicate availability.
 */
export async function detectLabelPredicates(url: string): Promise<LabelPredicatesByResourceType> {
  const resourceTypes = [
    { key: 'concept', type: 'skos:Concept' },
    { key: 'scheme', type: 'skos:ConceptScheme' },
    { key: 'collection', type: 'skos:Collection' },
  ] as const

  const result: LabelPredicatesByResourceType = {}

  for (const { key, type } of resourceTypes) {
    const query = `
      PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
      PREFIX skosxl: <http://www.w3.org/2008/05/skos-xl#>
      PREFIX dct: <http://purl.org/dc/terms/>
      PREFIX dc: <http://purl.org/dc/elements/1.1/>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      SELECT
        (EXISTS { ?r a ${type} . ?r skos:prefLabel ?x } AS ?hasPrefLabel)
        (EXISTS { ?r a ${type} . ?r skosxl:prefLabel/skosxl:literalForm ?x } AS ?hasXlPrefLabel)
        (EXISTS { ?r a ${type} . ?r dct:title ?x } AS ?hasDctTitle)
        (EXISTS { ?r a ${type} . ?r dc:title ?x } AS ?hasDcTitle)
        (EXISTS { ?r a ${type} . ?r rdfs:label ?x } AS ?hasRdfsLabel)
      WHERE {}
    `

    try {
      const results = await executeSparql(url, query)
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
    } catch {
      // Query failed for this resource type - skip it
    }
  }

  return result
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Read input configuration from a curation directory.
 */
export function readConfig(dir: string): InputConfig {
  const configPath = join(dir, 'input', 'config.json')
  const content = readFileSync(configPath, 'utf-8')
  return JSON.parse(content)
}

/**
 * Analyze a SPARQL endpoint for SKOS content with step callbacks.
 * Returns null if no SKOS content is found.
 */
export async function analyzeEndpointWithSteps(
  url: string,
  onStep?: StepCallback
): Promise<EndpointAnalysis | null> {
  const totalSteps = 11
  let currentStep = 0

  const runStep = async <T>(name: string, fn: () => Promise<T>, formatResult: (r: T) => string, errorResult = 'error'): Promise<T | null> => {
    currentStep++
    const start = Date.now()
    try {
      const result = await fn()
      const duration = Date.now() - start
      onStep?.(currentStep, totalSteps, name, duration, formatResult(result))
      return result
    } catch (e) {
      const duration = Date.now() - start
      onStep?.(currentStep, totalSteps, name, duration, errorResult)
      return null
    }
  }

  const skipStep = (name: string) => {
    currentStep++
    onStep?.(currentStep, totalSteps, name, 0, '-')
  }

  // Step 1: JSON results support
  const supportsJsonResults = await runStep(
    'JSON results',
    () => detectJsonSupport(url),
    r => r ? 'yes' : 'no'
  )

  // Step 2: Check SKOS content
  const hasSkos = await runStep(
    'SKOS content',
    () => checkSkosContent(url),
    r => r ? 'yes' : 'no'
  )

  if (!hasSkos) {
    return null
  }

  // Step 3: Named graphs support
  const supportsNamedGraphs = await runStep(
    'Named graphs',
    () => detectGraphs(url),
    r => r ? 'yes' : 'no'
  )

  let skosGraphCount: number | null = null
  let skosGraphUris: string[] | null = null

  // Step 4: SKOS graphs (conditional)
  if (supportsNamedGraphs) {
    const skosResult = await runStep(
      'SKOS graphs',
      () => detectSkosGraphs(url),
      r => `${r.count}`
    )
    if (skosResult) {
      skosGraphCount = skosResult.count
      skosGraphUris = skosResult.uris
    }
  } else {
    skipStep('SKOS graphs')
  }

  // Step 5: Concept schemes
  const schemeResult = await runStep(
    'Concept schemes',
    () => detectSchemes(url),
    r => `${r.schemeCount}`
  )

  // Step 6: Concepts
  const totalConcepts = await runStep(
    'Concepts',
    () => countConcepts(url),
    r => r.toLocaleString()
  )

  // Step 7: Collections
  const totalCollections = await runStep(
    'Collections',
    () => countCollections(url),
    r => r.toLocaleString()
  )

  // Step 8: Ordered collections
  const totalOrderedCollections = await runStep(
    'Ordered collections',
    () => countOrderedCollections(url),
    r => r.toLocaleString()
  )

  // Step 9: Relationships
  const relationships = await runStep(
    'Relationships',
    () => detectRelationships(url),
    r => `${Object.values(r).filter(Boolean).length}/7`
  )

  // Step 10: Label predicates (capability detection, like relationships)
  const labelPredicates = await runStep(
    'Label predicates',
    () => detectLabelPredicates(url),
    r => {
      const count = Object.values(r).reduce((sum, caps) => sum + Object.keys(caps || {}).length, 0)
      return `${count}`
    }
  )

  // Step 11: Languages
  const languagesResult = await runStep(
    'Languages',
    () => detectLanguages(url, skosGraphUris),
    r => `${r.length}`
  )

  // Filter to valid ISO language codes and limit to top 50
  const languages = languagesResult
    ? languagesResult.filter(l => isValidLanguageCode(l.lang)).slice(0, 50)
    : []

  return {
    hasSkosContent: true,
    supportsJsonResults: supportsJsonResults ?? null,
    supportsNamedGraphs,
    skosGraphCount,
    schemeUris: schemeResult?.schemeUris?.length ? schemeResult.schemeUris : undefined,
    schemeCount: schemeResult?.schemeCount,
    schemesLimited: schemeResult?.schemesLimited,
    languages,
    totalConcepts,
    totalCollections,
    totalOrderedCollections,
    relationships,
    labelPredicates: labelPredicates ?? undefined,
    analyzedAt: new Date().toISOString(),
  }
}

/**
 * Analyze a SPARQL endpoint for SKOS content.
 * Returns null if no SKOS content is found.
 */
export async function analyzeEndpoint(url: string, log = console.error): Promise<EndpointAnalysis | null> {
  return analyzeEndpointWithSteps(url, (step, total, name, durationMs, result) => {
    log(`  - ${name}: ${result}`)
  })
}

/**
 * Generate language priorities from detected languages.
 * Sorts by count with 'en' moved to front if present.
 */
export function generateLanguagePriorities(languages: DetectedLanguage[]): string[] {
  const langs = languages.map(l => l.lang)

  // Move 'en' to front if present
  const enIndex = langs.indexOf('en')
  if (enIndex > 0) {
    langs.splice(enIndex, 1)
    langs.unshift('en')
  }

  return langs
}

/**
 * Write curated endpoint data to output directory.
 */
export function writeOutput(dir: string, data: CuratedEndpoint): void {
  const outputDir = join(dir, 'output')
  mkdirSync(outputDir, { recursive: true })

  const outputPath = join(outputDir, 'endpoint.json')
  writeFileSync(outputPath, JSON.stringify(data, null, 2))
}

// =============================================================================
// Formatting Helpers
// =============================================================================

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Convenience function for standard curation flow.
 * Reads config, analyzes endpoint, writes output.
 */
export async function curate(dir: string): Promise<void> {
  const config = readConfig(dir)
  const startTime = Date.now()

  console.log('')
  console.log(bold(config.name))
  console.log(dim(config.url))
  console.log('')

  const STEP_NAME_WIDTH = 22
  const RESULT_WIDTH = 12

  const onStep: StepCallback = (step, total, name, durationMs, result) => {
    const stepWidth = `${total}/${total}`.length
    const stepLabel = `${step}/${total}`.padStart(stepWidth)
    const paddedName = name.padEnd(STEP_NAME_WIDTH)
    const paddedResult = result.padStart(RESULT_WIDTH)
    const duration = formatDuration(durationMs).padStart(6)
    console.log(`  ${dim(stepLabel)} ${paddedName}${cyan(paddedResult)}  ${dim(duration)}`)
  }

  const analysis = await analyzeEndpointWithSteps(config.url, onStep)

  if (!analysis) {
    console.log('')
    console.log(`  ${'\x1b[31m✗\x1b[0m'} No SKOS content found`)
    process.exit(1)
  }

  // If languages are empty (timeout), use sampling approach
  let languagesFailed = false
  if (!analysis.languages || analysis.languages.length === 0) {
    console.log('')
    console.log(`  ${dim('→')} Language detection via sampling...`)
    const start = Date.now()

    try {
      const sampledLanguages = await detectLanguagesSampled(config.url)
      analysis.languages = sampledLanguages
        .filter(l => isValidLanguageCode(l.lang))
        .slice(0, 50)
      console.log(`    ${cyan(`${analysis.languages.length} languages`)}  ${dim(formatDuration(Date.now() - start))}`)
    } catch {
      console.log(`    ${dim('error')}`)
      languagesFailed = true
    }
  }

  const suggestedLanguagePriorities = generateLanguagePriorities(analysis.languages || [])

  writeOutput(dir, {
    ...config,
    analysis,
    suggestedLanguagePriorities,
  })

  console.log('')
  if (languagesFailed) {
    const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
    console.log(`  ${yellow('⚠')} ${bold('Complete')} ${dim('(no languages detected)')}  ${dim(formatDuration(Date.now() - startTime))}`)
  } else {
    console.log(`  ${green('✓')} ${bold('Complete')}  ${dim(formatDuration(Date.now() - startTime))}`)
  }
}
