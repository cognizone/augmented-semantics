/**
 * Scheme Store - Concept scheme state management
 *
 * Manages available concept schemes and current selection.
 * Persisted to localStorage under key 'ae-skos-scheme'.
 *
 * @see /spec/ae-skos/sko02-SchemeSelector.md
 * @see /spec/common/com02-StateManagement.md
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ConceptScheme, SchemeDetails } from '../types'
import { logger } from '../services'

const STORAGE_KEY = 'ae-skos-scheme'
const ROOT_MODE_STORAGE_KEY = 'ae-skos-root-mode'
export type RootMode = 'scheme' | 'collection'

/** Special URI for orphan concepts and collections (not linked to any scheme) */
export const ORPHAN_SCHEME_URI = '~orphans~'

/** Pseudo-scheme for orphan concepts and collections */
export const ORPHAN_SCHEME: ConceptScheme = {
  uri: ORPHAN_SCHEME_URI,
  label: 'Orphan Concepts & Collections',
}

export const useSchemeStore = defineStore('scheme', () => {
  // State
  const schemes = ref<ConceptScheme[]>([])
  const selectedUri = ref<string | null>(null)
  const loading = ref(false)
  const rootMode = ref<RootMode>('scheme')

  // Scheme details viewing state (separate from selection for filtering)
  const viewingSchemeUri = ref<string | null>(null)
  const schemeDetails = ref<SchemeDetails | null>(null)
  const loadingDetails = ref(false)

  // Getters
  const selected = computed(() => {
    if (selectedUri.value === ORPHAN_SCHEME_URI) return ORPHAN_SCHEME
    return schemes.value.find(s => s.uri === selectedUri.value) ?? null
  })

  const isOrphanSchemeSelected = computed(() =>
    selectedUri.value === ORPHAN_SCHEME_URI
  )

  const sortedSchemes = computed(() =>
    [...schemes.value].sort((a, b) => {
      const labelA = a.label ?? a.uri
      const labelB = b.label ?? b.uri
      return labelA.localeCompare(labelB)
    })
  )

  // Actions
  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        selectedUri.value = JSON.parse(stored)
      }
      const storedRootMode = localStorage.getItem(ROOT_MODE_STORAGE_KEY)
      if (storedRootMode === 'collection' || storedRootMode === 'scheme') {
        rootMode.value = storedRootMode
      }
    } catch (e) {
      logger.error('SchemeStore', 'Failed to load scheme from storage', { error: e })
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedUri.value))
      localStorage.setItem(ROOT_MODE_STORAGE_KEY, rootMode.value)
    } catch (e) {
      logger.error('SchemeStore', 'Failed to save scheme to storage', { error: e })
    }
  }

  function setSchemes(newSchemes: ConceptScheme[]) {
    schemes.value = newSchemes
  }

  function selectScheme(uri: string | null) {
    selectedUri.value = uri
    saveToStorage()
  }

  function setRootMode(mode: RootMode) {
    rootMode.value = mode
    saveToStorage()
  }

  function setLoading(isLoading: boolean) {
    loading.value = isLoading
  }

  function reset(options?: { preserveSelection?: boolean }) {
    schemes.value = []
    viewingSchemeUri.value = null
    schemeDetails.value = null
    if (!options?.preserveSelection) {
      selectedUri.value = null
    }
  }

  // Scheme details viewing actions
  function viewScheme(uri: string | null) {
    viewingSchemeUri.value = uri
    if (!uri) {
      schemeDetails.value = null
    }
  }

  function setSchemeDetails(details: SchemeDetails | null) {
    schemeDetails.value = details
  }

  function setLoadingDetails(isLoading: boolean) {
    loadingDetails.value = isLoading
  }

  // Initialize
  loadFromStorage()

  return {
    // State
    schemes,
    selectedUri,
    loading,
    rootMode,
    viewingSchemeUri,
    schemeDetails,
    loadingDetails,
    // Getters
    selected,
    isOrphanSchemeSelected,
    sortedSchemes,
    // Actions
    loadFromStorage,
    setSchemes,
    selectScheme,
    setRootMode,
    setLoading,
    reset,
    viewScheme,
    setSchemeDetails,
    setLoadingDetails,
  }
})
