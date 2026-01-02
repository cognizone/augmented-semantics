/**
 * useLabelResolver Composable Tests
 *
 * Tests for label selection, sorting, and deduplication
 * @see /spec/ae-skos/sko01-LanguageSelector.md
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useLabelResolver } from '../useLabelResolver'
import { useLanguageStore, useEndpointStore, useSettingsStore } from '../../stores'

describe('useLabelResolver', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('sortLabels', () => {
    it('deduplicates labels with same value and language', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { sortLabels } = useLabelResolver()
      const labels = [
        { value: 'anarchism', lang: 'en' },
        { value: 'anarchism', lang: 'en' }, // duplicate
        { value: 'anarchisme', lang: 'fr' },
        { value: 'anarchisme', lang: 'fr' }, // duplicate
      ]

      const result = sortLabels(labels)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ value: 'anarchism', lang: 'en' })
      expect(result[1]).toEqual({ value: 'anarchisme', lang: 'fr' })
    })

    it('keeps labels with same value but different language', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { sortLabels } = useLabelResolver()
      const labels = [
        { value: 'test', lang: 'en' },
        { value: 'test', lang: 'nl' },
      ]

      const result = sortLabels(labels)
      expect(result).toHaveLength(2)
    })

    it('sorts preferred language first', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('nl')

      const { sortLabels } = useLabelResolver()
      const labels = [
        { value: 'english', lang: 'en' },
        { value: 'french', lang: 'fr' },
        { value: 'dutch', lang: 'nl' },
      ]

      const result = sortLabels(labels)
      expect(result).toHaveLength(3)
      expect(result[0]?.lang).toBe('nl') // preferred first
    })

    it('places no-lang labels after preferred language', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { sortLabels } = useLabelResolver()
      const labels = [
        { value: 'no-lang', lang: undefined },
        { value: 'english', lang: 'en' },
        { value: 'german', lang: 'de' },
      ]

      const result = sortLabels(labels)
      expect(result).toHaveLength(3)
      expect(result[0]?.lang).toBe('en')      // preferred
      expect(result[1]?.lang).toBeUndefined() // no-lang
      expect(result[2]?.lang).toBe('de')      // alphabetical
    })

    it('handles empty label arrays', () => {
      const { sortLabels } = useLabelResolver()
      expect(sortLabels([])).toEqual([])
    })
  })

  describe('selectLabel', () => {
    it('selects label matching preferred language', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('nl')

      const { selectLabel } = useLabelResolver()
      const labels = [
        { value: 'english', lang: 'en' },
        { value: 'dutch', lang: 'nl' },
      ]

      const result = selectLabel(labels)
      expect(result?.lang).toBe('nl')
    })

    it('falls back to no-lang label when preferred not found', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('fr')

      const { selectLabel } = useLabelResolver()
      const labels = [
        { value: 'english', lang: 'en' },
        { value: 'no-lang', lang: undefined },
      ]

      const result = selectLabel(labels)
      expect(result?.value).toBe('no-lang')
    })

    it('falls back to first available when no match', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('fr')

      const { selectLabel } = useLabelResolver()
      const labels = [
        { value: 'english', lang: 'en' },
        { value: 'german', lang: 'de' },
      ]

      const result = selectLabel(labels)
      expect(result?.value).toBe('english')
    })

    it('returns null for empty array', () => {
      const { selectLabel } = useLabelResolver()
      expect(selectLabel([])).toBeNull()
    })
  })

  describe('selectLabelWithXL', () => {
    it('prefers regular labels over XL labels', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectLabelWithXL } = useLabelResolver()
      const labels = [{ value: 'regular', lang: 'en' }]
      const xlLabels = [{
        uri: 'http://example.org/label1',
        literalForm: { value: 'xl-label', lang: 'en' }
      }]

      const result = selectLabelWithXL(labels, xlLabels)
      expect(result?.value).toBe('regular')
    })

    it('falls back to XL labels when no regular labels', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectLabelWithXL } = useLabelResolver()
      const labels: { value: string; lang?: string }[] = []
      const xlLabels = [{
        uri: 'http://example.org/label1',
        literalForm: { value: 'xl-label', lang: 'en' }
      }]

      const result = selectLabelWithXL(labels, xlLabels)
      expect(result?.value).toBe('xl-label')
    })
  })

  describe('shouldShowLangTag', () => {
    it('returns false when lang matches preferred language', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { shouldShowLangTag } = useLabelResolver()
      expect(shouldShowLangTag('en')).toBe(false)
    })

    it('returns true when lang differs from preferred language', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { shouldShowLangTag } = useLabelResolver()
      expect(shouldShowLangTag('fr')).toBe(true)
    })

    it('returns false for undefined/empty lang', () => {
      const { shouldShowLangTag } = useLabelResolver()
      expect(shouldShowLangTag()).toBe(false)
      expect(shouldShowLangTag('')).toBe(false)
    })

    it('returns true for preferred lang when showPreferredLanguageTag is enabled', () => {
      const languageStore = useLanguageStore()
      const settingsStore = useSettingsStore()
      languageStore.setPreferred('en')
      settingsStore.showPreferredLanguageTag = true

      const { shouldShowLangTag } = useLabelResolver()
      expect(shouldShowLangTag('en')).toBe(true)
    })

    it('returns false when showLanguageTags is disabled', () => {
      const settingsStore = useSettingsStore()
      settingsStore.showLanguageTags = false

      const { shouldShowLangTag } = useLabelResolver()
      expect(shouldShowLangTag('fr')).toBe(false)
    })
  })

  describe('selectLabel with endpoint priorities', () => {
    it('falls back to endpoint priorities when preferred not found', () => {
      const languageStore = useLanguageStore()
      const endpointStore = useEndpointStore()

      languageStore.setPreferred('fr') // not in labels

      // Add an endpoint with language priorities
      const endpoint = endpointStore.addEndpoint({
        name: 'Test',
        url: 'http://example.org/sparql',
        languagePriorities: ['de', 'en'], // de first, then en
      })
      endpointStore.selectEndpoint(endpoint.id)

      const { selectLabel } = useLabelResolver()
      const labels = [
        { value: 'english', lang: 'en' },
        { value: 'german', lang: 'de' },
      ]

      const result = selectLabel(labels)
      expect(result?.lang).toBe('de') // should pick de (first in priorities)
    })

    it('prefers preferred language over endpoint priorities', () => {
      const languageStore = useLanguageStore()
      const endpointStore = useEndpointStore()

      languageStore.setPreferred('en')

      const endpoint = endpointStore.addEndpoint({
        name: 'Test',
        url: 'http://example.org/sparql',
        languagePriorities: ['de', 'fr'], // de first
      })
      endpointStore.selectEndpoint(endpoint.id)

      const { selectLabel } = useLabelResolver()
      const labels = [
        { value: 'english', lang: 'en' },
        { value: 'german', lang: 'de' },
      ]

      const result = selectLabel(labels)
      expect(result?.lang).toBe('en') // preferred takes precedence
    })
  })

  describe('sortLabels with endpoint priorities', () => {
    it('sorts by endpoint priorities after preferred language', () => {
      const languageStore = useLanguageStore()
      const endpointStore = useEndpointStore()

      languageStore.setPreferred('en')

      const endpoint = endpointStore.addEndpoint({
        name: 'Test',
        url: 'http://example.org/sparql',
        languagePriorities: ['fr', 'de'], // fr before de
      })
      endpointStore.selectEndpoint(endpoint.id)

      const { sortLabels } = useLabelResolver()
      const labels = [
        { value: 'german', lang: 'de' },
        { value: 'french', lang: 'fr' },
        { value: 'english', lang: 'en' },
        { value: 'spanish', lang: 'es' },
      ]

      const result = sortLabels(labels)
      expect(result[0]?.lang).toBe('en') // preferred first
      expect(result[1]?.lang).toBe('fr') // then fr (first in priorities)
      expect(result[2]?.lang).toBe('de') // then de (second in priorities)
      expect(result[3]?.lang).toBe('es') // then alphabetical
    })
  })
})
