/**
 * UI Store - Application UI state
 *
 * Manages:
 * - Loading states
 * - Error display
 * - Dialog visibility
 * - Layout (sidebar, view mode, mobile tabs)
 * - Responsive breakpoints
 *
 * @see /spec/common/com03-ErrorHandling.md
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AppError } from '../types'

export type ViewMode = 'tree' | 'flat'
export type MobileTab = 'tree' | 'details' | 'search'

export const useUIStore = defineStore('ui', () => {
  // State - Loading
  const loading = ref<Record<string, boolean>>({})

  // State - Errors
  const errors = ref<AppError[]>([])

  // State - Dialogs
  const openDialogs = ref<string[]>([])

  // State - Layout
  const sidebarOpen = ref(true)
  const viewMode = ref<ViewMode>('tree')
  const mobileTab = ref<MobileTab>('tree')

  // State - Responsive
  const isMobile = ref(false)
  const isTablet = ref(false)

  // Getters
  const isLoading = computed(() => (key: string) => loading.value[key] ?? false)

  const hasErrors = computed(() => errors.value.length > 0)

  const latestError = computed(() => errors.value[0] ?? null)

  const isDialogOpen = computed(() => (id: string) => openDialogs.value.includes(id))

  const isDesktop = computed(() => !isMobile.value && !isTablet.value)

  // Actions - Loading
  function setLoading(key: string, isLoading: boolean) {
    loading.value[key] = isLoading
  }

  function clearLoading() {
    loading.value = {}
  }

  // Actions - Errors
  function addError(error: AppError) {
    errors.value.unshift(error)
  }

  function removeError(timestamp: string) {
    errors.value = errors.value.filter(e => e.timestamp !== timestamp)
  }

  function clearErrors() {
    errors.value = []
  }

  // Actions - Dialogs
  function openDialog(id: string) {
    if (!openDialogs.value.includes(id)) {
      openDialogs.value.push(id)
    }
  }

  function closeDialog(id: string) {
    openDialogs.value = openDialogs.value.filter(d => d !== id)
  }

  function closeAllDialogs() {
    openDialogs.value = []
  }

  // Actions - Layout
  function toggleSidebar() {
    sidebarOpen.value = !sidebarOpen.value
  }

  function setSidebarOpen(open: boolean) {
    sidebarOpen.value = open
  }

  function setViewMode(mode: ViewMode) {
    viewMode.value = mode
  }

  function setMobileTab(tab: MobileTab) {
    mobileTab.value = tab
  }

  // Actions - Responsive
  function updateBreakpoints() {
    const width = window.innerWidth
    isMobile.value = width < 768
    isTablet.value = width >= 768 && width < 1024
  }

  // Initialize responsive listener
  function initResponsive() {
    updateBreakpoints()
    window.addEventListener('resize', updateBreakpoints)
  }

  function destroyResponsive() {
    window.removeEventListener('resize', updateBreakpoints)
  }

  return {
    // State
    loading,
    errors,
    openDialogs,
    sidebarOpen,
    viewMode,
    mobileTab,
    isMobile,
    isTablet,
    // Getters
    isLoading,
    hasErrors,
    latestError,
    isDialogOpen,
    isDesktop,
    // Actions
    setLoading,
    clearLoading,
    addError,
    removeError,
    clearErrors,
    openDialog,
    closeDialog,
    closeAllDialogs,
    toggleSidebar,
    setSidebarOpen,
    setViewMode,
    setMobileTab,
    updateBreakpoints,
    initResponsive,
    destroyResponsive,
  }
})
