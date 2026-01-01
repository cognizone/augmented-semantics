/**
 * Language Store - Per-endpoint language preference management
 *
 * Manages language priorities and current override per endpoint.
 * Persisted to localStorage under key 'ae-language-{endpointId}'.
 *
 * @see /spec/ae-skos/sko01-LanguageSelector.md
 * @see /spec/common/com02-StateManagement.md
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const STORAGE_KEY_PREFIX = 'ae-language-'
const OLD_STORAGE_KEY = 'ae-language'

export interface EndpointLanguageConfig {
  priorities: string[]
  current: string | null
}

export interface DetectedLanguage {
  lang: string
  count: number
}

export const useLanguageStore = defineStore('language', () => {
  // Per-endpoint configs (cached)
  const configs = ref<Record<string, EndpointLanguageConfig>>({})

  // Current endpoint's config
  const currentEndpointId = ref<string | null>(null)
  const priorities = ref<string[]>(['en'])
  const current = ref<string | null>(null)

  // Detection results
  const detected = ref<string[]>([])
  const detectedWithCount = ref<DetectedLanguage[]>([])
  const detectedAt = ref<string | null>(null)

  // Getters
  const hasDetected = computed(() => detected.value.length > 0)

  const browserLanguage = computed(() => {
    const lang = navigator.language || 'en'
    return lang.split('-')[0]
  })

  // Effective display language (current override or first priority)
  const displayLanguage = computed(() => {
    return current.value || priorities.value[0] || 'en'
  })

  // For backward compatibility - preferred is first priority
  const preferred = computed(() => priorities.value[0] || 'en')

  // For backward compatibility - fallback is second priority
  const fallback = computed(() => priorities.value[1] || priorities.value[0] || 'en')

  // Actions
  function getBrowserLanguage(): string {
    const lang = navigator.language || 'en'
    const primary = lang.split('-')[0]
    return primary || 'en'
  }

  function getStorageKey(endpointId: string): string {
    return `${STORAGE_KEY_PREFIX}${endpointId}`
  }

  function loadConfigForEndpoint(endpointId: string): EndpointLanguageConfig {
    // Check cache
    if (configs.value[endpointId]) {
      return configs.value[endpointId]
    }

    try {
      const key = getStorageKey(endpointId)
      const stored = localStorage.getItem(key)

      if (stored) {
        const config = JSON.parse(stored) as EndpointLanguageConfig
        configs.value[endpointId] = config
        return config
      }

      // Try to migrate from old global format
      const oldStored = localStorage.getItem(OLD_STORAGE_KEY)
      if (oldStored) {
        const oldConfig = JSON.parse(oldStored)
        if (oldConfig.preferred) {
          const migrated: EndpointLanguageConfig = {
            priorities: [oldConfig.preferred, oldConfig.fallback].filter(Boolean),
            current: null
          }
          configs.value[endpointId] = migrated
          saveConfigForEndpoint(endpointId, migrated)
          return migrated
        }
      }

      // Default: browser language first, then 'en'
      const browserLang = getBrowserLanguage()
      const defaultConfig: EndpointLanguageConfig = {
        priorities: browserLang !== 'en' ? [browserLang, 'en'] : ['en'],
        current: null
      }
      configs.value[endpointId] = defaultConfig
      return defaultConfig
    } catch (e) {
      console.error('Failed to load language config:', e)
      return { priorities: ['en'], current: null }
    }
  }

  function saveConfigForEndpoint(endpointId: string, config: EndpointLanguageConfig) {
    try {
      const key = getStorageKey(endpointId)
      localStorage.setItem(key, JSON.stringify(config))
      configs.value[endpointId] = config
    } catch (e) {
      console.error('Failed to save language config:', e)
    }
  }

  function setEndpoint(endpointId: string) {
    currentEndpointId.value = endpointId
    const config = loadConfigForEndpoint(endpointId)
    priorities.value = config.priorities
    current.value = config.current
  }

  function clearEndpoint() {
    currentEndpointId.value = null
    priorities.value = ['en']
    current.value = null
    detected.value = []
    detectedWithCount.value = []
    detectedAt.value = null
  }

  function setPriorities(langs: string[]) {
    if (!currentEndpointId.value) return

    priorities.value = langs
    saveConfigForEndpoint(currentEndpointId.value, {
      priorities: langs,
      current: current.value
    })
  }

  function setCurrent(lang: string | null) {
    if (!currentEndpointId.value) return

    current.value = lang
    saveConfigForEndpoint(currentEndpointId.value, {
      priorities: priorities.value,
      current: lang
    })
  }

  function addToPriorities(lang: string) {
    if (!priorities.value.includes(lang)) {
      setPriorities([...priorities.value, lang])
    }
  }

  function removeFromPriorities(lang: string) {
    const filtered = priorities.value.filter(l => l !== lang)
    if (filtered.length > 0) {
      setPriorities(filtered)
    }
  }

  function movePriority(fromIndex: number, toIndex: number) {
    const newPriorities = [...priorities.value]
    const removed = newPriorities.splice(fromIndex, 1)
    if (removed[0]) {
      newPriorities.splice(toIndex, 0, removed[0])
      setPriorities(newPriorities)
    }
  }

  function setDetected(languages: string[]) {
    detected.value = languages
    detectedAt.value = new Date().toISOString()
  }

  function setDetectedWithCount(languages: DetectedLanguage[]) {
    detectedWithCount.value = languages
    detected.value = languages.map(l => l.lang)
    detectedAt.value = new Date().toISOString()
  }

  function clearDetected() {
    detected.value = []
    detectedWithCount.value = []
    detectedAt.value = null
  }

  // Backward compatibility: setPreferred sets first priority and current
  function setPreferred(lang: string) {
    if (!currentEndpointId.value) return

    // If setting a new preferred, make it first in priorities
    const newPriorities = [lang, ...priorities.value.filter(l => l !== lang)]
    priorities.value = newPriorities
    current.value = lang
    saveConfigForEndpoint(currentEndpointId.value, {
      priorities: newPriorities,
      current: lang
    })
  }

  // Backward compatibility: setFallback adds to priorities if not present
  function setFallback(lang: string) {
    if (!currentEndpointId.value) return

    if (!priorities.value.includes(lang)) {
      const newPriorities = [...priorities.value, lang]
      priorities.value = newPriorities
      saveConfigForEndpoint(currentEndpointId.value, {
        priorities: newPriorities,
        current: current.value
      })
    }
  }

  return {
    // State
    configs,
    currentEndpointId,
    priorities,
    current,
    detected,
    detectedWithCount,
    detectedAt,
    // Getters
    hasDetected,
    browserLanguage,
    displayLanguage,
    preferred,
    fallback,
    // Actions
    setEndpoint,
    clearEndpoint,
    setPriorities,
    setCurrent,
    addToPriorities,
    removeFromPriorities,
    movePriority,
    setDetected,
    setDetectedWithCount,
    clearDetected,
    // Backward compatibility
    setPreferred,
    setFallback,
  }
})
