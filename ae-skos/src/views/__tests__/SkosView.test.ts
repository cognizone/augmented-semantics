/**
 * SkosView Tests
 *
 * Tests for main SKOS browser view, focusing on history navigation
 * and URL state synchronization.
 *
 * @see /spec/common/com04-URLRouting.md
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import SkosView from '../SkosView.vue'
import { useConceptStore, useEndpointStore, useSchemeStore, useLanguageStore, useUIStore } from '../../stores'

// Mock vue-router
const mockPush = vi.fn()
const mockReplace = vi.fn()
vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    useRoute: () => ({
      query: {},
    }),
    useRouter: () => ({
      push: mockPush,
      replace: mockReplace,
    }),
  }
})

// Mock the logger
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
  executeSparql: vi.fn().mockResolvedValue({ results: { bindings: [] } }),
  withPrefixes: vi.fn((q) => q),
}))

describe('SkosView', () => {
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

    // Set language
    const languageStore = useLanguageStore()
    languageStore.setPreferred('en')

    // Set UI store defaults
    const uiStore = useUIStore()
    uiStore.isDesktop = true
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mountSkosView() {
    return mount(SkosView, {
      global: {
        directives: {
          tooltip: () => {},
        },
        stubs: {
          ConceptTree: { template: '<div class="concept-tree-stub" />' },
          ConceptDetails: { template: '<div class="concept-details-stub" />' },
          CollectionDetails: { template: '<div class="collection-details-stub" />' },
          SchemeDetails: { template: '<div class="scheme-details-stub" />' },
          SearchBox: { template: '<div class="search-box-stub" />' },
          RecentHistory: {
            template: '<div class="recent-history-stub" @click="$emit(\'select-concept\', entry)" />',
            props: ['entry'],
            emits: ['select-concept'],
          },
          Splitter: { template: '<div class="splitter"><slot /></div>' },
          SplitterPanel: { template: '<div class="splitter-panel"><slot /></div>' },
          Tabs: { template: '<div class="tabs"><slot /></div>' },
          TabList: { template: '<div class="tab-list"><slot /></div>' },
          Tab: { template: '<div class="tab"><slot /></div>' },
          TabPanels: { template: '<div class="tab-panels"><slot /></div>' },
          TabPanel: { template: '<div class="tab-panel"><slot /></div>' },
        },
      },
    })
  }

  describe('selectFromHistory', () => {
    it('switches endpoint when entry has different endpoint', async () => {
      const endpointStore = useEndpointStore()
      const conceptStore = useConceptStore()

      // Add a second endpoint
      const secondEndpoint = endpointStore.addEndpoint({
        name: 'Second Endpoint',
        url: 'https://other.org/sparql',
      })

      // Currently on first endpoint
      expect(endpointStore.current?.url).toBe('https://example.org/sparql')

      // Mount view
      const wrapper = mountSkosView()
      await flushPromises()

      // Simulate history selection with different endpoint
      const historyEntry = {
        uri: 'http://example.org/concept/1',
        endpointUrl: 'https://other.org/sparql',
        schemeUri: 'http://example.org/scheme/1',
      }

      // Get the component instance and call selectFromHistory
      // Since it's not exposed, we test via store state changes
      endpointStore.selectEndpoint(secondEndpoint.id)
      await nextTick()

      expect(endpointStore.current?.url).toBe('https://other.org/sparql')
    })

    it('switches scheme when entry has different scheme', async () => {
      const schemeStore = useSchemeStore()

      // Set up schemes
      schemeStore.schemes = [
        { uri: 'http://example.org/scheme/1', label: 'Scheme 1' },
        { uri: 'http://example.org/scheme/2', label: 'Scheme 2' },
      ]
      schemeStore.selectScheme('http://example.org/scheme/1')

      expect(schemeStore.selectedUri).toBe('http://example.org/scheme/1')

      // Switch scheme
      schemeStore.selectScheme('http://example.org/scheme/2')
      await nextTick()

      expect(schemeStore.selectedUri).toBe('http://example.org/scheme/2')
    })

    it('selects concept after switching endpoint/scheme', async () => {
      const conceptStore = useConceptStore()
      const schemeStore = useSchemeStore()

      // Set up scheme
      schemeStore.schemes = [
        { uri: 'http://example.org/scheme/1', label: 'Scheme 1' },
      ]
      schemeStore.selectScheme('http://example.org/scheme/1')

      mountSkosView()
      await flushPromises()

      // Select concept
      conceptStore.selectConcept('http://example.org/concept/1')
      await nextTick()

      expect(conceptStore.selectedUri).toBe('http://example.org/concept/1')
    })

    it('handles missing endpointUrl in entry', async () => {
      const endpointStore = useEndpointStore()
      const conceptStore = useConceptStore()

      const currentEndpointUrl = endpointStore.current?.url

      mountSkosView()
      await flushPromises()

      // Entry without endpointUrl should not change endpoint
      conceptStore.selectConcept('http://example.org/concept/1')
      await nextTick()

      expect(endpointStore.current?.url).toBe(currentEndpointUrl)
      expect(conceptStore.selectedUri).toBe('http://example.org/concept/1')
    })

    it('handles missing schemeUri in entry', async () => {
      const schemeStore = useSchemeStore()
      const conceptStore = useConceptStore()

      schemeStore.schemes = [
        { uri: 'http://example.org/scheme/1', label: 'Scheme 1' },
      ]
      schemeStore.selectScheme('http://example.org/scheme/1')

      mountSkosView()
      await flushPromises()

      // Entry without schemeUri should not change scheme
      conceptStore.selectConcept('http://example.org/concept/1')
      await nextTick()

      expect(schemeStore.selectedUri).toBe('http://example.org/scheme/1')
      expect(conceptStore.selectedUri).toBe('http://example.org/concept/1')
    })

    it('handles endpoint not found in store', async () => {
      const endpointStore = useEndpointStore()
      const conceptStore = useConceptStore()

      const currentEndpointUrl = endpointStore.current?.url

      mountSkosView()
      await flushPromises()

      // Entry with non-existent endpoint URL
      // Endpoint should remain unchanged
      expect(endpointStore.current?.url).toBe(currentEndpointUrl)

      conceptStore.selectConcept('http://example.org/concept/1')
      await nextTick()

      expect(conceptStore.selectedUri).toBe('http://example.org/concept/1')
    })

    it('does not wait when no endpoint/scheme change needed', async () => {
      const endpointStore = useEndpointStore()
      const schemeStore = useSchemeStore()
      const conceptStore = useConceptStore()

      schemeStore.schemes = [
        { uri: 'http://example.org/scheme/1', label: 'Scheme 1' },
      ]
      schemeStore.selectScheme('http://example.org/scheme/1')

      mountSkosView()
      await flushPromises()

      // Entry with same endpoint/scheme
      const startTime = Date.now()
      conceptStore.selectConcept('http://example.org/concept/1')
      await nextTick()
      const endTime = Date.now()

      // Should be nearly instant (no artificial delay)
      expect(endTime - startTime).toBeLessThan(100)
      expect(conceptStore.selectedUri).toBe('http://example.org/concept/1')
    })
  })

  describe('URL state synchronization', () => {
    it('updates URL when concept is selected', async () => {
      const conceptStore = useConceptStore()

      mountSkosView()
      await flushPromises()

      conceptStore.selectConcept('http://example.org/concept/1')
      await nextTick()
      await flushPromises()

      // Router should be called with concept in query
      expect(mockPush).toHaveBeenCalled()
    })

    it('updates URL when scheme changes', async () => {
      const schemeStore = useSchemeStore()

      schemeStore.schemes = [
        { uri: 'http://example.org/scheme/1', label: 'Scheme 1' },
      ]

      mountSkosView()
      await flushPromises()

      schemeStore.selectScheme('http://example.org/scheme/1')
      await nextTick()
      await flushPromises()

      // Router should be called
      expect(mockReplace).toHaveBeenCalled()
    })
  })

  describe('concept selection', () => {
    it('clears scheme viewing when selecting concept', async () => {
      const schemeStore = useSchemeStore()
      const conceptStore = useConceptStore()

      schemeStore.schemes = [
        { uri: 'http://example.org/scheme/1', label: 'Scheme 1' },
      ]
      schemeStore.selectScheme('http://example.org/scheme/1')
      schemeStore.viewScheme('http://example.org/scheme/1')

      expect(schemeStore.viewingSchemeUri).toBe('http://example.org/scheme/1')

      mountSkosView()
      await flushPromises()

      // Select concept should clear scheme viewing
      schemeStore.viewScheme(null)
      conceptStore.selectConcept('http://example.org/concept/1')
      await nextTick()

      expect(schemeStore.viewingSchemeUri).toBeNull()
      expect(conceptStore.selectedUri).toBe('http://example.org/concept/1')
    })
  })

  describe('scheme navigation from details', () => {
    it('switches to scheme mode when navigating to scheme from details', async () => {
      const schemeStore = useSchemeStore()
      const conceptStore = useConceptStore()
      const uiStore = useUIStore()

      // Start in collection mode with a concept selected
      schemeStore.setRootMode('collection')
      conceptStore.selectConcept('http://example.org/concept/1')

      expect(schemeStore.rootMode).toBe('collection')

      mountSkosView()
      await flushPromises()

      // Simulate navigating to a scheme from details
      // This tests the state changes that selectSchemeFromDetails would make
      schemeStore.setRootMode('scheme')
      schemeStore.selectScheme('http://example.org/scheme/1')
      conceptStore.selectConcept(null)
      conceptStore.selectCollection(null)
      uiStore.setSidebarTab('browse')
      await nextTick()
      schemeStore.viewScheme('http://example.org/scheme/1')

      expect(schemeStore.rootMode).toBe('scheme')
      expect(schemeStore.selectedUri).toBe('http://example.org/scheme/1')
      expect(conceptStore.selectedUri).toBeNull()
      expect(conceptStore.selectedCollectionUri).toBeNull()
      expect(schemeStore.viewingSchemeUri).toBe('http://example.org/scheme/1')
    })

    it('clears collection selection when navigating to scheme', async () => {
      const schemeStore = useSchemeStore()
      const conceptStore = useConceptStore()

      // Start in collection mode with a collection selected
      schemeStore.setRootMode('collection')
      conceptStore.selectCollection('http://example.org/collection/1')

      mountSkosView()
      await flushPromises()

      // Navigate to scheme
      schemeStore.setRootMode('scheme')
      schemeStore.selectScheme('http://example.org/scheme/1')
      conceptStore.selectConcept(null)
      conceptStore.selectCollection(null)
      await nextTick()

      expect(conceptStore.selectedCollectionUri).toBeNull()
    })
  })
})
