/**
 * Concept Store Tests
 *
 * Tests for concept tree, selection, search, and history management.
 * @see /spec/ae-skos/sko03-ConceptTree.md
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 * @see /spec/ae-skos/sko07-Testing.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useConceptStore } from '../concept'
import type { ConceptNode, ConceptDetails } from '../../types'

describe('concept store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  describe('initial state', () => {
    it('starts with empty tree', () => {
      const store = useConceptStore()
      expect(store.topConcepts).toEqual([])
    })

    it('starts with no selection', () => {
      const store = useConceptStore()
      expect(store.selectedUri).toBeNull()
      expect(store.details).toBeNull()
      expect(store.hasSelection).toBe(false)
    })

    it('starts with empty search', () => {
      const store = useConceptStore()
      expect(store.searchQuery).toBe('')
      expect(store.searchResults).toEqual([])
    })

    it('starts with default search settings', () => {
      const store = useConceptStore()
      expect(store.searchSettings.searchIn.prefLabel).toBe(true)
      expect(store.searchSettings.searchIn.altLabel).toBe(true)
      expect(store.searchSettings.caseSensitive).toBe(false)
    })
  })

  describe('tree operations', () => {
    it('sets top concepts', () => {
      const store = useConceptStore()
      const concepts: ConceptNode[] = [
        { uri: 'http://ex.org/c1', label: 'Concept 1', hasNarrower: true, expanded: false },
        { uri: 'http://ex.org/c2', label: 'Concept 2', hasNarrower: false, expanded: false },
      ]

      store.setTopConcepts(concepts)
      expect(store.topConcepts).toEqual(concepts)
    })

    it('expands node', () => {
      const store = useConceptStore()

      store.expandNode('http://ex.org/c1')
      expect(store.expanded.has('http://ex.org/c1')).toBe(true)
      expect(store.isExpanded('http://ex.org/c1')).toBe(true)
    })

    it('collapses node', () => {
      const store = useConceptStore()

      store.expandNode('http://ex.org/c1')
      store.collapseNode('http://ex.org/c1')
      expect(store.expanded.has('http://ex.org/c1')).toBe(false)
      expect(store.isExpanded('http://ex.org/c1')).toBe(false)
    })

    it('toggles node expansion', () => {
      const store = useConceptStore()

      store.toggleNode('http://ex.org/c1')
      expect(store.isExpanded('http://ex.org/c1')).toBe(true)

      store.toggleNode('http://ex.org/c1')
      expect(store.isExpanded('http://ex.org/c1')).toBe(false)
    })

    it('updates node children', () => {
      const store = useConceptStore()
      const concepts: ConceptNode[] = [
        { uri: 'http://ex.org/c1', label: 'Parent', hasNarrower: true, expanded: false },
      ]
      store.setTopConcepts(concepts)

      const children: ConceptNode[] = [
        { uri: 'http://ex.org/c1-1', label: 'Child 1', hasNarrower: false, expanded: false },
        { uri: 'http://ex.org/c1-2', label: 'Child 2', hasNarrower: false, expanded: false },
      ]

      store.updateNodeChildren('http://ex.org/c1', children)
      const firstConcept = store.topConcepts[0]
      expect(firstConcept?.children).toEqual(children)
    })

    it('updates nested node children', () => {
      const store = useConceptStore()
      const concepts: ConceptNode[] = [
        {
          uri: 'http://ex.org/c1',
          label: 'Parent',
          hasNarrower: true,
          expanded: false,
          children: [
            { uri: 'http://ex.org/c1-1', label: 'Child', hasNarrower: true, expanded: false },
          ],
        },
      ]
      store.setTopConcepts(concepts)

      const grandchildren: ConceptNode[] = [
        { uri: 'http://ex.org/c1-1-1', label: 'Grandchild', hasNarrower: false, expanded: false },
      ]

      store.updateNodeChildren('http://ex.org/c1-1', grandchildren)
      const firstConcept = store.topConcepts[0]
      expect(firstConcept?.children?.[0]?.children).toEqual(grandchildren)
    })

    it('clears all children and expanded state', () => {
      const store = useConceptStore()
      const concepts: ConceptNode[] = [
        {
          uri: 'http://ex.org/c1',
          label: 'Parent',
          hasNarrower: true,
          expanded: false,
          children: [
            {
              uri: 'http://ex.org/c1-1',
              label: 'Child',
              hasNarrower: true,
              expanded: false,
              children: [
                { uri: 'http://ex.org/c1-1-1', label: 'Grandchild', hasNarrower: false, expanded: false },
              ],
            },
          ],
        },
        {
          uri: 'http://ex.org/c2',
          label: 'Parent 2',
          hasNarrower: true,
          expanded: false,
          children: [
            { uri: 'http://ex.org/c2-1', label: 'Child 2', hasNarrower: false, expanded: false },
          ],
        },
      ]
      store.setTopConcepts(concepts)
      store.expandNode('http://ex.org/c1')
      store.expandNode('http://ex.org/c1-1')

      store.clearAllChildren()

      // Children should be cleared
      expect(store.topConcepts[0]?.children).toBeUndefined()
      expect(store.topConcepts[1]?.children).toBeUndefined()
      // Expanded state should be cleared
      expect(store.expanded.size).toBe(0)
      // Top concepts should still exist
      expect(store.topConcepts).toHaveLength(2)
    })
  })

  describe('selection', () => {
    it('selects concept by URI', () => {
      const store = useConceptStore()

      store.selectConcept('http://ex.org/c1')
      expect(store.selectedUri).toBe('http://ex.org/c1')
      expect(store.hasSelection).toBe(true)
    })

    it('deselects with null', () => {
      const store = useConceptStore()

      store.selectConcept('http://ex.org/c1')
      store.selectConcept(null)
      expect(store.selectedUri).toBeNull()
      expect(store.hasSelection).toBe(false)
    })

    it('sets details', () => {
      const store = useConceptStore()
      const details: ConceptDetails = {
        uri: 'http://ex.org/c1',
        prefLabels: [{ value: 'Test', lang: 'en' }],
        altLabels: [],
        hiddenLabels: [],
        prefLabelsXL: [],
        altLabelsXL: [],
        hiddenLabelsXL: [],
        definitions: [],
        scopeNotes: [],
        historyNotes: [],
        changeNotes: [],
        editorialNotes: [],
        examples: [],
        notations: [],
        broader: [],
        narrower: [],
        related: [],
        inScheme: [],
        exactMatch: [],
        closeMatch: [],
        broadMatch: [],
        narrowMatch: [],
        relatedMatch: [],
        otherProperties: [],
      }

      store.setDetails(details)
      expect(store.details).toEqual(details)
    })

    it('sets breadcrumb path', () => {
      const store = useConceptStore()
      const path = [
        { uri: 'http://ex.org/root', label: 'Root' },
        { uri: 'http://ex.org/child', label: 'Child' },
      ]

      store.setBreadcrumb(path)
      expect(store.breadcrumb).toEqual(path)
    })
  })

  describe('search', () => {
    it('sets search query', () => {
      const store = useConceptStore()

      store.setSearchQuery('test')
      expect(store.searchQuery).toBe('test')
    })

    it('sets search results', () => {
      const store = useConceptStore()
      const results = [
        { uri: 'http://ex.org/c1', label: 'Result 1', matchedIn: 'prefLabel' as const },
      ]

      store.setSearchResults(results)
      expect(store.searchResults).toEqual(results)
    })

    it('updates search settings', () => {
      const store = useConceptStore()

      store.updateSearchSettings({ caseSensitive: true })
      expect(store.searchSettings.caseSensitive).toBe(true)
      expect(store.searchSettings.searchIn.prefLabel).toBe(true) // Preserved
    })

    it('clears search', () => {
      const store = useConceptStore()

      store.setSearchQuery('test')
      store.setSearchResults([{ uri: 'http://ex.org/c1', label: 'Result', matchedIn: 'prefLabel' as const }])

      store.clearSearch()
      expect(store.searchQuery).toBe('')
      expect(store.searchResults).toEqual([])
    })
  })

  describe('history', () => {
    it('adds entry to history', () => {
      const store = useConceptStore()

      store.addToHistory({ uri: 'http://ex.org/c1', label: 'Concept 1' })
      expect(store.history).toHaveLength(1)
      expect(store.history[0]?.uri).toBe('http://ex.org/c1')
      expect(store.history[0]?.accessedAt).toBeDefined()
    })

    it('adds to front of history', () => {
      const store = useConceptStore()

      store.addToHistory({ uri: 'http://ex.org/c1', label: 'Concept 1' })
      store.addToHistory({ uri: 'http://ex.org/c2', label: 'Concept 2' })

      expect(store.history[0]?.uri).toBe('http://ex.org/c2')
      expect(store.history[1]?.uri).toBe('http://ex.org/c1')
    })

    it('removes duplicate before adding', () => {
      const store = useConceptStore()

      store.addToHistory({ uri: 'http://ex.org/c1', label: 'Concept 1' })
      store.addToHistory({ uri: 'http://ex.org/c2', label: 'Concept 2' })
      store.addToHistory({ uri: 'http://ex.org/c1', label: 'Concept 1' })

      expect(store.history).toHaveLength(2)
      expect(store.history[0]?.uri).toBe('http://ex.org/c1')
    })

    it('limits history to MAX_HISTORY entries', () => {
      const store = useConceptStore()

      // Add 55 entries (MAX_HISTORY is 50)
      for (let i = 0; i < 55; i++) {
        store.addToHistory({ uri: `http://ex.org/c${i}`, label: `Concept ${i}` })
      }

      expect(store.history.length).toBeLessThanOrEqual(50)
    })

    it('persists history to localStorage', () => {
      const store = useConceptStore()

      store.addToHistory({ uri: 'http://ex.org/c1', label: 'Concept 1' })

      expect(localStorage.setItem).toHaveBeenCalled()
    })

    it('clears history', () => {
      const store = useConceptStore()

      store.addToHistory({ uri: 'http://ex.org/c1', label: 'Concept 1' })
      store.addToHistory({ uri: 'http://ex.org/c2', label: 'Concept 2' })

      store.clearHistory()
      expect(store.history).toEqual([])
    })

    it('returns all history entries in recentHistory getter (up to MAX_HISTORY of 50)', () => {
      const store = useConceptStore()

      // Add 55 entries (more than MAX_HISTORY)
      for (let i = 0; i < 55; i++) {
        store.addToHistory({ uri: `http://ex.org/c${i}`, label: `Concept ${i}` })
      }

      // Should return all 50 (MAX_HISTORY)
      expect(store.recentHistory.length).toBe(50)
    })

    it('loads history from localStorage on init', () => {
      const storedHistory = [
        { uri: 'http://ex.org/c1', label: 'Stored', accessedAt: '2024-01-01T00:00:00Z' },
      ]

      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(storedHistory))

      const store = useConceptStore()
      expect(store.history).toHaveLength(1)
      expect(store.history[0]?.label).toBe('Stored')
    })
  })

  describe('loading states', () => {
    it('sets loading tree state', () => {
      const store = useConceptStore()

      store.setLoadingTree(true)
      expect(store.loadingTree).toBe(true)

      store.setLoadingTree(false)
      expect(store.loadingTree).toBe(false)
    })

    it('sets loading details state', () => {
      const store = useConceptStore()

      store.setLoadingDetails(true)
      expect(store.loadingDetails).toBe(true)
    })

    it('sets loading search state', () => {
      const store = useConceptStore()

      store.setLoadingSearch(true)
      expect(store.loadingSearch).toBe(true)
    })
  })

  describe('reset', () => {
    it('resets all state except history', () => {
      const store = useConceptStore()

      // Set up some state
      store.setTopConcepts([{ uri: 'http://ex.org/c1', label: 'Test', hasNarrower: false, expanded: false }])
      store.expandNode('http://ex.org/c1')
      store.selectConcept('http://ex.org/c1')
      store.setSearchQuery('test')
      store.addToHistory({ uri: 'http://ex.org/c1', label: 'Test' })

      store.reset()

      expect(store.topConcepts).toEqual([])
      expect(store.expanded.size).toBe(0)
      expect(store.selectedUri).toBeNull()
      expect(store.details).toBeNull()
      expect(store.searchQuery).toBe('')
      expect(store.searchResults).toEqual([])
      // History is preserved (not reset)
      expect(store.history.length).toBeGreaterThan(0)
    })
  })
})
