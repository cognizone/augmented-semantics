import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ConceptScheme } from '../types'

const STORAGE_KEY = 'ae-skos-scheme'

export const useSchemeStore = defineStore('scheme', () => {
  // State
  const schemes = ref<ConceptScheme[]>([])
  const selectedUri = ref<string | null>(null)
  const loading = ref(false)

  // Getters
  const selected = computed(() =>
    schemes.value.find(s => s.uri === selectedUri.value) ?? null
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
      console.error('Failed to load scheme from storage:', e)
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedUri.value))
    } catch (e) {
      console.error('Failed to save scheme to storage:', e)
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
  }

  // Initialize
  loadFromStorage()

  return {
    // State
    schemes,
    selectedUri,
    loading,
    // Getters
    selected,
    sortedSchemes,
    // Actions
    loadFromStorage,
    setSchemes,
    selectScheme,
    setLoading,
    reset,
  }
})
