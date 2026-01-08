/**
 * Prebuild script to analyze trusted endpoints and generate pre-calculated data.
 *
 * Run with: npx tsx scripts/prebuild-endpoints.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Types
interface TrustedEndpointSource {
  name: string
  url: string
}

interface DetectedLanguage {
  lang: string
  count: number
}

interface EndpointAnalysis {
  hasSkosContent: boolean
  supportsNamedGraphs: boolean | null
  skosGraphCount: number | null
  languages?: DetectedLanguage[]
  analyzedAt: string
}

interface TrustedEndpoint extends TrustedEndpointSource {
  analysis: EndpointAnalysis
  suggestedLanguagePriorities: string[]
}

// SPARQL execution
async function executeSparql(url: string, query: string): Promise<any> {
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

// Check for SKOS content (first check - most important)
async function hasSkosContent(url: string): Promise<boolean> {
  const query = `
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    ASK {
      { ?s a skos:ConceptScheme }
      UNION
      { ?s a skos:Concept }
    }
  `

  try {
    const results = await executeSparql(url, query)
    return results.boolean === true
  } catch {
    return false
  }
}

// Detect named graphs support
async function detectGraphs(url: string): Promise<boolean | null> {
  const query = `ASK { GRAPH ?g { ?s ?p ?o } }`

  try {
    const results = await executeSparql(url, query)
    return results.boolean === true
  } catch {
    return null
  }
}

// Detect SKOS graphs
async function detectSkosGraphs(url: string): Promise<{ count: number | null; uris: string[] | null }> {
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

  try {
    const results = await executeSparql(url, query)
    const uris = results.results.bindings
      .map((b: any) => b.g?.value)
      .filter((uri: string | undefined): uri is string => !!uri)

    if (uris.length > 500) {
      return { count: uris.length, uris: null }
    }

    return { count: uris.length, uris }
  } catch {
    return { count: null, uris: null }
  }
}

// Detect languages
async function detectLanguages(url: string, graphUris?: string[] | null): Promise<DetectedLanguage[]> {
  let query: string

  if (graphUris && graphUris.length > 0) {
    // Batched query for specific graphs
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
    // Default query
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

  try {
    const results = await executeSparql(url, query)
    return results.results.bindings
      .map((b: any) => ({
        lang: b.lang?.value || '',
        count: parseInt(b.count?.value || '0', 10)
      }))
      .filter((item: DetectedLanguage) => item.lang.length > 0)
  } catch {
    return []
  }
}

// Filter to valid ISO language codes (2-3 chars, lowercase letters only)
function isValidLanguageCode(lang: string): boolean {
  return /^[a-z]{2,3}$/.test(lang)
}

// Full analysis - returns null if no SKOS content found
async function analyzeEndpoint(url: string): Promise<EndpointAnalysis | null> {
  console.log(`  - Checking for SKOS content...`)
  const hasSkos = await hasSkosContent(url)

  if (!hasSkos) {
    console.log(`  ✗ No SKOS content found`)
    return null
  }

  console.log(`  - Detecting named graphs...`)
  const supportsNamedGraphs = await detectGraphs(url)

  let skosGraphCount: number | null = null
  let skosGraphUris: string[] | null = null

  if (supportsNamedGraphs === true) {
    console.log(`  - Detecting SKOS graphs...`)
    const skosResult = await detectSkosGraphs(url)
    skosGraphCount = skosResult.count
    skosGraphUris = skosResult.uris
  }

  console.log(`  - Detecting languages...`)
  let languages = await detectLanguages(url, skosGraphUris)

  // Filter to valid ISO language codes and limit to top 50
  languages = languages
    .filter(l => isValidLanguageCode(l.lang))
    .slice(0, 50)

  return {
    hasSkosContent: true,
    supportsNamedGraphs,
    skosGraphCount,
    languages,
    analyzedAt: new Date().toISOString(),
  }
}

// Generate language priorities from detected languages
function generateLanguagePriorities(languages: DetectedLanguage[]): string[] {
  // Take all languages by count, with 'en' first if present
  const langs = languages.map(l => l.lang)

  // Move 'en' to front if present
  const enIndex = langs.indexOf('en')
  if (enIndex > 0) {
    langs.splice(enIndex, 1)
    langs.unshift('en')
  }

  return langs
}

// Main
async function main() {
  const forceRebuild = process.argv.includes('--force')
  const sourcePath = join(__dirname, '../src/data/trusted-endpoints.json')
  const outputPath = join(__dirname, '../src/data/trusted-endpoints.generated.json')

  // Read source and compute hash
  const sourceContent = readFileSync(sourcePath, 'utf-8')
  const sourceHash = createHash('md5').update(sourceContent).digest('hex')

  // Check if rebuild is needed
  if (!forceRebuild && existsSync(outputPath)) {
    try {
      const existing = JSON.parse(readFileSync(outputPath, 'utf-8'))
      if (existing._sourceHash === sourceHash) {
        console.log('✓ Source unchanged, skipping rebuild. Use --force to rebuild.')
        return
      }
    } catch {
      // Continue with rebuild if can't read existing file
    }
  }

  console.log('Reading trusted endpoints source...')
  const sources: TrustedEndpointSource[] = JSON.parse(sourceContent)

  console.log(`Found ${sources.length} endpoints to analyze.\n`)

  const results: TrustedEndpoint[] = []

  for (const source of sources) {
    console.log(`Analyzing: ${source.name} (${source.url})`)

    try {
      const analysis = await analyzeEndpoint(source.url)

      if (analysis === null) {
        console.log(`  → Excluded: no SKOS content\n`)
        continue
      }

      const suggestedLanguagePriorities = generateLanguagePriorities(analysis.languages || [])

      results.push({
        ...source,
        analysis,
        suggestedLanguagePriorities,
      })

      console.log(`  ✓ Done: ${analysis.languages?.length || 0} languages detected\n`)
    } catch (error) {
      console.error(`  ✗ Failed: ${error}`)
      console.log(`  → Excluded: analysis failed\n`)
    }
  }

  console.log('Writing generated file...')
  const output = { _sourceHash: sourceHash, endpoints: results }
  writeFileSync(outputPath, JSON.stringify(output, null, 2))
  console.log(`✓ Generated: ${outputPath}`)
}

main().catch(console.error)
