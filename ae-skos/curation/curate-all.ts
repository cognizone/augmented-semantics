/**
 * Curate all endpoints and merge the results.
 *
 * @see /spec/ae-skos/sko09-CurationWorkflow.md
 *
 * Run with: npx tsx curation/curate-all.ts
 */

import { readdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import {
  readConfig,
  analyzeEndpointWithSteps,
  generateLanguagePriorities,
  writeOutput,
  type EndpointAnalysis,
  type StepCallback,
} from './_shared/analyze'

const curationDir = import.meta.dirname

// =============================================================================
// Formatting Helpers
// =============================================================================

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function formatNumber(n: number | undefined): string {
  if (n === undefined) return '?'
  return n.toLocaleString()
}

// =============================================================================
// Curation Logic
// =============================================================================

interface CurationResult {
  name: string
  success: boolean
  durationMs: number
  analysis?: EndpointAnalysis
  error?: string
}

async function curateEndpoint(dir: string, index: number, total: number): Promise<CurationResult> {
  const fullPath = join(curationDir, dir)
  const configPath = join(fullPath, 'input', 'config.json')
  const startTime = Date.now()

  if (!existsSync(configPath)) {
    return {
      name: dir,
      success: false,
      durationMs: Date.now() - startTime,
      error: 'No input/config.json found',
    }
  }

  const config = readConfig(fullPath)

  // Header
  console.log('')
  console.log(`${dim('─'.repeat(60))}`)
  console.log(`${bold(`[${index}/${total}]`)} ${bold(config.name)}`)
  console.log(`${dim(config.url)}`)
  console.log('')

  // Step callback for progress display
  const STEP_NAME_WIDTH = 16
  const RESULT_WIDTH = 12

  const onStep: StepCallback = (step, stepTotal, name, durationMs, result) => {
    const paddedName = name.padEnd(STEP_NAME_WIDTH)
    const paddedResult = result.padStart(RESULT_WIDTH)
    const duration = formatDuration(durationMs).padStart(6)
    console.log(`  ${dim(`${step}/${stepTotal}`)} ${paddedName}${cyan(paddedResult)}  ${dim(duration)}`)
  }

  try {
    const analysis = await analyzeEndpointWithSteps(config.url, onStep)

    if (!analysis) {
      console.log('')
      console.log(`  ${red('✗')} No SKOS content found`)
      return {
        name: config.name,
        success: false,
        durationMs: Date.now() - startTime,
        error: 'No SKOS content',
      }
    }

    const suggestedLanguagePriorities = generateLanguagePriorities(analysis.languages || [])

    writeOutput(fullPath, {
      ...config,
      analysis,
      suggestedLanguagePriorities,
    })

    console.log('')
    console.log(`  ${green('✓')} ${bold('Complete')}  ${dim(formatDuration(Date.now() - startTime))}`)

    return {
      name: config.name,
      success: true,
      durationMs: Date.now() - startTime,
      analysis,
    }
  } catch (error) {
    console.log('')
    console.log(`  ${red('✗')} Error: ${error}`)
    return {
      name: config.name,
      success: false,
      durationMs: Date.now() - startTime,
      error: String(error),
    }
  }
}

async function main() {
  const overallStart = Date.now()

  // Header
  console.log('')
  console.log(bold('╔════════════════════════════════════════════════════════════╗'))
  console.log(bold('║              SKOS Endpoint Curation                        ║'))
  console.log(bold('╚════════════════════════════════════════════════════════════╝'))

  // Get all endpoint directories
  const entries = readdirSync(curationDir)
  const endpointDirs = entries.filter(entry => {
    if (entry.startsWith('_') || entry.startsWith('.')) return false
    if (entry.endsWith('.ts')) return false
    const fullPath = join(curationDir, entry)
    return statSync(fullPath).isDirectory()
  }).sort()

  console.log('')
  console.log(`Found ${bold(String(endpointDirs.length))} endpoints to curate`)

  const results: CurationResult[] = []

  for (let i = 0; i < endpointDirs.length; i++) {
    const result = await curateEndpoint(endpointDirs[i], i + 1, endpointDirs.length)
    results.push(result)
  }

  // Final summary
  const successful = results.filter(r => r.success)
  const failed = results.filter(r => !r.success)
  const totalDuration = Date.now() - overallStart

  console.log('')
  console.log(`${dim('─'.repeat(60))}`)
  console.log('')
  console.log(bold('Summary'))
  console.log('')
  console.log(`  Total time:  ${bold(formatDuration(totalDuration))}`)
  console.log(`  Successful:  ${green(String(successful.length))}/${endpointDirs.length}`)

  if (failed.length > 0) {
    console.log(`  Failed:      ${red(String(failed.length))}`)
    console.log('')
    console.log(`  ${yellow('Failed endpoints:')}`)
    for (const f of failed) {
      console.log(`    - ${f.name}: ${f.error}`)
    }
  }

  // Totals from successful
  const totalSchemes = successful.reduce((sum, r) => sum + (r.analysis?.schemeCount || 0), 0)
  const totalConcepts = successful.reduce((sum, r) => sum + (r.analysis?.totalConcepts || 0), 0)

  console.log('')
  console.log(`  ${dim('Totals across all endpoints:')}`)
  console.log(`    Schemes:  ${formatNumber(totalSchemes)}`)
  console.log(`    Concepts: ${formatNumber(totalConcepts)}`)

  // Run merge
  if (successful.length > 0) {
    console.log('')
    console.log(`${dim('─'.repeat(60))}`)
    console.log('')
    console.log(bold('Merging results...'))
    console.log('')

    const { execSync } = await import('child_process')
    execSync('npx tsx curation/merge.ts', {
      cwd: join(curationDir, '..'),
      stdio: 'inherit',
    })
  }

  console.log('')

  if (failed.length > 0) {
    process.exit(1)
  }
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
