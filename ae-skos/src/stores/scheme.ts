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

/** Special URI for orphan concepts (not linked to any scheme) */
export const ORPHAN_SCHEME_URI = '~orphans~'

/** Pseudo-scheme for orphan concepts */
export const ORPHAN_SCHEME: ConceptScheme = {
  uri: ORPHAN_SCHEME_URI,
  label: 'Orphan Concepts',
}

export const useSchemeStore = defineStore('scheme', () => {
  // State
  const schemes = ref<ConceptScheme[]>([])
  const selectedUri = ref<string | null>(null)
  const loading = ref(false)

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
    } catch (e) {
      logger.error('SchemeStore', 'Failed to load scheme from storage', { error: e })
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedUri.value))
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

  function setLoading(isLoading: boolean) {
    loading.value = isLoading
  }

  function reset() {
    schemes.value = []
    selectedUri.value = null
    viewingSchemeUri.value = null
    schemeDetails.value = null
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
    setLoading,
    reset,
    viewScheme,
    setSchemeDetails,
    setLoadingDetails,
  }
})
