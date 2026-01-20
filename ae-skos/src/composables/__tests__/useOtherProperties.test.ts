/**
 * useOtherProperties Composable Tests
 *
 * Tests for loading non-SKOS properties.
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useOtherProperties, CONCEPT_EXCLUDED_PREDICATES, SCHEME_EXCLUDED_PREDICATES, COLLECTION_EXCLUDED_PREDICATES } from '../useOtherProperties'
import { useEndpointStore } from '../../stores'

// Mock logger
vi.mock('../../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock SPARQL service
vi.mock('../../services/sparql', () => ({
  executeSparql: vi.fn(),
  withPrefixes: vi.fn((q) => q),
  resolveUris: vi.fn().mockResolvedValue(new Map()),
  formatQualifiedName: vi.fn(({ prefix, localName }) => `${prefix}:${localName}`),
}))

import { executeSparql } from '../../services/sparql'
import type { Mock } from 'vitest'

describe('useOtherProperties', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    // Set up default endpoint
    const endpointStore = useEndpointStore()
    const endpoint = endpointStore.addEndpoint({
      name: 'Test Endpoint',
      url: 'https://example.org/sparql',
    })
    endpointStore.selectEndpoint(endpoint.id)

    // Default mock - empty results
    ;(executeSparql as Mock).mockResolvedValue({ results: { bindings: [] } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createTarget() {
    return {
      otherProperties: [],
    }
  }

  describe('loadOtherProperties', () => {
    it('returns early if no endpoint', async () => {
      const endpointStore = useEndpointStore()
      endpointStore.selectEndpoint(null as unknown as string)

      const { loadOtherProperties } = useOtherProperties()
      const target = createTarget()

      await loadOtherProperties('http://ex.org/concept', target)

      expect(executeSparql).not.toHaveBeenCalled()
    })

    it('loads properties and groups by predicate', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            {
              predicate: { value: 'http://ex.org/prop1' },
              value: { type: 'literal', value: 'Value 1' },
            },
            {
              predicate: { value: 'http://ex.org/prop1' },
              value: { type: 'literal', value: 'Value 2' },
            },
            {
              predicate: { value: 'http://ex.org/prop2' },
              value: { type: 'uri', value: 'http://ex.org/ref' },
            },
          ],
        },
      })

      const { loadOtherProperties } = useOtherProperties()
      const target = createTarget()

      await loadOtherProperties('http://ex.org/concept', target)

      expect(target.otherProperties).toHaveLength(2)

      const prop1 = target.otherProperties.find(p => p.predicate === 'http://ex.org/prop1')
      expect(prop1?.values).toHaveLength(2)

      const prop2 = target.otherProperties.find(p => p.predicate === 'http://ex.org/prop2')
      expect(prop2?.values).toHaveLength(1)
      expect(prop2?.values[0]?.isUri).toBe(true)
    })

    it('preserves language tags', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            {
              predicate: { value: 'http://ex.org/prop' },
              value: { type: 'literal', value: 'English', 'xml:lang': 'en' },
            },
            {
              predicate: { value: 'http://ex.org/prop' },
              value: { type: 'literal', value: 'French', 'xml:lang': 'fr' },
            },
          ],
        },
      })

      const { loadOtherProperties } = useOtherProperties()
      const target = createTarget()

      await loadOtherProperties('http://ex.org/concept', target)

      const prop = target.otherProperties[0]
      expect(prop?.values).toHaveLength(2)
      expect(prop?.values.find(v => v.lang === 'en')).toBeTruthy()
      expect(prop?.values.find(v => v.lang === 'fr')).toBeTruthy()
    })

    it('deduplicates values by value+lang+datatype', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            {
              predicate: { value: 'http://ex.org/prop' },
              value: { type: 'literal', value: 'Same Value', 'xml:lang': 'en' },
            },
            {
              predicate: { value: 'http://ex.org/prop' },
              value: { type: 'literal', value: 'Same Value', 'xml:lang': 'en' }, // Duplicate
            },
          ],
        },
      })

      const { loadOtherProperties } = useOtherProperties()
      const target = createTarget()

      await loadOtherProperties('http://ex.org/concept', target)

      expect(target.otherProperties[0]?.values).toHaveLength(1)
    })

    it('handles SPARQL errors gracefully', async () => {
      ;(executeSparql as Mock).mockRejectedValue(new Error('Query failed'))

      const { loadOtherProperties } = useOtherProperties()
      const target = createTarget()

      // Should not throw
      await loadOtherProperties('http://ex.org/concept', target)

      expect(target.otherProperties).toHaveLength(0)
    })

    it('skips bindings without predicate or value', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { predicate: { value: 'http://ex.org/prop' } }, // No value
            { value: { type: 'literal', value: 'orphan' } }, // No predicate
            {
              predicate: { value: 'http://ex.org/prop' },
              value: { type: 'literal', value: 'Valid' },
            },
          ],
        },
      })

      const { loadOtherProperties } = useOtherProperties()
      const target = createTarget()

      await loadOtherProperties('http://ex.org/concept', target)

      expect(target.otherProperties).toHaveLength(1)
      expect(target.otherProperties[0]?.values).toHaveLength(1)
    })
  })

  describe('excluded predicates', () => {
    it('exports CONCEPT_EXCLUDED_PREDICATES', () => {
      expect(CONCEPT_EXCLUDED_PREDICATES).toContain('skos:broader')
      expect(CONCEPT_EXCLUDED_PREDICATES).toContain('skos:narrower')
      expect(CONCEPT_EXCLUDED_PREDICATES).toContain('skos:inScheme')
    })

    it('exports CONCEPT_EXCLUDED_PREDICATES with documentation properties', () => {
      // rdfs:comment and dct:description are displayed in the documentation section
      expect(CONCEPT_EXCLUDED_PREDICATES).toContain('rdfs:comment')
      expect(CONCEPT_EXCLUDED_PREDICATES).toContain('dct:description')
    })

    it('exports SCHEME_EXCLUDED_PREDICATES', () => {
      expect(SCHEME_EXCLUDED_PREDICATES).toContain('skos:hasTopConcept')
      expect(SCHEME_EXCLUDED_PREDICATES).toContain('dct:title')
      expect(SCHEME_EXCLUDED_PREDICATES).toContain('owl:versionInfo')
    })

    it('exports COLLECTION_EXCLUDED_PREDICATES', () => {
      expect(COLLECTION_EXCLUDED_PREDICATES).toContain('skos:member')
      expect(COLLECTION_EXCLUDED_PREDICATES).toContain('skos:inScheme')
    })

    it('exports COLLECTION_EXCLUDED_PREDICATES with documentation properties', () => {
      // rdfs:comment and dct:description are displayed in the documentation section
      expect(COLLECTION_EXCLUDED_PREDICATES).toContain('rdfs:comment')
      expect(COLLECTION_EXCLUDED_PREDICATES).toContain('dct:description')
    })
  })
})
