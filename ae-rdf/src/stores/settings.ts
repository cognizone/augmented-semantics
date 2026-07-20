/**
 * Settings Store - user preferences, persisted to localStorage `ae-rdf-settings`.
 *
 * @see /spec/common/com02-StateManagement.md
 */
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { logger } from '../services'
import { setGlobalConcurrency } from '../services/http'
import type { UriDisplayMode } from '../utils/format'

const STORAGE_KEY = 'ae-rdf-settings'

export interface AppSettings {
  darkMode: boolean
  uriDisplay: UriDisplayMode // humanized | prefixed | full
  editMode: boolean // config authoring mode: reveals per-type gears + export
  showHidden: boolean // reveal fields hidden by per-type config (greyed), without editing
  groupsCollapsed: boolean // default-collapse named sidebar groups (Ontology, custom groups)
  showEmbedsNested: boolean // nest embed value-object types inline under their composing class
  listView: 'list' | 'cards' // instance-list layout when a type has columns: table rows or cards
  sparqlAutoLimit: boolean // append LIMIT to an unbounded SELECT in the SPARQL panel
  doiCitations: boolean // fetch citation metadata from doi.org for DOI values (external call, opt-in)
  wktMaps: boolean // render an embedded map for WKT geometry values (external tiles, opt-in)
  maxConcurrency: number | null // cap on parallel SPARQL requests per endpoint; null = Auto (per-endpoint config, else 4)
}

const DEFAULT_SETTINGS: AppSettings = {
  darkMode: false,
  uriDisplay: 'humanized',
  editMode: false,
  showHidden: false,
  groupsCollapsed: true,
  showEmbedsNested: false,
  listView: 'cards',
  sparqlAutoLimit: true,
  doiCitations: false,
  wktMaps: false,
  maxConcurrency: 4, // out-of-box default; slider ranges 1‥8 (8 = ceiling)
}

export const useSettingsStore = defineStore('settings', () => {
  const darkMode = ref(DEFAULT_SETTINGS.darkMode)
  const uriDisplay = ref<UriDisplayMode>(DEFAULT_SETTINGS.uriDisplay)
  const editMode = ref(DEFAULT_SETTINGS.editMode)
  const showHidden = ref(DEFAULT_SETTINGS.showHidden)
  const groupsCollapsed = ref(DEFAULT_SETTINGS.groupsCollapsed)
  const showEmbedsNested = ref(DEFAULT_SETTINGS.showEmbedsNested)
  const listView = ref<'list' | 'cards'>(DEFAULT_SETTINGS.listView)
  const sparqlAutoLimit = ref(DEFAULT_SETTINGS.sparqlAutoLimit)
  const doiCitations = ref(DEFAULT_SETTINGS.doiCitations)
  const wktMaps = ref(DEFAULT_SETTINGS.wktMaps)
  const maxConcurrency = ref<number | null>(DEFAULT_SETTINGS.maxConcurrency)

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
      if (s.showEmbedsNested !== undefined) showEmbedsNested.value = s.showEmbedsNested
      if (s.listView !== undefined) listView.value = s.listView
      if (s.sparqlAutoLimit !== undefined) sparqlAutoLimit.value = s.sparqlAutoLimit
      if (s.doiCitations !== undefined) doiCitations.value = s.doiCitations
      if (s.wktMaps !== undefined) wktMaps.value = s.wktMaps
      if (s.maxConcurrency !== undefined) maxConcurrency.value = s.maxConcurrency
    } catch (e) {
      logger.error('SettingsStore', 'Failed to load settings', { error: e })
    }
  }

  function saveSettings() {
    try {
      const settings: AppSettings = { darkMode: darkMode.value, uriDisplay: uriDisplay.value, editMode: editMode.value, showHidden: showHidden.value, groupsCollapsed: groupsCollapsed.value, showEmbedsNested: showEmbedsNested.value, listView: listView.value, sparqlAutoLimit: sparqlAutoLimit.value, doiCitations: doiCitations.value, wktMaps: wktMaps.value, maxConcurrency: maxConcurrency.value }
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
  watch(showEmbedsNested, () => saveSettings())
  watch(listView, () => saveSettings())
  watch(sparqlAutoLimit, () => saveSettings())
  watch(doiCitations, () => saveSettings())
  watch(wktMaps, () => saveSettings())
  // Apply the concurrency override to the SPARQL gate on every change (and persist).
  watch(maxConcurrency, (v) => {
    setGlobalConcurrency(v)
    saveSettings()
  })

  loadSettings()
  // The watch only fires on change, so push the loaded value to the gate once now.
  setGlobalConcurrency(maxConcurrency.value)

  return { darkMode, uriDisplay, editMode, showHidden, groupsCollapsed, showEmbedsNested, listView, sparqlAutoLimit, doiCitations, wktMaps, maxConcurrency, setDarkMode }
})
