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

    it('places xsd:string (no-lang) labels first', () => {
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
      expect(result[0]?.lang).toBeUndefined() // xsd:string first
      expect(result[1]?.lang).toBe('en')      // preferred
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

  describe('selectConceptLabel', () => {
    it('selects prefLabel over rdfsLabel', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectConceptLabel } = useLabelResolver()
      const result = selectConceptLabel({
        prefLabels: [{ value: 'prefLabel value', lang: 'en' }],
        rdfsLabels: [{ value: 'rdfs value', lang: 'en' }],
      })

      expect(result?.value).toBe('prefLabel value')
    })

    it('falls back to xlPrefLabel when no prefLabel', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectConceptLabel } = useLabelResolver()
      const result = selectConceptLabel({
        prefLabels: [],
        prefLabelsXL: [{
          uri: 'http://example.org/xl',
          literalForm: { value: 'xl value', lang: 'en' }
        }],
        rdfsLabels: [{ value: 'rdfs value', lang: 'en' }],
      })

      expect(result?.value).toBe('xl value')
    })

    it('falls back to rdfsLabel when no prefLabel or xlPrefLabel', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectConceptLabel } = useLabelResolver()
      const result = selectConceptLabel({
        prefLabels: [],
        prefLabelsXL: [],
        rdfsLabels: [{ value: 'rdfs value', lang: 'en' }],
      })

      expect(result?.value).toBe('rdfs value')
    })

    it('returns null when no labels available', () => {
      const { selectConceptLabel } = useLabelResolver()
      const result = selectConceptLabel({})

      expect(result).toBeNull()
    })
  })

  describe('selectSchemeLabel', () => {
    it('selects prefLabel over dctTitle and rdfsLabel', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectSchemeLabel } = useLabelResolver()
      const result = selectSchemeLabel({
        prefLabels: [{ value: 'prefLabel value', lang: 'en' }],
        dctTitles: [{ value: 'dctTitle value', lang: 'en' }],
        rdfsLabels: [{ value: 'rdfs value', lang: 'en' }],
      })

      expect(result?.value).toBe('prefLabel value')
    })

    it('falls back to dctTitle when no prefLabel', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectSchemeLabel } = useLabelResolver()
      const result = selectSchemeLabel({
        prefLabels: [],
        dctTitles: [{ value: 'dctTitle value', lang: 'en' }],
        rdfsLabels: [{ value: 'rdfs value', lang: 'en' }],
      })

      expect(result?.value).toBe('dctTitle value')
    })

    it('falls back to dcTitle when no prefLabel or dctTitle', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectSchemeLabel } = useLabelResolver()
      const result = selectSchemeLabel({
        prefLabels: [],
        dctTitles: [],
        dcTitles: [{ value: 'dcTitle value', lang: 'en' }],
        rdfsLabels: [{ value: 'rdfs value', lang: 'en' }],
      })

      expect(result?.value).toBe('dcTitle value')
    })

    it('falls back to rdfsLabel when no prefLabel or titles', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectSchemeLabel } = useLabelResolver()
      const result = selectSchemeLabel({
        prefLabels: [],
        dctTitles: [],
        dcTitles: [],
        rdfsLabels: [{ value: 'rdfs value', lang: 'en' }],
      })

      expect(result?.value).toBe('rdfs value')
    })

    it('returns null when no labels available', () => {
      const { selectSchemeLabel } = useLabelResolver()
      const result = selectSchemeLabel({})

      expect(result).toBeNull()
    })

    it('respects language priority within each label type', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('fr')

      const { selectSchemeLabel } = useLabelResolver()
      const result = selectSchemeLabel({
        prefLabels: [],
        dctTitles: [
          { value: 'English title', lang: 'en' },
          { value: 'French title', lang: 'fr' },
        ],
      })

      expect(result?.value).toBe('French title')
      expect(result?.lang).toBe('fr')
    })

    it('prefers dctTitle over dcTitle', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectSchemeLabel } = useLabelResolver()
      const result = selectSchemeLabel({
        prefLabels: [],
        dctTitles: [{ value: 'DCT Title', lang: 'en' }],
        dcTitles: [{ value: 'DC Title', lang: 'en' }],
        rdfsLabels: [{ value: 'rdfs value', lang: 'en' }],
      })

      expect(result?.value).toBe('DCT Title')
    })
  })

  describe('selectCollectionLabel', () => {
    it('selects prefLabel over dctTitle and rdfsLabel', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectCollectionLabel } = useLabelResolver()
      const result = selectCollectionLabel({
        prefLabels: [{ value: 'prefLabel value', lang: 'en' }],
        dctTitles: [{ value: 'dctTitle value', lang: 'en' }],
        rdfsLabels: [{ value: 'rdfs value', lang: 'en' }],
      })

      expect(result?.value).toBe('prefLabel value')
    })

    it('falls back to xlPrefLabel when no prefLabel', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectCollectionLabel } = useLabelResolver()
      const result = selectCollectionLabel({
        prefLabels: [],
        prefLabelsXL: [{
          uri: 'http://example.org/xl',
          literalForm: { value: 'xl value', lang: 'en' }
        }],
        rdfsLabels: [{ value: 'rdfs value', lang: 'en' }],
      })

      expect(result?.value).toBe('xl value')
    })

    it('falls back to dctTitle when no prefLabel', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectCollectionLabel } = useLabelResolver()
      const result = selectCollectionLabel({
        prefLabels: [],
        dctTitles: [{ value: 'dctTitle value', lang: 'en' }],
        rdfsLabels: [{ value: 'rdfs value', lang: 'en' }],
      })

      expect(result?.value).toBe('dctTitle value')
    })

    it('falls back to dcTitle when no prefLabel or dctTitle', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectCollectionLabel } = useLabelResolver()
      const result = selectCollectionLabel({
        prefLabels: [],
        dctTitles: [],
        dcTitles: [{ value: 'dcTitle value', lang: 'en' }],
        rdfsLabels: [{ value: 'rdfs value', lang: 'en' }],
      })

      expect(result?.value).toBe('dcTitle value')
    })

    it('falls back to rdfsLabel when no prefLabel or titles', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectCollectionLabel } = useLabelResolver()
      const result = selectCollectionLabel({
        prefLabels: [],
        dctTitles: [],
        dcTitles: [],
        rdfsLabels: [{ value: 'rdfs value', lang: 'en' }],
      })

      expect(result?.value).toBe('rdfs value')
    })

    it('returns null when no labels available', () => {
      const { selectCollectionLabel } = useLabelResolver()
      const result = selectCollectionLabel({})

      expect(result).toBeNull()
    })

    it('has same priority as selectSchemeLabel', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectCollectionLabel, selectSchemeLabel } = useLabelResolver()

      // Both should pick dctTitle when no prefLabel
      const labels = {
        prefLabels: [],
        dctTitles: [{ value: 'DCT Title', lang: 'en' }],
        dcTitles: [{ value: 'DC Title', lang: 'en' }],
        rdfsLabels: [{ value: 'RDFS Label', lang: 'en' }],
      }

      const collectionResult = selectCollectionLabel(labels)
      const schemeResult = selectSchemeLabel(labels)

      expect(collectionResult?.value).toBe(schemeResult?.value)
    })
  })

  describe('selectLabelByPriority', () => {
    it('selects prefLabel over other types', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectLabelByPriority } = useLabelResolver()
      const labels = [
        { value: 'RDFS Label', lang: 'en', type: 'rdfsLabel' },
        { value: 'Pref Label', lang: 'en', type: 'prefLabel' },
        { value: 'DCT Title', lang: 'en', type: 'dctTitle' },
      ]

      const result = selectLabelByPriority(labels)
      expect(result?.value).toBe('Pref Label')
    })

    it('respects LABEL_PRIORITY order', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectLabelByPriority } = useLabelResolver()
      const labels = [
        { value: 'RDFS Label', lang: 'en', type: 'rdfsLabel' },
        { value: 'DCT Title', lang: 'en', type: 'dctTitle' },
        { value: 'DC Title', lang: 'en', type: 'dcTitle' },
      ]

      const result = selectLabelByPriority(labels)
      expect(result?.value).toBe('DCT Title') // dctTitle before dcTitle
    })

    it('respects language preference within type', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('fr')

      const { selectLabelByPriority } = useLabelResolver()
      const labels = [
        { value: 'English', lang: 'en', type: 'prefLabel' },
        { value: 'French', lang: 'fr', type: 'prefLabel' },
      ]

      const result = selectLabelByPriority(labels)
      expect(result?.value).toBe('French')
      expect(result?.lang).toBe('fr')
    })

    it('falls back to first available when no priority match', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectLabelByPriority } = useLabelResolver()
      const labels = [
        { value: 'Unknown Type', lang: 'en', type: 'unknownType' },
      ]

      const result = selectLabelByPriority(labels)
      expect(result?.value).toBe('Unknown Type')
    })

    it('returns undefined for empty array', () => {
      const { selectLabelByPriority } = useLabelResolver()
      const result = selectLabelByPriority([])
      expect(result).toBeUndefined()
    })

    it('handles xlPrefLabel type', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { selectLabelByPriority } = useLabelResolver()
      const labels = [
        { value: 'RDFS Label', lang: 'en', type: 'rdfsLabel' },
        { value: 'XL Pref Label', lang: 'en', type: 'xlPrefLabel' },
      ]

      const result = selectLabelByPriority(labels)
      expect(result?.value).toBe('XL Pref Label') // xlPrefLabel before rdfsLabel
    })
  })
})
