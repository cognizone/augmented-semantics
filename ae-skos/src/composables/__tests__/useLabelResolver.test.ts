/**
 * useLabelResolver Composable Tests
 *
 * Tests for label selection, sorting, and deduplication
 * @see /spec/ae-skos/sko01-LanguageSelector.md
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useLabelResolver } from '../useLabelResolver'
import { useLanguageStore } from '../../stores'

describe('useLabelResolver', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // Set up a mock endpoint so language preferences can be changed
    const languageStore = useLanguageStore()
    languageStore.setEndpoint('test-endpoint')
  })

  describe('sortLabels', () => {
    it('deduplicates labels with same value and language', () => {
      const languageStore = useLanguageStore()
      languageStore.setPriorities(['en', 'nl', 'fr'])

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
      languageStore.setPriorities(['en', 'nl'])

      const { sortLabels } = useLabelResolver()
      const labels = [
        { value: 'test', lang: 'en' },
        { value: 'test', lang: 'nl' },
      ]

      const result = sortLabels(labels)
      expect(result).toHaveLength(2)
    })

    it('sorts by priority list order', () => {
      const languageStore = useLanguageStore()
      languageStore.setPriorities(['nl', 'en', 'fr'])

      const { sortLabels } = useLabelResolver()
      const labels = [
        { value: 'english', lang: 'en' },
        { value: 'french', lang: 'fr' },
        { value: 'dutch', lang: 'nl' },
      ]

      const result = sortLabels(labels)
      expect(result).toHaveLength(3)
      expect(result[0]?.lang).toBe('nl')
      expect(result[1]?.lang).toBe('en')
      expect(result[2]?.lang).toBe('fr')
    })

    it('places no-lang labels after priority languages', () => {
      const languageStore = useLanguageStore()
      languageStore.setPriorities(['en'])

      const { sortLabels } = useLabelResolver()
      const labels = [
        { value: 'no-lang', lang: undefined },
        { value: 'english', lang: 'en' },
        { value: 'german', lang: 'de' },
      ]

      const result = sortLabels(labels)
      expect(result).toHaveLength(3)
      expect(result[0]?.lang).toBe('en')    // priority
      expect(result[1]?.lang).toBeUndefined()  // no-lang
      expect(result[2]?.lang).toBe('de')    // alphabetical
    })

    it('handles empty label arrays', () => {
      const { sortLabels } = useLabelResolver()
      expect(sortLabels([])).toEqual([])
    })
  })

  describe('selectLabel', () => {
    it('selects label matching current override', () => {
      const languageStore = useLanguageStore()
      languageStore.setPriorities(['en', 'nl'])
      languageStore.setCurrent('nl')

      const { selectLabel } = useLabelResolver()
      const labels = [
        { value: 'english', lang: 'en' },
        { value: 'dutch', lang: 'nl' },
      ]

      const result = selectLabel(labels)
      expect(result?.lang).toBe('nl')
    })

    it('selects first priority match when no override', () => {
      const languageStore = useLanguageStore()
      languageStore.setPriorities(['de', 'en'])
      languageStore.setCurrent(null)

      const { selectLabel } = useLabelResolver()
      const labels = [
        { value: 'english', lang: 'en' },
        { value: 'german', lang: 'de' },
      ]

      const result = selectLabel(labels)
      expect(result?.lang).toBe('de')
    })

    it('falls back to no-lang label when no priority match', () => {
      const languageStore = useLanguageStore()
      languageStore.setPriorities(['fr'])

      const { selectLabel } = useLabelResolver()
      const labels = [
        { value: 'english', lang: 'en' },
        { value: 'no-lang', lang: undefined },
      ]

      const result = selectLabel(labels)
      expect(result?.value).toBe('no-lang')
    })

    it('returns null for empty array', () => {
      const { selectLabel } = useLabelResolver()
      expect(selectLabel([])).toBeNull()
    })
  })

  describe('selectLabelWithXL', () => {
    it('prefers regular labels over XL labels', () => {
      const languageStore = useLanguageStore()
      languageStore.setPriorities(['en'])

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
      languageStore.setPriorities(['en'])

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
    it('returns false when lang matches display language', () => {
      const languageStore = useLanguageStore()
      languageStore.setPriorities(['en', 'nl'])

      const { shouldShowLangTag } = useLabelResolver()
      expect(shouldShowLangTag('en')).toBe(false)
    })

    it('returns true when lang differs from display language', () => {
      const languageStore = useLanguageStore()
      languageStore.setPriorities(['en', 'nl'])

      const { shouldShowLangTag } = useLabelResolver()
      expect(shouldShowLangTag('fr')).toBe(true)
    })

    it('returns false for undefined/empty lang', () => {
      const { shouldShowLangTag } = useLabelResolver()
      expect(shouldShowLangTag()).toBe(false)
      expect(shouldShowLangTag('')).toBe(false)
    })
  })
})
