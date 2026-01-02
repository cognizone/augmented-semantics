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

export interface AppSettings {
  // Display settings
  showDatatypes: boolean              // Show datatype tags on property values
  showLanguageTags: boolean           // Show language tags on labels (when not current)
  showPreferredLanguageTag: boolean   // Show language tag even when matching preferred

  // Future settings can be added here
  // compactMode: boolean
  // darkMode: boolean
}

const DEFAULT_SETTINGS: AppSettings = {
  showDatatypes: true,
  showLanguageTags: true,
  showPreferredLanguageTag: false,
}

export const useSettingsStore = defineStore('settings', () => {
  // State
  const showDatatypes = ref(DEFAULT_SETTINGS.showDatatypes)
  const showLanguageTags = ref(DEFAULT_SETTINGS.showLanguageTags)
  const showPreferredLanguageTag = ref(DEFAULT_SETTINGS.showPreferredLanguageTag)

  // Load settings from localStorage
  function loadSettings() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const settings = JSON.parse(stored) as Partial<AppSettings>
        if (settings.showDatatypes !== undefined) {
          showDatatypes.value = settings.showDatatypes
        }
        if (settings.showLanguageTags !== undefined) {
          showLanguageTags.value = settings.showLanguageTags
        }
        if (settings.showPreferredLanguageTag !== undefined) {
          showPreferredLanguageTag.value = settings.showPreferredLanguageTag
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
        showDatatypes: showDatatypes.value,
        showLanguageTags: showLanguageTags.value,
        showPreferredLanguageTag: showPreferredLanguageTag.value,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch (e) {
      console.error('Failed to save settings:', e)
    }
  }

  // Actions
  function setShowDatatypes(value: boolean) {
    showDatatypes.value = value
    saveSettings()
  }

  function setShowLanguageTags(value: boolean) {
    showLanguageTags.value = value
    saveSettings()
  }

  function resetToDefaults() {
    showDatatypes.value = DEFAULT_SETTINGS.showDatatypes
    showLanguageTags.value = DEFAULT_SETTINGS.showLanguageTags
    showPreferredLanguageTag.value = DEFAULT_SETTINGS.showPreferredLanguageTag
    saveSettings()
  }

  // Auto-save on any change (alternative to manual save in each setter)
  watch(
    () => [showDatatypes.value, showLanguageTags.value, showPreferredLanguageTag.value],
    () => saveSettings(),
    { deep: true }
  )

  // Load settings on store initialization
  loadSettings()

  return {
    // State
    showDatatypes,
    showLanguageTags,
    showPreferredLanguageTag,
    // Actions
    setShowDatatypes,
    setShowLanguageTags,
    resetToDefaults,
    loadSettings,
  }
})
