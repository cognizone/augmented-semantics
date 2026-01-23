/**
 * useConceptBindings Composable Tests
 *
 * Tests for SPARQL binding processing into ConceptNode[].
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useConceptBindings, type ConceptBinding } from '../useConceptBindings'

// Mock useLabelResolver
vi.mock('../useLabelResolver', () => ({
  useLabelResolver: () => ({
    selectLabel: vi.fn((labels: { value: string; lang: string }[]) => {
      // Simple mock: prefer 'en', then first available
      const enLabel = labels.find(l => l.lang === 'en')
      if (enLabel) return enLabel
      return labels[0]
    }),
  }),
}))

// Mock useDeprecation
vi.mock('../useDeprecation', () => ({
  useDeprecation: () => ({
    isDeprecatedFromBinding: vi.fn((binding: ConceptBinding) => {
      // Check for owl:deprecated = true
      return binding.deprecated?.value === 'true'
    }),
  }),
}))

describe('useConceptBindings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function createBinding(overrides: Partial<ConceptBinding>): ConceptBinding {
    return {
      concept: { type: 'uri', value: 'http://example.org/concept1' },
      ...overrides,
    }
  }

  describe('processBindings', () => {
    it('returns empty array for empty bindings', () => {
      const { processBindings } = useConceptBindings()

      const result = processBindings([])

      expect(result).toEqual([])
    })

    it('groups bindings by concept URI', () => {
      const { processBindings } = useConceptBindings()

      const bindings: ConceptBinding[] = [
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c1' },
          label: { type: 'literal', value: 'Label EN' },
          labelLang: { type: 'literal', value: 'en' },
          labelType: { type: 'literal', value: 'prefLabel' },
        }),
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c1' },
          label: { type: 'literal', value: 'Label FR' },
          labelLang: { type: 'literal', value: 'fr' },
          labelType: { type: 'literal', value: 'prefLabel' },
        }),
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c2' },
          label: { type: 'literal', value: 'Concept 2' },
          labelLang: { type: 'literal', value: 'en' },
          labelType: { type: 'literal', value: 'prefLabel' },
        }),
      ]

      const result = processBindings(bindings)

      expect(result).toHaveLength(2)
      expect(result.map(c => c.uri)).toContain('http://ex.org/c1')
      expect(result.map(c => c.uri)).toContain('http://ex.org/c2')
    })

    it('picks best label by type priority (prefLabel > xlPrefLabel > rdfsLabel)', () => {
      const { processBindings } = useConceptBindings()

      const bindings: ConceptBinding[] = [
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c1' },
          label: { type: 'literal', value: 'RDFS Label' },
          labelLang: { type: 'literal', value: 'en' },
          labelType: { type: 'literal', value: 'rdfsLabel' },
        }),
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c1' },
          label: { type: 'literal', value: 'Pref Label' },
          labelLang: { type: 'literal', value: 'en' },
          labelType: { type: 'literal', value: 'prefLabel' },
        }),
      ]

      const result = processBindings(bindings)

      expect(result[0]?.label).toBe('Pref Label')
    })

    it('ignores title properties for concepts when rdfsLabel exists', () => {
      const { processBindings } = useConceptBindings()

      const bindings: ConceptBinding[] = [
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c1' },
          label: { type: 'literal', value: 'RDFS Label' },
          labelLang: { type: 'literal', value: 'en' },
          labelType: { type: 'literal', value: 'rdfsLabel' },
        }),
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c1' },
          label: { type: 'literal', value: 'DC Title' },
          labelLang: { type: 'literal', value: 'en' },
          labelType: { type: 'literal', value: 'dcTitle' },
        }),
      ]

      const result = processBindings(bindings)

      expect(result[0]?.label).toBe('RDFS Label')
    })

    it('picks xlPrefLabel when no prefLabel exists', () => {
      const { processBindings } = useConceptBindings()

      const bindings: ConceptBinding[] = [
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c1' },
          label: { type: 'literal', value: 'Title' },
          labelLang: { type: 'literal', value: 'en' },
          labelType: { type: 'literal', value: 'title' },
        }),
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c1' },
          label: { type: 'literal', value: 'XL Label' },
          labelLang: { type: 'literal', value: 'en' },
          labelType: { type: 'literal', value: 'xlPrefLabel' },
        }),
      ]

      const result = processBindings(bindings)

      expect(result[0]?.label).toBe('XL Label')
    })

    it('picks best notation (smallest numeric)', () => {
      const { processBindings } = useConceptBindings()

      const bindings: ConceptBinding[] = [
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c1' },
          notation: { type: 'literal', value: '10' },
        }),
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c1' },
          notation: { type: 'literal', value: '5' },
        }),
      ]

      const result = processBindings(bindings)

      expect(result[0]?.notation).toBe('5')
    })

    it('detects hasNarrower from narrowerCount binding', () => {
      const { processBindings } = useConceptBindings()

      const bindings: ConceptBinding[] = [
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c1' },
          narrowerCount: { type: 'literal', value: '5' },
        }),
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c2' },
          narrowerCount: { type: 'literal', value: '0' },
        }),
      ]

      const result = processBindings(bindings)

      const c1 = result.find(c => c.uri === 'http://ex.org/c1')
      const c2 = result.find(c => c.uri === 'http://ex.org/c2')

      expect(c1?.hasNarrower).toBe(true)
      expect(c2?.hasNarrower).toBe(false)
    })

    describe('hasNarrower COUNT edge cases', () => {
      it('detects hasNarrower for large counts', () => {
        const { processBindings } = useConceptBindings()

        const bindings: ConceptBinding[] = [
          createBinding({
            concept: { type: 'uri', value: 'http://ex.org/c1' },
            narrowerCount: { type: 'literal', value: '1000' },
          }),
          createBinding({
            concept: { type: 'uri', value: 'http://ex.org/c2' },
            narrowerCount: { type: 'literal', value: '999999' },
          }),
        ]

        const result = processBindings(bindings)

        expect(result.find(c => c.uri === 'http://ex.org/c1')?.hasNarrower).toBe(true)
        expect(result.find(c => c.uri === 'http://ex.org/c2')?.hasNarrower).toBe(true)
      })

      it('detects hasNarrower for count of 1', () => {
        const { processBindings } = useConceptBindings()

        const bindings: ConceptBinding[] = [
          createBinding({
            concept: { type: 'uri', value: 'http://ex.org/c1' },
            narrowerCount: { type: 'literal', value: '1' },
          }),
        ]

        const result = processBindings(bindings)

        expect(result[0]?.hasNarrower).toBe(true)
      })

      it('returns false for missing narrowerCount', () => {
        const { processBindings } = useConceptBindings()

        const bindings: ConceptBinding[] = [
          createBinding({
            concept: { type: 'uri', value: 'http://ex.org/c1' },
            // No narrowerCount property
          }),
        ]

        const result = processBindings(bindings)

        expect(result[0]?.hasNarrower).toBe(false)
      })

      it('returns false for empty string narrowerCount', () => {
        const { processBindings } = useConceptBindings()

        const bindings: ConceptBinding[] = [
          createBinding({
            concept: { type: 'uri', value: 'http://ex.org/c1' },
            narrowerCount: { type: 'literal', value: '' },
          }),
        ]

        const result = processBindings(bindings)

        expect(result[0]?.hasNarrower).toBe(false)
      })

      it('returns false for non-numeric narrowerCount', () => {
        const { processBindings } = useConceptBindings()

        const bindings: ConceptBinding[] = [
          createBinding({
            concept: { type: 'uri', value: 'http://ex.org/c1' },
            narrowerCount: { type: 'literal', value: 'abc' },
          }),
          createBinding({
            concept: { type: 'uri', value: 'http://ex.org/c2' },
            narrowerCount: { type: 'literal', value: 'NaN' },
          }),
        ]

        const result = processBindings(bindings)

        // parseInt('abc', 10) returns NaN, NaN > 0 is false
        expect(result.find(c => c.uri === 'http://ex.org/c1')?.hasNarrower).toBe(false)
        expect(result.find(c => c.uri === 'http://ex.org/c2')?.hasNarrower).toBe(false)
      })

      it('handles negative narrowerCount (should be false)', () => {
        const { processBindings } = useConceptBindings()

        const bindings: ConceptBinding[] = [
          createBinding({
            concept: { type: 'uri', value: 'http://ex.org/c1' },
            narrowerCount: { type: 'literal', value: '-1' },
          }),
          createBinding({
            concept: { type: 'uri', value: 'http://ex.org/c2' },
            narrowerCount: { type: 'literal', value: '-100' },
          }),
        ]

        const result = processBindings(bindings)

        expect(result.find(c => c.uri === 'http://ex.org/c1')?.hasNarrower).toBe(false)
        expect(result.find(c => c.uri === 'http://ex.org/c2')?.hasNarrower).toBe(false)
      })

      it('handles leading zeros in narrowerCount', () => {
        const { processBindings } = useConceptBindings()

        const bindings: ConceptBinding[] = [
          createBinding({
            concept: { type: 'uri', value: 'http://ex.org/c1' },
            narrowerCount: { type: 'literal', value: '001' },
          }),
          createBinding({
            concept: { type: 'uri', value: 'http://ex.org/c2' },
            narrowerCount: { type: 'literal', value: '000' },
          }),
        ]

        const result = processBindings(bindings)

        expect(result.find(c => c.uri === 'http://ex.org/c1')?.hasNarrower).toBe(true)
        expect(result.find(c => c.uri === 'http://ex.org/c2')?.hasNarrower).toBe(false)
      })

      it('handles decimal narrowerCount (parseInt truncates)', () => {
        const { processBindings } = useConceptBindings()

        const bindings: ConceptBinding[] = [
          createBinding({
            concept: { type: 'uri', value: 'http://ex.org/c1' },
            narrowerCount: { type: 'literal', value: '1.9' },
          }),
          createBinding({
            concept: { type: 'uri', value: 'http://ex.org/c2' },
            narrowerCount: { type: 'literal', value: '0.9' },
          }),
        ]

        const result = processBindings(bindings)

        // parseInt('1.9', 10) = 1, parseInt('0.9', 10) = 0
        expect(result.find(c => c.uri === 'http://ex.org/c1')?.hasNarrower).toBe(true)
        expect(result.find(c => c.uri === 'http://ex.org/c2')?.hasNarrower).toBe(false)
      })

      it('handles whitespace in narrowerCount', () => {
        const { processBindings } = useConceptBindings()

        const bindings: ConceptBinding[] = [
          createBinding({
            concept: { type: 'uri', value: 'http://ex.org/c1' },
            narrowerCount: { type: 'literal', value: ' 5 ' },
          }),
          createBinding({
            concept: { type: 'uri', value: 'http://ex.org/c2' },
            narrowerCount: { type: 'literal', value: '  ' },
          }),
        ]

        const result = processBindings(bindings)

        // parseInt(' 5 ', 10) = 5, parseInt('  ', 10) = NaN
        expect(result.find(c => c.uri === 'http://ex.org/c1')?.hasNarrower).toBe(true)
        expect(result.find(c => c.uri === 'http://ex.org/c2')?.hasNarrower).toBe(false)
      })

      it('uses first binding narrowerCount for grouped concepts', () => {
        const { processBindings } = useConceptBindings()

        // Multiple bindings for same concept with different narrowerCount values
        // The first binding should set hasNarrower
        const bindings: ConceptBinding[] = [
          createBinding({
            concept: { type: 'uri', value: 'http://ex.org/c1' },
            narrowerCount: { type: 'literal', value: '5' },
            label: { type: 'literal', value: 'Label 1' },
          }),
          createBinding({
            concept: { type: 'uri', value: 'http://ex.org/c1' },
            narrowerCount: { type: 'literal', value: '0' }, // Different value, should be ignored
            label: { type: 'literal', value: 'Label 2' },
          }),
        ]

        const result = processBindings(bindings)

        // hasNarrower is set on first encounter, subsequent bindings don't overwrite
        expect(result[0]?.hasNarrower).toBe(true)
      })
    })

    it('detects deprecated status', () => {
      const { processBindings } = useConceptBindings()

      const bindings: ConceptBinding[] = [
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c1' },
          deprecated: { type: 'literal', value: 'true' },
        }),
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c2' },
        }),
      ]

      const result = processBindings(bindings)

      const c1 = result.find(c => c.uri === 'http://ex.org/c1')
      const c2 = result.find(c => c.uri === 'http://ex.org/c2')

      expect(c1?.deprecated).toBe(true)
      expect(c2?.deprecated).toBe(false)
    })

    it('sorts by notation then label', () => {
      const { processBindings } = useConceptBindings()

      const bindings: ConceptBinding[] = [
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c1' },
          label: { type: 'literal', value: 'Zebra' },
          labelLang: { type: 'literal', value: 'en' },
          labelType: { type: 'literal', value: 'prefLabel' },
        }),
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c2' },
          notation: { type: 'literal', value: '10' },
          label: { type: 'literal', value: 'Ten' },
          labelLang: { type: 'literal', value: 'en' },
          labelType: { type: 'literal', value: 'prefLabel' },
        }),
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c3' },
          notation: { type: 'literal', value: '2' },
          label: { type: 'literal', value: 'Two' },
          labelLang: { type: 'literal', value: 'en' },
          labelType: { type: 'literal', value: 'prefLabel' },
        }),
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c4' },
          label: { type: 'literal', value: 'Apple' },
          labelLang: { type: 'literal', value: 'en' },
          labelType: { type: 'literal', value: 'prefLabel' },
        }),
      ]

      const result = processBindings(bindings)

      // Order: 2 (notation), 10 (notation), Apple (label), Zebra (label)
      expect(result[0]?.notation).toBe('2')
      expect(result[1]?.notation).toBe('10')
      expect(result[2]?.label).toBe('Apple')
      expect(result[3]?.label).toBe('Zebra')
    })

    it('handles missing optional fields', () => {
      const { processBindings } = useConceptBindings()

      const bindings: ConceptBinding[] = [
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c1' },
          // No label, notation, narrowerCount
        }),
      ]

      const result = processBindings(bindings)

      expect(result).toHaveLength(1)
      expect(result[0]?.uri).toBe('http://ex.org/c1')
      expect(result[0]?.label).toBeUndefined()
      expect(result[0]?.notation).toBeUndefined()
      expect(result[0]?.hasNarrower).toBe(false)
    })

    it('skips bindings without concept URI', () => {
      const { processBindings } = useConceptBindings()

      const bindings: ConceptBinding[] = [
        createBinding({
          concept: undefined,
          label: { type: 'literal', value: 'Orphan Label' },
        }),
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c1' },
          label: { type: 'literal', value: 'Valid' },
          labelLang: { type: 'literal', value: 'en' },
          labelType: { type: 'literal', value: 'prefLabel' },
        }),
      ]

      const result = processBindings(bindings)

      expect(result).toHaveLength(1)
      expect(result[0]?.uri).toBe('http://ex.org/c1')
    })

    it('deduplicates notations for same concept', () => {
      const { processBindings } = useConceptBindings()

      const bindings: ConceptBinding[] = [
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c1' },
          notation: { type: 'literal', value: '5' },
        }),
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c1' },
          notation: { type: 'literal', value: '5' }, // Duplicate
        }),
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c1' },
          notation: { type: 'literal', value: '10' },
        }),
      ]

      const result = processBindings(bindings)

      // Should pick smallest: 5
      expect(result[0]?.notation).toBe('5')
    })

    it('sets expanded to false for all concepts', () => {
      const { processBindings } = useConceptBindings()

      const bindings: ConceptBinding[] = [
        createBinding({ concept: { type: 'uri', value: 'http://ex.org/c1' } }),
        createBinding({ concept: { type: 'uri', value: 'http://ex.org/c2' } }),
      ]

      const result = processBindings(bindings)

      expect(result.every(c => c.expanded === false)).toBe(true)
    })

    it('preserves label language', () => {
      const { processBindings } = useConceptBindings()

      const bindings: ConceptBinding[] = [
        createBinding({
          concept: { type: 'uri', value: 'http://ex.org/c1' },
          label: { type: 'literal', value: 'English Label' },
          labelLang: { type: 'literal', value: 'en' },
          labelType: { type: 'literal', value: 'prefLabel' },
        }),
      ]

      const result = processBindings(bindings)

      expect(result[0]?.lang).toBe('en')
    })
  })
})
