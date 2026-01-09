/**
 * UI Store - Application UI state
 *
 * Manages:
 * - Loading states
 * - Dialog visibility
 * - Layout (sidebar, view mode, mobile tabs)
 * - Responsive breakpoints
 *
 * @see /spec/common/com03-ErrorHandling.md
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type ViewMode = 'tree' | 'flat'
export type MobileTab = 'tree' | 'details' | 'search'
export type SidebarTab = 'browse' | 'search' | 'recent'

export const useUIStore = defineStore('ui', () => {
  // State - Loading
  const loading = ref<Record<string, boolean>>({})

  // State - Dialogs
  const openDialogs = ref<string[]>([])

  // State - Layout
  const sidebarOpen = ref(true)
  const viewMode = ref<ViewMode>('tree')
  const mobileTab = ref<MobileTab>('tree')
  const sidebarTab = ref<SidebarTab>('browse')

  // State - Responsive
  const isMobile = ref(false)
  const isTablet = ref(false)

  // State - Keyboard shortcuts
  const searchFocusTrigger = ref(0)

  // State - ARIA announcements (for screen readers)
  const loadingAnnouncement = ref('')
  const errorAnnouncement = ref('')

  // Getters
  const isLoading = computed(() => (key: string) => loading.value[key] ?? false)

  const isDesktop = computed(() => !isMobile.value && !isTablet.value)

  // Actions - Loading
  function setLoading(key: string, isLoading: boolean) {
    loading.value[key] = isLoading
  }

  // Actions - Dialogs
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

  function setSidebarTab(tab: SidebarTab) {
    sidebarTab.value = tab
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

  // Actions - Keyboard shortcuts
  function triggerSearchFocus() {
    searchFocusTrigger.value++
  }

  // Actions - ARIA announcements
  function announceLoading(message: string) {
    loadingAnnouncement.value = message
    // Clear after a delay to allow repeat announcements
    setTimeout(() => {
      if (loadingAnnouncement.value === message) {
        loadingAnnouncement.value = ''
      }
    }, 1000)
  }

  function announceError(message: string) {
    errorAnnouncement.value = message
    // Clear after a delay to allow repeat announcements
    setTimeout(() => {
      if (errorAnnouncement.value === message) {
        errorAnnouncement.value = ''
      }
    }, 5000)
  }

  function announceSuccess(message: string) {
    // Use loading region for success (polite)
    loadingAnnouncement.value = message
    setTimeout(() => {
      if (loadingAnnouncement.value === message) {
        loadingAnnouncement.value = ''
      }
    }, 3000)
  }

  return {
    // State
    loading,
    openDialogs,
    sidebarOpen,
    viewMode,
    mobileTab,
    sidebarTab,
    isMobile,
    isTablet,
    // Getters
    isLoading,
    isDesktop,
    // Actions
    setLoading,
    closeAllDialogs,
    toggleSidebar,
    setSidebarOpen,
    setViewMode,
    setMobileTab,
    setSidebarTab,
    updateBreakpoints,
    initResponsive,
    destroyResponsive,
    // Keyboard shortcuts
    searchFocusTrigger,
    triggerSearchFocus,
    // ARIA announcements
    loadingAnnouncement,
    errorAnnouncement,
    announceLoading,
    announceError,
    announceSuccess,
  }
})
