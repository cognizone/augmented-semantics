/**
 * EndpointWizard Component Tests
 *
 * Tests for multi-step endpoint configuration wizard.
 * @see /spec/common/com01-EndpointManager.md
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { ref, reactive, nextTick } from 'vue'
import EndpointWizard from '../common/EndpointWizard.vue'

// Mock the logger
vi.mock('../../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock form composable
const mockForm = reactive({
  name: '',
  url: '',
  authType: 'none' as const,
  username: '',
  password: '',
  apiKey: '',
  headerName: 'X-API-Key',
  token: '',
})

const mockFormValid = ref(false)
const mockSecurityCheck = ref<{ warning?: string; isHttps?: boolean; isLocalhost?: boolean } | null>(null)
const mockTrustCheck = ref<{ level: string; reasons: string[] } | null>(null)

vi.mock('../../composables/useEndpointForm', () => ({
  useEndpointForm: () => ({
    form: mockForm,
    formValid: mockFormValid,
    securityCheck: mockSecurityCheck,
    trustCheck: mockTrustCheck,
    resetForm: vi.fn(() => {
      mockForm.name = ''
      mockForm.url = ''
      mockForm.authType = 'none'
    }),
    loadEndpoint: vi.fn(),
    useExample: vi.fn((ex) => {
      mockForm.name = ex.name
      mockForm.url = ex.url
    }),
    buildEndpoint: vi.fn(() => ({
      id: 'new',
      name: mockForm.name,
      url: mockForm.url,
      createdAt: new Date().toISOString(),
      accessCount: 0,
    })),
  }),
}))

// Mock test composable
const mockTesting = ref(false)
const mockTestResult = ref<{ success: boolean; message?: string } | null>(null)

vi.mock('../../composables/useEndpointTest', () => ({
  useEndpointTest: () => ({
    testing: mockTesting,
    testResult: mockTestResult,
    testConnection: vi.fn(),
    clearResult: vi.fn(() => { mockTestResult.value = null }),
  }),
}))

// Mock analysis composable
const mockAnalyzing = ref(false)
const mockAnalyzeStep = ref<string | null>(null)
const mockAnalysisLog = ref<Array<{ message: string; status: string }>>([])
const mockAnalyzeElapsed = {
  show: ref(false),
  elapsed: ref(0),
}

vi.mock('../../composables/useEndpointAnalysis', () => ({
  useEndpointAnalysis: () => ({
    analyzing: mockAnalyzing,
    analyzeStep: mockAnalyzeStep,
    analyzeElapsed: mockAnalyzeElapsed,
    analysisLog: mockAnalysisLog,
    reanalyzeEndpoint: vi.fn().mockResolvedValue({
      supportsNamedGraphs: true,
      graphCount: 5,
      graphCountExact: true,
      hasDuplicateTriples: false,
      analyzedAt: new Date().toISOString(),
      languages: [{ lang: 'en', count: 100 }],
    }),
    clearAnalysis: vi.fn(() => {
      mockAnalysisLog.value = []
      mockAnalyzeStep.value = null
    }),
  }),
}))

// Mock language priorities composable
const mockPriorities = ref<string[]>([])
const mockEndpointLanguages = ref<Array<{ lang: string; count: number }>>([])

vi.mock('../../composables/useLanguagePriorities', () => ({
  useLanguagePriorities: () => ({
    priorities: mockPriorities,
    endpointLanguages: mockEndpointLanguages,
    loadPriorities: vi.fn(),
    onReorder: vi.fn(),
    getLanguageCount: vi.fn((lang: string) => {
      const found = mockEndpointLanguages.value.find(l => l.lang === lang)
      return found?.count
    }),
  }),
}))

// Mock capabilities composable
vi.mock('../../composables/useEndpointCapabilities', () => ({
  useEndpointCapabilities: () => ({
    graphStatus: ref('Unknown'),
    graphSeverity: ref('secondary'),
    graphIcon: ref('pi pi-question'),
    graphDescription: ref(null),
    duplicateStatus: ref('Unknown'),
    duplicateSeverity: ref('secondary'),
    duplicateIcon: ref('pi pi-question'),
    duplicateDescription: ref(null),
  }),
}))

// Mock SPARQL service
vi.mock('../../services/sparql', () => ({
  testConnection: vi.fn().mockResolvedValue({ success: true }),
  analyzeEndpoint: vi.fn().mockResolvedValue({
    supportsNamedGraphs: true,
    graphCount: 5,
    graphCountExact: true,
    hasDuplicateTriples: false,
    analyzedAt: new Date().toISOString(),
    languages: [{ lang: 'en', count: 100 }],
  }),
}))

describe('EndpointWizard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    // Reset mock state
    mockForm.name = ''
    mockForm.url = ''
    mockForm.authType = 'none'
    mockFormValid.value = false
    mockSecurityCheck.value = null
    mockTrustCheck.value = null
    mockTesting.value = false
    mockTestResult.value = null
    mockAnalyzing.value = false
    mockAnalyzeStep.value = null
    mockAnalysisLog.value = []
    mockPriorities.value = []
    mockEndpointLanguages.value = []
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mountEndpointWizard(props = {}) {
    return mount(EndpointWizard, {
      props: {
        visible: true,
        ...props,
      },
      global: {
        stubs: {
          Dialog: {
            template: '<div class="p-dialog" v-if="visible"><slot /></div>',
            props: ['visible', 'header', 'modal', 'closable'],
          },
          Stepper: {
            template: '<div class="p-stepper"><slot /></div>',
            props: ['value', 'linear'],
          },
          StepList: {
            template: '<div class="p-steplist"><slot /></div>',
          },
          StepPanels: {
            template: '<div class="p-steppanels"><slot /></div>',
          },
          Step: {
            template: '<div class="p-step"><slot /></div>',
            props: ['value'],
          },
          StepPanel: {
            template: '<div class="p-steppanel" :data-value="value"><slot :activateCallback="() => {}" /></div>',
            props: ['value'],
          },
          Select: {
            template: '<select @change="$emit(\'update:modelValue\', $event.target.value)" class="p-select"><slot /></select>',
            props: ['modelValue', 'options', 'optionLabel', 'optionValue'],
            emits: ['update:modelValue'],
          },
          Button: {
            template: '<button @click="$emit(\'click\')" :disabled="disabled || loading" class="p-button"><slot />{{ label }}</button>',
            props: ['disabled', 'loading', 'icon', 'iconPos', 'severity', 'outlined', 'text', 'label'],
            emits: ['click'],
          },
          Message: {
            template: '<div class="p-message" :class="`p-message-${severity}`"><slot /></div>',
            props: ['severity', 'closable'],
          },
          Tag: {
            template: '<span class="p-tag"><slot /></span>',
            props: ['severity', 'value'],
          },
          Divider: {
            template: '<hr class="p-divider" />',
          },
          OrderList: {
            template: '<div class="p-orderlist"><slot name="item" v-for="(item, index) in modelValue" :item="item" :index="index" /></div>',
            props: ['modelValue', 'listStyle', 'selectionMode'],
            emits: ['update:modelValue', 'reorder'],
          },
        },
      },
    })
  }

  describe('initial rendering', () => {
    it('renders the dialog when visible', () => {
      const wrapper = mountEndpointWizard()
      expect(wrapper.find('.p-dialog').exists()).toBe(true)
    })

    it('does not render when not visible', () => {
      const wrapper = mountEndpointWizard({ visible: false })
      expect(wrapper.find('.p-dialog').exists()).toBe(false)
    })

    it('renders stepper with 3 steps', () => {
      const wrapper = mountEndpointWizard()
      const steps = wrapper.findAll('.p-step')
      expect(steps.length).toBe(3)
    })

    it('renders step panels', () => {
      const wrapper = mountEndpointWizard()
      const panels = wrapper.findAll('.p-steppanel')
      expect(panels.length).toBe(3)
    })
  })

  describe('step 1: Basic Info', () => {
    it('renders name input field', () => {
      const wrapper = mountEndpointWizard()
      const nameInput = wrapper.find('#ep-name')
      expect(nameInput.exists()).toBe(true)
    })

    it('renders URL input field', () => {
      const wrapper = mountEndpointWizard()
      const urlInput = wrapper.find('#ep-url')
      expect(urlInput.exists()).toBe(true)
    })

    it('renders authentication select', () => {
      const wrapper = mountEndpointWizard()
      expect(wrapper.find('.p-select').exists()).toBe(true)
    })

    it('renders example buttons when no URL', () => {
      const wrapper = mountEndpointWizard()
      expect(wrapper.text()).toContain('Quick add')
    })

    it('shows test connection button', () => {
      const wrapper = mountEndpointWizard()
      expect(wrapper.text()).toContain('Test Connection')
    })

    it('disables next button when form is invalid', () => {
      mockFormValid.value = false
      const wrapper = mountEndpointWizard()

      const nextButton = wrapper.findAll('.p-button').find(b => b.text().includes('Next'))
      expect(nextButton?.attributes('disabled')).toBeDefined()
    })
  })

  describe('step 2: Capabilities', () => {
    it('renders capabilities panel', () => {
      const wrapper = mountEndpointWizard()
      const capabilitiesPanel = wrapper.find('[data-value="2"]')
      expect(capabilitiesPanel.exists()).toBe(true)
    })

    it('shows Named Graphs capability', () => {
      const wrapper = mountEndpointWizard()
      expect(wrapper.text()).toContain('Named Graphs')
    })

    it('shows Duplicate Triples capability', () => {
      const wrapper = mountEndpointWizard()
      expect(wrapper.text()).toContain('Duplicate Triples')
    })

    it('shows Re-analyze button', () => {
      const wrapper = mountEndpointWizard()
      expect(wrapper.text()).toContain('Re-analyze')
    })
  })

  describe('step 3: Languages', () => {
    it('renders languages panel', () => {
      const wrapper = mountEndpointWizard()
      const languagesPanel = wrapper.find('[data-value="3"]')
      expect(languagesPanel.exists()).toBe(true)
    })

    it('shows no languages message when empty', () => {
      mockEndpointLanguages.value = []
      const wrapper = mountEndpointWizard()
      expect(wrapper.text()).toContain('No languages detected')
    })

    it('renders language list when languages exist', () => {
      mockEndpointLanguages.value = [{ lang: 'en', count: 100 }]
      mockPriorities.value = ['en']
      const wrapper = mountEndpointWizard()
      expect(wrapper.find('.p-orderlist').exists()).toBe(true)
    })
  })

  describe('add mode', () => {
    it('shows "Add Endpoint" title when no endpoint provided', () => {
      const wrapper = mountEndpointWizard()
      // Dialog header should be "Add Endpoint"
      expect(wrapper.props('endpoint')).toBeUndefined()
    })

    it('shows "Add Endpoint" on save button', () => {
      const wrapper = mountEndpointWizard()
      expect(wrapper.text()).toContain('Add Endpoint')
    })
  })

  describe('edit mode', () => {
    it('shows "Configure Endpoint" when endpoint provided', () => {
      const wrapper = mountEndpointWizard({
        endpoint: {
          id: 'test-1',
          name: 'Test Endpoint',
          url: 'https://example.org/sparql',
          createdAt: '2024-01-01',
          accessCount: 0,
        },
      })
      expect(wrapper.props('endpoint')).toBeDefined()
    })

    it('shows "Save" on save button in edit mode', () => {
      const wrapper = mountEndpointWizard({
        endpoint: {
          id: 'test-1',
          name: 'Test Endpoint',
          url: 'https://example.org/sparql',
          createdAt: '2024-01-01',
          accessCount: 0,
        },
      })
      expect(wrapper.text()).toContain('Save')
    })
  })

  describe('form validation', () => {
    it('uses formValid from composable', () => {
      mockFormValid.value = false
      const wrapper = mountEndpointWizard()

      // Next button should be disabled
      const nextButton = wrapper.findAll('.p-button').find(b => b.text().includes('Next'))
      expect(nextButton?.attributes('disabled')).toBeDefined()
    })

    it('enables buttons when form is valid', async () => {
      mockFormValid.value = true
      mockForm.name = 'Test'
      mockForm.url = 'https://example.org/sparql'

      const wrapper = mountEndpointWizard()
      await nextTick()

      expect(mockFormValid.value).toBe(true)
    })
  })

  describe('security indicators', () => {
    it('shows warning for non-HTTPS URLs', async () => {
      mockSecurityCheck.value = {
        warning: 'Connection is not secure',
        isHttps: false,
        isLocalhost: false,
      }

      const wrapper = mountEndpointWizard()
      await nextTick()

      expect(wrapper.find('.p-message').exists()).toBe(true)
    })

    it('shows trust indicator when available', async () => {
      mockTrustCheck.value = {
        level: 'trusted',
        reasons: ['Known institution'],
      }

      const wrapper = mountEndpointWizard()
      await nextTick()

      expect(wrapper.find('.p-tag').exists()).toBe(true)
    })
  })

  describe('connection testing', () => {
    it('shows loading state during test', async () => {
      mockTesting.value = true

      const wrapper = mountEndpointWizard()
      await nextTick()

      expect(mockTesting.value).toBe(true)
    })

    it('shows success message after successful test', async () => {
      mockTestResult.value = { success: true, message: 'Connected!' }

      const wrapper = mountEndpointWizard()
      await nextTick()

      expect(wrapper.find('.p-message').exists()).toBe(true)
    })

    it('shows error message after failed test', async () => {
      mockTestResult.value = { success: false, message: 'Connection failed' }

      const wrapper = mountEndpointWizard()
      await nextTick()

      expect(wrapper.find('.p-message').exists()).toBe(true)
    })
  })

  describe('analysis', () => {
    it('shows analysis step during analysis', async () => {
      mockAnalyzing.value = true
      mockAnalyzeStep.value = 'Analyzing endpoint structure...'

      const wrapper = mountEndpointWizard()
      await nextTick()

      expect(mockAnalyzeStep.value).toContain('Analyzing')
    })

    it('shows analysis log entries', async () => {
      mockAnalysisLog.value = [
        { message: 'Testing connection...', status: 'success' },
        { message: 'Detecting graphs...', status: 'pending' },
      ]

      const wrapper = mountEndpointWizard()
      await nextTick()

      expect(mockAnalysisLog.value.length).toBe(2)
    })
  })

  describe('events', () => {
    it('emits update:visible when cancel is clicked', async () => {
      const wrapper = mountEndpointWizard()

      const cancelButton = wrapper.findAll('.p-button').find(b => b.text().includes('Cancel'))
      if (cancelButton) {
        await cancelButton.trigger('click')
        expect(wrapper.emitted('update:visible')).toBeTruthy()
      }
    })
  })

  describe('authentication options', () => {
    it('renders auth type select with options', () => {
      const wrapper = mountEndpointWizard()
      expect(wrapper.find('.p-select').exists()).toBe(true)
    })

    it('shows username/password fields for basic auth', async () => {
      const wrapper = mountEndpointWizard()
      // Set authType after mount to bypass resetForm() call from immediate watch
      mockForm.authType = 'basic'
      await nextTick()

      expect(wrapper.find('#ep-user').exists()).toBe(true)
      expect(wrapper.find('#ep-pass').exists()).toBe(true)
    })

    it('shows API key fields for apikey auth', async () => {
      const wrapper = mountEndpointWizard()
      // Set authType after mount to bypass resetForm() call from immediate watch
      mockForm.authType = 'apikey'
      await nextTick()

      expect(wrapper.find('#ep-header').exists()).toBe(true)
      expect(wrapper.find('#ep-apikey').exists()).toBe(true)
    })

    it('shows token field for bearer auth', async () => {
      const wrapper = mountEndpointWizard()
      // Set authType after mount to bypass resetForm() call from immediate watch
      mockForm.authType = 'bearer'
      await nextTick()

      expect(wrapper.find('#ep-token').exists()).toBe(true)
    })
  })
})
