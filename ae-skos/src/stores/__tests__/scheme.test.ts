/**
 * Scheme Store Tests
 *
 * Tests for scheme selection, root mode, and persistence.
 * @see /spec/ae-skos/sko02-SchemeSelector.md
 * @see /spec/common/com02-StateManagement.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSchemeStore, ORPHAN_SCHEME_URI, ORPHAN_SCHEME } from '../scheme'

// Mock logger
vi.mock('../../services', () => ({
  logger: {
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

describe('scheme store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  describe('initial state', () => {
    it('starts with empty schemes array', () => {
      const store = useSchemeStore()
      expect(store.schemes).toEqual([])
    })

    it('starts with no selected scheme', () => {
      const store = useSchemeStore()
      expect(store.selectedUri).toBeNull()
      expect(store.selected).toBeNull()
    })

    it('starts with scheme root mode', () => {
      const store = useSchemeStore()
      expect(store.rootMode).toBe('scheme')
    })

    it('starts with loading false', () => {
      const store = useSchemeStore()
      expect(store.loading).toBe(false)
    })

    it('starts with no viewing scheme', () => {
      const store = useSchemeStore()
      expect(store.viewingSchemeUri).toBeNull()
      expect(store.schemeDetails).toBeNull()
    })
  })

  describe('setSchemes', () => {
    it('sets schemes array', () => {
      const store = useSchemeStore()
      const schemes = [
        { uri: 'http://example.org/scheme1', label: 'Scheme 1' },
        { uri: 'http://example.org/scheme2', label: 'Scheme 2' },
      ]

      store.setSchemes(schemes)
      expect(store.schemes).toEqual(schemes)
    })
  })

  describe('selectScheme', () => {
    it('selects a scheme by URI', () => {
      const store = useSchemeStore()
      const schemes = [
        { uri: 'http://example.org/scheme1', label: 'Scheme 1' },
        { uri: 'http://example.org/scheme2', label: 'Scheme 2' },
      ]
      store.setSchemes(schemes)

      store.selectScheme('http://example.org/scheme1')
      expect(store.selectedUri).toBe('http://example.org/scheme1')
      expect(store.selected?.label).toBe('Scheme 1')
    })

    it('clears selection when null', () => {
      const store = useSchemeStore()
      store.selectScheme('http://example.org/scheme1')
      store.selectScheme(null)
      expect(store.selectedUri).toBeNull()
      expect(store.selected).toBeNull()
    })

    it('persists selection to localStorage', () => {
      const store = useSchemeStore()
      store.selectScheme('http://example.org/scheme1')
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'ae-skos-scheme',
        JSON.stringify('http://example.org/scheme1')
      )
    })
  })

  describe('rootMode', () => {
    it('sets root mode to collection', () => {
      const store = useSchemeStore()
      store.setRootMode('collection')
      expect(store.rootMode).toBe('collection')
    })

    it('sets root mode to scheme', () => {
      const store = useSchemeStore()
      store.setRootMode('collection')
      store.setRootMode('scheme')
      expect(store.rootMode).toBe('scheme')
    })

    it('persists root mode to localStorage', () => {
      const store = useSchemeStore()
      store.setRootMode('collection')
      expect(localStorage.setItem).toHaveBeenCalledWith('ae-skos-root-mode', 'collection')
    })

    it('restores root mode from localStorage', () => {
      localStorage.setItem('ae-skos-root-mode', 'collection')
      setActivePinia(createPinia())
      const store = useSchemeStore()
      expect(store.rootMode).toBe('collection')
    })

    it('defaults to scheme if invalid value in localStorage', () => {
      localStorage.setItem('ae-skos-root-mode', 'invalid')
      setActivePinia(createPinia())
      const store = useSchemeStore()
      expect(store.rootMode).toBe('scheme')
    })
  })

  describe('orphan scheme', () => {
    it('returns ORPHAN_SCHEME when orphan URI selected', () => {
      const store = useSchemeStore()
      store.selectScheme(ORPHAN_SCHEME_URI)
      expect(store.selected).toEqual(ORPHAN_SCHEME)
    })

    it('isOrphanSchemeSelected is true when orphan selected', () => {
      const store = useSchemeStore()
      store.selectScheme(ORPHAN_SCHEME_URI)
      expect(store.isOrphanSchemeSelected).toBe(true)
    })

    it('isOrphanSchemeSelected is false for regular scheme', () => {
      const store = useSchemeStore()
      store.selectScheme('http://example.org/scheme1')
      expect(store.isOrphanSchemeSelected).toBe(false)
    })
  })

  describe('sortedSchemes', () => {
    it('sorts schemes alphabetically by label', () => {
      const store = useSchemeStore()
      store.setSchemes([
        { uri: 'http://example.org/c', label: 'Zebra' },
        { uri: 'http://example.org/a', label: 'Alpha' },
        { uri: 'http://example.org/b', label: 'Beta' },
      ])

      expect(store.sortedSchemes[0].label).toBe('Alpha')
      expect(store.sortedSchemes[1].label).toBe('Beta')
      expect(store.sortedSchemes[2].label).toBe('Zebra')
    })

    it('uses URI as fallback for sorting when no label', () => {
      const store = useSchemeStore()
      store.setSchemes([
        { uri: 'http://example.org/z' },
        { uri: 'http://example.org/a' },
      ])

      expect(store.sortedSchemes[0].uri).toBe('http://example.org/a')
      expect(store.sortedSchemes[1].uri).toBe('http://example.org/z')
    })
  })

  describe('reset', () => {
    it('clears all state', () => {
      const store = useSchemeStore()
      store.setSchemes([{ uri: 'http://example.org/scheme1', label: 'Scheme 1' }])
      store.selectScheme('http://example.org/scheme1')
      store.viewScheme('http://example.org/scheme1')

      store.reset()

      expect(store.schemes).toEqual([])
      expect(store.selectedUri).toBeNull()
      expect(store.viewingSchemeUri).toBeNull()
      expect(store.schemeDetails).toBeNull()
    })

    it('preserves selection when option set', () => {
      const store = useSchemeStore()
      store.selectScheme('http://example.org/scheme1')

      store.reset({ preserveSelection: true })

      expect(store.selectedUri).toBe('http://example.org/scheme1')
    })
  })

  describe('scheme details viewing', () => {
    it('sets viewing scheme URI', () => {
      const store = useSchemeStore()
      store.viewScheme('http://example.org/scheme1')
      expect(store.viewingSchemeUri).toBe('http://example.org/scheme1')
    })

    it('clears scheme details when viewing null', () => {
      const store = useSchemeStore()
      store.setSchemeDetails({ uri: 'http://example.org/scheme1' } as any)
      store.viewScheme(null)
      expect(store.viewingSchemeUri).toBeNull()
      expect(store.schemeDetails).toBeNull()
    })
  })

  describe('persistence', () => {
    it('restores selected scheme from localStorage', () => {
      localStorage.setItem('ae-skos-scheme', JSON.stringify('http://example.org/scheme1'))
      setActivePinia(createPinia())
      const store = useSchemeStore()
      expect(store.selectedUri).toBe('http://example.org/scheme1')
    })

    it('handles invalid JSON in localStorage gracefully', () => {
      localStorage.setItem('ae-skos-scheme', 'invalid-json')
      setActivePinia(createPinia())
      const store = useSchemeStore()
      expect(store.selectedUri).toBeNull()
    })
  })
})
