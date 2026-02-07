/**
 * Curate all endpoints by running each endpoint's curate.ts script.
 *
 * @see /spec/ae-rdf/rdf00-EndpointAnalysis.md
 *
 * Run with: npx tsx analysis/curate-all.ts
 */

import { readdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'

const analysisDir = import.meta.dirname
const SKIP_DIRS = new Set(['_shared', '_template'])

// =============================================================================
// Formatting Helpers
// =============================================================================

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`

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
    const fullPath = join(analysisDir, dir)
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

async function main(): Promise<void> {
  const dirs = readdirSync(analysisDir).filter((dir) => {
    if (dir.startsWith('.') || SKIP_DIRS.has(dir)) return false
    const fullPath = join(analysisDir, dir)
    return statSync(fullPath).isDirectory()
  })

  if (dirs.length === 0) {
    console.log('No endpoint folders found.')
    return
  }

  const results: CurationResult[] = []

  for (let i = 0; i < dirs.length; i += 1) {
    results.push(await runCurateScript(dirs[i], i + 1, dirs.length))
  }

  console.log('')
  console.log(dim('─'.repeat(60)))
  console.log(bold('Summary'))

  for (const result of results) {
    const status = result.success ? green('OK') : red('FAIL')
    const duration = formatDuration(result.durationMs)
    const extra = result.error ? ` - ${result.error}` : ''
    console.log(`${status} ${result.name} (${duration})${extra}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
