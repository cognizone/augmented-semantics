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
import { logger, type LogLevel } from '../services'

const STORAGE_KEY = 'ae-skos-settings'

// Orphan detection strategy
export type OrphanDetectionStrategy = 'auto' | 'fast' | 'slow'

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
  showStringDatatypes: boolean        // Show xsd:string datatype tags
  showLanguageTags: boolean           // Show language tags on labels (when not current)
  showPreferredLanguageTag: boolean   // Show language tag even when matching preferred
  showNotationInLabels: boolean       // Show notation in labels and use for sorting

  // Deprecation settings
  showDeprecationIndicator: boolean   // Show deprecation visual indicators
  deprecationRules: DeprecationRule[] // Configurable deprecation detection rules

  // Scheme selector settings
  showOrphansSelector: boolean    // Show "Orphan Concepts" option in scheme dropdown

  // Search settings
  searchInPrefLabel: boolean
  searchInAltLabel: boolean
  searchInDefinition: boolean
  searchMatchMode: 'contains' | 'startsWith' | 'exact' | 'regex'
  searchAllSchemes: boolean

  // Data fixes
  enableSchemeUriSlashFix: boolean

  // Developer settings
  developerMode: boolean                      // Enable developer tools (e.g., JSON export)
  logLevel: LogLevel                          // Minimum log level for console output
  orphanDetectionStrategy: OrphanDetectionStrategy  // Orphan detection method (auto/fast/slow)
  orphanFastPrefilter: boolean                // Prefilter candidates in fast orphan detection
}

const DEFAULT_SETTINGS: AppSettings = {
  darkMode: false,
  showDatatypes: true,
  showStringDatatypes: false,
  showLanguageTags: true,
  showPreferredLanguageTag: false,
  showNotationInLabels: true,
  showDeprecationIndicator: true,
  deprecationRules: DEFAULT_DEPRECATION_RULES,
  showOrphansSelector: true,
  searchInPrefLabel: true,
  searchInAltLabel: true,
  searchInDefinition: false,
  searchMatchMode: 'contains',
  searchAllSchemes: true,
  enableSchemeUriSlashFix: false,
  developerMode: false,
  logLevel: 'warn',
  orphanDetectionStrategy: 'auto',
  orphanFastPrefilter: false,
}

