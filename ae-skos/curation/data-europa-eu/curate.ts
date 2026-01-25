/**
 * Specialized curation script for data.europa.eu
 *
 * This endpoint contains millions of DCAT dataset metadata graphs alongside
 * the actual SKOS vocabularies (EU authority tables, EuroVoc, etc.).
 *
 * Pipeline:
 * 1. Find SKOS graphs that have a ConceptScheme (not just loose concepts)
 * 2. Exclude graphs that also contain dcat:Dataset (metadata graphs)
 * 3. Run standard analysis using those specific graphs
 *
 * Run with: npx tsx curation/data-europa-eu/curate.ts
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import {
  detectJsonSupport,
  executeSparql,
  type EndpointAnalysis,
  type DetectedLanguage,
  type LabelPredicateCapabilities,
  type LabelPredicatesByResourceType,
} from '../_shared/analyze'

const curationDir = import.meta.dirname
const ENDPOINT = 'https://data.europa.eu/sparql'

// =============================================================================
// Formatting
// =============================================================================

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

// =============================================================================
// Graph Discovery
// =============================================================================

const PAGE_SIZE = 10000

async function fetchGraphsPaginated(
  queryFn: (limit: number, offset: number) => string,
  label: string
): Promise<Set<string>> {
  const allGraphs = new Set<string>()
  let offset = 0

  while (true) {
    const query = queryFn(PAGE_SIZE, offset)
    const results = await executeSparql(ENDPOINT, query)
    const graphs = results.results.bindings
      .map((b: any) => b.g?.value)
      .filter((uri: string | undefined): uri is string => !!uri)

    graphs.forEach((g: string) => allGraphs.add(g))
    process.stdout.write(`\r  ${label}: ${allGraphs.size.toLocaleString()}...`)

    if (graphs.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  process.stdout.write('\n')
  return allGraphs
}

async function fetchSkosGraphs(): Promise<Set<string>> {
  return fetchGraphsPaginated(
    (limit, offset) => `
      PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
      SELECT DISTINCT ?g
      WHERE {
        GRAPH ?g { ?s a skos:Concept }
      }
      LIMIT ${limit} OFFSET ${offset}
    `,
    'SKOS graphs'
  )
}

async function fetchDcatGraphs(): Promise<Set<string>> {
  return fetchGraphsPaginated(
    (limit, offset) => `
      PREFIX dcat: <http://www.w3.org/ns/dcat#>
      SELECT DISTINCT ?g
      WHERE {
        GRAPH ?g { ?s a dcat:Dataset }
      }
      LIMIT ${limit} OFFSET ${offset}
    `,
    'DCAT graphs'
  )
}

async function checkGraphHasScheme(graphUri: string): Promise<boolean> {
  const query = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    ASK {
      GRAPH <${graphUri}> {
        ?s a skos:ConceptScheme .
      }
    }
  `
  const results = await executeSparql(ENDPOINT, query)
  return results.boolean === true
}

// =============================================================================
// Analysis (using specific graphs)
// =============================================================================

async function countConceptsInGraphs(graphUris: string[]): Promise<number> {
  const valuesClause = graphUris.map(uri => `<${uri}>`).join(' ')
  const query = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    SELECT (COUNT(DISTINCT ?concept) AS ?count)
    WHERE {
      VALUES ?g { ${valuesClause} }
      GRAPH ?g {
        ?concept a skos:Concept .
      }
    }
  `
  const results = await executeSparql(ENDPOINT, query)
  return parseInt(results.results.bindings[0]?.count?.value || '0', 10)
}

async function countCollectionsInGraphs(graphUris: string[]): Promise<number> {
  const valuesClause = graphUris.map(uri => `<${uri}>`).join(' ')
  const query = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    SELECT (COUNT(DISTINCT ?collection) AS ?count)
    WHERE {
      VALUES ?g { ${valuesClause} }
      GRAPH ?g {
        ?collection a skos:Collection .
      }
    }
  `
  const results = await executeSparql(ENDPOINT, query)
  return parseInt(results.results.bindings[0]?.count?.value || '0', 10)
}

async function countOrderedCollectionsInGraphs(graphUris: string[]): Promise<number> {
  const valuesClause = graphUris.map(uri => `<${uri}>`).join(' ')
  const query = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    SELECT (COUNT(DISTINCT ?collection) AS ?count)
    WHERE {
      VALUES ?g { ${valuesClause} }
      GRAPH ?g {
        ?collection a skos:OrderedCollection .
      }
    }
  `
  const results = await executeSparql(ENDPOINT, query)
  return parseInt(results.results.bindings[0]?.count?.value || '0', 10)
}

async function detectSchemesInGraphs(graphUris: string[]): Promise<string[]> {
  const valuesClause = graphUris.map(uri => `<${uri}>`).join(' ')
  const query = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    SELECT DISTINCT ?scheme
    WHERE {
      VALUES ?g { ${valuesClause} }
      GRAPH ?g {
        ?scheme a skos:ConceptScheme .
      }
    }
  `
  const results = await executeSparql(ENDPOINT, query)
  return results.results.bindings
    .map((b: any) => b.scheme?.value)
    .filter((uri: string | undefined): uri is string => !!uri)
}

async function detectLanguagesInGraphs(graphUris: string[]): Promise<DetectedLanguage[]> {
  const valuesClause = graphUris.map(uri => `<${uri}>`).join(' ')
  const query = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    SELECT ?lang (COUNT(?label) AS ?count)
    WHERE {
      VALUES ?g { ${valuesClause} }
      GRAPH ?g {
        ?concept a skos:Concept .
        ?concept skos:prefLabel|skos:altLabel ?label .
      }
      BIND(LANG(?label) AS ?lang)
      FILTER(?lang != "")
    }
    GROUP BY ?lang
    ORDER BY DESC(?count)
  `
  const results = await executeSparql(ENDPOINT, query)
  return results.results.bindings
    .map((b: any) => ({
      lang: b.lang?.value || '',
      count: parseInt(b.count?.value || '0', 10)
    }))
    .filter((item: DetectedLanguage) => item.lang.length > 0 && /^[a-z]{2,3}$/.test(item.lang))
    .slice(0, 50)
}

async function detectRelationshipsInGraphs(graphUris: string[]): Promise<EndpointAnalysis['relationships']> {
  const valuesClause = graphUris.map(uri => `<${uri}>`).join(' ')
  const query = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    SELECT
      (EXISTS { VALUES ?g { ${valuesClause} } GRAPH ?g { ?c skos:inScheme ?x } } AS ?hasInScheme)
      (EXISTS { VALUES ?g { ${valuesClause} } GRAPH ?g { ?c skos:topConceptOf ?x } } AS ?hasTopConceptOf)
      (EXISTS { VALUES ?g { ${valuesClause} } GRAPH ?g { ?s skos:hasTopConcept ?x } } AS ?hasHasTopConcept)
      (EXISTS { VALUES ?g { ${valuesClause} } GRAPH ?g { ?c skos:broader ?x } } AS ?hasBroader)
      (EXISTS { VALUES ?g { ${valuesClause} } GRAPH ?g { ?c skos:narrower ?x } } AS ?hasNarrower)
      (EXISTS { VALUES ?g { ${valuesClause} } GRAPH ?g { ?c skos:broaderTransitive ?x } } AS ?hasBroaderTransitive)
      (EXISTS { VALUES ?g { ${valuesClause} } GRAPH ?g { ?c skos:narrowerTransitive ?x } } AS ?hasNarrowerTransitive)
    WHERE {}
  `
  const results = await executeSparql(ENDPOINT, query)
  const binding = results.results.bindings[0]

  const parseExists = (value?: string): boolean => {
    if (!value) return false
    return value === 'true' || value === '1'
  }

  return {
    hasInScheme: parseExists(binding?.hasInScheme?.value),
    hasTopConceptOf: parseExists(binding?.hasTopConceptOf?.value),
    hasHasTopConcept: parseExists(binding?.hasHasTopConcept?.value),
    hasBroader: parseExists(binding?.hasBroader?.value),
    hasNarrower: parseExists(binding?.hasNarrower?.value),
    hasBroaderTransitive: parseExists(binding?.hasBroaderTransitive?.value),
    hasNarrowerTransitive: parseExists(binding?.hasNarrowerTransitive?.value),
  }
}

async function detectLabelPredicatesInGraphs(graphUris: string[]): Promise<LabelPredicatesByResourceType> {
  const valuesClause = graphUris.map(uri => `<${uri}>`).join(' ')

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
        (EXISTS { VALUES ?g { ${valuesClause} } GRAPH ?g { ?r a ${type} . ?r skos:prefLabel ?x } } AS ?hasPrefLabel)
        (EXISTS { VALUES ?g { ${valuesClause} } GRAPH ?g { ?r a ${type} . ?r skosxl:prefLabel/skosxl:literalForm ?x } } AS ?hasXlPrefLabel)
        (EXISTS { VALUES ?g { ${valuesClause} } GRAPH ?g { ?r a ${type} . ?r dct:title ?x } } AS ?hasDctTitle)
        (EXISTS { VALUES ?g { ${valuesClause} } GRAPH ?g { ?r a ${type} . ?r dc:title ?x } } AS ?hasDcTitle)
        (EXISTS { VALUES ?g { ${valuesClause} } GRAPH ?g { ?r a ${type} . ?r rdfs:label ?x } } AS ?hasRdfsLabel)
      WHERE {}
    `

    try {
      const results = await executeSparql(ENDPOINT, query)
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
// Main
// =============================================================================

async function main() {
  const overallStart = Date.now()
  const STEP_NAME_WIDTH = 22
  const RESULT_WIDTH = 12

  const logStep = (step: number, total: number, name: string, result: string, durationMs: number) => {
    const stepWidth = `${total}/${total}`.length
    const stepLabel = `${step}/${total}`.padStart(stepWidth)
    const paddedName = name.padEnd(STEP_NAME_WIDTH)
    const paddedResult = result.padStart(RESULT_WIDTH)
    const duration = formatDuration(durationMs).padStart(6)
    console.log(`  ${dim(stepLabel)} ${paddedName}${cyan(paddedResult)}  ${dim(duration)}`)
  }

  console.log('')
  console.log(bold('data.europa.eu - Specialized Curation'))
  console.log(dim(ENDPOINT))
  console.log('')

  const logPreStep = (label: string, name: string, result: string, durationMs: number) => {
    const paddedName = name.padEnd(STEP_NAME_WIDTH)
    const paddedResult = result.padStart(RESULT_WIDTH)
    const duration = formatDuration(durationMs).padStart(6)
    console.log(`  ${dim(label.padStart(3))} ${paddedName}${cyan(paddedResult)}  ${dim(duration)}`)
  }

  let start: number

  // Pre-step a: Fetch SKOS graphs
  start = Date.now()
  const skosGraphs = await fetchSkosGraphs()
  logPreStep('a', 'SKOS graphs', skosGraphs.size.toLocaleString(), Date.now() - start)

  // Pre-step b: Fetch DCAT graphs to exclude
  start = Date.now()
  const dcatGraphs = await fetchDcatGraphs()
  logPreStep('b', 'DCAT graphs', dcatGraphs.size.toLocaleString(), Date.now() - start)

  // Filter: remove SKOS graphs that overlap with DCAT
  const skosOnlyGraphs = [...skosGraphs].filter(g => !dcatGraphs.has(g))
  console.log(`  ${green('→')} ${bold(String(skosOnlyGraphs.length))} SKOS-only graphs (no DCAT overlap)`)

  if (skosOnlyGraphs.length === 0) {
    console.log('  No SKOS-only graphs found')
    process.exit(1)
  }

  // Pre-step c: Check which graphs have ConceptScheme
  start = Date.now()
  const validGraphs: string[] = []
  for (let i = 0; i < skosOnlyGraphs.length; i++) {
    const graph = skosOnlyGraphs[i]
    process.stdout.write(`\r  Checking for ConceptScheme: ${i + 1}/${skosOnlyGraphs.length}...`)
    try {
      if (await checkGraphHasScheme(graph)) {
        validGraphs.push(graph)
      }
    } catch {
      // Skip on error
    }
  }
  process.stdout.write('\n')
  logPreStep('c', 'With ConceptScheme', String(validGraphs.length), Date.now() - start)
  console.log('')

  if (validGraphs.length === 0) {
    console.log('  No graphs with ConceptScheme found')
    process.exit(1)
  }

  // Standard 11-step analysis
  // 1/11 JSON results support
  start = Date.now()
  let supportsJsonResults: boolean | null = null
  try {
    supportsJsonResults = await detectJsonSupport(ENDPOINT)
    logStep(1, 11, 'JSON results', supportsJsonResults ? 'yes' : 'no', Date.now() - start)
  } catch {
    logStep(1, 11, 'JSON results', 'error', Date.now() - start)
  }

  // 2/11 SKOS content - we know it's yes
  logStep(2, 11, 'SKOS content', 'yes', 0)

  // 3/11 Named graphs - we know it's yes
  logStep(3, 11, 'Named graphs', 'yes', 0)

  // 4/11 SKOS graphs - already discovered
  logStep(4, 11, 'SKOS graphs', String(validGraphs.length), 0)

  // 5/11 Concept schemes
  start = Date.now()
  const schemeUris = await detectSchemesInGraphs(validGraphs)
  logStep(5, 11, 'Concept schemes', String(schemeUris.length), Date.now() - start)

  // 6/11 Concepts
  start = Date.now()
  const totalConcepts = await countConceptsInGraphs(validGraphs)
  logStep(6, 11, 'Concepts', totalConcepts.toLocaleString(), Date.now() - start)

  // 7/11 Collections
  start = Date.now()
  const totalCollections = await countCollectionsInGraphs(validGraphs)
  logStep(7, 11, 'Collections', totalCollections.toLocaleString(), Date.now() - start)

  // 8/11 Ordered collections
  start = Date.now()
  const totalOrderedCollections = await countOrderedCollectionsInGraphs(validGraphs)
  logStep(8, 11, 'Ordered collections', totalOrderedCollections.toLocaleString(), Date.now() - start)

  // 9/11 Relationships
  start = Date.now()
  const relationships = await detectRelationshipsInGraphs(validGraphs)
  const relCount = Object.values(relationships).filter(Boolean).length
  logStep(9, 11, 'Relationships', `${relCount}/7`, Date.now() - start)

  // 10/11 Label predicates
  start = Date.now()
  const labelPredicates = await detectLabelPredicatesInGraphs(validGraphs)
  const labelCount = Object.values(labelPredicates).reduce((sum, caps) => sum + Object.keys(caps || {}).length, 0)
  logStep(10, 11, 'Label predicates', String(labelCount), Date.now() - start)

  // 11/11 Languages
  start = Date.now()
  const languages = await detectLanguagesInGraphs(validGraphs)
  logStep(11, 11, 'Languages', String(languages.length), Date.now() - start)

  const totalDuration = Date.now() - overallStart
  console.log('')
  console.log(`  ${green('✓')} ${bold('Complete')}  ${dim(formatDuration(totalDuration))}`)

  // Build output
  const analysis: EndpointAnalysis = {
    hasSkosContent: true,
    supportsJsonResults,
    supportsNamedGraphs: true,
    skosGraphCount: validGraphs.length,
    schemeUris: schemeUris.slice(0, 200),
    schemeCount: schemeUris.length,
    schemesLimited: schemeUris.length > 200,
    languages,
    totalConcepts,
    totalCollections,
    totalOrderedCollections,
    relationships,
    labelPredicates: Object.keys(labelPredicates).length > 0 ? labelPredicates : undefined,
    analyzedAt: new Date().toISOString(),
  }

  const suggestedLanguagePriorities = languages.map(l => l.lang)
  // Move 'en' to front if present
  const enIndex = suggestedLanguagePriorities.indexOf('en')
  if (enIndex > 0) {
    suggestedLanguagePriorities.splice(enIndex, 1)
    suggestedLanguagePriorities.unshift('en')
  }

  const output = {
    name: 'data.europa.eu',
    url: ENDPOINT,
    description: 'The official open data portal of the European Union. Contains EU authority tables (languages, countries, corporate bodies) and EuroVoc thesaurus.',
    analysis,
    suggestedLanguagePriorities,
    // Extra: list of valid graph URIs for reference
    _validGraphs: validGraphs,
  }

  // Write output
  const outputDir = join(curationDir, 'output')
  mkdirSync(outputDir, { recursive: true })

  const outputPath = join(outputDir, 'endpoint.json')
  writeFileSync(outputPath, JSON.stringify(output, null, 2))

  console.log('')
  console.log(`${green('✓')} Written: ${outputPath}`)
  console.log('')
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
