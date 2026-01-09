/**
 * useTreeNavigation Composable Tests
 *
 * Tests for tree navigation and reveal functionality.
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useTreeNavigation } from '../useTreeNavigation'
import { useConceptStore, useEndpointStore, useSchemeStore } from '../../stores'

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
}))

import { executeSparql } from '../../services/sparql'
import type { Mock } from 'vitest'

describe('useTreeNavigation', () => {
  const mockTreeWrapperRef = ref<HTMLElement | null>(null)
  const mockLoadChildren = vi.fn()
  const mockFindNode = vi.fn()

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

    // Reset refs
    mockTreeWrapperRef.value = null
    mockLoadChildren.mockResolvedValue(undefined)
    mockFindNode.mockReturnValue(null)

    // Default mock - empty results
    ;(executeSparql as Mock).mockResolvedValue({ results: { bindings: [] } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createNavigation() {
    return useTreeNavigation({
      treeWrapperRef: mockTreeWrapperRef,
      loadChildren: mockLoadChildren,
      findNode: mockFindNode,
    })
  }

  describe('fetchAncestorPath', () => {
    it('returns empty array if no endpoint', async () => {
      const endpointStore = useEndpointStore()
      endpointStore.selectEndpoint(null as unknown as string)

      const { fetchAncestorPath } = createNavigation()
      const result = await fetchAncestorPath('http://ex.org/concept')

      expect(result).toEqual([])
      expect(executeSparql).not.toHaveBeenCalled()
    })

    it('queries SPARQL for ancestors', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { ancestor: { value: 'http://ex.org/root' }, label: { value: 'Root' } },
            { ancestor: { value: 'http://ex.org/parent' }, label: { value: 'Parent' } },
          ],
        },
      })

      const { fetchAncestorPath } = createNavigation()
      const result = await fetchAncestorPath('http://ex.org/concept')

      expect(executeSparql).toHaveBeenCalled()
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ uri: 'http://ex.org/root', label: 'Root', notation: undefined })
    })

    it('deduplicates ancestors', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { ancestor: { value: 'http://ex.org/root' }, label: { value: 'Root' } },
            { ancestor: { value: 'http://ex.org/root' }, label: { value: 'Root Again' } }, // Duplicate
          ],
        },
      })

      const { fetchAncestorPath } = createNavigation()
      const result = await fetchAncestorPath('http://ex.org/concept')

      expect(result).toHaveLength(1)
    })

    it('handles SPARQL errors gracefully', async () => {
      ;(executeSparql as Mock).mockRejectedValue(new Error('Query failed'))

      const { fetchAncestorPath } = createNavigation()
      const result = await fetchAncestorPath('http://ex.org/concept')

      expect(result).toEqual([])
    })
  })

  describe('scrollToNode', () => {
    it('does nothing if no tree wrapper ref', () => {
      mockTreeWrapperRef.value = null

      const { scrollToNode } = createNavigation()
      scrollToNode('http://ex.org/concept')

      // Should not throw
    })

    it('scrolls to selected node when found', () => {
      const mockScrollTo = vi.fn()
      const mockQuerySelector = vi.fn().mockReturnValue({
        getBoundingClientRect: () => ({ top: 100, height: 30 }),
      })

      mockTreeWrapperRef.value = {
        querySelector: mockQuerySelector,
        getBoundingClientRect: () => ({ top: 0, height: 400 }),
        scrollTop: 0,
        scrollTo: mockScrollTo,
      } as unknown as HTMLElement

      const { scrollToNode } = createNavigation()
      scrollToNode('http://ex.org/concept')

      expect(mockQuerySelector).toHaveBeenCalled()
      expect(mockScrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
    })

    it('tries multiple selectors to find node', () => {
      const mockQuerySelector = vi.fn().mockReturnValue(null)

      mockTreeWrapperRef.value = {
        querySelector: mockQuerySelector,
        getBoundingClientRect: () => ({ top: 0, height: 400 }),
        scrollTop: 0,
        scrollTo: vi.fn(),
      } as unknown as HTMLElement

      const { scrollToNode } = createNavigation()
      scrollToNode('http://ex.org/concept')

      // Should try multiple selectors
      expect(mockQuerySelector).toHaveBeenCalledTimes(3)
    })
  })

  describe('scrollToTop', () => {
    it('scrolls tree to top', () => {
      const mockScrollTo = vi.fn()
      mockTreeWrapperRef.value = {
        scrollTo: mockScrollTo,
      } as unknown as HTMLElement

      const { scrollToTop } = createNavigation()
      scrollToTop()

      expect(mockScrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    })

    it('does nothing if no tree wrapper ref', () => {
      mockTreeWrapperRef.value = null

      const { scrollToTop } = createNavigation()
      scrollToTop()

      // Should not throw
    })
  })

  describe('revealConceptIfNeeded', () => {
    it('scrolls to existing node without fetching ancestors', async () => {
      const conceptStore = useConceptStore()
      const mockScrollTo = vi.fn()

      mockTreeWrapperRef.value = {
        querySelector: vi.fn().mockReturnValue({
          getBoundingClientRect: () => ({ top: 100, height: 30 }),
        }),
        getBoundingClientRect: () => ({ top: 0, height: 400 }),
        scrollTop: 0,
        scrollTo: mockScrollTo,
      } as unknown as HTMLElement

      // Node exists in tree
      mockFindNode.mockReturnValue({
        uri: 'http://ex.org/concept',
        label: 'Test',
        hasNarrower: false,
        expanded: false,
      })

      const { revealConceptIfNeeded } = createNavigation()
      await revealConceptIfNeeded('http://ex.org/concept')

      // Should not query ancestors since node exists
      expect(executeSparql).not.toHaveBeenCalled()
    })

    it('fetches ancestors when node not in tree', async () => {
      const conceptStore = useConceptStore()

      mockTreeWrapperRef.value = {
        querySelector: vi.fn().mockReturnValue(null),
        getBoundingClientRect: () => ({ top: 0, height: 400 }),
        scrollTop: 0,
        scrollTo: vi.fn(),
      } as unknown as HTMLElement

      // Node not in tree
      mockFindNode.mockReturnValue(null)

      ;(executeSparql as Mock).mockResolvedValue({ results: { bindings: [] } })

      const { revealConceptIfNeeded } = createNavigation()
      await revealConceptIfNeeded('http://ex.org/concept')

      // Should query ancestors since node doesn't exist
      expect(executeSparql).toHaveBeenCalled()
    })

    it('marks concept as revealed', async () => {
      const conceptStore = useConceptStore()

      mockTreeWrapperRef.value = {
        querySelector: vi.fn().mockReturnValue(null),
        getBoundingClientRect: () => ({ top: 0, height: 400 }),
        scrollTop: 0,
        scrollTo: vi.fn(),
      } as unknown as HTMLElement

      mockFindNode.mockReturnValue({
        uri: 'http://ex.org/concept',
        label: 'Test',
        hasNarrower: false,
        expanded: false,
      })

      const { revealConceptIfNeeded } = createNavigation()
      await revealConceptIfNeeded('http://ex.org/concept')

      // Should have cleared pending reveal
      expect(conceptStore.pendingRevealUri).toBeNull()
    })
  })

  describe('revealConcept', () => {
    it('expands ancestors and loads children', async () => {
      const conceptStore = useConceptStore()
      const schemeStore = useSchemeStore()

      mockTreeWrapperRef.value = {
        querySelector: vi.fn().mockReturnValue(null),
        getBoundingClientRect: () => ({ top: 0, height: 400 }),
        scrollTop: 0,
        scrollTo: vi.fn(),
      } as unknown as HTMLElement

      schemeStore.setSchemes([{ uri: 'http://ex.org/scheme', label: 'Scheme' }])
      schemeStore.selectScheme('http://ex.org/scheme')

      // Mock ancestor response
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { ancestor: { value: 'http://ex.org/parent' }, label: { value: 'Parent' } },
          ],
        },
      })

      // Mock findNode to return a node that needs children loaded
      mockFindNode.mockReturnValue({
        uri: 'http://ex.org/parent',
        label: 'Parent',
        hasNarrower: true,
        expanded: false,
        children: undefined, // Not loaded yet
      })

      const { revealConcept } = createNavigation()
      await revealConcept('http://ex.org/concept')

      // Should expand ancestors
      expect(conceptStore.expanded.has('http://ex.org/parent')).toBe(true)
      // Should also expand scheme
      expect(conceptStore.expanded.has('http://ex.org/scheme')).toBe(true)
      // Should load children
      expect(mockLoadChildren).toHaveBeenCalledWith('http://ex.org/parent')
    })
  })
})
