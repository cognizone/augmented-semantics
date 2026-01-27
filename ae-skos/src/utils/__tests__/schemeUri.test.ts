/**
 * Scheme URI Utility Tests
 *
 * Tests for URI variant generation and SPARQL clause building.
 * @see /spec/ae-skos/sko04-ConceptTree.md#scheme-uri-slash-fix
 */
import { describe, it, expect } from 'vitest'
import { getSchemeUriVariants, buildSchemeValuesClause } from '../schemeUri'
import type { EndpointAnalysis } from '../../types'

// Helper to create minimal analysis for testing
function createAnalysis(overrides: Partial<EndpointAnalysis> = {}): EndpointAnalysis {
  return {
    hasSkosContent: true,
    supportsNamedGraphs: false,
    skosGraphCount: 0,
    analyzedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('getSchemeUriVariants', () => {
  describe('basic validation', () => {
    it('returns empty array for empty URI', () => {
      const analysis = createAnalysis({ schemeUriSlashMismatch: true })
      const result = getSchemeUriVariants('', analysis, true)
      expect(result).toEqual([])
    })

    it('returns single URI when fix is disabled', () => {
      const analysis = createAnalysis({ schemeUriSlashMismatch: true })
      const result = getSchemeUriVariants('http://example.org/scheme', analysis, false)
      expect(result).toEqual(['http://example.org/scheme'])
    })

    it('returns single URI when analysis is undefined', () => {
      const result = getSchemeUriVariants('http://example.org/scheme', undefined, true)
      expect(result).toEqual(['http://example.org/scheme'])
    })

    it('returns single URI when no mismatch detected', () => {
      const analysis = createAnalysis({ schemeUriSlashMismatch: false })
      const result = getSchemeUriVariants('http://example.org/scheme', analysis, true)
      expect(result).toEqual(['http://example.org/scheme'])
    })

    it('returns single URI when schemeUriSlashMismatch is undefined', () => {
      const analysis = createAnalysis()
      const result = getSchemeUriVariants('http://example.org/scheme', analysis, true)
      expect(result).toEqual(['http://example.org/scheme'])
    })
  })

  describe('variant generation', () => {
    it('generates variant without trailing slash when original has it', () => {
      const analysis = createAnalysis({ schemeUriSlashMismatch: true })
      const result = getSchemeUriVariants('http://example.org/scheme/', analysis, true)
      expect(result).toEqual(['http://example.org/scheme/', 'http://example.org/scheme'])
    })

    it('generates variant with trailing slash when original lacks it', () => {
      const analysis = createAnalysis({ schemeUriSlashMismatch: true })
      const result = getSchemeUriVariants('http://example.org/scheme', analysis, true)
      expect(result).toEqual(['http://example.org/scheme', 'http://example.org/scheme/'])
    })

    it('strips multiple trailing slashes', () => {
      const analysis = createAnalysis({ schemeUriSlashMismatch: true })
      const result = getSchemeUriVariants('http://example.org/scheme///', analysis, true)
      expect(result).toEqual(['http://example.org/scheme///', 'http://example.org/scheme'])
    })

    it('handles root path URI', () => {
      const analysis = createAnalysis({ schemeUriSlashMismatch: true })
      const result = getSchemeUriVariants('http://example.org/', analysis, true)
      expect(result).toEqual(['http://example.org/', 'http://example.org'])
    })
  })
})

describe('buildSchemeValuesClause', () => {
  describe('single variant (no fix needed)', () => {
    it('returns direct URI term when fix is disabled', () => {
      const analysis = createAnalysis({ schemeUriSlashMismatch: true })
      const result = buildSchemeValuesClause('http://example.org/scheme', analysis, false)
      expect(result.schemeTerm).toBe('<http://example.org/scheme>')
      expect(result.valuesClause).toBe('')
    })

    it('returns direct URI term when no mismatch', () => {
      const analysis = createAnalysis({ schemeUriSlashMismatch: false })
      const result = buildSchemeValuesClause('http://example.org/scheme', analysis, true)
      expect(result.schemeTerm).toBe('<http://example.org/scheme>')
      expect(result.valuesClause).toBe('')
    })

    it('returns direct URI term when analysis is undefined', () => {
      const result = buildSchemeValuesClause('http://example.org/scheme', undefined, true)
      expect(result.schemeTerm).toBe('<http://example.org/scheme>')
      expect(result.valuesClause).toBe('')
    })
  })

  describe('multiple variants (fix enabled)', () => {
    it('generates VALUES clause with both variants', () => {
      const analysis = createAnalysis({ schemeUriSlashMismatch: true })
      const result = buildSchemeValuesClause('http://example.org/scheme', analysis, true)
      expect(result.schemeTerm).toBe('?scheme')
      expect(result.valuesClause).toBe(
        'VALUES ?scheme { <http://example.org/scheme> <http://example.org/scheme/> }'
      )
    })

    it('uses custom variable name', () => {
      const analysis = createAnalysis({ schemeUriSlashMismatch: true })
      const result = buildSchemeValuesClause('http://example.org/scheme', analysis, true, 'myScheme')
      expect(result.schemeTerm).toBe('?myScheme')
      expect(result.valuesClause).toBe(
        'VALUES ?myScheme { <http://example.org/scheme> <http://example.org/scheme/> }'
      )
    })

    it('preserves original URI order (original first)', () => {
      const analysis = createAnalysis({ schemeUriSlashMismatch: true })
      const result = buildSchemeValuesClause('http://example.org/scheme/', analysis, true)
      expect(result.valuesClause).toBe(
        'VALUES ?scheme { <http://example.org/scheme/> <http://example.org/scheme> }'
      )
    })
  })
})
