/**
 * useCollections Composable Tests
 *
 * Tests for SKOS Collection loading and processing.
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCollections } from '../useCollections'
import { useEndpointStore } from '../../stores'

// Mock the services
vi.mock('../../services/sparql', () => ({
  executeSparql: vi.fn(),
  withPrefixes: vi.fn((q) => q),
  endpointHasCollections: vi.fn(() => true),
}))

vi.mock('../../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { executeSparql } from '../../services/sparql'

describe('useCollections', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    // Set up default endpoint with analysis data
    const endpointStore = useEndpointStore()
    const endpoint = endpointStore.addEndpoint({
      name: 'Test Endpoint',
      url: 'https://example.org/sparql',
    })
    // Add analysis with relationships so capability-aware queries work
    endpoint.analysis = {
      hasSkosContent: true,
      supportsNamedGraphs: false,
      skosGraphCount: 0,
      languages: [],
      analyzedAt: new Date().toISOString(),
      relationships: {
        hasInScheme: true,
        hasTopConceptOf: true,
        hasHasTopConcept: true,
        hasBroader: true,
        hasNarrower: true,
        hasBroaderTransitive: true,
        hasNarrowerTransitive: true,
      },
    }
    endpointStore.selectEndpoint(endpoint.id)

    // Default mock implementation
    ;(executeSparql as Mock).mockResolvedValue({ results: { bindings: [] } })
  })

  describe('initial state', () => {
    it('has correct initial values', () => {
      const { collections, loading, error } = useCollections()

      expect(collections.value).toEqual([])
      expect(loading.value).toBe(false)
      expect(error.value).toBeNull()
    })
  })

  describe('loadCollectionsForScheme', () => {
    it('returns early when no endpoint is selected', async () => {
      const endpointStore = useEndpointStore()
      endpointStore.selectEndpoint(null as unknown as string)

      const { loadCollectionsForScheme, loading } = useCollections()
      await loadCollectionsForScheme('http://example.org/scheme')

      expect(executeSparql).not.toHaveBeenCalled()
      expect(loading.value).toBe(false)
    })

    it('sets loading state during execution', async () => {
      const { loadCollectionsForScheme, loading } = useCollections()

      expect(loading.value).toBe(false)
      const promise = loadCollectionsForScheme('http://example.org/scheme')
      expect(loading.value).toBe(true)

      await promise
      expect(loading.value).toBe(false)
    })

    it('loads collections with prefLabel', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              collection: { value: 'http://example.org/collection/1' },
              label: { value: 'Collection One' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
            },
          ],
        },
      })

      const { loadCollectionsForScheme, collections } = useCollections()
      await loadCollectionsForScheme('http://example.org/scheme')

      expect(collections.value).toHaveLength(1)
      expect(collections.value[0].uri).toBe('http://example.org/collection/1')
      expect(collections.value[0].label).toBe('Collection One')
      expect(collections.value[0].labelLang).toBe('en')
    })

    it('picks prefLabel over other label types', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              collection: { value: 'http://example.org/collection/1' },
              label: { value: 'RDFS Label' },
              labelLang: { value: 'en' },
              labelType: { value: 'rdfsLabel' },
            },
            {
              collection: { value: 'http://example.org/collection/1' },
              label: { value: 'Pref Label' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
            },
          ],
        },
      })

      const { loadCollectionsForScheme, collections } = useCollections()
      await loadCollectionsForScheme('http://example.org/scheme')

      expect(collections.value[0].label).toBe('Pref Label')
    })

    it('picks dcTitle when no prefLabel/xlPrefLabel/title exists', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              collection: { value: 'http://example.org/collection/1' },
              label: { value: 'RDFS Label' },
              labelLang: { value: 'en' },
              labelType: { value: 'rdfsLabel' },
            },
            {
              collection: { value: 'http://example.org/collection/1' },
              label: { value: 'DC Title' },
              labelLang: { value: 'en' },
              labelType: { value: 'dcTitle' },
            },
          ],
        },
      })

      const { loadCollectionsForScheme, collections } = useCollections()
      await loadCollectionsForScheme('http://example.org/scheme')

      expect(collections.value[0].label).toBe('DC Title')
    })

    it('groups bindings by collection URI', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              collection: { value: 'http://example.org/collection/1' },
              label: { value: 'Label EN' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
            },
            {
              collection: { value: 'http://example.org/collection/1' },
              label: { value: 'Label FR' },
              labelLang: { value: 'fr' },
              labelType: { value: 'prefLabel' },
            },
            {
              collection: { value: 'http://example.org/collection/2' },
              label: { value: 'Collection Two' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
            },
          ],
        },
      })

      const { loadCollectionsForScheme, collections } = useCollections()
      await loadCollectionsForScheme('http://example.org/scheme')

      expect(collections.value).toHaveLength(2)
    })

    it('handles notation', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              collection: { value: 'http://example.org/collection/1' },
              label: { value: 'Collection One' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
              notation: { value: 'C1' },
            },
          ],
        },
      })

      const { loadCollectionsForScheme, collections } = useCollections()
      await loadCollectionsForScheme('http://example.org/scheme')

      expect(collections.value[0].notation).toBe('C1')
    })

    it('sorts collections by label', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              collection: { value: 'http://example.org/collection/2' },
              label: { value: 'Zebra Collection' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
            },
            {
              collection: { value: 'http://example.org/collection/1' },
              label: { value: 'Alpha Collection' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
            },
          ],
        },
      })

      const { loadCollectionsForScheme, collections } = useCollections()
      await loadCollectionsForScheme('http://example.org/scheme')

      expect(collections.value[0].label).toBe('Alpha Collection')
      expect(collections.value[1].label).toBe('Zebra Collection')
    })

    it('sets error on query failure', async () => {
      ;(executeSparql as Mock).mockRejectedValueOnce(new Error('Network error'))

      const { loadCollectionsForScheme, collections, error } = useCollections()
      await loadCollectionsForScheme('http://example.org/scheme')

      expect(collections.value).toEqual([])
      expect(error.value).toContain('Network error')
    })

    it('clears error on successful load', async () => {
      ;(executeSparql as Mock).mockRejectedValueOnce(new Error('First error'))

      const { loadCollectionsForScheme, error } = useCollections()
      await loadCollectionsForScheme('http://example.org/scheme')
      expect(error.value).not.toBeNull()

      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      await loadCollectionsForScheme('http://example.org/scheme')
      expect(error.value).toBeNull()
    })
  })

  describe('reset', () => {
    it('clears all state', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              collection: { value: 'http://example.org/collection/1' },
              label: { value: 'Test' },
              labelType: { value: 'prefLabel' },
            },
          ],
        },
      })

      const { loadCollectionsForScheme, collections, reset } = useCollections()
      await loadCollectionsForScheme('http://example.org/scheme')
      expect(collections.value).toHaveLength(1)

      reset()

      expect(collections.value).toEqual([])
    })
  })

  describe('capability-aware query building', () => {
    it('skips loading when endpoint has no analysis', async () => {
      const endpointStore = useEndpointStore()
      const endpoint = endpointStore.current!
      // Remove analysis
      delete (endpoint as Record<string, unknown>).analysis

      const { loadCollectionsForScheme, collections } = useCollections()
      await loadCollectionsForScheme('http://example.org/scheme')

      expect(executeSparql).not.toHaveBeenCalled()
      expect(collections.value).toEqual([])
    })

    it('skips loading when endpoint has no relationships', async () => {
      const endpointStore = useEndpointStore()
      const endpoint = endpointStore.current!
      endpoint.analysis = {
        hasSkosContent: true,
        supportsNamedGraphs: false,
        skosGraphCount: 0,
        languages: [],
        analyzedAt: new Date().toISOString(),
        relationships: {
          hasInScheme: false,
          hasTopConceptOf: false,
          hasHasTopConcept: false,
          hasBroader: false,
          hasNarrower: false,
          hasBroaderTransitive: false,
          hasNarrowerTransitive: false,
        },
      }

      const { loadCollectionsForScheme, collections } = useCollections()
      await loadCollectionsForScheme('http://example.org/scheme')

      expect(executeSparql).not.toHaveBeenCalled()
      expect(collections.value).toEqual([])
    })

    it('executes query when at least one capability exists', async () => {
      const endpointStore = useEndpointStore()
      const endpoint = endpointStore.current!
      endpoint.analysis = {
        hasSkosContent: true,
        supportsNamedGraphs: false,
        skosGraphCount: 0,
        languages: [],
        analyzedAt: new Date().toISOString(),
        relationships: {
          hasInScheme: true, // Only this one capability
          hasTopConceptOf: false,
          hasHasTopConcept: false,
          hasBroader: false,
          hasNarrower: false,
          hasBroaderTransitive: false,
          hasNarrowerTransitive: false,
        },
      }

      const { loadCollectionsForScheme } = useCollections()
      await loadCollectionsForScheme('http://example.org/scheme')

      expect(executeSparql).toHaveBeenCalled()
    })
  })

  describe('nested collections support', () => {
    it('sets isNested when hasParentCollection is true', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              collection: { value: 'http://example.org/collection/1' },
              label: { value: 'Nested Collection' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
              hasParentCollection: { value: 'true' },
              hasChildCollections: { value: 'false' },
            },
          ],
        },
      })

      const { loadCollectionsForScheme, collections } = useCollections()
      await loadCollectionsForScheme('http://example.org/scheme')

      expect(collections.value).toHaveLength(1)
      expect(collections.value[0].isNested).toBe(true)
    })

    it('sets hasChildCollections when hasChildCollections is true', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              collection: { value: 'http://example.org/collection/1' },
              label: { value: 'Parent Collection' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
              hasParentCollection: { value: 'false' },
              hasChildCollections: { value: 'true' },
            },
          ],
        },
      })

      const { loadCollectionsForScheme, collections } = useCollections()
      await loadCollectionsForScheme('http://example.org/scheme')

      expect(collections.value).toHaveLength(1)
      expect(collections.value[0].hasChildCollections).toBe(true)
    })

    it('topLevelCollections excludes nested collections', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              collection: { value: 'http://example.org/collection/top' },
              label: { value: 'Top Level' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
              hasParentCollection: { value: 'false' },
              hasChildCollections: { value: 'true' },
            },
            {
              collection: { value: 'http://example.org/collection/nested' },
              label: { value: 'Nested' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
              hasParentCollection: { value: 'true' },
              hasChildCollections: { value: 'false' },
            },
          ],
        },
      })

      const { loadCollectionsForScheme, collections, topLevelCollections } = useCollections()
      await loadCollectionsForScheme('http://example.org/scheme')

      expect(collections.value).toHaveLength(2)
      expect(topLevelCollections.value).toHaveLength(1)
      expect(topLevelCollections.value[0].uri).toBe('http://example.org/collection/top')
    })

    it('loadChildCollections returns child collections', async () => {
      // Staged loading makes 3 calls (inScheme, topConcept, transitive stages)
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: { bindings: [] },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: { bindings: [] },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: { bindings: [] },
      })

      // Fourth call for loadChildCollections
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              collection: { value: 'http://example.org/collection/child1' },
              label: { value: 'Child 1' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
              hasChildCollections: { value: 'false' },
            },
            {
              collection: { value: 'http://example.org/collection/child2' },
              label: { value: 'Child 2' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
              hasChildCollections: { value: 'true' },
            },
          ],
        },
      })

      const { loadCollectionsForScheme, loadChildCollections } = useCollections()
      await loadCollectionsForScheme('http://example.org/scheme')

      const children = await loadChildCollections('http://example.org/collection/parent')

      expect(children).toHaveLength(2)
      expect(children[0].label).toBe('Child 1')
      expect(children[0].hasChildCollections).toBeUndefined()
      expect(children[1].label).toBe('Child 2')
      expect(children[1].hasChildCollections).toBe(true)
    })

    it('loadChildCollections returns empty array when no endpoint', async () => {
      const endpointStore = useEndpointStore()
      endpointStore.selectEndpoint(null as unknown as string)

      const { loadChildCollections } = useCollections()
      const children = await loadChildCollections('http://example.org/collection/parent')

      expect(children).toEqual([])
    })
  })

  describe('loadAllCollections (collection root mode)', () => {
    it('returns early when no endpoint is selected', async () => {
      const endpointStore = useEndpointStore()
      endpointStore.selectEndpoint(null as unknown as string)

      const { loadAllCollections, loading } = useCollections()
      await loadAllCollections()

      expect(executeSparql).not.toHaveBeenCalled()
      expect(loading.value).toBe(false)
    })

    it('sets loading state during execution', async () => {
      const { loadAllCollections, loading } = useCollections()

      expect(loading.value).toBe(false)
      const promise = loadAllCollections()
      expect(loading.value).toBe(true)

      await promise
      expect(loading.value).toBe(false)
    })

    it('loads all collections without scheme filter', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              collection: { value: 'http://example.org/collection/1' },
              label: { value: 'Collection One' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
              hasParentCollection: { value: 'false' },
            },
            {
              collection: { value: 'http://example.org/collection/2' },
              label: { value: 'Collection Two' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
              hasParentCollection: { value: 'false' },
            },
          ],
        },
      })

      const { loadAllCollections, collections, topLevelCollections } = useCollections()
      await loadAllCollections()

      expect(collections.value).toHaveLength(2)
      expect(topLevelCollections.value).toHaveLength(2)
      expect(collections.value[0].uri).toBe('http://example.org/collection/1')
    })

    it('sets error on query failure', async () => {
      ;(executeSparql as Mock).mockRejectedValueOnce(new Error('Query failed'))

      const { loadAllCollections, collections, error } = useCollections()
      await loadAllCollections()

      expect(collections.value).toEqual([])
      expect(error.value).toContain('Query failed')
    })

    it('filters nested collections from topLevelCollections', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              collection: { value: 'http://example.org/collection/top' },
              label: { value: 'Top Level' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
              hasParentCollection: { value: 'false' },
            },
            {
              collection: { value: 'http://example.org/collection/nested' },
              label: { value: 'Nested' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
              hasParentCollection: { value: 'true' },
            },
          ],
        },
      })

      const { loadAllCollections, collections, topLevelCollections } = useCollections()
      await loadAllCollections()

      expect(collections.value).toHaveLength(2)
      expect(topLevelCollections.value).toHaveLength(1)
      expect(topLevelCollections.value[0].uri).toBe('http://example.org/collection/top')
    })
  })

  describe('shared singleton pattern', () => {
    it('returns same instance when shared option is true', () => {
      const instance1 = useCollections({ shared: true })
      const instance2 = useCollections({ shared: true })

      expect(instance1).toBe(instance2)
    })

    it('returns different instances when shared option is false/undefined', () => {
      const instance1 = useCollections()
      const instance2 = useCollections()
      const instance3 = useCollections({ shared: false })

      // Each call creates a new instance
      expect(instance1).not.toBe(instance2)
      expect(instance2).not.toBe(instance3)
    })

    it('shared instance retains state across calls', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              collection: { value: 'http://example.org/collection/1' },
              label: { value: 'Test Collection' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
            },
          ],
        },
      })

      const instance1 = useCollections({ shared: true })
      await instance1.loadAllCollections()

      const instance2 = useCollections({ shared: true })
      expect(instance2.collections.value).toHaveLength(1)
      expect(instance2.collections.value[0].label).toBe('Test Collection')
    })
  })
})
