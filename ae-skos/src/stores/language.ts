/**
 * Language Store - Global language preference
 *
 * Simple store for user's preferred display language.
 * Detected languages are stored per-endpoint in EndpointAnalysis.
 *
 * @see /spec/ae-skos/sko01-LanguageSelector.md
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const STORAGE_KEY = 'ae-preferred-language'

export const useLanguageStore = defineStore('language', () => {
  // User's preferred language (global)
  const preferred = ref<string>(loadPreferred())

  // Getters
  const browserLanguage = computed(() => {
    const lang = navigator.language || 'en'
    return lang.split('-')[0]
  })

  // Load from localStorage
  function loadPreferred(): string {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        return stored
      }
      // Default to browser language
      const lang = navigator.language || 'en'
      return lang.split('-')[0] || 'en'
    } catch {
      return 'en'
    }
  }

  // Set preferred language
  function setPreferred(lang: string) {
    preferred.value = lang
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch (e) {
      console.error('Failed to save preferred language:', e)
    }
  }

  return {
    preferred,
    browserLanguage,
    setPreferred,
  }
})
