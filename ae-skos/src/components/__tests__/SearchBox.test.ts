/**
 * SearchBox Component Tests
 *
 * Tests for search input, debouncing, and result handling.
 * @see /spec/ae-skos/sko05-SearchBox.md
 * @see /spec/ae-skos/sko07-Testing.md
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import SearchBox from '../skos/SearchBox.vue'
import { useConceptStore, useEndpointStore, useSchemeStore, useSettingsStore } from '../../stores'
import { createSparqlResults, mockFetchSuccess } from '../../test-utils/mocks'

// Mock the logger
vi.mock('../../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('SearchBox', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function mountSearchBox() {
    return mount(SearchBox, {
      global: {
        directives: {
          tooltip: () => {}, // Stub PrimeVue tooltip directive
        },
        stubs: {
          InputText: {
            template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'input\', $event)" />',
            props: ['modelValue'],
            emits: ['update:modelValue', 'input'],
          },
          Button: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
          Listbox: {
            template: '<div class="listbox"><button class="select-first" @click="$emit(\'change\', { value: options?.[0] })">select</button><slot name="option" v-for="opt in options" :option="opt" /></div>',
            props: ['options'],
          },
          Dialog: { template: '<div v-if="visible"><slot /><slot name="footer" /></div>', props: ['visible'] },
          Checkbox: { template: '<input type="checkbox" />' },
          RadioButton: { template: '<input type="radio" />' },
          ProgressSpinner: { template: '<div class="spinner">Loading...</div>' },
          Message: { template: '<div class="message"><slot /></div>' },
        },
      },
    })
  }

  function getLastQueryFromFetchMock(): string {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
    const request = call?.[1] as RequestInit | undefined
    const body = String(request?.body ?? '')
    return decodeURIComponent(body.replace(/^query=/, ''))
  }

  describe('initial state', () => {
    it('renders search input', () => {
      const wrapper = mountSearchBox()
      expect(wrapper.find('input').exists()).toBe(true)
    })

    it('starts with empty search', () => {
      const wrapper = mountSearchBox()
      expect(wrapper.find('input').element.value).toBe('')
    })

    it('does not show results initially', () => {
      const wrapper = mountSearchBox()
      expect(wrapper.find('.search-results').exists()).toBe(false)
    })

    it('does not show loading initially', () => {
      const wrapper = mountSearchBox()
      expect(wrapper.find('.spinner').exists()).toBe(false)
    })
  })

  describe('input handling', () => {
    it('does not search for queries under 2 chars', async () => {
      const wrapper = mountSearchBox()
      const conceptStore = useConceptStore()

      await wrapper.find('input').setValue('a')
      await vi.advanceTimersByTimeAsync(400)

      expect(conceptStore.loadingSearch).toBe(false)
      expect(conceptStore.searchResults).toEqual([])
    })

    it('debounces input by 300ms', async () => {
      // Setup endpoint
      const endpointStore = useEndpointStore()
      endpointStore.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
      })
      endpointStore.selectEndpoint(endpointStore.endpoints[0]!.id)

      // Mock fetch
      global.fetch = mockFetchSuccess(createSparqlResults([]))

      const wrapper = mountSearchBox()

      // Type quickly
      await wrapper.find('input').setValue('test')

      // Check not called yet
      expect(fetch).not.toHaveBeenCalled()

      // Advance 200ms
      await vi.advanceTimersByTimeAsync(200)
      expect(fetch).not.toHaveBeenCalled()

      // Advance remaining 100ms
      await vi.advanceTimersByTimeAsync(100)
      await flushPromises()

      expect(fetch).toHaveBeenCalled()
    })

    it('clears search when input is cleared', async () => {
      const wrapper = mountSearchBox()
      const conceptStore = useConceptStore()

      // Setup some existing search state
      conceptStore.setSearchQuery('old query')
      conceptStore.setSearchResults([{ uri: 'http://ex.org/c1', label: 'Old', matchedIn: 'prefLabel' }])

      // Clear input
      await wrapper.find('input').setValue('')

      expect(conceptStore.searchQuery).toBe('')
      expect(conceptStore.searchResults).toEqual([])
    })
  })

  describe('search execution', () => {
    it('sets loading state during search', async () => {
      // Setup
      const endpointStore = useEndpointStore()
      const conceptStore = useConceptStore()
      endpointStore.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
      })
      endpointStore.selectEndpoint(endpointStore.endpoints[0]!.id)

      // Mock fetch with delay
      let resolvePromise: (value: unknown) => void
      global.fetch = vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          resolvePromise = resolve
        })
      })

      const wrapper = mountSearchBox()
      await wrapper.find('input').setValue('test')

      // Advance debounce
      await vi.advanceTimersByTimeAsync(300)

      // Should be loading
      expect(conceptStore.loadingSearch).toBe(true)

      // Resolve fetch
      const results = createSparqlResults([])
      resolvePromise!({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(results),
        text: () => Promise.resolve(JSON.stringify(results)),
      })

      await flushPromises()

      // Should not be loading anymore
      expect(conceptStore.loadingSearch).toBe(false)
    })

    it('stores search results in concept store', async () => {
      vi.useRealTimers() // Use real timers for this test

      const endpointStore = useEndpointStore()
      const conceptStore = useConceptStore()

      endpointStore.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
      })
      endpointStore.selectEndpoint(endpointStore.endpoints[0]!.id)

      // Mock fetch with results
      global.fetch = mockFetchSuccess(createSparqlResults([
        { resource: 'http://ex.org/c1', resourceType: 'concept', label: 'Result 1', matchedLabel: 'Result 1', matchType: 'prefLabel', hasNarrower: '1' },
        { resource: 'http://ex.org/c2', resourceType: 'scheme', label: 'Result 2', matchedLabel: 'Result 2', matchType: 'prefLabel' },
      ]))

      const wrapper = mountSearchBox()
      await wrapper.find('input').setValue('result')

      // Wait for debounce and execution
      await new Promise(r => setTimeout(r, 350))
      await flushPromises()

      expect(conceptStore.searchResults.length).toBe(2)
      expect(conceptStore.searchResults[0]?.uri).toBe('http://ex.org/c1')
      expect(conceptStore.searchResults[0]?.hasNarrower).toBe(true)
    })

    it('uses capability-aware single-scheme filtering when endpoint relationships are available', async () => {
      const endpointStore = useEndpointStore()
      const schemeStore = useSchemeStore()
      const settingsStore = useSettingsStore()

      endpointStore.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
        analysis: {
          hasSkosContent: true,
          supportsNamedGraphs: false,
          skosGraphCount: 0,
          languages: [],
          analyzedAt: new Date().toISOString(),
          relationships: {
            hasInScheme: false,
            hasTopConceptOf: true,
            hasHasTopConcept: true,
            hasBroader: false,
            hasNarrower: false,
            hasBroaderTransitive: true,
            hasNarrowerTransitive: true,
          },
        },
      })
      endpointStore.selectEndpoint(endpointStore.endpoints[0]!.id)
      schemeStore.setSchemes([{ uri: 'http://ex.org/scheme/current', label: 'Current Scheme' }])
      schemeStore.selectScheme('http://ex.org/scheme/current')
      settingsStore.searchAllSchemes = false

      global.fetch = mockFetchSuccess(createSparqlResults([]))

      const wrapper = mountSearchBox()
      await wrapper.find('input').setValue('grain')
      await vi.advanceTimersByTimeAsync(300)
      await flushPromises()

      const query = getLastQueryFromFetchMock()

      expect(query).toContain('?resource skos:topConceptOf <http://ex.org/scheme/current> .')
      expect(query).toContain('<http://ex.org/scheme/current> skos:hasTopConcept ?resource .')
      expect(query).toContain('?resource skos:broaderTransitive ?topConcept .')
      expect(query).toContain('?topConcept skos:narrowerTransitive ?resource .')
      expect(query).toContain('?memberConcept skos:topConceptOf <http://ex.org/scheme/current> .')
    })

    it('falls back to broader path single-scheme filtering when endpoint relationships are unavailable', async () => {
      const endpointStore = useEndpointStore()
      const schemeStore = useSchemeStore()
      const settingsStore = useSettingsStore()

      endpointStore.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
      })
      endpointStore.selectEndpoint(endpointStore.endpoints[0]!.id)
      schemeStore.setSchemes([{ uri: 'http://ex.org/scheme/current', label: 'Current Scheme' }])
      schemeStore.selectScheme('http://ex.org/scheme/current')
      settingsStore.searchAllSchemes = false

      global.fetch = mockFetchSuccess(createSparqlResults([]))

      const wrapper = mountSearchBox()
      await wrapper.find('input').setValue('grain')
      await vi.advanceTimersByTimeAsync(300)
      await flushPromises()

      const query = getLastQueryFromFetchMock()

      expect(query).toContain('(skos:broader|^skos:narrower)+ ?topConcept')
      expect(query).toContain('?topConcept skos:topConceptOf <http://ex.org/scheme/current> .')
      expect(query).toContain('<http://ex.org/scheme/current> skos:hasTopConcept ?topConcept .')
    })

    it('applies single-scheme filter when selectedUri exists even if scheme object is not resolved', async () => {
      const endpointStore = useEndpointStore()
      const schemeStore = useSchemeStore()
      const settingsStore = useSettingsStore()

      endpointStore.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
      })
      endpointStore.selectEndpoint(endpointStore.endpoints[0]!.id)

      // Intentionally do not populate schemeStore.schemes; only selectedUri is set.
      schemeStore.selectScheme('http://ex.org/scheme/current')
      settingsStore.searchAllSchemes = false

      global.fetch = mockFetchSuccess(createSparqlResults([]))

      const wrapper = mountSearchBox()
      await wrapper.find('input').setValue('grain')
      await vi.advanceTimersByTimeAsync(300)
      await flushPromises()

      const query = getLastQueryFromFetchMock()

      expect(query).toContain('<http://ex.org/scheme/current>')
      expect(query).toContain('?resourceType = "scheme"')
      expect(query).toContain('FILTER (')
    })

    it('normalizes result scheme context to selected scheme in single-scheme mode', async () => {
      vi.useRealTimers()

      const endpointStore = useEndpointStore()
      const schemeStore = useSchemeStore()
      const settingsStore = useSettingsStore()
      const conceptStore = useConceptStore()

      endpointStore.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
      })
      endpointStore.selectEndpoint(endpointStore.endpoints[0]!.id)
      schemeStore.setSchemes([{ uri: 'http://ex.org/scheme/current', label: 'Current Scheme' }])
      schemeStore.selectScheme('http://ex.org/scheme/current')
      settingsStore.searchAllSchemes = false

      global.fetch = mockFetchSuccess(createSparqlResults([
        {
          resource: 'http://ex.org/c1',
          resourceType: 'concept',
          label: 'Result 1',
          matchedLabel: 'Result 1',
          matchType: 'prefLabel',
          scheme: 'http://ex.org/scheme/other',
          schemeLabel: 'Other Scheme',
        },
      ]))

      const wrapper = mountSearchBox()
      await wrapper.find('input').setValue('result')
      await new Promise(r => setTimeout(r, 350))
      await flushPromises()

      expect(conceptStore.searchResults[0]?.scheme?.uri).toBe('http://ex.org/scheme/current')
      expect(conceptStore.searchResults[0]?.scheme?.label).toBe('Current Scheme')
    })

    it('keeps collection type when duplicate bindings include concept and collection for same resource', async () => {
      vi.useRealTimers()

      const endpointStore = useEndpointStore()
      const conceptStore = useConceptStore()

      endpointStore.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
      })
      endpointStore.selectEndpoint(endpointStore.endpoints[0]!.id)

      global.fetch = mockFetchSuccess(createSparqlResults([
        {
          resource: 'http://ex.org/coll-1',
          resourceType: 'concept',
          label: 'Ambiguous Resource',
          matchedLabel: 'Ambiguous Resource',
          matchType: 'prefLabel',
          hasNarrower: '0',
        },
        {
          resource: 'http://ex.org/coll-1',
          resourceType: 'collection',
          label: 'Ambiguous Resource',
          matchedLabel: 'Ambiguous',
          matchType: 'altLabel',
        },
      ]))

      const wrapper = mountSearchBox()
      await wrapper.find('input').setValue('ambiguous')
      await new Promise(r => setTimeout(r, 350))
      await flushPromises()

      expect(conceptStore.searchResults).toHaveLength(1)
      expect(conceptStore.searchResults[0]?.type).toBe('collection')
    })

    it('infers collection/ordered type from member predicates when resourceType is concept', async () => {
      vi.useRealTimers()

      const endpointStore = useEndpointStore()
      const conceptStore = useConceptStore()

      endpointStore.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
      })
      endpointStore.selectEndpoint(endpointStore.endpoints[0]!.id)

      global.fetch = mockFetchSuccess(createSparqlResults([
        {
          resource: 'http://ex.org/r1',
          resourceType: 'concept',
          label: 'Collection-like',
          matchedLabel: 'Collection-like',
          matchType: 'prefLabel',
          hasMembers: 'true',
          hasMemberList: 'false',
        },
        {
          resource: 'http://ex.org/r2',
          resourceType: 'concept',
          label: 'Ordered-like',
          matchedLabel: 'Ordered-like',
          matchType: 'prefLabel',
          hasMembers: 'true',
          hasMemberList: 'true',
        },
      ]))

      const wrapper = mountSearchBox()
      await wrapper.find('input').setValue('like')
      await new Promise(r => setTimeout(r, 350))
      await flushPromises()

      expect(conceptStore.searchResults[0]?.type).toBe('collection')
      expect(conceptStore.searchResults[1]?.type).toBe('orderedCollection')
    })
  })

  describe('result selection', () => {
    it('emits scheme-aware selection and stores the correct scheme in history', async () => {
      const conceptStore = useConceptStore()
      const schemeStore = useSchemeStore()
      const addToHistorySpy = vi.spyOn(conceptStore, 'addToHistory')

      schemeStore.selectScheme('http://ex.org/scheme/current')

      // Setup results in store
      conceptStore.setSearchQuery('test')
      conceptStore.setSearchResults([
        {
          uri: 'http://ex.org/c1',
          label: 'Result 1',
          matchedIn: 'prefLabel',
          scheme: { uri: 'http://ex.org/scheme/actual', label: 'Actual Scheme' },
        },
      ])

      const wrapper = mountSearchBox()
      await wrapper.find('input').setValue('test')
      await flushPromises()
      await wrapper.find('.select-first').trigger('click')

      expect(wrapper.emitted('selectConcept')?.[0]?.[0]).toEqual({
        uri: 'http://ex.org/c1',
        type: 'concept',
        schemeUri: 'http://ex.org/scheme/actual',
      })
      expect(addToHistorySpy).toHaveBeenCalledWith(expect.objectContaining({
        uri: 'http://ex.org/c1',
        schemeUri: 'http://ex.org/scheme/actual',
        type: 'concept',
      }))
    })

    it('emits and stores collection/ordered type from search results', async () => {
      const conceptStore = useConceptStore()
      const addToHistorySpy = vi.spyOn(conceptStore, 'addToHistory')

      conceptStore.setSearchQuery('test')
      conceptStore.setSearchResults([
        {
          uri: 'http://ex.org/col1',
          label: 'Ordered Collection',
          type: 'orderedCollection',
          matchedIn: 'prefLabel',
          scheme: { uri: 'http://ex.org/scheme/1', label: 'Scheme 1' },
        },
      ])

      const wrapper = mountSearchBox()
      await wrapper.find('input').setValue('test')
      await flushPromises()
      await wrapper.find('.select-first').trigger('click')

      expect(wrapper.emitted('selectConcept')?.[0]?.[0]).toEqual({
        uri: 'http://ex.org/col1',
        type: 'orderedCollection',
        schemeUri: 'http://ex.org/scheme/1',
      })
      expect(addToHistorySpy).toHaveBeenCalledWith(expect.objectContaining({
        uri: 'http://ex.org/col1',
        type: 'orderedCollection',
      }))
    })
  })

  describe('result rendering', () => {
    it('shows concept icons based on hasNarrower', async () => {
      const conceptStore = useConceptStore()
      conceptStore.setSearchQuery('test')
      conceptStore.setSearchResults([
        { uri: 'http://ex.org/c1', label: 'Parent', matchedIn: 'prefLabel', hasNarrower: true },
        { uri: 'http://ex.org/c2', label: 'Leaf', matchedIn: 'prefLabel', hasNarrower: false },
      ])

      const wrapper = mountSearchBox()
      await wrapper.find('input').setValue('test')
      await flushPromises()

      const icons = wrapper.findAll('.result-icon')
      expect(icons).toHaveLength(2)
      expect(icons[0]?.text()).toBe('label')
      expect(icons[1]?.text()).toBe('circle')
    })

    it('shows specific icons for scheme, collection, and ordered collection', async () => {
      const conceptStore = useConceptStore()
      conceptStore.setSearchQuery('test')
      conceptStore.setSearchResults([
        { uri: 'http://ex.org/s1', label: 'Scheme', type: 'scheme', matchedIn: 'prefLabel' },
        { uri: 'http://ex.org/coll', label: 'Collection', type: 'collection', matchedIn: 'prefLabel' },
        { uri: 'http://ex.org/ocoll', label: 'Ordered', type: 'orderedCollection', matchedIn: 'prefLabel' },
      ])

      const wrapper = mountSearchBox()
      await wrapper.find('input').setValue('test')
      await flushPromises()

      const icons = wrapper.findAll('.result-icon')
      expect(icons).toHaveLength(3)
      expect(icons[0]?.text()).toBe('folder')
      expect(icons[1]?.text()).toBe('collections_bookmark')
      expect(icons[2]?.text()).toBe('format_list_numbered')
    })
  })

  describe('error handling', () => {
    it('requires endpoint to execute search', async () => {
      // Without an endpoint, search should not execute
      const conceptStore = useConceptStore()

      const wrapper = mountSearchBox()
      await wrapper.find('input').setValue('test')

      await vi.advanceTimersByTimeAsync(400)

      // No fetch should be called without endpoint
      expect(conceptStore.loadingSearch).toBe(false)
    })
  })

  describe('no results state', () => {
    it('shows no results message when search returns empty', async () => {
      vi.useRealTimers()

      const endpointStore = useEndpointStore()
      endpointStore.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
      })
      endpointStore.selectEndpoint(endpointStore.endpoints[0]!.id)

      global.fetch = mockFetchSuccess(createSparqlResults([]))

      const wrapper = mountSearchBox()
      await wrapper.find('input').setValue('nonexistent')

      await new Promise(r => setTimeout(r, 350))
      await flushPromises()

      expect(wrapper.find('.no-results').exists()).toBe(true)
    })
  })
})
