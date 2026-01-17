/**
 * Curate all endpoints by running each endpoint's curate.ts script.
 *
 * @see /spec/ae-skos/sko09-CurationWorkflow.md
 *
 * Run with: npx tsx curation/curate-all.ts
 */

import { readdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'

const curationDir = import.meta.dirname

// =============================================================================
// Formatting Helpers
// =============================================================================

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

// =============================================================================
// Run Individual Curate Script
// =============================================================================

interface CurationResult {
  name: string
  success: boolean
  durationMs: number
  error?: string
}

function runCurateScript(dir: string, index: number, total: number): Promise<CurationResult> {
  return new Promise((resolve) => {
    const fullPath = join(curationDir, dir)
    const scriptPath = join(fullPath, 'curate.ts')
    const startTime = Date.now()

    if (!existsSync(scriptPath)) {
      resolve({
        name: dir,
        success: false,
        durationMs: Date.now() - startTime,
        error: 'No curate.ts found',
      })
      return
    }

    console.log('')
    console.log(`${dim('─'.repeat(60))}`)
    console.log(`${bold(`[${index}/${total}]`)} ${bold(dir)}`)
    console.log('')

    const child = spawn('npx', ['tsx', scriptPath], {
      cwd: fullPath,
      stdio: 'inherit',
      shell: true,
    })

    child.on('close', (code) => {
      resolve({
        name: dir,
        success: code === 0,
        durationMs: Date.now() - startTime,
        error: code !== 0 ? `Exit code ${code}` : undefined,
      })
    })

    child.on('error', (err) => {
      resolve({
        name: dir,
        success: false,
        durationMs: Date.now() - startTime,
        error: err.message,
      })
    })
  })
}

// =============================================================================
// Main
// =============================================================================

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
    const result = await runCurateScript(endpointDirs[i], i + 1, endpointDirs.length)
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
