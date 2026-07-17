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
  editMode: boolean // config authoring mode: reveals per-type gears + export
  showHidden: boolean // reveal fields hidden by per-type config (greyed), without editing
  groupsCollapsed: boolean // default-collapse named sidebar groups (Ontology, custom groups)
  doiCitations: boolean // fetch citation metadata from doi.org for DOI values (external call, opt-in)
}

const DEFAULT_SETTINGS: AppSettings = {
  darkMode: false,
  uriDisplay: 'humanized',
  editMode: false,
  showHidden: false,
  groupsCollapsed: true,
  doiCitations: false,
}

export const useSettingsStore = defineStore('settings', () => {
  const darkMode = ref(DEFAULT_SETTINGS.darkMode)
  const uriDisplay = ref<UriDisplayMode>(DEFAULT_SETTINGS.uriDisplay)
  const editMode = ref(DEFAULT_SETTINGS.editMode)
  const showHidden = ref(DEFAULT_SETTINGS.showHidden)
  const groupsCollapsed = ref(DEFAULT_SETTINGS.groupsCollapsed)
  const doiCitations = ref(DEFAULT_SETTINGS.doiCitations)

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
      if (s.editMode !== undefined) editMode.value = s.editMode
      if (s.showHidden !== undefined) showHidden.value = s.showHidden
      if (s.groupsCollapsed !== undefined) groupsCollapsed.value = s.groupsCollapsed
      if (s.doiCitations !== undefined) doiCitations.value = s.doiCitations
    } catch (e) {
      logger.error('SettingsStore', 'Failed to load settings', { error: e })
    }
  }

  function saveSettings() {
    try {
      const settings: AppSettings = { darkMode: darkMode.value, uriDisplay: uriDisplay.value, editMode: editMode.value, showHidden: showHidden.value, groupsCollapsed: groupsCollapsed.value, doiCitations: doiCitations.value }
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
  watch(editMode, () => saveSettings())
  watch(showHidden, () => saveSettings())
  watch(groupsCollapsed, () => saveSettings())
  watch(doiCitations, () => saveSettings())

  loadSettings()

  return { darkMode, uriDisplay, editMode, showHidden, groupsCollapsed, doiCitations, setDarkMode }
})
