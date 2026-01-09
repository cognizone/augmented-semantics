/**
 * useWizardLifecycle - Wizard dialog lifecycle management
 *
 * Consolidates wizard dialog state management including:
 * - Active step tracking
 * - Edit mode detection
 * - Dialog open/close handling
 * - State reset on close
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'
import type { SPARQLEndpoint } from '../types'

export interface UseWizardLifecycleOptions {
  /** Reactive reference to dialog visibility */
  visible: Ref<boolean> | ComputedRef<boolean>
  /** Reactive reference to endpoint being edited */
  endpoint: Ref<SPARQLEndpoint | undefined> | ComputedRef<SPARQLEndpoint | undefined>
  /** Initial step to show (defaults to '1') */
  initialStep?: Ref<'1' | '2' | '3' | undefined> | ComputedRef<'1' | '2' | '3' | undefined>
  /** Callback to reset form state */
  onReset: () => void
  /** Callback when endpoint is loaded for editing */
  onLoad: (endpoint: SPARQLEndpoint) => void
}

export function useWizardLifecycle(options: UseWizardLifecycleOptions) {
  const { visible, endpoint, initialStep, onReset, onLoad } = options

  const activeStep = ref<'1' | '2' | '3'>('1')
  const tempEndpoint = ref<SPARQLEndpoint | null>(null)

  const isEditing = computed(() => !!endpoint.value)

  /**
   * Initialize wizard state when opening or endpoint changes
   */
  function initializeWizard(ep?: SPARQLEndpoint, step?: '1' | '2' | '3') {
    if (ep) {
      onLoad(ep)
      tempEndpoint.value = ep
    }
    if (step) {
      activeStep.value = step
    }
  }

  /**
   * Reset wizard to initial state
   */
  function resetWizard() {
    activeStep.value = '1'
    tempEndpoint.value = null
    onReset()
  }

  // Handle dialog open/close
  watch(visible, (isVisible) => {
    if (isVisible) {
      // Load endpoint data when opening
      if (endpoint.value) {
        initializeWizard(endpoint.value, initialStep?.value)
      } else if (initialStep?.value) {
        activeStep.value = initialStep.value
      }
    } else {
      // Clear state when dialog closes
      resetWizard()
    }
  })

  // Handle endpoint changes (edit mode)
  watch(endpoint, (ep) => {
    if (ep) {
      initializeWizard(ep)
    } else {
      tempEndpoint.value = null
      onReset()
    }
  }, { immediate: true })

  return {
    activeStep,
    tempEndpoint,
    isEditing,
    initializeWizard,
    resetWizard,
  }
}
