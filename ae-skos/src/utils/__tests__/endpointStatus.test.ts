/**
 * Endpoint Status Utility Tests
 *
 * Tests for configuration status calculation.
 * @see /spec/common/com01-EndpointManager.md
 */
import { describe, it, expect } from 'vitest'
import { getConfigStatus } from '../endpointStatus'
import type { SPARQLEndpoint } from '../../types'

// Helper to create a minimal endpoint for testing
function createEndpoint(overrides: Partial<SPARQLEndpoint> = {}): SPARQLEndpoint {
  return {
    id: 'test-id',
    name: 'Test Endpoint',
    url: 'https://example.org/sparql',
    createdAt: '2024-01-01T00:00:00Z',
    accessCount: 0,
    ...overrides,
  }
}

describe('getConfigStatus', () => {
  describe('basic validation', () => {
    it('returns neutral for null endpoint', () => {
      const result = getConfigStatus(null)
      expect(result.status).toBe('neutral')
      expect(result.label).toBe('Not configured')
    })

    it('returns neutral for undefined endpoint', () => {
      const result = getConfigStatus(undefined)
      expect(result.status).toBe('neutral')
      expect(result.label).toBe('Not configured')
    })

    it('returns neutral for empty URL', () => {
      const endpoint = createEndpoint({ url: '' })
      const result = getConfigStatus(endpoint)
      expect(result.status).toBe('neutral')
      expect(result.label).toBe('Not configured')
    })

    it('returns neutral for whitespace-only URL', () => {
      const endpoint = createEndpoint({ url: '   ' })
      const result = getConfigStatus(endpoint)
      expect(result.status).toBe('neutral')
      expect(result.label).toBe('Not configured')
    })

    it('returns error for invalid URL', () => {
      const endpoint = createEndpoint({ url: 'not-a-valid-url' })
      const result = getConfigStatus(endpoint)
      expect(result.status).toBe('error')
      expect(result.label).toBe('Invalid URL')
    })

    it('returns error for ftp URL', () => {
      const endpoint = createEndpoint({ url: 'ftp://example.org/files' })
      const result = getConfigStatus(endpoint)
      expect(result.status).toBe('error')
      expect(result.label).toBe('Invalid URL')
    })
  })

  describe('test status', () => {
    it('returns warning when testing in progress', () => {
      const endpoint = createEndpoint({
        lastTestStatus: 'testing',
        analysis: { hasSkosContent: true, supportsNamedGraphs: false, skosGraphCount: 0, analyzedAt: '' },
      })
      const result = getConfigStatus(endpoint)
      expect(result.status).toBe('warning')
      expect(result.label).toBe('Testing...')
    })

    it('returns error when connection failed', () => {
      const endpoint = createEndpoint({
        lastTestStatus: 'error',
        analysis: { hasSkosContent: true, supportsNamedGraphs: false, skosGraphCount: 0, analyzedAt: '' },
      })
      const result = getConfigStatus(endpoint)
      expect(result.status).toBe('error')
      expect(result.label).toBe('Connection failed')
    })

    it('returns warning for CORS_BLOCKED error', () => {
      const endpoint = createEndpoint({
        lastTestStatus: 'error',
        lastTestErrorCode: 'CORS_BLOCKED',
        analysis: { hasSkosContent: true, supportsNamedGraphs: false, skosGraphCount: 0, analyzedAt: '' },
      })
      const result = getConfigStatus(endpoint)
      expect(result.status).toBe('warning')
      expect(result.label).toBe('CORS blocked')
    })

    it('prioritizes CORS_BLOCKED over generic connection error', () => {
      const endpoint = createEndpoint({
        lastTestStatus: 'error',
        lastTestErrorCode: 'CORS_BLOCKED',
      })
      const result = getConfigStatus(endpoint)
      expect(result.status).toBe('warning')
      expect(result.label).toBe('CORS blocked')
    })
  })

  describe('analysis status', () => {
    it('returns error when no SKOS content', () => {
      const endpoint = createEndpoint({
        analysis: { hasSkosContent: false, supportsNamedGraphs: false, skosGraphCount: 0, analyzedAt: '' },
      })
      const result = getConfigStatus(endpoint)
      expect(result.status).toBe('error')
      expect(result.label).toBe('No SKOS content')
    })

    it('returns warning when analysis pending', () => {
      const endpoint = createEndpoint({
        analysis: undefined,
      })
      const result = getConfigStatus(endpoint)
      expect(result.status).toBe('warning')
      expect(result.label).toBe('Analysis pending')
    })

    it('returns warning when no languages detected', () => {
      const endpoint = createEndpoint({
        analysis: {
          hasSkosContent: true,
          supportsNamedGraphs: false,
          skosGraphCount: 0,
          analyzedAt: '',
          languages: [],
        },
        languagePriorities: [],
      })
      const result = getConfigStatus(endpoint)
      expect(result.status).toBe('warning')
      expect(result.label).toBe('No languages detected')
    })

    it('returns warning when CORS issue detected', () => {
      const endpoint = createEndpoint({
        analysis: {
          hasSkosContent: true,
          supportsNamedGraphs: false,
          skosGraphCount: 0,
          analyzedAt: '',
          cors: false,
          languages: [{ lang: 'en', count: 100 }],
        },
      })
      const result = getConfigStatus(endpoint)
      expect(result.status).toBe('warning')
      expect(result.label).toBe('CORS issue')
    })
  })

  describe('success state', () => {
    it('returns success when fully configured', () => {
      const endpoint = createEndpoint({
        lastTestStatus: 'success',
        analysis: {
          hasSkosContent: true,
          supportsNamedGraphs: true,
          skosGraphCount: 1,
          analyzedAt: '2024-01-01T00:00:00Z',
          languages: [{ lang: 'en', count: 100 }],
        },
      })
      const result = getConfigStatus(endpoint)
      expect(result.status).toBe('success')
      expect(result.label).toBe('Configuration complete')
    })

    it('considers languagePriorities for language detection', () => {
      const endpoint = createEndpoint({
        analysis: {
          hasSkosContent: true,
          supportsNamedGraphs: false,
          skosGraphCount: 0,
          analyzedAt: '',
          languages: [], // No languages from analysis
        },
        languagePriorities: ['en', 'fr'], // But user has set priorities
      })
      const result = getConfigStatus(endpoint)
      expect(result.status).toBe('success')
      expect(result.label).toBe('Configuration complete')
    })

    it('considers analysis.languages for language detection', () => {
      const endpoint = createEndpoint({
        analysis: {
          hasSkosContent: true,
          supportsNamedGraphs: false,
          skosGraphCount: 0,
          analyzedAt: '',
          languages: [{ lang: 'de', count: 50 }], // Languages from analysis
        },
        languagePriorities: [], // No user priorities
      })
      const result = getConfigStatus(endpoint)
      expect(result.status).toBe('success')
      expect(result.label).toBe('Configuration complete')
    })
  })

  describe('additionalLanguageCount option', () => {
    it('considers additionalLanguageCount for wizard state', () => {
      const endpoint = createEndpoint({
        analysis: {
          hasSkosContent: true,
          supportsNamedGraphs: false,
          skosGraphCount: 0,
          analyzedAt: '',
          languages: [], // No languages from analysis
        },
        languagePriorities: [], // No saved priorities
      })
      // But wizard has pending priorities
      const result = getConfigStatus(endpoint, { additionalLanguageCount: 3 })
      expect(result.status).toBe('success')
      expect(result.label).toBe('Configuration complete')
    })

    it('uses maximum of endpoint and additional language counts', () => {
      const endpoint = createEndpoint({
        analysis: {
          hasSkosContent: true,
          supportsNamedGraphs: false,
          skosGraphCount: 0,
          analyzedAt: '',
          languages: [{ lang: 'en', count: 100 }], // 1 from analysis
        },
        languagePriorities: ['fr'], // 1 from priorities
      })
      // additionalLanguageCount is 0, but we already have 2 from endpoint
      const result = getConfigStatus(endpoint, { additionalLanguageCount: 0 })
      expect(result.status).toBe('success')
    })
  })

  describe('status priority order', () => {
    it('checks testing status before SKOS content', () => {
      const endpoint = createEndpoint({
        lastTestStatus: 'testing',
        analysis: { hasSkosContent: false, supportsNamedGraphs: false, skosGraphCount: 0, analyzedAt: '' },
      })
      const result = getConfigStatus(endpoint)
      expect(result.status).toBe('warning')
      expect(result.label).toBe('Testing...')
    })

    it('checks SKOS content before connection error', () => {
      const endpoint = createEndpoint({
        lastTestStatus: 'error',
        analysis: { hasSkosContent: false, supportsNamedGraphs: false, skosGraphCount: 0, analyzedAt: '' },
      })
      const result = getConfigStatus(endpoint)
      expect(result.status).toBe('error')
      expect(result.label).toBe('No SKOS content')
    })

    it('checks CORS blocked before connection error', () => {
      const endpoint = createEndpoint({
        lastTestStatus: 'error',
        lastTestErrorCode: 'CORS_BLOCKED',
        analysis: { hasSkosContent: true, supportsNamedGraphs: false, skosGraphCount: 0, analyzedAt: '' },
      })
      const result = getConfigStatus(endpoint)
      expect(result.status).toBe('warning')
      expect(result.label).toBe('CORS blocked')
    })
  })
})
