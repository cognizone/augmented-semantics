/**
 * useLanguagePriorities Composable Tests
 *
 * Tests for language priority management composable.
 * @see /spec/common/com01-EndpointManager.md
 */
import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useLanguagePriorities } from '../useLanguagePriorities'
import type { SPARQLEndpoint } from '../../types'

function createEndpoint(overrides: Partial<SPARQLEndpoint> = {}): SPARQLEndpoint {
  return {
    id: 'test-1',
    name: 'Test Endpoint',
    url: 'https://example.org/sparql',
    createdAt: '2024-01-01',
    accessCount: 0,
    ...overrides,
  }
}

describe('useLanguagePriorities', () => {
  describe('loadPriorities', () => {
    it('uses existing priorities when available', () => {
      const endpoint = ref(createEndpoint({
        languagePriorities: ['fr', 'de', 'en'],
        analysis: {
          languages: [
            { lang: 'en', count: 100 },
            { lang: 'fr', count: 80 },
            { lang: 'de', count: 60 },
          ],
          analyzedAt: '2024-01-01',
        },
      }))

      const { priorities, loadPriorities } = useLanguagePriorities(endpoint)
      loadPriorities(endpoint.value)

      expect(priorities.value).toEqual(['fr', 'de', 'en'])
    })

    it('generates default order when no existing priorities', () => {
      const endpoint = ref(createEndpoint({
        analysis: {
          languages: [
            { lang: 'fr', count: 80 },
            { lang: 'de', count: 60 },
            { lang: 'en', count: 100 },
          ],
          analyzedAt: '2024-01-01',
        },
      }))

      const { priorities, loadPriorities } = useLanguagePriorities(endpoint)
      loadPriorities(endpoint.value)

      // 'en' should be first, then alphabetical
      expect(priorities.value).toEqual(['en', 'de', 'fr'])
    })

    it('puts en first in default ordering', () => {
      const endpoint = ref(createEndpoint({
        analysis: {
          languages: [
            { lang: 'zh', count: 100 },
            { lang: 'ar', count: 80 },
            { lang: 'en', count: 60 },
          ],
          analyzedAt: '2024-01-01',
        },
      }))

      const { priorities, loadPriorities } = useLanguagePriorities(endpoint)
      loadPriorities(endpoint.value)

      expect(priorities.value[0]).toBe('en')
    })

    it('handles empty languages array', () => {
      const endpoint = ref(createEndpoint({
        analysis: {
          languages: [],
          analyzedAt: '2024-01-01',
        },
      }))

      const { priorities, loadPriorities } = useLanguagePriorities(endpoint)
      loadPriorities(endpoint.value)

      expect(priorities.value).toEqual([])
    })

    it('handles missing analysis', () => {
      const endpoint = ref(createEndpoint())

      const { priorities, loadPriorities } = useLanguagePriorities(endpoint)
      loadPriorities(endpoint.value)

      expect(priorities.value).toEqual([])
    })
  })

  describe('savePriorities', () => {
    it('returns correct format with endpoint id', () => {
      const endpoint = ref(createEndpoint({ id: 'my-endpoint' }))

      const { priorities, savePriorities } = useLanguagePriorities(endpoint)
      priorities.value = ['en', 'fr', 'de']

      const result = savePriorities(endpoint.value)

      expect(result).toEqual({
        id: 'my-endpoint',
        languagePriorities: ['en', 'fr', 'de'],
      })
    })

    it('creates a copy of priorities array', () => {
      const endpoint = ref(createEndpoint())

      const { priorities, savePriorities } = useLanguagePriorities(endpoint)
      priorities.value = ['en', 'fr']

      const result = savePriorities(endpoint.value)

      // Modifying original should not affect saved result
      priorities.value.push('de')
      expect(result.languagePriorities).toEqual(['en', 'fr'])
    })
  })

  describe('getLanguageCount', () => {
    it('returns count for existing language', () => {
      const endpoint = ref(createEndpoint({
        analysis: {
          languages: [
            { lang: 'en', count: 12456 },
            { lang: 'fr', count: 8901 },
          ],
          analyzedAt: '2024-01-01',
        },
      }))

      const { getLanguageCount } = useLanguagePriorities(endpoint)

      expect(getLanguageCount('en')).toBe(12456)
      expect(getLanguageCount('fr')).toBe(8901)
    })

    it('returns undefined for non-existent language', () => {
      const endpoint = ref(createEndpoint({
        analysis: {
          languages: [{ lang: 'en', count: 100 }],
          analyzedAt: '2024-01-01',
        },
      }))

      const { getLanguageCount } = useLanguagePriorities(endpoint)

      expect(getLanguageCount('de')).toBeUndefined()
    })

    it('returns undefined when no analysis', () => {
      const endpoint = ref(createEndpoint())

      const { getLanguageCount } = useLanguagePriorities(endpoint)

      expect(getLanguageCount('en')).toBeUndefined()
    })
  })

  describe('getLanguageName', () => {
    it('returns full name for known language codes', () => {
      const endpoint = ref<SPARQLEndpoint | null>(null)
      const { getLanguageName } = useLanguagePriorities(endpoint)

      expect(getLanguageName('en')).toBe('English')
      expect(getLanguageName('fr')).toBe('French')
      expect(getLanguageName('de')).toBe('German')
      expect(getLanguageName('es')).toBe('Spanish')
      expect(getLanguageName('it')).toBe('Italian')
      expect(getLanguageName('nl')).toBe('Dutch')
      expect(getLanguageName('ja')).toBe('Japanese')
      expect(getLanguageName('zh')).toBe('Chinese')
    })

    it('returns uppercase code for unknown languages', () => {
      const endpoint = ref<SPARQLEndpoint | null>(null)
      const { getLanguageName } = useLanguagePriorities(endpoint)

      expect(getLanguageName('xyz')).toBe('XYZ')
      expect(getLanguageName('foo')).toBe('FOO')
    })
  })

  describe('getPriorityLabel', () => {
    it('returns "Default fallback" for index 0', () => {
      const endpoint = ref<SPARQLEndpoint | null>(null)
      const { getPriorityLabel } = useLanguagePriorities(endpoint)

      expect(getPriorityLabel(0)).toBe('Default fallback')
    })

    it('returns "2nd priority" for index 1', () => {
      const endpoint = ref<SPARQLEndpoint | null>(null)
      const { getPriorityLabel } = useLanguagePriorities(endpoint)

      expect(getPriorityLabel(1)).toBe('2nd priority')
    })

    it('returns "3rd priority" for index 2', () => {
      const endpoint = ref<SPARQLEndpoint | null>(null)
      const { getPriorityLabel } = useLanguagePriorities(endpoint)

      expect(getPriorityLabel(2)).toBe('3rd priority')
    })

    it('returns "4th priority" for index 3 and beyond', () => {
      const endpoint = ref<SPARQLEndpoint | null>(null)
      const { getPriorityLabel } = useLanguagePriorities(endpoint)

      expect(getPriorityLabel(3)).toBe('4th priority')
      expect(getPriorityLabel(4)).toBe('5th priority')
      expect(getPriorityLabel(10)).toBe('11th priority')
    })
  })

  describe('getBadgeColor', () => {
    it('returns first color for index 0', () => {
      const endpoint = ref<SPARQLEndpoint | null>(null)
      const { getBadgeColor } = useLanguagePriorities(endpoint)

      const color = getBadgeColor(0)
      expect(color).toHaveProperty('bg')
      expect(color).toHaveProperty('text')
      expect(color.bg).toBe('bg-blue')
    })

    it('cycles through colors for indices beyond palette size', () => {
      const endpoint = ref<SPARQLEndpoint | null>(null)
      const { getBadgeColor } = useLanguagePriorities(endpoint)

      // Should cycle back to first color
      const color0 = getBadgeColor(0)
      const color6 = getBadgeColor(6)
      expect(color0).toEqual(color6)
    })

    it('returns different colors for consecutive indices', () => {
      const endpoint = ref<SPARQLEndpoint | null>(null)
      const { getBadgeColor } = useLanguagePriorities(endpoint)

      const color0 = getBadgeColor(0)
      const color1 = getBadgeColor(1)
      const color2 = getBadgeColor(2)

      expect(color0.bg).not.toBe(color1.bg)
      expect(color1.bg).not.toBe(color2.bg)
    })
  })

  describe('removeLanguage', () => {
    it('removes language from priorities', () => {
      const endpoint = ref(createEndpoint())
      const { priorities, removeLanguage } = useLanguagePriorities(endpoint)

      priorities.value = ['en', 'fr', 'de']
      removeLanguage('fr')

      expect(priorities.value).toEqual(['en', 'de'])
    })

    it('does nothing when language not in list', () => {
      const endpoint = ref(createEndpoint())
      const { priorities, removeLanguage } = useLanguagePriorities(endpoint)

      priorities.value = ['en', 'fr']
      removeLanguage('de')

      expect(priorities.value).toEqual(['en', 'fr'])
    })

    it('handles removing last item', () => {
      const endpoint = ref(createEndpoint())
      const { priorities, removeLanguage } = useLanguagePriorities(endpoint)

      priorities.value = ['en']
      removeLanguage('en')

      expect(priorities.value).toEqual([])
    })
  })

  describe('clearPriorities', () => {
    it('empties the priorities array', () => {
      const endpoint = ref(createEndpoint())
      const { priorities, clearPriorities } = useLanguagePriorities(endpoint)

      priorities.value = ['en', 'fr', 'de']
      clearPriorities()

      expect(priorities.value).toEqual([])
    })
  })

  describe('onReorder', () => {
    it('updates priorities from reorder event', () => {
      const endpoint = ref(createEndpoint())
      const { priorities, onReorder } = useLanguagePriorities(endpoint)

      priorities.value = ['en', 'fr', 'de']
      onReorder({ value: ['de', 'en', 'fr'] })

      expect(priorities.value).toEqual(['de', 'en', 'fr'])
    })
  })

  describe('endpointLanguages', () => {
    it('returns languages from endpoint analysis', () => {
      const endpoint = ref(createEndpoint({
        analysis: {
          languages: [
            { lang: 'en', count: 100 },
            { lang: 'fr', count: 80 },
          ],
          analyzedAt: '2024-01-01',
        },
      }))

      const { endpointLanguages } = useLanguagePriorities(endpoint)

      expect(endpointLanguages.value).toEqual([
        { lang: 'en', count: 100 },
        { lang: 'fr', count: 80 },
      ])
    })

    it('returns empty array when no analysis', () => {
      const endpoint = ref(createEndpoint())

      const { endpointLanguages } = useLanguagePriorities(endpoint)

      expect(endpointLanguages.value).toEqual([])
    })

    it('returns empty array when endpoint is null', () => {
      const endpoint = ref<SPARQLEndpoint | null>(null)

      const { endpointLanguages } = useLanguagePriorities(endpoint)

      expect(endpointLanguages.value).toEqual([])
    })
  })
})
