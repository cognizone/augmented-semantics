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
      store.showDatatypes = false
      store.showLanguageTags = false
      store.showPreferredLanguageTag = true
      store.showDeprecationIndicator = false
      store.setDeprecationRules([])

      // Reset
      store.resetToDefaults()

      // Verify defaults
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
        showDatatypes: false,
        showLanguageTags: false,
        showPreferredLanguageTag: true,
      }

      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(storedSettings))

      const store = useSettingsStore()

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
})