export const useSettingsStore = defineStore('settings', () => {
  // State
  const darkMode = ref(DEFAULT_SETTINGS.darkMode)
  const showDatatypes = ref(DEFAULT_SETTINGS.showDatatypes)
  const showStringDatatypes = ref(DEFAULT_SETTINGS.showStringDatatypes)
  const showLanguageTags = ref(DEFAULT_SETTINGS.showLanguageTags)
  const showPreferredLanguageTag = ref(DEFAULT_SETTINGS.showPreferredLanguageTag)
  const showNotationInLabels = ref(DEFAULT_SETTINGS.showNotationInLabels)
  const showDeprecationIndicator = ref(DEFAULT_SETTINGS.showDeprecationIndicator)
  const deprecationRules = ref<DeprecationRule[]>([...DEFAULT_DEPRECATION_RULES])
  const showOrphansSelector = ref(DEFAULT_SETTINGS.showOrphansSelector)
  const searchInPrefLabel = ref(DEFAULT_SETTINGS.searchInPrefLabel)
  const searchInAltLabel = ref(DEFAULT_SETTINGS.searchInAltLabel)
  const searchInDefinition = ref(DEFAULT_SETTINGS.searchInDefinition)
  const searchMatchMode = ref<AppSettings['searchMatchMode']>(DEFAULT_SETTINGS.searchMatchMode)
  const searchAllSchemes = ref(DEFAULT_SETTINGS.searchAllSchemes)
  const enableSchemeUriSlashFix = ref(DEFAULT_SETTINGS.enableSchemeUriSlashFix)
  const developerMode = ref(DEFAULT_SETTINGS.developerMode)
  const logLevel = ref<LogLevel>(DEFAULT_SETTINGS.logLevel)
  const orphanDetectionStrategy = ref<OrphanDetectionStrategy>(DEFAULT_SETTINGS.orphanDetectionStrategy)
  const orphanFastPrefilter = ref(DEFAULT_SETTINGS.orphanFastPrefilter)

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
        if (settings.showStringDatatypes !== undefined) {
          showStringDatatypes.value = settings.showStringDatatypes
        }
        if (settings.showLanguageTags !== undefined) {
          showLanguageTags.value = settings.showLanguageTags
        }
        if (settings.showPreferredLanguageTag !== undefined) {
          showPreferredLanguageTag.value = settings.showPreferredLanguageTag
        }
        if (settings.showNotationInLabels !== undefined) {
          showNotationInLabels.value = settings.showNotationInLabels
        }
        if (settings.showDeprecationIndicator !== undefined) {
          showDeprecationIndicator.value = settings.showDeprecationIndicator
        }
        if (settings.deprecationRules !== undefined) {
          deprecationRules.value = settings.deprecationRules
        }
        if (settings.showOrphansSelector !== undefined) {
          showOrphansSelector.value = settings.showOrphansSelector
        }
        if (settings.searchInPrefLabel !== undefined) {
          searchInPrefLabel.value = settings.searchInPrefLabel
        }
        if (settings.searchInAltLabel !== undefined) {
          searchInAltLabel.value = settings.searchInAltLabel
        }
        if (settings.searchInDefinition !== undefined) {
          searchInDefinition.value = settings.searchInDefinition
        }
        if (settings.searchMatchMode !== undefined) {
          searchMatchMode.value = settings.searchMatchMode
        }
        if (settings.searchAllSchemes !== undefined) {
          searchAllSchemes.value = settings.searchAllSchemes
        }
        if (settings.enableSchemeUriSlashFix !== undefined) {
          enableSchemeUriSlashFix.value = settings.enableSchemeUriSlashFix
        }
        if (settings.developerMode !== undefined) {
          developerMode.value = settings.developerMode
        }
        if (settings.logLevel !== undefined) {
          logLevel.value = settings.logLevel
          logger.setMinLevel(settings.logLevel)
        }
        if (settings.orphanDetectionStrategy !== undefined) {
          orphanDetectionStrategy.value = settings.orphanDetectionStrategy
        }
        if (settings.orphanFastPrefilter !== undefined) {
          orphanFastPrefilter.value = settings.orphanFastPrefilter
        }
      }
    } catch (e) {
      logger.error('SettingsStore', 'Failed to load settings', { error: e })
    }
  }

  // Save settings to localStorage
  function saveSettings() {
    try {
      const settings: AppSettings = {
        darkMode: darkMode.value,
        showDatatypes: showDatatypes.value,
        showStringDatatypes: showStringDatatypes.value,
        showLanguageTags: showLanguageTags.value,
        showPreferredLanguageTag: showPreferredLanguageTag.value,
        showNotationInLabels: showNotationInLabels.value,
        showDeprecationIndicator: showDeprecationIndicator.value,
        deprecationRules: deprecationRules.value,
        showOrphansSelector: showOrphansSelector.value,
        searchInPrefLabel: searchInPrefLabel.value,
        searchInAltLabel: searchInAltLabel.value,
        searchInDefinition: searchInDefinition.value,
        searchMatchMode: searchMatchMode.value,
        searchAllSchemes: searchAllSchemes.value,
        enableSchemeUriSlashFix: enableSchemeUriSlashFix.value,
        developerMode: developerMode.value,
        logLevel: logLevel.value,
        orphanDetectionStrategy: orphanDetectionStrategy.value,
        orphanFastPrefilter: orphanFastPrefilter.value,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch (e) {
      logger.error('SettingsStore', 'Failed to save settings', { error: e })
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

  function setShowStringDatatypes(value: boolean) {
    showStringDatatypes.value = value
    saveSettings()
  }

  function setShowLanguageTags(value: boolean) {
    showLanguageTags.value = value
    saveSettings()
  }

  function setShowNotationInLabels(value: boolean) {
    showNotationInLabels.value = value
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

  function setLogLevel(level: LogLevel) {
    logLevel.value = level
    logger.setMinLevel(level)
    saveSettings()
  }

  function setOrphanDetectionStrategy(strategy: OrphanDetectionStrategy) {
    orphanDetectionStrategy.value = strategy
    saveSettings()
  }

  function setOrphanFastPrefilter(value: boolean) {
    orphanFastPrefilter.value = value
    saveSettings()
  }

  function resetToDefaults() {
    darkMode.value = DEFAULT_SETTINGS.darkMode
    applyDarkMode(DEFAULT_SETTINGS.darkMode)
    showDatatypes.value = DEFAULT_SETTINGS.showDatatypes
    showStringDatatypes.value = DEFAULT_SETTINGS.showStringDatatypes
    showLanguageTags.value = DEFAULT_SETTINGS.showLanguageTags
    showPreferredLanguageTag.value = DEFAULT_SETTINGS.showPreferredLanguageTag
    showNotationInLabels.value = DEFAULT_SETTINGS.showNotationInLabels
    showDeprecationIndicator.value = DEFAULT_SETTINGS.showDeprecationIndicator
    deprecationRules.value = [...DEFAULT_DEPRECATION_RULES]
    showOrphansSelector.value = DEFAULT_SETTINGS.showOrphansSelector
    searchInPrefLabel.value = DEFAULT_SETTINGS.searchInPrefLabel
    searchInAltLabel.value = DEFAULT_SETTINGS.searchInAltLabel
    searchInDefinition.value = DEFAULT_SETTINGS.searchInDefinition
    searchMatchMode.value = DEFAULT_SETTINGS.searchMatchMode
    searchAllSchemes.value = DEFAULT_SETTINGS.searchAllSchemes
    enableSchemeUriSlashFix.value = DEFAULT_SETTINGS.enableSchemeUriSlashFix
    developerMode.value = DEFAULT_SETTINGS.developerMode
    logLevel.value = DEFAULT_SETTINGS.logLevel
    orphanDetectionStrategy.value = DEFAULT_SETTINGS.orphanDetectionStrategy
    orphanFastPrefilter.value = DEFAULT_SETTINGS.orphanFastPrefilter
    logger.setMinLevel(DEFAULT_SETTINGS.logLevel)
    saveSettings()
  }

  // Watch darkMode separately to apply class immediately
  watch(darkMode, (isDark) => {
    applyDarkMode(isDark)
    saveSettings()
  })

  // Watch logLevel to update logger
  watch(logLevel, (level) => {
    logger.setMinLevel(level)
  })

  // Auto-save on any change (alternative to manual save in each setter)
  watch(
    () => [
      showDatatypes.value,
      showStringDatatypes.value,
      showLanguageTags.value,
      showPreferredLanguageTag.value,
      showNotationInLabels.value,
      showDeprecationIndicator.value,
      deprecationRules.value,
      showOrphansSelector.value,
      searchInPrefLabel.value,
      searchInAltLabel.value,
      searchInDefinition.value,
      searchMatchMode.value,
      searchAllSchemes.value,
      enableSchemeUriSlashFix.value,
      developerMode.value,
      logLevel.value,
      orphanDetectionStrategy.value,
      orphanFastPrefilter.value,
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
    showStringDatatypes,
    showLanguageTags,
    showPreferredLanguageTag,
    showNotationInLabels,
    showDeprecationIndicator,
    deprecationRules,
    showOrphansSelector,
    searchInPrefLabel,
    searchInAltLabel,
    searchInDefinition,
    searchMatchMode,
    searchAllSchemes,
    enableSchemeUriSlashFix,
    developerMode,
    logLevel,
    orphanDetectionStrategy,
    orphanFastPrefilter,
    // Actions
    setDarkMode,
    setShowDatatypes,
    setShowStringDatatypes,
    setShowLanguageTags,
    setShowNotationInLabels,
    setShowDeprecationIndicator,
    setDeprecationRules,
    setLogLevel,
    setOrphanDetectionStrategy,
    setOrphanFastPrefilter,
    resetToDefaults,
    loadSettings,
  }
})
