/**
 * useTreePagination Composable Tests
 *
 * Tests for tree pagination and lazy loading.
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTreePagination } from '../useTreePagination'
import { useConceptStore, useEndpointStore, useSchemeStore, ORPHAN_SCHEME_URI } from '../../stores'

// Mock logger
vi.mock('../../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock eventBus
vi.mock('../../services/eventBus', () => ({
  eventBus: {
    emit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(() => ({ unsubscribe: vi.fn() })),
  },
}))

// Mock SPARQL service
vi.mock('../../services/sparql', () => ({
  executeSparql: vi.fn(),
  withPrefixes: vi.fn((q) => q),
}))

// Mock useConceptBindings
vi.mock('../useConceptBindings', () => ({
  useConceptBindings: () => ({
    processBindings: vi.fn((bindings) => {
      // Simple mock: convert bindings to ConceptNode[]
      return bindings.map((b: { concept?: { value: string } }) => ({
        uri: b.concept?.value || '',
        label: 'Test',
        hasNarrower: false,
        expanded: false,
      }))
    }),
  }),
}))

// Mock useConceptTreeQueries
vi.mock('../useConceptTreeQueries', () => ({
  useConceptTreeQueries: () => ({
    buildTopConceptsQuery: vi.fn(() => 'SELECT ?concept WHERE { }'),
    buildChildrenQuery: vi.fn(() => 'SELECT ?concept WHERE { }'),
  }),
}))

import { executeSparql } from '../../services/sparql'
import type { Mock } from 'vitest'

describe('useTreePagination', () => {
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

  describe('initial state', () => {
    it('starts with default pagination state', () => {
      const {
        topConceptsOffset,
        hasMoreTopConcepts,
        loadingMoreTopConcepts,
        error,
      } = useTreePagination()

      expect(topConceptsOffset.value).toBe(0)
      expect(hasMoreTopConcepts.value).toBe(true)
      expect(loadingMoreTopConcepts.value).toBe(false)
      expect(error.value).toBeNull()
    })
  })

  describe('loadTopConcepts', () => {
    it('returns early if no endpoint', async () => {
      const endpointStore = useEndpointStore()
      endpointStore.selectEndpoint(null as unknown as string)

      const { loadTopConcepts } = useTreePagination()
      await loadTopConcepts()

      expect(executeSparql).not.toHaveBeenCalled()
    })

    it('returns empty and clears tree if no scheme selected', async () => {
      const conceptStore = useConceptStore()
      conceptStore.setTopConcepts([{ uri: 'http://old', label: 'Old', hasNarrower: false, expanded: false }])

      const { loadTopConcepts } = useTreePagination()
      await loadTopConcepts()

      expect(conceptStore.topConcepts).toEqual([])
      expect(executeSparql).not.toHaveBeenCalled()
    })

    it('returns empty if orphan scheme selected', async () => {
      const schemeStore = useSchemeStore()
      const conceptStore = useConceptStore()

      schemeStore.selectScheme(ORPHAN_SCHEME_URI)

      const { loadTopConcepts } = useTreePagination()
      await loadTopConcepts()

      expect(conceptStore.topConcepts).toEqual([])
      expect(executeSparql).not.toHaveBeenCalled()
    })

    it('loads top concepts when scheme selected', async () => {
      const schemeStore = useSchemeStore()
      const conceptStore = useConceptStore()

      schemeStore.setSchemes([{ uri: 'http://ex.org/scheme', label: 'Test Scheme' }])
      schemeStore.selectScheme('http://ex.org/scheme')

      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { concept: { value: 'http://ex.org/c1' } },
            { concept: { value: 'http://ex.org/c2' } },
          ],
        },
      })

      const { loadTopConcepts } = useTreePagination()
      await loadTopConcepts()

      expect(executeSparql).toHaveBeenCalled()
      expect(conceptStore.topConcepts).toHaveLength(2)
    })

    it('sets loading state during fetch', async () => {
      const schemeStore = useSchemeStore()
      const conceptStore = useConceptStore()

      schemeStore.setSchemes([{ uri: 'http://ex.org/scheme', label: 'Test Scheme' }])
      schemeStore.selectScheme('http://ex.org/scheme')

      let loadingDuringFetch = false
      ;(executeSparql as Mock).mockImplementation(async () => {
        loadingDuringFetch = conceptStore.loadingTree
        return { results: { bindings: [] } }
      })

      const { loadTopConcepts } = useTreePagination()
      await loadTopConcepts()

      expect(loadingDuringFetch).toBe(true)
      expect(conceptStore.loadingTree).toBe(false)
    })

    it('handles SPARQL errors gracefully', async () => {
      const schemeStore = useSchemeStore()

      schemeStore.setSchemes([{ uri: 'http://ex.org/scheme', label: 'Test Scheme' }])
      schemeStore.selectScheme('http://ex.org/scheme')

      ;(executeSparql as Mock).mockRejectedValue(new Error('Network error'))

      const { loadTopConcepts, error } = useTreePagination()
      await loadTopConcepts()

      expect(error.value).toContain('Failed to load concepts')
    })

    it('detects hasMore when results exceed page size', async () => {
      const schemeStore = useSchemeStore()

      schemeStore.setSchemes([{ uri: 'http://ex.org/scheme', label: 'Test Scheme' }])
      schemeStore.selectScheme('http://ex.org/scheme')

      // Return 201 results (PAGE_SIZE + 1)
      const bindings = Array.from({ length: 201 }, (_, i) => ({
        concept: { value: `http://ex.org/c${i}` },
      }))

      ;(executeSparql as Mock).mockResolvedValue({
        results: { bindings },
      })

      const { loadTopConcepts, hasMoreTopConcepts } = useTreePagination()
      await loadTopConcepts()

      expect(hasMoreTopConcepts.value).toBe(true)
    })
  })

  describe('loadMoreTopConcepts', () => {
    it('does not load if no more concepts', async () => {
      const { loadMoreTopConcepts, hasMoreTopConcepts } = useTreePagination()

      hasMoreTopConcepts.value = false
      await loadMoreTopConcepts()

      expect(executeSparql).not.toHaveBeenCalled()
    })

    it('does not load if already loading', async () => {
      const { loadMoreTopConcepts, loadingMoreTopConcepts, hasMoreTopConcepts } = useTreePagination()

      hasMoreTopConcepts.value = true
      loadingMoreTopConcepts.value = true
      await loadMoreTopConcepts()

      expect(executeSparql).not.toHaveBeenCalled()
    })
  })

  describe('loadChildren', () => {
    it('returns early if no endpoint', async () => {
      const endpointStore = useEndpointStore()
      endpointStore.selectEndpoint(null as unknown as string)

      const { loadChildren } = useTreePagination()
      await loadChildren('http://ex.org/parent')

      expect(executeSparql).not.toHaveBeenCalled()
    })

    it('prevents duplicate requests for same parent', async () => {
      const { loadChildren, loadingChildren } = useTreePagination()

      ;(executeSparql as Mock).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ results: { bindings: [] } }), 100))
      )

      // Start first request
      const promise1 = loadChildren('http://ex.org/parent')
      // Try to start second request immediately
      const promise2 = loadChildren('http://ex.org/parent')

      await Promise.all([promise1, promise2])

      // Should only have called once
      expect(executeSparql).toHaveBeenCalledTimes(1)
    })

    it('tracks loading state per parent', async () => {
      const { loadChildren, loadingChildren } = useTreePagination()

      ;(executeSparql as Mock).mockResolvedValue({ results: { bindings: [] } })

      // Load children for parent1
      const promise = loadChildren('http://ex.org/parent1')

      // Check that parent1 is in loading set during request
      expect(loadingChildren.value.has('http://ex.org/parent1')).toBe(true)

      await promise

      // Should be removed after completion
      expect(loadingChildren.value.has('http://ex.org/parent1')).toBe(false)
    })
  })

  describe('findNode', () => {
    it('finds node at top level', () => {
      const { findNode } = useTreePagination()

      const nodes = [
        { uri: 'http://ex.org/c1', label: 'C1', hasNarrower: false, expanded: false },
        { uri: 'http://ex.org/c2', label: 'C2', hasNarrower: false, expanded: false },
      ]

      const found = findNode('http://ex.org/c2', nodes)

      expect(found?.uri).toBe('http://ex.org/c2')
    })

    it('finds node in nested children', () => {
      const { findNode } = useTreePagination()

      const nodes = [
        {
          uri: 'http://ex.org/c1',
          label: 'C1',
          hasNarrower: true,
          expanded: true,
          children: [
            {
              uri: 'http://ex.org/c1-1',
              label: 'C1-1',
              hasNarrower: true,
              expanded: true,
              children: [
                { uri: 'http://ex.org/c1-1-1', label: 'C1-1-1', hasNarrower: false, expanded: false },
              ],
            },
          ],
        },
      ]

      const found = findNode('http://ex.org/c1-1-1', nodes)

      expect(found?.uri).toBe('http://ex.org/c1-1-1')
    })

    it('returns null if not found', () => {
      const { findNode } = useTreePagination()

      const nodes = [
        { uri: 'http://ex.org/c1', label: 'C1', hasNarrower: false, expanded: false },
      ]

      const found = findNode('http://ex.org/nonexistent', nodes)

      expect(found).toBeNull()
    })
  })

  describe('resetPagination', () => {
    it('resets all pagination state', () => {
      const {
        topConceptsOffset,
        hasMoreTopConcepts,
        loadingMoreTopConcepts,
        childrenPagination,
        loadingChildren,
        error,
        resetPagination,
      } = useTreePagination()

      // Set some state
      topConceptsOffset.value = 200
      hasMoreTopConcepts.value = false
      loadingMoreTopConcepts.value = true
      childrenPagination.value.set('http://ex.org/parent', { offset: 100, hasMore: true, loading: true })
      loadingChildren.value.add('http://ex.org/parent')
      error.value = 'Some error'

      resetPagination()

      expect(topConceptsOffset.value).toBe(0)
      expect(hasMoreTopConcepts.value).toBe(true)
      expect(loadingMoreTopConcepts.value).toBe(false)
      expect(childrenPagination.value.size).toBe(0)
      expect(loadingChildren.value.size).toBe(0)
      expect(error.value).toBeNull()
    })
  })
})
