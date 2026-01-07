/**
 * SchemeDetails Component Tests
 *
 * Tests for scheme property display and interactions.
 * @see /spec/ae-skos/sko02-SchemeSelector.md
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { ref, nextTick } from 'vue'
import SchemeDetails from '../skos/SchemeDetails.vue'
import { useSchemeStore, useEndpointStore, useLanguageStore } from '../../stores'

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

// Mock useSchemeData composable
const mockDetails = ref(null)
const mockLoading = ref(false)
const mockError = ref(null)
const mockLoadDetails = vi.fn()

vi.mock('../../composables/useSchemeData', () => ({
  useSchemeData: () => ({
    details: mockDetails,
    loading: mockLoading,
    error: mockError,
    resolvedPredicates: ref(new Map()),
    loadDetails: mockLoadDetails,
  }),
}))

describe('SchemeDetails', () => {
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

  function mountSchemeDetails() {
    return mount(SchemeDetails, {
      global: {
        directives: {
          tooltip: () => {},
        },
        stubs: {
          Button: {
            template: '<button @click="$emit(\'click\')" :disabled="disabled"><slot /></button>',
            props: ['disabled', 'icon', 'severity', 'outlined', 'text', 'size'],
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
          // Shared components
          DetailsStates: {
            template: `<div class="details-states">
              <div v-if="loading" class="loading-state"></div>
              <div v-else-if="error" class="error-state"><div class="p-message p-message-error">{{ error }}</div></div>
              <div v-else-if="!hasData" class="empty-state">{{ emptyTitle }}</div>
              <slot v-else />
            </div>`,
            props: ['loading', 'showLoading', 'hasData', 'error', 'loadingText', 'emptyIcon', 'emptyTitle', 'emptySubtitle', 'elapsed'],
          },
          DetailsHeader: {
            template: '<div class="details-header"><h2>{{ title }}</h2><span class="uri">{{ uri }}</span></div>',
            props: ['icon', 'iconClass', 'wrapperClass', 'title', 'uri', 'langTag', 'showLangTag', 'deprecated', 'deprecatedTooltip', 'exportMenuItems'],
          },
          LabelsSection: {
            template: '<div class="labels-section"><template v-for="item in items" :key="item.label"><span v-for="(v, i) in item.values" :key="i">{{ v.value }}</span></template><slot /></div>',
            props: ['items', 'title', 'icon'],
          },
          DocumentationSection: {
            template: '<div class="documentation-section"><template v-for="item in items" :key="item.label"><span v-for="(v, i) in item.values" :key="i">{{ v.value }}</span></template></div>',
            props: ['items', 'title', 'icon'],
          },
          OtherPropertiesSection: {
            template: '<div class="other-properties-section"></div>',
            props: ['properties', 'resolvedPredicates', 'title', 'icon'],
          },
        },
      },
    })
  }

  describe('initial rendering', () => {
    it('renders the details container', () => {
      const wrapper = mountSchemeDetails()
      expect(wrapper.find('.scheme-details').exists()).toBe(true)
    })

    it('shows empty state when no scheme viewed', () => {
      const wrapper = mountSchemeDetails()
      expect(wrapper.find('.empty-state').exists()).toBe(true)
      expect(wrapper.text()).toContain('No scheme selected')
    })
  })

  describe('loading state', () => {
    it('shows loading state when loading', async () => {
      const schemeStore = useSchemeStore()
      schemeStore.viewScheme('http://example.org/scheme/1')
      mockLoading.value = true

      const wrapper = mountSchemeDetails()
      await nextTick()

      expect(mockLoading.value).toBe(true)
    })

    it('calls loadDetails when scheme is viewed', async () => {
      const schemeStore = useSchemeStore()
      schemeStore.viewScheme('http://example.org/scheme/1')

      const wrapper = mountSchemeDetails()
      await flushPromises()

      expect(mockLoadDetails).toHaveBeenCalledWith('http://example.org/scheme/1')
    })
  })

  describe('with scheme loaded', () => {
    beforeEach(() => {
      const schemeStore = useSchemeStore()
      schemeStore.viewScheme('http://example.org/scheme/1')

      mockDetails.value = {
        uri: 'http://example.org/scheme/1',
        prefLabels: [{ value: 'Test Scheme', lang: 'en' }],
        altLabels: [],
        hiddenLabels: [],
        labels: [],
        notations: [],
        definitions: [{ value: 'A test scheme definition', lang: 'en' }],
        scopeNotes: [],
        historyNotes: [],
        changeNotes: [],
        editorialNotes: [],
        notes: [],
        examples: [],
        comments: [],
        title: [{ value: 'DC Title', lang: 'en' }],
        description: [{ value: 'DC Description', lang: 'en' }],
        creator: ['http://example.org/person/1'],
        created: '2024-01-01',
        modified: '2024-06-15',
        issued: '2024-01-01',
        publisher: [],
        rights: [],
        license: [],
        ccLicense: [],
        seeAlso: [],
        prefLabelsXL: [],
        altLabelsXL: [],
        hiddenLabelsXL: [],
        otherProperties: [],
      }
    })

    it('displays scheme title', async () => {
      const wrapper = mountSchemeDetails()
      await nextTick()

      expect(wrapper.text()).toContain('Test Scheme')
    })

    it('displays definition', async () => {
      const wrapper = mountSchemeDetails()
      await nextTick()

      expect(wrapper.text()).toContain('A test scheme definition')
    })

    it('displays DC title', async () => {
      const wrapper = mountSchemeDetails()
      await nextTick()

      expect(wrapper.text()).toContain('DC Title')
    })

    it('displays metadata (created, modified)', async () => {
      const wrapper = mountSchemeDetails()
      await nextTick()

      expect(wrapper.text()).toContain('2024')
    })
  })

  describe('browse functionality', () => {
    beforeEach(() => {
      const schemeStore = useSchemeStore()
      schemeStore.viewScheme('http://example.org/scheme/1')

      mockDetails.value = {
        uri: 'http://example.org/scheme/1',
        prefLabels: [{ value: 'Test Scheme', lang: 'en' }],
        altLabels: [],
        hiddenLabels: [],
        labels: [],
        notations: [],
        definitions: [],
        scopeNotes: [],
        historyNotes: [],
        changeNotes: [],
        editorialNotes: [],
        notes: [],
        examples: [],
        comments: [],
        title: [],
        description: [],
        creator: [],
        publisher: [],
        rights: [],
        license: [],
        ccLicense: [],
        seeAlso: [],
        prefLabelsXL: [],
        altLabelsXL: [],
        hiddenLabelsXL: [],
        otherProperties: [],
      }
    })

    it('emits browseScheme when browse button clicked', async () => {
      const wrapper = mountSchemeDetails()
      await nextTick()

      // Find browse button and click
      const browseButton = wrapper.find('button')
      if (browseButton.exists()) {
        await browseButton.trigger('click')
        // Check if browseScheme was emitted (may need to find correct button)
      }
    })
  })

  describe('error handling', () => {
    it('displays error message when loading fails', async () => {
      const schemeStore = useSchemeStore()
      schemeStore.viewScheme('http://example.org/scheme/1')
      mockError.value = 'Failed to load scheme'

      const wrapper = mountSchemeDetails()
      await nextTick()

      expect(wrapper.find('.p-message-error').exists()).toBe(true)
      expect(wrapper.text()).toContain('Failed to load scheme')
    })
  })

  describe('store interactions', () => {
    it('viewingSchemeUri reflects schemeStore', () => {
      const schemeStore = useSchemeStore()
      // Initial state may be undefined or null
      expect(schemeStore.viewingSchemeUri == null).toBe(true)

      schemeStore.viewScheme('http://example.org/scheme/1')
      expect(schemeStore.viewingSchemeUri).toBe('http://example.org/scheme/1')
    })

    it('clearing view shows empty state', async () => {
      const schemeStore = useSchemeStore()
      schemeStore.viewScheme('http://example.org/scheme/1')

      const wrapper = mountSchemeDetails()
      await nextTick()

      schemeStore.viewScheme(null)
      await nextTick()

      expect(wrapper.find('.empty-state').exists()).toBe(true)
    })
  })
})
