/**
 * Code Quality Tests - Prevent Duplicate Formatters
 *
 * These tests ensure developers use shared utilities instead of
 * creating local duplicate functions that can lead to inconsistencies.
 *
 * Background: Date/time formatting has been a source of regressions
 * because developers created local `formatDate` functions instead of
 * using the shared `formatTemporalValue` utility.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Recursively get all .vue and .ts files in a directory
 */
function getSourceFiles(dir: string, files: string[] = []): string[] {
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      // Skip node_modules, dist, and test directories
      if (!['node_modules', 'dist', '__tests__'].includes(entry)) {
        getSourceFiles(fullPath, files)
      }
    } else if (entry.endsWith('.vue') || (entry.endsWith('.ts') && !entry.endsWith('.test.ts'))) {
      files.push(fullPath)
    }
  }
  return files
}

describe('Code Quality - No Duplicate Formatters', () => {
  const srcDir = join(__dirname, '../..')
  const sourceFiles = getSourceFiles(srcDir)

  it('should not have local formatDate functions (use formatTemporalValue from displayUtils)', () => {
    const violations: string[] = []

    // Pattern matches: function formatDate, const formatDate =, etc.
    // Excludes the utility file itself
    const pattern = /function\s+formatDate|const\s+formatDate\s*=/g

    for (const file of sourceFiles) {
      // Skip the displayUtils file where formatTemporalValue is defined
      if (file.includes('displayUtils.ts')) continue

      const content = readFileSync(file, 'utf-8')
      if (pattern.test(content)) {
        const relativePath = file.replace(srcDir, 'src')
        violations.push(relativePath)
      }
    }

    expect(violations, `
Found local formatDate functions in the following files:
${violations.map(f => `  - ${f}`).join('\n')}

These should be replaced with the shared utility:
  import { formatTemporalValue } from '@/utils/displayUtils'

For RDF typed literals (xsd:date, xsd:dateTime, xsd:time):
  formatTemporalValue(value, 'xsd:date')     → "2009-01-14"
  formatTemporalValue(value, 'xsd:dateTime') → "2009-01-14T10:30:00Z"
  formatTemporalValue(value, 'xsd:time')     → "10:30:00"

For UI display dates (last accessed, etc.), use:
  new Date(value).toLocaleDateString()
directly in the template, or create a separate UI-specific formatter.
`).toHaveLength(0)
  })

  it('should not have local toLocaleDateString wrappers for RDF values', () => {
    // This is a softer check - we look for patterns that suggest
    // someone is formatting RDF dates incorrectly
    const violations: string[] = []

    // Pattern: toLocaleDateString used near RDF-related variable names
    const suspiciousPatterns = [
      /(?:created|modified|issued|date).*toLocaleDateString/gi,
      /toLocaleDateString.*(?:created|modified|issued|date)/gi,
    ]

    for (const file of sourceFiles) {
      // Skip files that legitimately use locale formatting for UI
      if (file.includes('EndpointManager')) continue

      const content = readFileSync(file, 'utf-8')
      for (const pattern of suspiciousPatterns) {
        if (pattern.test(content)) {
          const relativePath = file.replace(srcDir, 'src')
          if (!violations.includes(relativePath)) {
            violations.push(relativePath)
          }
        }
      }
    }

    // This is a warning, not a hard failure - review manually
    if (violations.length > 0) {
      console.warn(`
Warning: Found potential RDF date formatting with toLocaleDateString in:
${violations.map(f => `  - ${f}`).join('\n')}

RDF dates (dct:created, dct:modified, etc.) should use ISO format via formatTemporalValue.
Please review these files to ensure correct formatting.
`)
    }
  })
})
