import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const STORAGE_KEY = 'ae-language'

export const useLanguageStore = defineStore('language', () => {
  // State
  const preferred = ref('en')
  const fallback = ref('en')
  const detected = ref<string[]>([])
  const detectedAt = ref<string | null>(null)

  // Getters
  const hasDetected = computed(() => detected.value.length > 0)

  const browserLanguage = computed(() => {
    const lang = navigator.language || 'en'
    return lang.split('-')[0] // Get primary language tag
  })

  // Actions
  function getBrowserLanguage(): string {
    const lang = navigator.language || 'en'
    const primary = lang.split('-')[0]
    return primary || 'en'
  }

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const data = JSON.parse(stored)
        preferred.value = data.preferred ?? getBrowserLanguage()
        fallback.value = data.fallback ?? 'en'
      } else {
        // Initialize from browser
        preferred.value = getBrowserLanguage()
      }
    } catch (e) {
      console.error('Failed to load language from storage:', e)
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        preferred: preferred.value,
        fallback: fallback.value,
      }))
    } catch (e) {
      console.error('Failed to save language to storage:', e)
    }
  }

  function setPreferred(lang: string) {
    preferred.value = lang
    saveToStorage()
  }

  function setFallback(lang: string) {
    fallback.value = lang
    saveToStorage()
  }

  function setDetected(languages: string[]) {
    detected.value = languages
    detectedAt.value = new Date().toISOString()
  }

  function clearDetected() {
    detected.value = []
    detectedAt.value = null
  }

  // Initialize
  loadFromStorage()

  return {
    // State
    preferred,
    fallback,
    detected,
    detectedAt,
    // Getters
    hasDetected,
    browserLanguage,
    // Actions
    loadFromStorage,
    setPreferred,
    setFallback,
    setDetected,
    clearDetected,
  }
})
