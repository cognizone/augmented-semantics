/**
 * Merge script to combine curated endpoint outputs into a single endpoints.json.
 *
 * @see /spec/ae-rdf/rdf00-EndpointAnalysis.md
 *
 * Run with: npx tsx analysis/merge.ts
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join, dirname } from 'path'

const analysisDir = import.meta.dirname
const outputPath = join(analysisDir, '..', 'src', 'data', 'endpoints.json')
const SKIP_DIRS = new Set(['_shared', '_template'])

const REQUIRED_FIELDS = ['name', 'url', 'analysis'] as const

type RequiredFields = (typeof REQUIRED_FIELDS)[number]

interface CuratedEndpoint {
  name: string
  url: string
  description?: string
  analysis: Record<string, unknown>
}

interface ValidationResult {
  valid: boolean
  endpoint?: CuratedEndpoint
  errors: string[]
  warnings: string[]
}

function validateEndpoint(data: unknown, filename: string): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (typeof data !== 'object' || data === null) {
    return { valid: false, errors: ['File does not contain a valid JSON object'], warnings }
  }

  const obj = data as Record<string, unknown>

  for (const field of REQUIRED_FIELDS) {
    if (!(field in obj) || obj[field] === undefined || obj[field] === null) {
      errors.push(`Missing required field: ${field}`)
    }
  }

  if ('name' in obj && typeof obj.name !== 'string') {
    errors.push('Field "name" must be a string')
  }

  if ('url' in obj && typeof obj.url !== 'string') {
    errors.push('Field "url" must be a string')
  }

  if ('analysis' in obj && (typeof obj.analysis !== 'object' || obj.analysis === null)) {
    errors.push('Field "analysis" must be an object')
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings }
  }

  const endpoint: CuratedEndpoint = {
    name: obj.name as string,
    url: obj.url as string,
    description: obj.description as string | undefined,
    analysis: obj.analysis as Record<string, unknown>,
  }

  return { valid: true, endpoint, errors, warnings }
}

function listEndpointDirs(): string[] {
  return readdirSync(analysisDir).filter((dir) => {
    if (dir.startsWith('.') || SKIP_DIRS.has(dir)) return false
    const fullPath = join(analysisDir, dir)
    return statSync(fullPath).isDirectory()
  })
}

function main(): void {
  const dirs = listEndpointDirs()
  const endpoints: CuratedEndpoint[] = []
  const failures: string[] = []

  for (const dir of dirs) {
    const file = join(analysisDir, dir, 'output', 'endpoint.json')
    if (!existsSync(file)) {
      failures.push(`${dir}: missing output/endpoint.json`)
      continue
    }

    const raw = JSON.parse(readFileSync(file, 'utf-8'))
    const result = validateEndpoint(raw, file)

    if (!result.valid || !result.endpoint) {
      failures.push(`${dir}: ${result.errors.join('; ')}`)
      continue
    }

    endpoints.push(result.endpoint)
  }

  if (!existsSync(dirname(outputPath))) {
    console.error(`Output directory missing: ${dirname(outputPath)}`)
    console.error('Create it or adjust outputPath in analysis/merge.ts')
    process.exitCode = 1
    return
  }

  writeFileSync(outputPath, JSON.stringify({ endpoints }, null, 2))

  if (failures.length > 0) {
    console.warn('Some endpoints failed validation:')
    for (const failure of failures) {
      console.warn(`- ${failure}`)
    }
  }
}

main()
