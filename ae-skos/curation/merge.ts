/**
 * Merge script to combine curated endpoint outputs into a single endpoints.json.
 *
 * @see /spec/ae-skos/sko09-CurationWorkflow.md
 *
 * Run with: npx tsx curation/merge.ts
 *
 * This script reads all output/endpoint.json files from each endpoint folder
 * and merges them into src/data/endpoints.json.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join, dirname } from 'path'

const curationDir = import.meta.dirname
const outputPath = join(curationDir, '..', 'src', 'data', 'endpoints.json')

// Required fields for each curated endpoint
const REQUIRED_FIELDS = ['name', 'url', 'analysis', 'suggestedLanguagePriorities'] as const

interface CuratedEndpoint {
  name: string
  url: string
  description?: string
  analysis: {
    hasSkosContent: boolean
    [key: string]: unknown
  }
  suggestedLanguagePriorities: string[]
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

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in obj) || obj[field] === undefined || obj[field] === null) {
      errors.push(`Missing required field: ${field}`)
    }
  }

  // Validate field types
  if ('name' in obj && typeof obj.name !== 'string') {
    errors.push('Field "name" must be a string')
  }

  if ('url' in obj && typeof obj.url !== 'string') {
    errors.push('Field "url" must be a string')
  }

  if ('description' in obj && obj.description !== undefined && typeof obj.description !== 'string') {
    errors.push('Field "description" must be a string if provided')
  }

  if ('analysis' in obj) {
    if (typeof obj.analysis !== 'object' || obj.analysis === null) {
      errors.push('Field "analysis" must be an object')
    } else {
      const analysis = obj.analysis as Record<string, unknown>
      if (!('hasSkosContent' in analysis)) {
        warnings.push('Field "analysis.hasSkosContent" is missing')
      }
    }
  }

  if ('suggestedLanguagePriorities' in obj) {
    if (!Array.isArray(obj.suggestedLanguagePriorities)) {
      errors.push('Field "suggestedLanguagePriorities" must be an array')
    } else if (!obj.suggestedLanguagePriorities.every((l: unknown) => typeof l === 'string')) {
      errors.push('Field "suggestedLanguagePriorities" must contain only strings')
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings }
  }

  return {
    valid: true,
    endpoint: obj as unknown as CuratedEndpoint,
    errors,
    warnings,
  }
}

async function main() {
  console.log('Merging curated endpoint files...\n')

  // Get all directories in curation folder (excluding _shared)
  const entries = readdirSync(curationDir)
  const endpointDirs = entries.filter(entry => {
    if (entry.startsWith('_') || entry.startsWith('.')) return false
    if (entry.endsWith('.ts')) return false
    const fullPath = join(curationDir, entry)
    return statSync(fullPath).isDirectory()
  })

  if (endpointDirs.length === 0) {
    console.error('Error: No endpoint directories found')
    process.exit(1)
  }

  console.log(`Found ${endpointDirs.length} endpoint directories.\n`)

  const endpoints: CuratedEndpoint[] = []
  let hasErrors = false

  for (const dir of endpointDirs) {
    const outputFile = join(curationDir, dir, 'output', 'endpoint.json')

    if (!existsSync(outputFile)) {
      console.log(`${dir}/`)
      console.log(`  ⚠ Warning: No output/endpoint.json found`)
      console.log(`  → Skipped\n`)
      continue
    }

    console.log(`${dir}/`)

    try {
      const content = readFileSync(outputFile, 'utf-8')
      const data = JSON.parse(content)
      const result = validateEndpoint(data, dir)

      if (result.warnings.length > 0) {
        for (const warning of result.warnings) {
          console.log(`  ⚠ Warning: ${warning}`)
        }
      }

      if (!result.valid) {
        for (const error of result.errors) {
          console.log(`  ✗ Error: ${error}`)
        }
        console.log(`  → Skipped\n`)
        hasErrors = true
        continue
      }

      endpoints.push(result.endpoint!)
      console.log(`  ✓ Valid: ${result.endpoint!.name}\n`)
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.log(`  ✗ Error: Invalid JSON syntax`)
      } else {
        console.log(`  ✗ Error: ${error}`)
      }
      console.log(`  → Skipped\n`)
      hasErrors = true
    }
  }

  if (endpoints.length === 0) {
    console.error('Error: No valid endpoints found')
    process.exit(1)
  }

  // Sort alphabetically by name
  endpoints.sort((a, b) => a.name.localeCompare(b.name))

  console.log(`Writing ${endpoints.length} endpoints to endpoints.json...`)
  writeFileSync(outputPath, JSON.stringify(endpoints, null, 2))
  console.log(`✓ Generated: ${outputPath}`)

  if (hasErrors) {
    console.log('\n⚠ Some directories had issues and were skipped. Please review the errors above.')
    process.exit(1)
  }
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
