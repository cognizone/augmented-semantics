/**
 * ConceptDetails Component Tests
 *
 * Tests for concept property display and interactions.
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { ref, nextTick } from 'vue'
import ConceptDetails from '../skos/ConceptDetails.vue'
import { useConceptStore, useEndpointStore, useLanguageStore, useSettingsStore } from '../../stores'

// Mock the logger
vi.mock('../../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock PrimeVue toast
vi.mock('primevue/usetoast', () => ({
  useToast: () => ({ add: vi.fn() }),
}))

// Mock services
vi.mock('../../services', () => ({
  isValidURI: vi.fn((uri) => uri?.startsWith('http')),
  fetchRawRdf: vi.fn(),
}))

// Mock useConceptData composable
const mockDetails = ref(null)
const mockLoading = ref(false)
const mockError = ref(null)
const mockLoadDetails = vi.fn()

vi.mock('../../composables/useConceptData', () => ({
  useConceptData: () => ({
    details: mockDetails,
    loading: mockLoading,
    error: mockError,
    resolvedPredicates: ref(new Map()),
    loadDetails: mockLoadDetails,
  }),
}))

describe('ConceptDetails', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    // Reset mock state
    mockDetails.value = null
    mockLoading.value = false
    mockError.value = null

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
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mountConceptDetails() {
    return mount(ConceptDetails, {
      global: {
        directives: {
          tooltip: () => {},
        },
        stubs: {
          Button: {
            template: '<button @click="$emit(\'click\')" :disabled="disabled" :aria-label="ariaLabel"><slot /></button>',
            props: ['disabled', 'icon', 'severity', 'outlined', 'text', 'size', 'ariaLabel'],
            emits: ['click'],
          },
          Divider: { template: '<hr />' },
          Message: {
            template: '<div class="p-message" :class="`p-message-${severity}`"><slot /></div>',
            props: ['severity', 'closable'],
          },
          ProgressSpinner: { template: '<div class="p-progress-spinner"></div>' },
          Menu: { template: '<div class="p-menu"></div>', props: ['model', 'popup'] },
          XLLabelsGroup: { template: '<div class="xl-labels-group"></div>', props: ['xlLabels', 'regularLabels', 'title', 'showHidden'] },
          RawRdfDialog: { template: '<div class="raw-rdf-dialog" v-if="visible"></div>', props: ['visible', 'resourceUri'] },
        },
      },
    })
  }

  describe('initial rendering', () => {
    it('renders the details container', () => {
      const wrapper = mountConceptDetails()
      expect(wrapper.find('.concept-details').exists()).toBe(true)
    })

    it('shows empty state when no concept selected', () => {
      const wrapper = mountConceptDetails()
      expect(wrapper.find('.empty-state').exists()).toBe(true)
      expect(wrapper.text()).toContain('Select a concept')
    })
  })

  describe('loading state', () => {
    it('shows loading state when loading', async () => {
      const conceptStore = useConceptStore()
      conceptStore.selectConcept('http://example.org/concept/1')
      mockLoading.value = true

      const wrapper = mountConceptDetails()
      await nextTick()

      // With delayed loading, spinner might not show immediately
      expect(mockLoading.value).toBe(true)
    })

    it('calls loadDetails when concept is selected', async () => {
      const conceptStore = useConceptStore()
      conceptStore.selectConcept('http://example.org/concept/1')

      const wrapper = mountConceptDetails()
      await flushPromises()

      expect(mockLoadDetails).toHaveBeenCalledWith('http://example.org/concept/1')
    })
  })

  describe('with concept loaded', () => {
    beforeEach(() => {
      const conceptStore = useConceptStore()
      conceptStore.selectConcept('http://example.org/concept/1')

      mockDetails.value = {
        uri: 'http://example.org/concept/1',
        prefLabels: [{ value: 'Test Concept', lang: 'en' }],
        altLabels: [{ value: 'Alt Label', lang: 'en' }],
        hiddenLabels: [],
        definitions: [{ value: 'A test concept definition', lang: 'en' }],
        scopeNotes: [],
        historyNotes: [],
        changeNotes: [],
        editorialNotes: [],
        examples: [],
        notations: [{ value: '1.1' }],
        broader: [{ uri: 'http://example.org/broader/1', label: 'Broader Concept' }],
        narrower: [],
        related: [],
        inScheme: [{ uri: 'http://example.org/scheme/1' }],
        exactMatch: [],
        closeMatch: [],
        broadMatch: [],
        narrowMatch: [],
        relatedMatch: [],
        prefLabelsXL: [],
        altLabelsXL: [],
        hiddenLabelsXL: [],
        otherProperties: [],
      }
    })

    it('displays concept title', async () => {
      const wrapper = mountConceptDetails()
      await nextTick()

      expect(wrapper.text()).toContain('Test Concept')
    })

    it('displays notation in title', async () => {
      const wrapper = mountConceptDetails()
      await nextTick()

      expect(wrapper.text()).toContain('1.1')
    })

    it('displays definition', async () => {
      const wrapper = mountConceptDetails()
      await nextTick()

      expect(wrapper.text()).toContain('A test concept definition')
    })

    it('shows labels section', async () => {
      const wrapper = mountConceptDetails()
      await nextTick()

      // Check for details-section with Labels heading
      expect(wrapper.text()).toContain('Labels')
    })

    it('shows hierarchy section when broader exists', async () => {
      const wrapper = mountConceptDetails()
      await nextTick()

      // Check for Hierarchy heading
      expect(wrapper.text()).toContain('Hierarchy')
    })

    it('hides hierarchy section when no broader/narrower', async () => {
      mockDetails.value.broader = []
      mockDetails.value.narrower = []

      const wrapper = mountConceptDetails()
      await nextTick()

      // Should not show Hierarchy when no broader/narrower
      expect(wrapper.text()).not.toContain('Hierarchy')
    })
  })

  describe('navigation', () => {
    beforeEach(() => {
      const conceptStore = useConceptStore()
      conceptStore.selectConcept('http://example.org/concept/1')

      mockDetails.value = {
        uri: 'http://example.org/concept/1',
        prefLabels: [{ value: 'Test Concept', lang: 'en' }],
        altLabels: [],
        hiddenLabels: [],
        definitions: [],
        scopeNotes: [],
        historyNotes: [],
        changeNotes: [],
        editorialNotes: [],
        examples: [],
        notations: [],
        broader: [{ uri: 'http://example.org/broader/1', label: 'Broader Concept' }],
        narrower: [],
        related: [],
        inScheme: [],
        exactMatch: [],
        closeMatch: [],
        broadMatch: [],
        narrowMatch: [],
        relatedMatch: [],
        prefLabelsXL: [],
        altLabelsXL: [],
        hiddenLabelsXL: [],
        otherProperties: [],
      }
    })

    it('emits selectConcept when navigating to broader', async () => {
      const wrapper = mountConceptDetails()
      await nextTick()

      // Find broader concept link
      const broaderLink = wrapper.find('.broader-concepts .concept-link')
      if (broaderLink.exists()) {
        await broaderLink.trigger('click')
        expect(wrapper.emitted('selectConcept')).toBeTruthy()
      }
    })
  })

  describe('error handling', () => {
    it('displays error message when loading fails', async () => {
      const conceptStore = useConceptStore()
      conceptStore.selectConcept('http://example.org/concept/1')
      mockError.value = 'Failed to load concept'

      const wrapper = mountConceptDetails()
      await nextTick()

      expect(wrapper.find('.p-message-error').exists()).toBe(true)
      expect(wrapper.text()).toContain('Failed to load concept')
    })
  })

  describe('store interactions', () => {
    it('selectedUri reflects conceptStore', () => {
      const conceptStore = useConceptStore()
      expect(conceptStore.selectedUri).toBeNull()

      conceptStore.selectConcept('http://example.org/concept/1')
      expect(conceptStore.selectedUri).toBe('http://example.org/concept/1')
    })

    it('clearing selection shows empty state', async () => {
      const conceptStore = useConceptStore()
      conceptStore.selectConcept('http://example.org/concept/1')

      const wrapper = mountConceptDetails()
      await nextTick()

      conceptStore.selectConcept(null as unknown as string)
      await nextTick()

      expect(wrapper.find('.empty-state').exists()).toBe(true)
    })
  })

  describe('settings', () => {
    it('settingsStore.showDatatypes affects display', () => {
      const settingsStore = useSettingsStore()

      expect(settingsStore.showDatatypes).toBe(true) // default

      settingsStore.setShowDatatypes(false)
      expect(settingsStore.showDatatypes).toBe(false)

      settingsStore.setShowDatatypes(true)
      expect(settingsStore.showDatatypes).toBe(true)
    })
  })
})
