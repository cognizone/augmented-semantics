/**
 * useTreeSelection Composable Tests
 *
 * Tests for tree selection and expansion state management.
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTreeSelection } from '../useTreeSelection'
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

// Mock eventBus
vi.mock('../../services/eventBus', () => ({
  eventBus: {
    emit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(() => ({ unsubscribe: vi.fn() })),
  },
}))

describe('useTreeSelection', () => {
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

    mockLoadChildren.mockResolvedValue(undefined)
    mockFindNode.mockReturnValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createSelection() {
    return useTreeSelection({
      loadChildren: mockLoadChildren,
      findNode: mockFindNode,
    })
  }

  describe('selectedKey', () => {
    it('returns undefined when nothing selected', () => {
      const { selectedKey } = createSelection()

      expect(selectedKey.value).toBeUndefined()
    })

    it('returns concept URI when concept selected', () => {
      const conceptStore = useConceptStore()
      conceptStore.selectConcept('http://ex.org/concept')

      const { selectedKey } = createSelection()

      expect(selectedKey.value).toEqual({ 'http://ex.org/concept': true })
    })

    it('returns scheme URI when viewing scheme', () => {
      const schemeStore = useSchemeStore()
      schemeStore.setSchemes([{ uri: 'http://ex.org/scheme', label: 'Scheme' }])
      schemeStore.selectScheme('http://ex.org/scheme')
      schemeStore.viewScheme('http://ex.org/scheme')

      const { selectedKey } = createSelection()

      expect(selectedKey.value).toEqual({ 'http://ex.org/scheme': true })
    })

    it('prefers scheme over concept when both set', () => {
      const conceptStore = useConceptStore()
      const schemeStore = useSchemeStore()

      conceptStore.selectConcept('http://ex.org/concept')
      schemeStore.setSchemes([{ uri: 'http://ex.org/scheme', label: 'Scheme' }])
      schemeStore.selectScheme('http://ex.org/scheme')
      schemeStore.viewScheme('http://ex.org/scheme')

      const { selectedKey } = createSelection()

      expect(selectedKey.value).toEqual({ 'http://ex.org/scheme': true })
    })
  })

  describe('expandedKeys', () => {
    it('includes scheme URI when scheme selected', () => {
      const schemeStore = useSchemeStore()
      schemeStore.setSchemes([{ uri: 'http://ex.org/scheme', label: 'Scheme' }])
      schemeStore.selectScheme('http://ex.org/scheme')

      const { expandedKeys } = createSelection()

      expect(expandedKeys.value).toEqual({ 'http://ex.org/scheme': true })
    })

    it('includes expanded concept URIs', () => {
      const conceptStore = useConceptStore()
      conceptStore.expandNode('http://ex.org/c1')
      conceptStore.expandNode('http://ex.org/c2')

      const { expandedKeys } = createSelection()

      expect(expandedKeys.value['http://ex.org/c1']).toBe(true)
      expect(expandedKeys.value['http://ex.org/c2']).toBe(true)
    })

    it('syncs collapse from setter', () => {
      const conceptStore = useConceptStore()
      conceptStore.expandNode('http://ex.org/c1')
      conceptStore.expandNode('http://ex.org/c2')

      const { expandedKeys } = createSelection()

      // Set new keys without c1
      expandedKeys.value = { 'http://ex.org/c2': true }

      expect(conceptStore.expanded.has('http://ex.org/c1')).toBe(false)
      expect(conceptStore.expanded.has('http://ex.org/c2')).toBe(true)
    })
  })

  describe('onNodeExpand', () => {
    it('loads children when node has narrower but no children', () => {
      const { onNodeExpand } = createSelection()

      onNodeExpand({
        key: 'http://ex.org/parent',
        data: {
          uri: 'http://ex.org/parent',
          hasNarrower: true,
          children: undefined,
        },
      })

      expect(mockLoadChildren).toHaveBeenCalledWith('http://ex.org/parent')
    })

    it('does not load children when already loaded', () => {
      const { onNodeExpand } = createSelection()

      onNodeExpand({
        key: 'http://ex.org/parent',
        data: {
          uri: 'http://ex.org/parent',
          hasNarrower: true,
          children: [{ uri: 'http://ex.org/child' }],
        },
      })

      expect(mockLoadChildren).not.toHaveBeenCalled()
    })

    it('does not load children for leaf nodes', () => {
      const { onNodeExpand } = createSelection()

      onNodeExpand({
        key: 'http://ex.org/leaf',
        data: {
          uri: 'http://ex.org/leaf',
          hasNarrower: false,
        },
      })

      expect(mockLoadChildren).not.toHaveBeenCalled()
    })

    it('expands node in store', () => {
      const conceptStore = useConceptStore()
      const { onNodeExpand } = createSelection()

      onNodeExpand({
        key: 'http://ex.org/node',
        data: { uri: 'http://ex.org/node', hasNarrower: false },
      })

      expect(conceptStore.expanded.has('http://ex.org/node')).toBe(true)
    })
  })

  describe('onNodeCollapse', () => {
    it('collapses node in store', () => {
      const conceptStore = useConceptStore()
      conceptStore.expandNode('http://ex.org/node')

      const { onNodeCollapse } = createSelection()

      onNodeCollapse({
        key: 'http://ex.org/node',
      })

      expect(conceptStore.expanded.has('http://ex.org/node')).toBe(false)
    })
  })

  describe('selectConcept', () => {
    it('clears scheme viewing when selecting concept', async () => {
      const schemeStore = useSchemeStore()
      schemeStore.setSchemes([{ uri: 'http://ex.org/scheme', label: 'Scheme' }])
      schemeStore.viewScheme('http://ex.org/scheme')

      const { selectConcept } = createSelection()
      await selectConcept('http://ex.org/concept')

      expect(schemeStore.viewingSchemeUri).toBeNull()
    })

    it('adds to history when node found', async () => {
      const conceptStore = useConceptStore()

      mockFindNode.mockReturnValue({
        uri: 'http://ex.org/concept',
        label: 'Test Concept',
        notation: '001',
        lang: 'en',
        hasNarrower: true,
      })

      const { selectConcept } = createSelection()
      await selectConcept('http://ex.org/concept')

      expect(conceptStore.history).toHaveLength(1)
      expect(conceptStore.history[0]).toMatchObject({
        uri: 'http://ex.org/concept',
        label: 'Test Concept',
        notation: '001',
      })
    })
  })
})
