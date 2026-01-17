/**
 * Custom curation script for Getty Vocabularies.
 *
 * Getty has 3.4M+ concepts which causes language detection timeouts.
 * We use a sampling approach to detect languages efficiently.
 */

import {
  readConfig,
  writeOutput,
  analyzeEndpointWithSteps,
  generateLanguagePriorities,
  executeSparql,
  type DetectedLanguage,
  type StepCallback,
} from '../_shared/analyze'

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Detect languages using sampling approach for large datasets.
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

async function main() {
  const dir = import.meta.dirname
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

  // Run standard analysis (languages will fail/timeout)
  const analysis = await analyzeEndpointWithSteps(config.url, onStep)

  if (!analysis) {
    console.log('')
    console.log(`  ${'\x1b[31m✗\x1b[0m'} No SKOS content found`)
    process.exit(1)
  }

  // If languages are empty (timeout), use sampling approach
  if (!analysis.languages || analysis.languages.length === 0) {
    console.log('')
    console.log(`  ${dim('→')} Language detection via sampling...`)
    const start = Date.now()

    try {
      const sampledLanguages = await detectLanguagesSampled(config.url)
      // Filter to valid 2-3 char ISO codes
      analysis.languages = sampledLanguages
        .filter(l => /^[a-z]{2,3}$/.test(l.lang))
        .slice(0, 50)
      console.log(`    ${cyan(`${analysis.languages.length} languages`)}  ${dim(formatDuration(Date.now() - start))}`)
    } catch (e) {
      console.log(`    ${dim('error')}`)
    }
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

main()
