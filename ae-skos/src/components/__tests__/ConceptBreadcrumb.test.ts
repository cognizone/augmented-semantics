/**
 * ConceptBreadcrumb Component Tests
 *
 * Tests for hierarchical navigation path display and scheme selection.
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import ConceptBreadcrumb from '../skos/ConceptBreadcrumb.vue'
import { useConceptStore, useEndpointStore, useSchemeStore, useLanguageStore, useUIStore } from '../../stores'

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

describe('ConceptBreadcrumb', () => {
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

    // Default mock - empty schemes
    ;(executeSparql as Mock).mockResolvedValue({ results: { bindings: [] } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mountBreadcrumb() {
    return mount(ConceptBreadcrumb, {
      global: {
        stubs: {
          Select: {
            template: `
              <div class="p-select" @click="onClick">
                <slot name="value" />
                <div class="p-select-overlay" v-if="showOverlay">
                  <div v-for="opt in options" :key="opt.value" class="p-select-option" @click.stop="selectOption(opt)">
                    {{ opt.label }}
                  </div>
                </div>
              </div>
            `,
            props: ['modelValue', 'options', 'optionLabel', 'optionValue', 'placeholder', 'disabled'],
            emits: ['update:modelValue'],
            data() {
              return { showOverlay: false }
            },
            methods: {
              onClick() {
                if (!this.disabled) {
                  this.showOverlay = !this.showOverlay
                }
              },
              selectOption(opt: { value: string | null; label: string }) {
                this.$emit('update:modelValue', opt.value)
                this.showOverlay = false
              },
            },
          },
          Breadcrumb: {
            template: `
              <nav class="p-breadcrumb">
                <ol class="p-breadcrumb-list">
                  <li v-for="(item, i) in model" :key="i" class="p-breadcrumb-item">
                    <slot name="item" :item="item" />
                  </li>
                </ol>
              </nav>
            `,
            props: ['model'],
          },
        },
      },
    })
  }

  describe('initial rendering', () => {
    it('renders home button', () => {
      const wrapper = mountBreadcrumb()
      expect(wrapper.find('.home-btn').exists()).toBe(true)
    })

    it('renders scheme selector', () => {
      const wrapper = mountBreadcrumb()
      expect(wrapper.find('.scheme-select').exists()).toBe(true)
    })

    it('shows "All Schemes" when no scheme selected', async () => {
      const wrapper = mountBreadcrumb()
      await flushPromises()

      expect(wrapper.find('.scheme-value').text()).toBe('All Schemes')
    })
  })

  describe('scheme selector', () => {
    beforeEach(() => {
      // Mock schemes response
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { scheme: { value: 'http://ex.org/scheme/1' }, label: { value: 'Scheme One' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
            { scheme: { value: 'http://ex.org/scheme/2' }, label: { value: 'Scheme Two' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })
    })

    it('loads schemes on mount', async () => {
      mountBreadcrumb()
      await flushPromises()

      expect(executeSparql).toHaveBeenCalled()
    })

    it('shows scheme options after loading', async () => {
      const schemeStore = useSchemeStore()
      mountBreadcrumb()
      await flushPromises()

      expect(schemeStore.schemes).toHaveLength(2)
    })

    it('shows selected scheme name', async () => {
      const schemeStore = useSchemeStore()

      // Mock schemes query to return our scheme
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { scheme: { value: 'http://ex.org/scheme/1' }, label: { value: 'Test Scheme' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      const wrapper = mountBreadcrumb()
      await flushPromises()

      // Should auto-select since only one scheme
      expect(schemeStore.selectedUri).toBe('http://ex.org/scheme/1')
      expect(wrapper.find('.scheme-value').text()).toBe('Test Scheme')
    })

    it('clears concept when scheme selected from dropdown', async () => {
      const conceptStore = useConceptStore()
      const schemeStore = useSchemeStore()

      schemeStore.setSchemes([
        { uri: 'http://ex.org/scheme/1', label: 'Scheme One' },
        { uri: 'http://ex.org/scheme/2', label: 'Scheme Two' },
      ])
      conceptStore.selectConcept('http://ex.org/concept/1')

      const wrapper = mountBreadcrumb()
      await nextTick()

      // Click to open dropdown
      await wrapper.find('.p-select').trigger('click')
      await nextTick()

      // Select a scheme
      const options = wrapper.findAll('.p-select-option')
      await options[1]?.trigger('click') // Select "Scheme One"
      await nextTick()

      expect(conceptStore.selectedUri).toBeNull()
    })

    it('shows scheme details when scheme selected', async () => {
      const schemeStore = useSchemeStore()

      schemeStore.setSchemes([
        { uri: 'http://ex.org/scheme/1', label: 'Scheme One' },
      ])

      const wrapper = mountBreadcrumb()
      await nextTick()

      // Click to open dropdown
      await wrapper.find('.p-select').trigger('click')
      await nextTick()

      // Select a scheme
      const options = wrapper.findAll('.p-select-option')
      await options[1]?.trigger('click') // Select "Scheme One"
      await nextTick()

      expect(schemeStore.viewingSchemeUri).toBe('http://ex.org/scheme/1')
    })
  })

  describe('home button', () => {
    it('clears concept and shows scheme details when clicked', async () => {
      const conceptStore = useConceptStore()
      const schemeStore = useSchemeStore()

      // Mock single scheme so it gets auto-selected
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { scheme: { value: 'http://ex.org/scheme/1' }, label: { value: 'Test Scheme' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      const wrapper = mountBreadcrumb()
      await flushPromises()

      // Set concept after scheme is loaded
      conceptStore.selectConcept('http://ex.org/concept/1')
      await nextTick()

      await wrapper.find('.home-btn').trigger('click')
      await nextTick()

      expect(conceptStore.selectedUri).toBeNull()
      expect(schemeStore.viewingSchemeUri).toBe('http://ex.org/scheme/1')
    })

    it('scrolls tree to top when clicked', async () => {
      const conceptStore = useConceptStore()

      // Mock single scheme so it gets auto-selected
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { scheme: { value: 'http://ex.org/scheme/1' }, label: { value: 'Test Scheme' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      const wrapper = mountBreadcrumb()
      await flushPromises()

      await wrapper.find('.home-btn').trigger('click')
      await nextTick()

      expect(conceptStore.shouldScrollToTop).toBe(true)
    })

    it('adds scheme to history when clicked', async () => {
      const conceptStore = useConceptStore()

      // Mock single scheme so it gets auto-selected
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { scheme: { value: 'http://ex.org/scheme/1' }, label: { value: 'Test Scheme' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      const wrapper = mountBreadcrumb()
      await flushPromises()

      await wrapper.find('.home-btn').trigger('click')
      await nextTick()

      expect(conceptStore.history).toHaveLength(1)
      expect(conceptStore.history[0]?.type).toBe('scheme')
    })
  })

  describe('breadcrumb path', () => {
    beforeEach(() => {
      // Mock empty scheme response to avoid loading side effects
      ;(executeSparql as Mock).mockResolvedValue({ results: { bindings: [] } })
    })

    it('shows breadcrumb when concept is selected', async () => {
      const conceptStore = useConceptStore()

      // Set concept first, then mount
      conceptStore.selectConcept('http://ex.org/c3')

      // Mock the breadcrumb loading query
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { label: { value: 'Current' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      const wrapper = mountBreadcrumb()
      await flushPromises()

      // Manually set breadcrumb to test rendering (loading sets it)
      conceptStore.setBreadcrumb([
        { uri: 'http://ex.org/c1', label: 'Root' },
        { uri: 'http://ex.org/c2', label: 'Parent' },
        { uri: 'http://ex.org/c3', label: 'Current' },
      ])
      await nextTick()

      expect(wrapper.find('.p-breadcrumb').exists()).toBe(true)
      const items = wrapper.findAll('.p-breadcrumb-item')
      expect(items).toHaveLength(3)
    })

    it('hides breadcrumb when no concept selected', async () => {
      const wrapper = mountBreadcrumb()
      await flushPromises()

      expect(wrapper.find('.p-breadcrumb').exists()).toBe(false)
    })

    it('shows notation + label when both exist', async () => {
      const conceptStore = useConceptStore()

      // Set concept to prevent breadcrumb clear
      conceptStore.selectConcept('http://ex.org/c1')

      const wrapper = mountBreadcrumb()
      await flushPromises()

      // Set breadcrumb after mount
      conceptStore.setBreadcrumb([
        { uri: 'http://ex.org/c1', label: 'Root', notation: '001' },
      ])
      await nextTick()

      expect(wrapper.text()).toContain('001 - Root')
    })

    it('emits selectConcept when breadcrumb item clicked', async () => {
      const conceptStore = useConceptStore()

      // Set concept to prevent breadcrumb clear
      conceptStore.selectConcept('http://ex.org/c2')

      const wrapper = mountBreadcrumb()
      await flushPromises()

      // Set breadcrumb after mount
      conceptStore.setBreadcrumb([
        { uri: 'http://ex.org/c1', label: 'Root' },
        { uri: 'http://ex.org/c2', label: 'Current' },
      ])
      await nextTick()

      const link = wrapper.find('.breadcrumb-link')
      await link.trigger('click')

      expect(wrapper.emitted('selectConcept')).toBeTruthy()
      expect(wrapper.emitted('selectConcept')![0]).toEqual(['http://ex.org/c1'])
    })
  })

  describe('language changes', () => {
    it('reloads schemes when language changes', async () => {
      const languageStore = useLanguageStore()

      mountBreadcrumb()
      await flushPromises()

      const initialCallCount = (executeSparql as Mock).mock.calls.length

      // Change language
      languageStore.setPreferred('fr')
      await flushPromises()

      // Should have made additional SPARQL calls
      expect((executeSparql as Mock).mock.calls.length).toBeGreaterThan(initialCallCount)
    })
  })

  describe('breadcrumb loading', () => {
    it('loads breadcrumb path when concept selected', async () => {
      const conceptStore = useConceptStore()
      const schemeStore = useSchemeStore()

      schemeStore.setSchemes([
        { uri: 'http://ex.org/scheme/1', label: 'Test Scheme' },
      ])
      schemeStore.selectScheme('http://ex.org/scheme/1')

      // Mock breadcrumb query response
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { label: { value: 'Test Concept' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      const wrapper = mountBreadcrumb()
      await flushPromises()

      conceptStore.selectConcept('http://ex.org/concept/1')
      await flushPromises()

      // Should have made SPARQL call for breadcrumb
      expect(executeSparql).toHaveBeenCalled()
    })

    it('clears breadcrumb when concept deselected', async () => {
      const conceptStore = useConceptStore()
      conceptStore.setBreadcrumb([
        { uri: 'http://ex.org/c1', label: 'Test' },
      ])

      mountBreadcrumb()
      await nextTick()

      conceptStore.selectConcept(null)
      await nextTick()

      expect(conceptStore.breadcrumb).toHaveLength(0)
    })
  })

  describe('auto-select single scheme', () => {
    it('auto-selects when only one scheme exists', async () => {
      const schemeStore = useSchemeStore()

      // Mock single scheme response
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { scheme: { value: 'http://ex.org/scheme/1' }, label: { value: 'Only Scheme' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      mountBreadcrumb()
      await flushPromises()

      expect(schemeStore.selectedUri).toBe('http://ex.org/scheme/1')
    })
  })
})
