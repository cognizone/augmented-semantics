/**
 * useProgressiveLabelLoader Composable Tests
 *
 * Tests for progressive label loading by language priority.
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProgressiveLabelLoader } from '../useProgressiveLabelLoader'
import { useLanguageStore, useEndpointStore } from '../../stores'
import { executeSparql } from '../../services/sparql'
import type { Mock } from 'vitest'

// Mock logger
vi.mock('../../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock SPARQL service
vi.mock('../../services/sparql', () => ({
  executeSparql: vi.fn(),
  withPrefixes: vi.fn((q: string) => q),
}))

describe('useProgressiveLabelLoader', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    // Set up default language
    const languageStore = useLanguageStore()
    languageStore.setPreferred('en')

    // Set up default endpoint
    const endpointStore = useEndpointStore()
    endpointStore.addEndpoint({
      name: 'Test Endpoint',
      url: 'https://example.org/sparql',
    })
    endpointStore.selectEndpoint(endpointStore.endpoints[0].id)
  })

  describe('getLanguagePriorities', () => {
    it('returns preferred language first', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('fr')

      const { getLanguagePriorities } = useProgressiveLabelLoader()
      const priorities = getLanguagePriorities(5)

      expect(priorities[0]).toBe('fr')
    })

    it('includes endpoint language priorities after preferred', () => {
      const languageStore = useLanguageStore()
      const endpointStore = useEndpointStore()

      languageStore.setPreferred('en')
      endpointStore.current!.languagePriorities = ['de', 'fr', 'es']

      const { getLanguagePriorities } = useProgressiveLabelLoader()
      const priorities = getLanguagePriorities(5)

      expect(priorities).toEqual(['en', 'de', 'fr', 'es'])
    })

    it('excludes preferred language from endpoint priorities to avoid duplicates', () => {
      const languageStore = useLanguageStore()
      const endpointStore = useEndpointStore()

      languageStore.setPreferred('de')
      endpointStore.current!.languagePriorities = ['en', 'de', 'fr']

      const { getLanguagePriorities } = useProgressiveLabelLoader()
      const priorities = getLanguagePriorities(5)

      // 'de' should only appear once (as preferred)
      expect(priorities).toEqual(['de', 'en', 'fr'])
      expect(priorities.filter(l => l === 'de')).toHaveLength(1)
    })

    it('limits to maxIterations', () => {
      const languageStore = useLanguageStore()
      const endpointStore = useEndpointStore()

      languageStore.setPreferred('en')
      endpointStore.current!.languagePriorities = ['de', 'fr', 'es', 'it', 'pt', 'nl']

      const { getLanguagePriorities } = useProgressiveLabelLoader()
      const priorities = getLanguagePriorities(3)

      expect(priorities).toHaveLength(3)
      expect(priorities).toEqual(['en', 'de', 'fr'])
    })

    it('handles empty endpoint priorities', () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { getLanguagePriorities } = useProgressiveLabelLoader()
      const priorities = getLanguagePriorities(5)

      expect(priorities).toEqual(['en'])
    })
  })

  describe('queryLabelsForLanguage', () => {
    it('returns empty map when no endpoint selected', async () => {
      const endpointStore = useEndpointStore()
      endpointStore.selectEndpoint(null as any)

      const { queryLabelsForLanguage } = useProgressiveLabelLoader()
      const result = await queryLabelsForLanguage(
        ['http://ex.org/c1'],
        'en',
        'concept'
      )

      expect(result.size).toBe(0)
      expect(executeSparql).not.toHaveBeenCalled()
    })

    it('returns empty map for empty URIs array', async () => {
      const { queryLabelsForLanguage } = useProgressiveLabelLoader()
      const result = await queryLabelsForLanguage([], 'en', 'concept')

      expect(result.size).toBe(0)
      expect(executeSparql).not.toHaveBeenCalled()
    })

    it('executes SPARQL query with VALUES clause', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            {
              concept: { value: 'http://ex.org/c1' },
              label: { value: 'Concept One' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
            },
          ],
        },
      })

      const { queryLabelsForLanguage } = useProgressiveLabelLoader()
      await queryLabelsForLanguage(
        ['http://ex.org/c1', 'http://ex.org/c2'],
        'en',
        'concept'
      )

      expect(executeSparql).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('<http://ex.org/c1>'),
        expect.objectContaining({ retries: 0 })
      )
      expect(executeSparql).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('<http://ex.org/c2>'),
        expect.anything()
      )
    })

    it('returns resolved labels as map', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            {
              concept: { value: 'http://ex.org/c1' },
              label: { value: 'Concept One' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
            },
            {
              concept: { value: 'http://ex.org/c2' },
              label: { value: 'Concept Two' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
            },
          ],
        },
      })

      const { queryLabelsForLanguage } = useProgressiveLabelLoader()
      const result = await queryLabelsForLanguage(
        ['http://ex.org/c1', 'http://ex.org/c2'],
        'en',
        'concept'
      )

      expect(result.size).toBe(2)
      expect(result.get('http://ex.org/c1')).toEqual({ value: 'Concept One', lang: 'en' })
      expect(result.get('http://ex.org/c2')).toEqual({ value: 'Concept Two', lang: 'en' })
    })

    it('returns empty map on query failure', async () => {
      ;(executeSparql as Mock).mockRejectedValue(new Error('Query failed'))

      const { queryLabelsForLanguage } = useProgressiveLabelLoader()
      const result = await queryLabelsForLanguage(
        ['http://ex.org/c1'],
        'en',
        'concept'
      )

      expect(result.size).toBe(0)
    })

    it('passes abort signal to executeSparql', async () => {
      ;(executeSparql as Mock).mockResolvedValue({ results: { bindings: [] } })

      const controller = new AbortController()
      const { queryLabelsForLanguage } = useProgressiveLabelLoader()
      await queryLabelsForLanguage(
        ['http://ex.org/c1'],
        'en',
        'concept',
        controller.signal
      )

      expect(executeSparql).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ signal: controller.signal })
      )
    })
  })

  describe('queryAllLabels', () => {
    it('returns empty map when no endpoint selected', async () => {
      const endpointStore = useEndpointStore()
      endpointStore.selectEndpoint(null as any)

      const { queryAllLabels } = useProgressiveLabelLoader()
      const result = await queryAllLabels(['http://ex.org/c1'], 'concept')

      expect(result.size).toBe(0)
      expect(executeSparql).not.toHaveBeenCalled()
    })

    it('returns empty map for empty URIs array', async () => {
      const { queryAllLabels } = useProgressiveLabelLoader()
      const result = await queryAllLabels([], 'concept')

      expect(result.size).toBe(0)
      expect(executeSparql).not.toHaveBeenCalled()
    })

    it('executes full label query with OPTIONAL', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: { bindings: [] },
      })

      const { queryAllLabels } = useProgressiveLabelLoader()
      await queryAllLabels(['http://ex.org/c1'], 'concept')

      expect(executeSparql).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('OPTIONAL'),
        expect.anything()
      )
    })

    it('returns resolved labels from multiple types', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            {
              concept: { value: 'http://ex.org/c1' },
              label: { value: 'Pref Label' },
              labelLang: { value: 'en' },
              labelType: { value: 'prefLabel' },
            },
            {
              concept: { value: 'http://ex.org/c1' },
              label: { value: 'RDFS Label' },
              labelLang: { value: 'en' },
              labelType: { value: 'rdfsLabel' },
            },
          ],
        },
      })

      const { queryAllLabels } = useProgressiveLabelLoader()
      const result = await queryAllLabels(['http://ex.org/c1'], 'concept')

      // Should pick prefLabel over rdfsLabel
      expect(result.get('http://ex.org/c1')?.value).toBe('Pref Label')
    })
  })

  describe('processLabelResults (via queryLabelsForLanguage)', () => {
    it('groups labels by concept URI', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { concept: { value: 'http://ex.org/c1' }, label: { value: 'Label A' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
            { concept: { value: 'http://ex.org/c1' }, label: { value: 'Label B' }, labelLang: { value: 'fr' }, labelType: { value: 'prefLabel' } },
            { concept: { value: 'http://ex.org/c2' }, label: { value: 'Label C' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      const languageStore = useLanguageStore()
      languageStore.setPreferred('en')

      const { queryLabelsForLanguage } = useProgressiveLabelLoader()
      const result = await queryLabelsForLanguage(['http://ex.org/c1', 'http://ex.org/c2'], 'en', 'concept')

      expect(result.size).toBe(2)
      expect(result.get('http://ex.org/c1')?.value).toBe('Label A') // preferred lang
      expect(result.get('http://ex.org/c2')?.value).toBe('Label C')
    })

    it('picks label by type priority: prefLabel > xlPrefLabel > rdfsLabel', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { concept: { value: 'http://ex.org/c1' }, label: { value: 'RDFS' }, labelLang: { value: 'en' }, labelType: { value: 'rdfsLabel' } },
            { concept: { value: 'http://ex.org/c1' }, label: { value: 'Pref' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
            { concept: { value: 'http://ex.org/c1' }, label: { value: 'XL' }, labelLang: { value: 'en' }, labelType: { value: 'xlPrefLabel' } },
          ],
        },
      })

      const { queryAllLabels } = useProgressiveLabelLoader()
      const result = await queryAllLabels(['http://ex.org/c1'], 'concept')

      expect(result.get('http://ex.org/c1')?.value).toBe('Pref')
    })

    it('picks preferred language within same type', async () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('fr')

      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { concept: { value: 'http://ex.org/c1' }, label: { value: 'English' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
            { concept: { value: 'http://ex.org/c1' }, label: { value: 'French' }, labelLang: { value: 'fr' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      const { queryAllLabels } = useProgressiveLabelLoader()
      const result = await queryAllLabels(['http://ex.org/c1'], 'concept')

      expect(result.get('http://ex.org/c1')?.value).toBe('French')
    })

    it('falls back to endpoint language priorities', async () => {
      const languageStore = useLanguageStore()
      const endpointStore = useEndpointStore()

      languageStore.setPreferred('es') // not available
      endpointStore.current!.languagePriorities = ['de', 'fr']

      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { concept: { value: 'http://ex.org/c1' }, label: { value: 'German' }, labelLang: { value: 'de' }, labelType: { value: 'prefLabel' } },
            { concept: { value: 'http://ex.org/c1' }, label: { value: 'French' }, labelLang: { value: 'fr' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      const { queryAllLabels } = useProgressiveLabelLoader()
      const result = await queryAllLabels(['http://ex.org/c1'], 'concept')

      expect(result.get('http://ex.org/c1')?.value).toBe('German') // first in priorities
    })

    it('falls back to no-lang label', async () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('es') // not available

      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { concept: { value: 'http://ex.org/c1' }, label: { value: 'No Lang' }, labelLang: { value: '' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      const { queryAllLabels } = useProgressiveLabelLoader()
      const result = await queryAllLabels(['http://ex.org/c1'], 'concept')

      expect(result.get('http://ex.org/c1')?.value).toBe('No Lang')
      expect(result.get('http://ex.org/c1')?.lang).toBeUndefined()
    })

    it('skips bindings without concept or label', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { concept: { value: 'http://ex.org/c1' }, label: { value: 'Valid' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
            { label: { value: 'No Concept' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
            { concept: { value: 'http://ex.org/c2' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      const { queryAllLabels } = useProgressiveLabelLoader()
      const result = await queryAllLabels(['http://ex.org/c1', 'http://ex.org/c2'], 'concept')

      expect(result.size).toBe(1)
      expect(result.has('http://ex.org/c1')).toBe(true)
    })

    it('defaults to prefLabel type when labelType missing', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { concept: { value: 'http://ex.org/c1' }, label: { value: 'Default Type' }, labelLang: { value: 'en' } },
          ],
        },
      })

      const { queryAllLabels } = useProgressiveLabelLoader()
      const result = await queryAllLabels(['http://ex.org/c1'], 'concept')

      expect(result.get('http://ex.org/c1')?.value).toBe('Default Type')
    })
  })

  describe('loadLabelsProgressively', () => {
    it('returns immediately for empty URIs array', async () => {
      const callback = vi.fn()
      const { loadLabelsProgressively } = useProgressiveLabelLoader()

      await loadLabelsProgressively([], 'concept', callback)

      expect(callback).not.toHaveBeenCalled()
      expect(executeSparql).not.toHaveBeenCalled()
    })

    it('calls callback with resolved labels', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { concept: { value: 'http://ex.org/c1' }, label: { value: 'Label' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      const callback = vi.fn()
      const { loadLabelsProgressively } = useProgressiveLabelLoader()

      await loadLabelsProgressively(['http://ex.org/c1'], 'concept', callback)

      expect(callback).toHaveBeenCalled()
      const calledWith = callback.mock.calls[0][0]
      expect(calledWith.get('http://ex.org/c1')?.value).toBe('Label')
    })

    it('removes resolved concepts from remaining list', async () => {
      // First query resolves c1
      ;(executeSparql as Mock)
        .mockResolvedValueOnce({
          results: {
            bindings: [
              { concept: { value: 'http://ex.org/c1' }, label: { value: 'C1' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
            ],
          },
        })
        // Second query (full) only gets c2
        .mockResolvedValueOnce({
          results: {
            bindings: [
              { concept: { value: 'http://ex.org/c2' }, label: { value: 'C2' }, labelLang: { value: 'de' }, labelType: { value: 'prefLabel' } },
            ],
          },
        })

      const callback = vi.fn()
      const { loadLabelsProgressively } = useProgressiveLabelLoader()

      await loadLabelsProgressively(
        ['http://ex.org/c1', 'http://ex.org/c2'],
        'concept',
        callback,
        { threshold: 1 } // Low threshold to trigger full query after first
      )

      // Second call should not include c1
      const secondQuery = (executeSparql as Mock).mock.calls[1][1]
      expect(secondQuery).not.toContain('<http://ex.org/c1>')
      expect(secondQuery).toContain('<http://ex.org/c2>')
    })

    it('switches to full query when remaining <= threshold', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: { bindings: [] },
      })

      const { loadLabelsProgressively } = useProgressiveLabelLoader()

      await loadLabelsProgressively(
        ['http://ex.org/c1', 'http://ex.org/c2', 'http://ex.org/c3'],
        'concept',
        vi.fn(),
        { threshold: 5 } // All concepts below threshold
      )

      // Should go directly to full query (with OPTIONAL)
      expect(executeSparql).toHaveBeenCalledTimes(1)
      expect((executeSparql as Mock).mock.calls[0][1]).toContain('OPTIONAL')
    })

    it('respects abort signal', async () => {
      const controller = new AbortController()
      controller.abort()

      const callback = vi.fn()
      const { loadLabelsProgressively } = useProgressiveLabelLoader()

      await loadLabelsProgressively(
        ['http://ex.org/c1'],
        'concept',
        callback,
        { signal: controller.signal, threshold: 0 }
      )

      // Should not execute any queries when already aborted
      expect(callback).not.toHaveBeenCalled()
    })

    it('iterates through multiple languages', async () => {
      const languageStore = useLanguageStore()
      const endpointStore = useEndpointStore()

      languageStore.setPreferred('en')
      endpointStore.current!.languagePriorities = ['de', 'fr']

      // First query (en) - no results
      ;(executeSparql as Mock)
        .mockResolvedValueOnce({ results: { bindings: [] } })
        // Second query (de) - partial results
        .mockResolvedValueOnce({
          results: {
            bindings: [
              { concept: { value: 'http://ex.org/c1' }, label: { value: 'German' }, labelLang: { value: 'de' }, labelType: { value: 'prefLabel' } },
            ],
          },
        })
        // Third query (fr) - more results
        .mockResolvedValueOnce({
          results: {
            bindings: [
              { concept: { value: 'http://ex.org/c2' }, label: { value: 'French' }, labelLang: { value: 'fr' }, labelType: { value: 'prefLabel' } },
            ],
          },
        })
        // Final full query
        .mockResolvedValueOnce({ results: { bindings: [] } })

      const callback = vi.fn()
      const { loadLabelsProgressively } = useProgressiveLabelLoader()

      await loadLabelsProgressively(
        Array.from({ length: 10 }, (_, i) => `http://ex.org/c${i + 1}`),
        'concept',
        callback,
        { threshold: 5, maxLanguageIterations: 3 }
      )

      // Should have made multiple queries
      expect((executeSparql as Mock).mock.calls.length).toBeGreaterThan(1)
    })

    it('respects maxLanguageIterations', async () => {
      const languageStore = useLanguageStore()
      const endpointStore = useEndpointStore()

      languageStore.setPreferred('en')
      endpointStore.current!.languagePriorities = ['de', 'fr', 'es', 'it', 'pt']

      ;(executeSparql as Mock).mockResolvedValue({ results: { bindings: [] } })

      const { loadLabelsProgressively } = useProgressiveLabelLoader()

      await loadLabelsProgressively(
        Array.from({ length: 20 }, (_, i) => `http://ex.org/c${i + 1}`),
        'concept',
        vi.fn(),
        { threshold: 0, maxLanguageIterations: 2 }
      )

      // Should only iterate 2 languages + final full query = 3 calls
      expect(executeSparql).toHaveBeenCalledTimes(3)
    })

    it('uses concept label priority for concept resourceType', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { concept: { value: 'http://ex.org/c1' }, label: { value: 'RDFS Label' }, labelLang: { value: 'en' }, labelType: { value: 'rdfsLabel' } },
            { concept: { value: 'http://ex.org/c1' }, label: { value: 'XL PrefLabel' }, labelLang: { value: 'en' }, labelType: { value: 'xlPrefLabel' } },
          ],
        },
      })

      const callback = vi.fn()
      const { loadLabelsProgressively } = useProgressiveLabelLoader()

      await loadLabelsProgressively(['http://ex.org/c1'], 'concept', callback, { threshold: 5 })

      const result = callback.mock.calls[0][0]
      // CONCEPT_LABEL_PRIORITY: prefLabel > xlPrefLabel > rdfsLabel
      expect(result.get('http://ex.org/c1')?.value).toBe('XL PrefLabel')
    })

    it('uses scheme label priority for scheme resourceType', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            { concept: { value: 'http://ex.org/s1' }, label: { value: 'DCT Title' }, labelLang: { value: 'en' }, labelType: { value: 'dctTitle' } },
            { concept: { value: 'http://ex.org/s1' }, label: { value: 'RDFS Label' }, labelLang: { value: 'en' }, labelType: { value: 'rdfsLabel' } },
          ],
        },
      })

      const callback = vi.fn()
      const { loadLabelsProgressively } = useProgressiveLabelLoader()

      await loadLabelsProgressively(['http://ex.org/s1'], 'scheme', callback, { threshold: 5 })

      const result = callback.mock.calls[0][0]
      // LABEL_PRIORITY for schemes has dctTitle before rdfsLabel
      expect(result.get('http://ex.org/s1')?.value).toBe('DCT Title')
    })
  })
})
