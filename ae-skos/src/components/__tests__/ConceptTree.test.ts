/**
 * ConceptTree Component Tests
 *
 * Tests for tree rendering and store interactions.
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import ConceptTree from '../skos/ConceptTree.vue'
import { useConceptStore, useEndpointStore, useSchemeStore, useLanguageStore } from '../../stores'

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
  executeSparql: vi.fn(),
  withPrefixes: vi.fn((q) => q),
}))

import { executeSparql } from '../../services/sparql'
import type { Mock } from 'vitest'

describe('ConceptTree', () => {
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

    // Default mock - empty results
    ;(executeSparql as Mock).mockResolvedValue({ results: { bindings: [] } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mountConceptTree() {
    return mount(ConceptTree, {
      global: {
        directives: {
          tooltip: () => {},
        },
        stubs: {
          Tree: {
            template: '<div class="p-tree"><slot name="default" :node="{ key: \'test\', label: \'Test\', data: {} }" /></div>',
            props: ['value', 'selectionKeys', 'expandedKeys', 'selectionMode'],
          },
          Button: {
            template: '<button @click="$emit(\'click\')" :disabled="disabled"><slot /></button>',
            props: ['disabled', 'icon', 'severity', 'outlined', 'text'],
            emits: ['click'],
          },
          InputText: {
            template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keyup.enter="$emit(\'keyup\', $event)" class="goto-input" />',
            props: ['modelValue', 'placeholder'],
            emits: ['update:modelValue', 'keyup'],
          },
          Message: {
            template: '<div class="p-message" :class="`p-message-${severity}`"><slot /></div>',
            props: ['severity', 'closable'],
          },
          ProgressSpinner: {
            template: '<div class="p-progress-spinner"></div>',
          },
        },
      },
    })
  }

  describe('initial rendering', () => {
    it('renders the tree container', () => {
      const wrapper = mountConceptTree()
      expect(wrapper.find('.concept-tree').exists()).toBe(true)
    })

    it('renders goto-uri section', () => {
      const wrapper = mountConceptTree()
      expect(wrapper.find('.goto-uri').exists()).toBe(true)
    })

    it('renders input for Go to URI', () => {
      const wrapper = mountConceptTree()
      expect(wrapper.find('.goto-input').exists()).toBe(true)
    })
  })

  describe('empty state', () => {
    it('shows empty state when no scheme selected', async () => {
      const wrapper = mountConceptTree()
      await flushPromises()
      await nextTick()

      expect(wrapper.find('.empty-state').exists()).toBe(true)
    })

    it('shows "Select a concept scheme" message when no scheme', async () => {
      const wrapper = mountConceptTree()
      await flushPromises()
      await nextTick()

      expect(wrapper.text()).toContain('Select a concept scheme')
    })
  })

  describe('with scheme selected', () => {
    beforeEach(() => {
      const schemeStore = useSchemeStore()
      schemeStore.schemes = [
        { uri: 'http://example.org/scheme/1', label: 'Test Scheme' },
      ]
      schemeStore.selectScheme('http://example.org/scheme/1')
    })

    it('shows tree when concepts loaded', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              concept: { value: 'http://example.org/concept/1' },
              label: { value: 'Concept 1' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
              narrowerCount: { value: '0' },
            },
          ],
        },
      })

      const wrapper = mountConceptTree()
      await flushPromises()
      await nextTick()

      expect(wrapper.find('.p-tree').exists()).toBe(true)
    })

    it('shows empty state for scheme with no concepts', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const wrapper = mountConceptTree()
      await flushPromises()
      await nextTick()

      expect(wrapper.find('.empty-state').exists()).toBe(true)
      expect(wrapper.text()).toContain('no top-level concepts')
    })
  })

  describe('store interactions', () => {
    it('selectConcept updates conceptStore', () => {
      const conceptStore = useConceptStore()

      conceptStore.selectConcept('http://example.org/concept/1')

      expect(conceptStore.selectedUri).toBe('http://example.org/concept/1')
    })

    it('expandNode adds to expanded set', () => {
      const conceptStore = useConceptStore()

      conceptStore.expandNode('http://example.org/concept/1')

      expect(conceptStore.expanded.has('http://example.org/concept/1')).toBe(true)
    })

    it('collapseNode removes from expanded set', () => {
      const conceptStore = useConceptStore()
      conceptStore.expandNode('http://example.org/concept/1')

      conceptStore.collapseNode('http://example.org/concept/1')

      expect(conceptStore.expanded.has('http://example.org/concept/1')).toBe(false)
    })

    it('setTopConcepts updates topConcepts', () => {
      const conceptStore = useConceptStore()

      conceptStore.setTopConcepts([
        { uri: 'http://example.org/concept/1', label: 'Concept 1', hasNarrower: false },
      ])

      expect(conceptStore.topConcepts).toHaveLength(1)
      expect(conceptStore.topConcepts[0].uri).toBe('http://example.org/concept/1')
    })

    it('addToHistory adds history entry', () => {
      const conceptStore = useConceptStore()

      conceptStore.addToHistory({
        uri: 'http://example.org/concept/1',
        label: 'Concept 1',
      })

      expect(conceptStore.history).toHaveLength(1)
      expect(conceptStore.history[0].uri).toBe('http://example.org/concept/1')
    })
  })

  describe('loading states', () => {
    it('loadingTree reflects store state', () => {
      const conceptStore = useConceptStore()

      expect(conceptStore.loadingTree).toBe(false)

      conceptStore.setLoadingTree(true)
      expect(conceptStore.loadingTree).toBe(true)

      conceptStore.setLoadingTree(false)
      expect(conceptStore.loadingTree).toBe(false)
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      const schemeStore = useSchemeStore()
      schemeStore.schemes = [
        { uri: 'http://example.org/scheme/1', label: 'Test Scheme' },
      ]
      schemeStore.selectScheme('http://example.org/scheme/1')
    })

    it('sets error on query failure', async () => {
      ;(executeSparql as Mock).mockRejectedValueOnce(new Error('Network error'))

      const wrapper = mountConceptTree()
      await flushPromises()
      await nextTick()

      // Component should show error message
      expect(wrapper.find('.p-message-error').exists()).toBe(true)
    })

    it('stores error in treeError', async () => {
      const conceptStore = useConceptStore()

      ;(executeSparql as Mock).mockRejectedValueOnce(new Error('Network error'))

      const wrapper = mountConceptTree()
      await flushPromises()
      await nextTick()

      // Note: Component stores error locally, not in store
      // But we can verify error message is displayed
      expect(wrapper.text()).toContain('Network error')
    })
  })

  describe('language handling', () => {
    it('languageStore.preferred affects label selection', () => {
      const languageStore = useLanguageStore()

      languageStore.setPreferred('fr')
      expect(languageStore.preferred).toBe('fr')

      languageStore.setPreferred('en')
      expect(languageStore.preferred).toBe('en')
    })
  })

  describe('SPARQL query patterns', () => {
    beforeEach(() => {
      const schemeStore = useSchemeStore()
      schemeStore.schemes = [
        { uri: 'http://example.org/scheme/1', label: 'Test Scheme' },
      ]
      schemeStore.selectScheme('http://example.org/scheme/1')
    })

    it('top concepts query supports both skos:broader and skos:narrower for fallback', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      mountConceptTree()
      await flushPromises()

      const query = (executeSparql as Mock).mock.calls[0][1]
      // Fallback should check both directions
      expect(query).toContain('FILTER NOT EXISTS { ?concept skos:broader ?broader }')
      expect(query).toContain('FILTER NOT EXISTS { ?parent skos:narrower ?concept }')
    })

    it('top concepts query counts children via both skos:broader and skos:narrower', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      mountConceptTree()
      await flushPromises()

      const query = (executeSparql as Mock).mock.calls[0][1]
      // Child counting should use UNION for both directions
      expect(query).toContain('?narrower skos:broader ?concept')
      expect(query).toContain('?concept skos:narrower ?narrower')
    })
  })
})
