/**
 * Settings Store Tests
 *
 * Tests for application settings management and persistence.
 * @see /spec/common/com02-StateManagement.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore, DEFAULT_DEPRECATION_RULES } from '../settings'

describe('settings store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  describe('initial state', () => {
    it('starts with darkMode disabled', () => {
      const store = useSettingsStore()
      expect(store.darkMode).toBe(false)
    })

    it('starts with showDatatypes enabled', () => {
      const store = useSettingsStore()
      expect(store.showDatatypes).toBe(true)
    })

    it('starts with showLanguageTags enabled', () => {
      const store = useSettingsStore()
      expect(store.showLanguageTags).toBe(true)
    })

    it('starts with showPreferredLanguageTag disabled', () => {
      const store = useSettingsStore()
      expect(store.showPreferredLanguageTag).toBe(false)
    })

    it('starts with showDeprecationIndicator enabled', () => {
      const store = useSettingsStore()
      expect(store.showDeprecationIndicator).toBe(true)
    })

    it('starts with default deprecation rules', () => {
      const store = useSettingsStore()
      expect(store.deprecationRules).toHaveLength(2)
      expect(store.deprecationRules[0].id).toBe('owl-deprecated')
      expect(store.deprecationRules[1].id).toBe('euvoc-status')
    })
  })

  describe('setDarkMode', () => {
    it('updates darkMode value', () => {
      const store = useSettingsStore()

      store.setDarkMode(true)
      expect(store.darkMode).toBe(true)

      store.setDarkMode(false)
      expect(store.darkMode).toBe(false)
    })

    it('persists to localStorage', () => {
      const store = useSettingsStore()

      store.setDarkMode(true)
      expect(localStorage.setItem).toHaveBeenCalled()
    })

    it('applies dark mode class to document', () => {
      const store = useSettingsStore()

      store.setDarkMode(true)
      expect(document.documentElement.classList.contains('dark-mode')).toBe(true)

      store.setDarkMode(false)
      expect(document.documentElement.classList.contains('dark-mode')).toBe(false)
    })

    it('applies class via watcher when ref is changed directly', async () => {
      const store = useSettingsStore()

      // Simulate v-model behavior (direct ref assignment)
      store.darkMode = true
      await new Promise(resolve => setTimeout(resolve, 0)) // Wait for watcher

      expect(document.documentElement.classList.contains('dark-mode')).toBe(true)
    })

    it('loads and applies dark mode from localStorage on init', () => {
      const storedSettings = { darkMode: true }
      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(storedSettings))

      // Create new store instance - should load and apply
      const store = useSettingsStore()

      expect(store.darkMode).toBe(true)
      expect(document.documentElement.classList.contains('dark-mode')).toBe(true)
    })
  })

  describe('setShowDatatypes', () => {
    it('updates showDatatypes value', () => {
      const store = useSettingsStore()

      store.setShowDatatypes(false)
      expect(store.showDatatypes).toBe(false)

      store.setShowDatatypes(true)
      expect(store.showDatatypes).toBe(true)
    })

    it('persists to localStorage', () => {
      const store = useSettingsStore()

      store.setShowDatatypes(false)
      expect(localStorage.setItem).toHaveBeenCalled()
    })
  })

  describe('setShowLanguageTags', () => {
    it('updates showLanguageTags value', () => {
      const store = useSettingsStore()

      store.setShowLanguageTags(false)
      expect(store.showLanguageTags).toBe(false)

      store.setShowLanguageTags(true)
      expect(store.showLanguageTags).toBe(true)
    })
  })

  describe('setShowDeprecationIndicator', () => {
    it('updates showDeprecationIndicator value', () => {
      const store = useSettingsStore()

      store.setShowDeprecationIndicator(false)
      expect(store.showDeprecationIndicator).toBe(false)

      store.setShowDeprecationIndicator(true)
      expect(store.showDeprecationIndicator).toBe(true)
    })

    it('persists to localStorage', () => {
      const store = useSettingsStore()

      store.setShowDeprecationIndicator(false)
      expect(localStorage.setItem).toHaveBeenCalled()
    })
  })

  describe('setDeprecationRules', () => {
    it('updates deprecation rules', () => {
      const store = useSettingsStore()

      const newRules = [
        { ...DEFAULT_DEPRECATION_RULES[0], enabled: false },
      ]

      store.setDeprecationRules(newRules)
      expect(store.deprecationRules).toHaveLength(1)
      expect(store.deprecationRules[0].enabled).toBe(false)
    })

    it('persists to localStorage', () => {
      const store = useSettingsStore()

      store.setDeprecationRules([])
      expect(localStorage.setItem).toHaveBeenCalled()
    })
  })

  describe('showPreferredLanguageTag', () => {
    it('can be toggled', () => {
      const store = useSettingsStore()

      store.showPreferredLanguageTag = true
      expect(store.showPreferredLanguageTag).toBe(true)

      store.showPreferredLanguageTag = false
      expect(store.showPreferredLanguageTag).toBe(false)
    })

    it('is included in saved settings', () => {
      const storedSettings = {
        showDatatypes: true,
        showLanguageTags: true,
        showPreferredLanguageTag: true,
      }

      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(storedSettings))

      const store = useSettingsStore()
      expect(store.showPreferredLanguageTag).toBe(true)
    })
  })

  describe('resetToDefaults', () => {
    it('resets all settings to defaults', () => {
      const store = useSettingsStore()

      // Change all settings
      store.setDarkMode(true)
      store.showDatatypes = false
      store.showLanguageTags = false
      store.showPreferredLanguageTag = true
      store.showDeprecationIndicator = false
      store.setDeprecationRules([])

      // Reset
      store.resetToDefaults()

      // Verify defaults
      expect(store.darkMode).toBe(false)
      expect(store.showDatatypes).toBe(true)
      expect(store.showLanguageTags).toBe(true)
      expect(store.showPreferredLanguageTag).toBe(false)
      expect(store.showDeprecationIndicator).toBe(true)
      expect(store.deprecationRules).toHaveLength(2)
    })
  })

  describe('persistence', () => {
    it('loads settings from localStorage on init', () => {
      const storedSettings = {
        darkMode: true,
        showDatatypes: false,
        showLanguageTags: false,
        showPreferredLanguageTag: true,
      }

      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(storedSettings))

      const store = useSettingsStore()

      expect(store.darkMode).toBe(true)
      expect(store.showDatatypes).toBe(false)
      expect(store.showLanguageTags).toBe(false)
      expect(store.showPreferredLanguageTag).toBe(true)
    })

    it('uses defaults when localStorage is empty', () => {
      vi.mocked(localStorage.getItem).mockReturnValue(null)

      const store = useSettingsStore()

      expect(store.showDatatypes).toBe(true)
      expect(store.showLanguageTags).toBe(true)
      expect(store.showPreferredLanguageTag).toBe(false)
    })

    it('handles invalid JSON gracefully', () => {
      vi.mocked(localStorage.getItem).mockReturnValue('invalid json')

      // Should not throw, should use defaults
      const store = useSettingsStore()
      expect(store.showDatatypes).toBe(true)
    })

    it('handles partial settings (backwards compatibility)', () => {
      // Old settings without showPreferredLanguageTag
      const storedSettings = {
        showDatatypes: false,
        showLanguageTags: true,
        // showPreferredLanguageTag is missing
      }

      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(storedSettings))

      const store = useSettingsStore()

      expect(store.showDatatypes).toBe(false)
      expect(store.showLanguageTags).toBe(true)
      expect(store.showPreferredLanguageTag).toBe(false) // uses default
    })
  })

  describe('logLevel', () => {
    it('starts with warn as default', () => {
      const store = useSettingsStore()
      expect(store.logLevel).toBe('warn')
    })

    it('can be changed via setLogLevel', () => {
      const store = useSettingsStore()

      store.setLogLevel('debug')
      expect(store.logLevel).toBe('debug')

      store.setLogLevel('error')
      expect(store.logLevel).toBe('error')
    })

    it('persists to localStorage', () => {
      const store = useSettingsStore()

      store.setLogLevel('info')
      expect(localStorage.setItem).toHaveBeenCalled()
    })

    it('loads from localStorage on init', () => {
      const storedSettings = {
        logLevel: 'debug',
      }

      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(storedSettings))

      const store = useSettingsStore()
      expect(store.logLevel).toBe('debug')
    })

    it('resets to warn on resetToDefaults', () => {
      const store = useSettingsStore()

      store.setLogLevel('debug')
      store.resetToDefaults()

      expect(store.logLevel).toBe('warn')
    })
  })

  describe('orphan detection strategy', () => {
    it('starts with auto as default', () => {
      const store = useSettingsStore()
      expect(store.orphanDetectionStrategy).toBe('auto')
    })

    it('can be changed via setOrphanDetectionStrategy', () => {
      const store = useSettingsStore()

      store.setOrphanDetectionStrategy('fast')
      expect(store.orphanDetectionStrategy).toBe('fast')

      store.setOrphanDetectionStrategy('slow')
      expect(store.orphanDetectionStrategy).toBe('slow')

      store.setOrphanDetectionStrategy('auto')
      expect(store.orphanDetectionStrategy).toBe('auto')
    })

    it('persists to localStorage', () => {
      const store = useSettingsStore()

      store.setOrphanDetectionStrategy('fast')
      expect(localStorage.setItem).toHaveBeenCalled()
    })

    it('loads from localStorage on init', () => {
      const storedSettings = {
        orphanDetectionStrategy: 'slow',
      }

      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(storedSettings))

      const store = useSettingsStore()
      expect(store.orphanDetectionStrategy).toBe('slow')
    })

    it('loads fast strategy from localStorage', () => {
      const storedSettings = {
        orphanDetectionStrategy: 'fast',
      }

      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(storedSettings))

      const store = useSettingsStore()
      expect(store.orphanDetectionStrategy).toBe('fast')
    })

    it('loads auto strategy from localStorage', () => {
      const storedSettings = {
        orphanDetectionStrategy: 'auto',
      }

      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(storedSettings))

      const store = useSettingsStore()
      expect(store.orphanDetectionStrategy).toBe('auto')
    })

    it('resets to auto on resetToDefaults', () => {
      const store = useSettingsStore()

      store.setOrphanDetectionStrategy('slow')
      expect(store.orphanDetectionStrategy).toBe('slow')

      store.resetToDefaults()
      expect(store.orphanDetectionStrategy).toBe('auto')
    })

    it('uses default when not in stored settings', () => {
      const storedSettings = {
        darkMode: true,
        // orphanDetectionStrategy not included
      }

      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(storedSettings))

      const store = useSettingsStore()
      expect(store.orphanDetectionStrategy).toBe('auto')
    })

    it('can be changed via direct assignment', async () => {
      const store = useSettingsStore()

      // Simulate v-model behavior (direct ref assignment)
      store.orphanDetectionStrategy = 'fast'
      await new Promise(resolve => setTimeout(resolve, 0)) // Wait for watcher

      expect(store.orphanDetectionStrategy).toBe('fast')
      expect(localStorage.setItem).toHaveBeenCalled()
    })

    it('is included in saved settings', () => {
      const store = useSettingsStore()

      store.setOrphanDetectionStrategy('slow')

      // Verify localStorage was called with correct data
      const calls = vi.mocked(localStorage.setItem).mock.calls
      const lastCall = calls[calls.length - 1]
      const savedData = JSON.parse(lastCall[1] as string)

      expect(savedData.orphanDetectionStrategy).toBe('slow')
    })
  })
})
