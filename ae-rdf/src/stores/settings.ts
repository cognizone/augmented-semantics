/**
 * Settings Store - user preferences, persisted to localStorage `ae-rdf-settings`.
 *
 * @see /spec/common/com02-StateManagement.md
 */
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { logger } from '../services'
import type { UriDisplayMode } from '../utils/format'

const STORAGE_KEY = 'ae-rdf-settings'

export interface AppSettings {
  darkMode: boolean
  uriDisplay: UriDisplayMode // humanized | prefixed | full
}

const DEFAULT_SETTINGS: AppSettings = {
  darkMode: false,
  uriDisplay: 'humanized',
}

export const useSettingsStore = defineStore('settings', () => {
  const darkMode = ref(DEFAULT_SETTINGS.darkMode)
  const uriDisplay = ref<UriDisplayMode>(DEFAULT_SETTINGS.uriDisplay)

  function applyDarkMode(isDark: boolean) {
    document.documentElement.classList.toggle('dark-mode', isDark)
  }

  function loadSettings() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (!stored) return
      const s = JSON.parse(stored) as Partial<AppSettings>
      if (s.darkMode !== undefined) {
        darkMode.value = s.darkMode
        applyDarkMode(s.darkMode)
      }
      if (s.uriDisplay !== undefined) uriDisplay.value = s.uriDisplay
    } catch (e) {
      logger.error('SettingsStore', 'Failed to load settings', { error: e })
    }
  }

  function saveSettings() {
    try {
      const settings: AppSettings = { darkMode: darkMode.value, uriDisplay: uriDisplay.value }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch (e) {
      logger.error('SettingsStore', 'Failed to save settings', { error: e })
    }
  }

  function setDarkMode(value: boolean) {
    darkMode.value = value // watch applies + saves
  }

  // darkMode also reachable via v-model; watch handles apply + persist for both paths.
  watch(darkMode, (isDark) => {
    applyDarkMode(isDark)
    saveSettings()
  })
  watch(uriDisplay, () => saveSettings())

  loadSettings()

  return { darkMode, uriDisplay, setDarkMode }
})
