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

export interface EndpointAnalysis {
  hasSkosContent: boolean
  supportsNamedGraphs: boolean | null
  skosGraphCount: number | null
  schemeUris?: string[]
  schemeCount?: number
  schemesLimited?: boolean
  languages?: DetectedLanguage[]
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

export async function executeSparql(url: string, query: string): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/sparql-results+json',
    },
    body: `query=${encodeURIComponent(query)}`,
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  return response.json()
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
  let query: string

  if (graphUris && graphUris.length > 0) {
    const valuesClause = graphUris.slice(0, 50).map(uri => `<${uri}>`).join(' ')
    query = `
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
  } else {
    query = `
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
  }

  // Let errors propagate - runStep will catch and show "error"
  const results = await executeSparql(url, query)
  return results.results.bindings
    .map((b: any) => ({
      lang: b.lang?.value || '',
      count: parseInt(b.count?.value || '0', 10)
    }))
    .filter((item: DetectedLanguage) => item.lang.length > 0)
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
  const totalSteps = 7
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

  // Step 1: Check SKOS content
  const hasSkos = await runStep(
    'SKOS content',
    () => checkSkosContent(url),
    r => r ? 'yes' : 'no'
  )

  if (!hasSkos) {
    return null
  }

  // Step 2: Named graphs support
  const supportsNamedGraphs = await runStep(
    'Named graphs',
    () => detectGraphs(url),
    r => r ? 'yes' : 'no'
  )

  let skosGraphCount: number | null = null
  let skosGraphUris: string[] | null = null

  // Step 3: SKOS graphs (conditional)
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

  // Step 4: Concept schemes
  const schemeResult = await runStep(
    'Concept schemes',
    () => detectSchemes(url),
    r => `${r.schemeCount}`
  )

  // Step 5: Concepts
  const totalConcepts = await runStep(
    'Concepts',
    () => countConcepts(url),
    r => r.toLocaleString()
  )

  // Step 6: Relationships
  const relationships = await runStep(
    'Relationships',
    () => detectRelationships(url),
    r => `${Object.values(r).filter(Boolean).length}/7`
  )

  // Step 7: Languages
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
    supportsNamedGraphs,
    skosGraphCount,
    schemeUris: schemeResult?.schemeUris?.length ? schemeResult.schemeUris : undefined,
    schemeCount: schemeResult?.schemeCount,
    schemesLimited: schemeResult?.schemesLimited,
    languages,
    totalConcepts,
    relationships,
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

  const STEP_NAME_WIDTH = 16
  const RESULT_WIDTH = 12

  const onStep: StepCallback = (step, total, name, durationMs, result) => {
    const paddedName = name.padEnd(STEP_NAME_WIDTH)
    const paddedResult = result.padStart(RESULT_WIDTH)
    const duration = formatDuration(durationMs).padStart(6)
    console.log(`  ${dim(`${step}/${total}`)} ${paddedName}${cyan(paddedResult)}  ${dim(duration)}`)
  }

  const analysis = await analyzeEndpointWithSteps(config.url, onStep)

  if (!analysis) {
    console.log('')
    console.log(`  ${'\x1b[31m✗\x1b[0m'} No SKOS content found`)
    process.exit(1)
  }

  const suggestedLanguagePriorities = generateLanguagePriorities(analysis.languages || [])

  writeOutput(dir, {
    ...config,
    analysis,
    suggestedLanguagePriorities,
  })

  console.log('')
  console.log(`  ${green('✓')} ${bold('Complete')}  ${dim(formatDuration(Date.now() - startTime))}`)
}
