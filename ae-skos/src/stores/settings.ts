/**
 * Settings Store - Global application settings
 *
 * Manages user preferences persisted to localStorage.
 * Settings are loaded on startup and saved automatically on change.
 *
 * @see /spec/common/com02-StateManagement.md
 */
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const STORAGE_KEY = 'ae-skos-settings'

// Deprecation detection rule
export interface DeprecationRule {
  id: string
  label: string
  predicate: string
  condition: 'equals' | 'not-equals' | 'exists'
  value?: string
  enabled: boolean
}

// Default deprecation rules
export const DEFAULT_DEPRECATION_RULES: DeprecationRule[] = [
  {
    id: 'owl-deprecated',
    label: 'OWL Deprecated',
    predicate: 'http://www.w3.org/2002/07/owl#deprecated',
    condition: 'equals',
    value: 'true',
    enabled: true,
  },
  {
    id: 'euvoc-status',
    label: 'EU Vocabularies Status',
    predicate: 'http://publications.europa.eu/ontology/euvoc#status',
    condition: 'not-equals',
    value: 'http://publications.europa.eu/resource/authority/concept-status/CURRENT',
    enabled: true,
  },
]

export interface AppSettings {
  // Display settings
  darkMode: boolean                   // Use dark color scheme
  showDatatypes: boolean              // Show datatype tags on property values
  showLanguageTags: boolean           // Show language tags on labels (when not current)
  showPreferredLanguageTag: boolean   // Show language tag even when matching preferred

  // Deprecation settings
  showDeprecationIndicator: boolean   // Show deprecation visual indicators
  deprecationRules: DeprecationRule[] // Configurable deprecation detection rules
}

const DEFAULT_SETTINGS: AppSettings = {
  darkMode: false,
  showDatatypes: true,
  showLanguageTags: true,
  showPreferredLanguageTag: false,
  showDeprecationIndicator: true,
  deprecationRules: DEFAULT_DEPRECATION_RULES,
}

export const useSettingsStore = defineStore('settings', () => {
  // State
  const darkMode = ref(DEFAULT_SETTINGS.darkMode)
  const showDatatypes = ref(DEFAULT_SETTINGS.showDatatypes)
  const showLanguageTags = ref(DEFAULT_SETTINGS.showLanguageTags)
  const showPreferredLanguageTag = ref(DEFAULT_SETTINGS.showPreferredLanguageTag)
  const showDeprecationIndicator = ref(DEFAULT_SETTINGS.showDeprecationIndicator)
  const deprecationRules = ref<DeprecationRule[]>([...DEFAULT_DEPRECATION_RULES])

  // Apply dark mode to document
  function applyDarkMode(isDark: boolean) {
    if (isDark) {
      document.documentElement.classList.add('dark-mode')
    } else {
      document.documentElement.classList.remove('dark-mode')
    }
  }

  // Load settings from localStorage
  function loadSettings() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const settings = JSON.parse(stored) as Partial<AppSettings>
        if (settings.darkMode !== undefined) {
          darkMode.value = settings.darkMode
          applyDarkMode(settings.darkMode)
        }
        if (settings.showDatatypes !== undefined) {
          showDatatypes.value = settings.showDatatypes
        }
        if (settings.showLanguageTags !== undefined) {
          showLanguageTags.value = settings.showLanguageTags
        }
        if (settings.showPreferredLanguageTag !== undefined) {
          showPreferredLanguageTag.value = settings.showPreferredLanguageTag
        }
        if (settings.showDeprecationIndicator !== undefined) {
          showDeprecationIndicator.value = settings.showDeprecationIndicator
        }
        if (settings.deprecationRules !== undefined) {
          deprecationRules.value = settings.deprecationRules
        }
      }
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
  }

  // Save settings to localStorage
  function saveSettings() {
    try {
      const settings: AppSettings = {
        darkMode: darkMode.value,
        showDatatypes: showDatatypes.value,
        showLanguageTags: showLanguageTags.value,
        showPreferredLanguageTag: showPreferredLanguageTag.value,
        showDeprecationIndicator: showDeprecationIndicator.value,
        deprecationRules: deprecationRules.value,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch (e) {
      console.error('Failed to save settings:', e)
    }
  }

  // Actions
  function setDarkMode(value: boolean) {
    darkMode.value = value
    applyDarkMode(value)
    saveSettings()
  }

  function setShowDatatypes(value: boolean) {
    showDatatypes.value = value
    saveSettings()
  }

  function setShowLanguageTags(value: boolean) {
    showLanguageTags.value = value
    saveSettings()
  }

  function setShowDeprecationIndicator(value: boolean) {
    showDeprecationIndicator.value = value
    saveSettings()
  }

  function setDeprecationRules(rules: DeprecationRule[]) {
    deprecationRules.value = rules
    saveSettings()
  }

  function resetToDefaults() {
    darkMode.value = DEFAULT_SETTINGS.darkMode
    applyDarkMode(DEFAULT_SETTINGS.darkMode)
    showDatatypes.value = DEFAULT_SETTINGS.showDatatypes
    showLanguageTags.value = DEFAULT_SETTINGS.showLanguageTags
    showPreferredLanguageTag.value = DEFAULT_SETTINGS.showPreferredLanguageTag
    showDeprecationIndicator.value = DEFAULT_SETTINGS.showDeprecationIndicator
    deprecationRules.value = [...DEFAULT_DEPRECATION_RULES]
    saveSettings()
  }

  // Watch darkMode separately to apply class immediately
  watch(darkMode, (isDark) => {
    applyDarkMode(isDark)
    saveSettings()
  })

  // Auto-save on any change (alternative to manual save in each setter)
  watch(
    () => [
      showDatatypes.value,
      showLanguageTags.value,
      showPreferredLanguageTag.value,
      showDeprecationIndicator.value,
      deprecationRules.value,
    ],
    () => saveSettings(),
    { deep: true }
  )

  // Load settings on store initialization
  loadSettings()

  return {
    // State
    darkMode,
    showDatatypes,
    showLanguageTags,
    showPreferredLanguageTag,
    showDeprecationIndicator,
    deprecationRules,
    // Actions
    setDarkMode,
    setShowDatatypes,
    setShowLanguageTags,
    setShowDeprecationIndicator,
    setDeprecationRules,
    resetToDefaults,
    loadSettings,
  }
})
