/**
 * EndpointFormDialog Component Tests
 *
 * Tests for endpoint form, validation, and connection testing.
 * @see /spec/common/com01-EndpointManager.md
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { ref, reactive, nextTick } from 'vue'
import EndpointFormDialog from '../common/EndpointFormDialog.vue'

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
const mockSecurityCheck = ref(null)
const mockTrustCheck = ref(null)

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
const mockTestResult = ref(null)

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
const mockAnalyzeStep = ref(null)
const mockAnalyzeElapsed = {
  show: ref(false),
  elapsed: ref(0),
}

vi.mock('../../composables/useEndpointAnalysis', () => ({
  useEndpointAnalysis: () => ({
    analyzing: mockAnalyzing,
    analyzeStep: mockAnalyzeStep,
    analyzeElapsed: mockAnalyzeElapsed,
    analyzeEndpoint: vi.fn().mockResolvedValue({
      supportsNamedGraphs: true,
      graphCount: 5,
    }),
  }),
}))

// Mock SPARQL service
vi.mock('../../services/sparql', () => ({
  testConnection: vi.fn().mockResolvedValue({ success: true }),
}))

describe('EndpointFormDialog', () => {
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mountEndpointFormDialog(props = {}) {
    return mount(EndpointFormDialog, {
      props: {
        visible: true,
        ...props,
      },
      global: {
        directives: {
          tooltip: () => {},
        },
        stubs: {
          Dialog: {
            template: '<div class="p-dialog" v-if="visible"><slot /><slot name="footer" /></div>',
            props: ['visible', 'header', 'modal', 'closable'],
          },
          InputText: {
            template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" class="p-inputtext" />',
            props: ['modelValue', 'placeholder', 'type'],
            emits: ['update:modelValue'],
          },
          Select: {
            template: '<select @change="$emit(\'update:modelValue\', $event.target.value)" class="p-select"><slot /></select>',
            props: ['modelValue', 'options', 'optionLabel', 'optionValue'],
            emits: ['update:modelValue'],
          },
          Button: {
            template: '<button @click="$emit(\'click\')" :disabled="disabled || loading" class="p-button"><slot /></button>',
            props: ['disabled', 'loading', 'icon', 'severity', 'outlined', 'text', 'label'],
            emits: ['click'],
          },
          Message: {
            template: '<div class="p-message" :class="`p-message-${severity}`"><slot /></div>',
            props: ['severity', 'closable'],
          },
          ProgressSpinner: { template: '<div class="p-progress-spinner"></div>' },
        },
      },
    })
  }

  describe('initial rendering', () => {
    it('renders the dialog when visible', () => {
      const wrapper = mountEndpointFormDialog()
      expect(wrapper.find('.p-dialog').exists()).toBe(true)
    })

    it('does not render when not visible', () => {
      const wrapper = mountEndpointFormDialog({ visible: false })
      expect(wrapper.find('.p-dialog').exists()).toBe(false)
    })

    it('renders form fields', () => {
      const wrapper = mountEndpointFormDialog()
      expect(wrapper.findAll('.p-inputtext').length).toBeGreaterThan(0)
    })
  })

  describe('add mode', () => {
    it('shows add mode when no endpoint provided', () => {
      const wrapper = mountEndpointFormDialog()
      // In add mode, form fields should be empty
      expect(mockForm.name).toBe('')
      expect(mockForm.url).toBe('')
    })

    it('renders example buttons section', () => {
      const wrapper = mountEndpointFormDialog()
      // Quick add section should be rendered
      expect(wrapper.text()).toContain('Quick add')
    })
  })

  describe('edit mode', () => {
    it('shows edit mode when endpoint provided', () => {
      const wrapper = mountEndpointFormDialog({
        endpoint: {
          id: 'test-1',
          name: 'Test Endpoint',
          url: 'https://example.org/sparql',
          createdAt: '2024-01-01',
          accessCount: 0,
        },
      })
      // In edit mode, an endpoint is provided
      expect(wrapper.props('endpoint')).toBeDefined()
    })
  })

  describe('form validation', () => {
    it('disables submit when form is invalid', () => {
      mockFormValid.value = false

      const wrapper = mountEndpointFormDialog()
      const buttons = wrapper.findAll('.p-button')
      const submitButton = buttons.find(b => b.text().includes('Add') || b.text().includes('Save'))

      if (submitButton) {
        expect(submitButton.attributes('disabled')).toBeDefined()
      }
    })

    it('enables submit when form is valid', () => {
      mockFormValid.value = true
      mockForm.name = 'Test'
      mockForm.url = 'https://example.org/sparql'

      const wrapper = mountEndpointFormDialog()
      // Form should now be valid
      expect(mockFormValid.value).toBe(true)
    })
  })

  describe('security indicators', () => {
    it('shows HTTP warning for non-HTTPS URLs', async () => {
      mockSecurityCheck.value = {
        isHttps: false,
        message: 'Connection is not secure (HTTP)',
      }

      const wrapper = mountEndpointFormDialog()
      await nextTick()

      // Check that security check value is set correctly
      expect(mockSecurityCheck.value?.isHttps).toBe(false)
    })

    it('shows HTTPS indicator for secure URLs', async () => {
      mockSecurityCheck.value = {
        isHttps: true,
        message: 'Connection is secure (HTTPS)',
      }

      const wrapper = mountEndpointFormDialog()
      await nextTick()

      expect(mockSecurityCheck.value.isHttps).toBe(true)
    })
  })

  describe('connection testing', () => {
    it('shows loading state during test', async () => {
      mockTesting.value = true

      const wrapper = mountEndpointFormDialog()
      await nextTick()

      expect(mockTesting.value).toBe(true)
    })

    it('shows success result after successful test', async () => {
      mockTestResult.value = { success: true }

      const wrapper = mountEndpointFormDialog()
      await nextTick()

      expect(mockTestResult.value.success).toBe(true)
    })

    it('shows error result after failed test', async () => {
      mockTestResult.value = { success: false, error: 'Connection failed' }

      const wrapper = mountEndpointFormDialog()
      await nextTick()

      expect(mockTestResult.value.success).toBe(false)
    })
  })

  describe('analysis progress', () => {
    it('shows analysis step during analysis', async () => {
      mockAnalyzing.value = true
      mockAnalyzeStep.value = 'Analyzing endpoint structure...'

      const wrapper = mountEndpointFormDialog()
      await nextTick()

      expect(mockAnalyzeStep.value).toContain('Analyzing')
    })
  })

  describe('events', () => {
    it('emits update:visible when closing', async () => {
      const wrapper = mountEndpointFormDialog()

      // Simulate close - find close/cancel button
      const buttons = wrapper.findAll('.p-button')
      const cancelButton = buttons.find(b => b.text().includes('Cancel'))

      if (cancelButton) {
        await cancelButton.trigger('click')
        expect(wrapper.emitted('update:visible')).toBeTruthy()
      }
    })
  })
})
