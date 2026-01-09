/**
 * useWizardLifecycle Composable Tests
 *
 * Tests for wizard dialog lifecycle management.
 * @see /spec/common/com01-EndpointManager.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { useWizardLifecycle } from '../useWizardLifecycle'
import type { SPARQLEndpoint } from '../../types'

describe('useWizardLifecycle', () => {
  const mockOnReset = vi.fn()
  const mockOnLoad = vi.fn()

  function createEndpoint(overrides: Partial<SPARQLEndpoint> = {}): SPARQLEndpoint {
    return {
      id: 'test-id',
      name: 'Test Endpoint',
      url: 'https://example.org/sparql',
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('starts at step 1', () => {
      const visible = ref(false)
      const endpoint = ref<SPARQLEndpoint | undefined>(undefined)

      const { activeStep } = useWizardLifecycle({
        visible,
        endpoint,
        onReset: mockOnReset,
        onLoad: mockOnLoad,
      })

      expect(activeStep.value).toBe('1')
    })

    it('starts with no temp endpoint', () => {
      const visible = ref(false)
      const endpoint = ref<SPARQLEndpoint | undefined>(undefined)

      const { tempEndpoint } = useWizardLifecycle({
        visible,
        endpoint,
        onReset: mockOnReset,
        onLoad: mockOnLoad,
      })

      expect(tempEndpoint.value).toBeNull()
    })

    it('isEditing is false when no endpoint', () => {
      const visible = ref(false)
      const endpoint = ref<SPARQLEndpoint | undefined>(undefined)

      const { isEditing } = useWizardLifecycle({
        visible,
        endpoint,
        onReset: mockOnReset,
        onLoad: mockOnLoad,
      })

      expect(isEditing.value).toBe(false)
    })
  })

  describe('isEditing', () => {
    it('is true when endpoint is provided', async () => {
      const visible = ref(false)
      const endpoint = ref<SPARQLEndpoint | undefined>(createEndpoint())

      const { isEditing } = useWizardLifecycle({
        visible,
        endpoint,
        onReset: mockOnReset,
        onLoad: mockOnLoad,
      })

      await nextTick()
      expect(isEditing.value).toBe(true)
    })

    it('becomes false when endpoint is cleared', async () => {
      const visible = ref(false)
      const endpoint = ref<SPARQLEndpoint | undefined>(createEndpoint())

      const { isEditing } = useWizardLifecycle({
        visible,
        endpoint,
        onReset: mockOnReset,
        onLoad: mockOnLoad,
      })

      await nextTick()
      expect(isEditing.value).toBe(true)

      endpoint.value = undefined
      await nextTick()
      expect(isEditing.value).toBe(false)
    })
  })

  describe('dialog open', () => {
    it('calls onLoad when opening with endpoint', async () => {
      const visible = ref(false)
      const ep = createEndpoint()
      const endpoint = ref<SPARQLEndpoint | undefined>(ep)

      useWizardLifecycle({
        visible,
        endpoint,
        onReset: mockOnReset,
        onLoad: mockOnLoad,
      })

      // Clear initial call from immediate watcher
      mockOnLoad.mockClear()

      visible.value = true
      await nextTick()

      expect(mockOnLoad).toHaveBeenCalledWith(ep)
    })

    it('sets initialStep when provided', async () => {
      const visible = ref(false)
      const endpoint = ref<SPARQLEndpoint | undefined>(createEndpoint())
      const initialStep = ref<'1' | '2' | '3' | undefined>('2')

      const { activeStep } = useWizardLifecycle({
        visible,
        endpoint,
        initialStep,
        onReset: mockOnReset,
        onLoad: mockOnLoad,
      })

      visible.value = true
      await nextTick()

      expect(activeStep.value).toBe('2')
    })
  })

  describe('dialog close', () => {
    it('resets to step 1 when closing', async () => {
      const visible = ref(true)
      const endpoint = ref<SPARQLEndpoint | undefined>(undefined)

      const { activeStep } = useWizardLifecycle({
        visible,
        endpoint,
        onReset: mockOnReset,
        onLoad: mockOnLoad,
      })

      activeStep.value = '3'
      visible.value = false
      await nextTick()

      expect(activeStep.value).toBe('1')
    })

    it('calls onReset when closing', async () => {
      const visible = ref(true)
      const endpoint = ref<SPARQLEndpoint | undefined>(undefined)

      useWizardLifecycle({
        visible,
        endpoint,
        onReset: mockOnReset,
        onLoad: mockOnLoad,
      })

      mockOnReset.mockClear()
      visible.value = false
      await nextTick()

      expect(mockOnReset).toHaveBeenCalled()
    })

    it('clears tempEndpoint when closing', async () => {
      const visible = ref(true)
      const endpoint = ref<SPARQLEndpoint | undefined>(createEndpoint())

      const { tempEndpoint } = useWizardLifecycle({
        visible,
        endpoint,
        onReset: mockOnReset,
        onLoad: mockOnLoad,
      })

      visible.value = false
      await nextTick()

      expect(tempEndpoint.value).toBeNull()
    })
  })

  describe('endpoint changes', () => {
    it('calls onLoad when endpoint is set', async () => {
      const visible = ref(false)
      const endpoint = ref<SPARQLEndpoint | undefined>(undefined)

      useWizardLifecycle({
        visible,
        endpoint,
        onReset: mockOnReset,
        onLoad: mockOnLoad,
      })

      const ep = createEndpoint()
      endpoint.value = ep
      await nextTick()

      expect(mockOnLoad).toHaveBeenCalledWith(ep)
    })

    it('calls onReset when endpoint is cleared', async () => {
      const visible = ref(false)
      const endpoint = ref<SPARQLEndpoint | undefined>(createEndpoint())

      useWizardLifecycle({
        visible,
        endpoint,
        onReset: mockOnReset,
        onLoad: mockOnLoad,
      })

      mockOnReset.mockClear()
      endpoint.value = undefined
      await nextTick()

      expect(mockOnReset).toHaveBeenCalled()
    })
  })

  describe('initializeWizard', () => {
    it('sets tempEndpoint and calls onLoad', () => {
      const visible = ref(false)
      const endpoint = ref<SPARQLEndpoint | undefined>(undefined)

      const { initializeWizard, tempEndpoint } = useWizardLifecycle({
        visible,
        endpoint,
        onReset: mockOnReset,
        onLoad: mockOnLoad,
      })

      const ep = createEndpoint()
      initializeWizard(ep)

      expect(tempEndpoint.value).toEqual(ep)
      expect(mockOnLoad).toHaveBeenCalledWith(ep)
    })

    it('sets step when provided', () => {
      const visible = ref(false)
      const endpoint = ref<SPARQLEndpoint | undefined>(undefined)

      const { initializeWizard, activeStep } = useWizardLifecycle({
        visible,
        endpoint,
        onReset: mockOnReset,
        onLoad: mockOnLoad,
      })

      initializeWizard(undefined, '3')

      expect(activeStep.value).toBe('3')
    })
  })

  describe('resetWizard', () => {
    it('resets step to 1', () => {
      const visible = ref(false)
      const endpoint = ref<SPARQLEndpoint | undefined>(undefined)

      const { resetWizard, activeStep } = useWizardLifecycle({
        visible,
        endpoint,
        onReset: mockOnReset,
        onLoad: mockOnLoad,
      })

      activeStep.value = '3'
      resetWizard()

      expect(activeStep.value).toBe('1')
    })

    it('clears tempEndpoint', () => {
      const visible = ref(false)
      const endpoint = ref<SPARQLEndpoint | undefined>(undefined)

      const { resetWizard, tempEndpoint, initializeWizard } = useWizardLifecycle({
        visible,
        endpoint,
        onReset: mockOnReset,
        onLoad: mockOnLoad,
      })

      initializeWizard(createEndpoint())
      resetWizard()

      expect(tempEndpoint.value).toBeNull()
    })

    it('calls onReset callback', () => {
      const visible = ref(false)
      const endpoint = ref<SPARQLEndpoint | undefined>(undefined)

      const { resetWizard } = useWizardLifecycle({
        visible,
        endpoint,
        onReset: mockOnReset,
        onLoad: mockOnLoad,
      })

      mockOnReset.mockClear()
      resetWizard()

      expect(mockOnReset).toHaveBeenCalled()
    })
  })
})
