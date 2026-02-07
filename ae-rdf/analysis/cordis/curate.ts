/**
 * Template analysis script for ae-rdf endpoints.
 *
 * @see /spec/ae-rdf/rdf00-EndpointAnalysis.md
 *
 * Run with: npx tsx analysis/_template/curate.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { analyzeEndpoint } from '../_shared/engine'

const baseDir = import.meta.dirname
const configPath = join(baseDir, 'input', 'config.json')
const rulesPath = join(baseDir, 'input', 'rules.json')
const outputDir = join(baseDir, 'output')
const analysisPath = join(outputDir, 'analysis.json')
const endpointPath = join(outputDir, 'endpoint.json')

const config = JSON.parse(readFileSync(configPath, 'utf-8'))
const rules = JSON.parse(readFileSync(rulesPath, 'utf-8'))

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`

const startTime = Date.now()
console.log('')
console.log(bold(config.name))
console.log(dim(config.url))
console.log('')

const analysis = await analyzeEndpoint(config, rules, (message) => {
  console.log(`  ${message}`)
})

mkdirSync(outputDir, { recursive: true })
writeFileSync(analysisPath, JSON.stringify(analysis, null, 2))
writeFileSync(endpointPath, JSON.stringify({ ...config, analysis }, null, 2))
console.log('')
console.log(`  ${green('✓')} ${bold('Complete')}  ${dim(`${((Date.now() - startTime) / 1000).toFixed(1)}s`)}`)
console.log(`  ${dim('Wrote')} ${analysisPath}`)
console.log(`  ${dim('Wrote')} ${endpointPath}`)
