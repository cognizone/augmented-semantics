import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useConceptData } from '../useConceptData'
import { useEndpointStore, useLanguageStore } from '../../stores'

// Mock the services
vi.mock('../../services/sparql', () => ({
  executeSparql: vi.fn(),
  withPrefixes: vi.fn((q) => q),
}))

vi.mock('../../services/prefix', () => ({
  resolveUris: vi.fn(),
  formatQualifiedName: vi.fn((r) => r?.localName || r?.prefix ? `${r.prefix}:${r.localName}` : undefined),
}))

vi.mock('../../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { executeSparql } from '../../services/sparql'
import { resolveUris } from '../../services/prefix'

describe('useConceptData', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    // Set up default endpoint
    const endpointStore = useEndpointStore()
    const endpoint = endpointStore.addEndpoint({
      name: 'Test Endpoint',
      url: 'https://example.org/sparql',
    })
    endpointStore.selectEndpoint(endpoint.id)
    endpointStore.updateEndpoint(endpoint.id, {
      languagePriorities: ['en', 'fr', 'de'],
    })

    // Set up language preference
    const languageStore = useLanguageStore()
    languageStore.setPreferred('en')

    // Default mock implementations
    ;(executeSparql as Mock).mockResolvedValue({ results: { bindings: [] } })
    ;(resolveUris as Mock).mockResolvedValue(new Map())
  })

  describe('initial state', () => {
    it('has correct initial values', () => {
      const { details, loading, error, resolvedPredicates } = useConceptData()

      expect(details.value).toBeNull()
      expect(loading.value).toBe(false)
      expect(error.value).toBeNull()
      expect(resolvedPredicates.value).toBeInstanceOf(Map)
      expect(resolvedPredicates.value.size).toBe(0)
    })
  })

  describe('loadDetails', () => {
    it('returns early when no endpoint is selected', async () => {
      const endpointStore = useEndpointStore()
      endpointStore.selectEndpoint(null as unknown as string)

      const { loadDetails, loading, error } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(executeSparql).not.toHaveBeenCalled()
      expect(loading.value).toBe(false)
      expect(error.value).toBeNull()
    })

    it('sets loading state during execution', async () => {
      let loadingDuringExecution = false
      ;(executeSparql as Mock).mockImplementation(async () => {
        // Capture loading state during async execution
        loadingDuringExecution = true
        return { results: { bindings: [] } }
      })

      const { loadDetails, loading } = useConceptData()

      expect(loading.value).toBe(false)
      const promise = loadDetails('http://example.org/concept/1')
      // Loading should be true immediately after calling
      expect(loading.value).toBe(true)

      await promise
      expect(loading.value).toBe(false)
    })

    it('populates details with SPARQL results', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2004/02/skos/core#prefLabel' }, value: { value: 'Test Concept', 'xml:lang': 'en' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#prefLabel' }, value: { value: 'Concept Test', 'xml:lang': 'fr' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#altLabel' }, value: { value: 'TC', 'xml:lang': 'en' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#definition' }, value: { value: 'A test concept', 'xml:lang': 'en' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value).not.toBeNull()
      expect(details.value?.uri).toBe('http://example.org/concept/1')
      expect(details.value?.prefLabels).toHaveLength(2)
      expect(details.value?.altLabels).toHaveLength(1)
      expect(details.value?.definitions).toHaveLength(1)
    })

    it('handles rdfs:label as prefLabel', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2000/01/rdf-schema#label' }, value: { value: 'RDFS Label', 'xml:lang': 'en' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.prefLabels).toHaveLength(1)
      expect(details.value?.prefLabels[0].value).toBe('RDFS Label')
    })

    it('handles dct:title as prefLabel', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://purl.org/dc/terms/title' }, value: { value: 'DC Title', 'xml:lang': 'en' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.prefLabels).toHaveLength(1)
      expect(details.value?.prefLabels[0].value).toBe('DC Title')
    })

    it('handles broader, narrower, related relations', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2004/02/skos/core#broader' }, value: { value: 'http://example.org/broader/1' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#narrower' }, value: { value: 'http://example.org/narrower/1' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#narrower' }, value: { value: 'http://example.org/narrower/2' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#related' }, value: { value: 'http://example.org/related/1' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.broader).toHaveLength(1)
      expect(details.value?.narrower).toHaveLength(2)
      expect(details.value?.related).toHaveLength(1)
    })

    it('deduplicates broader, narrower, related URIs', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2004/02/skos/core#broader' }, value: { value: 'http://example.org/broader/1' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#broader' }, value: { value: 'http://example.org/broader/1' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.broader).toHaveLength(1)
    })

    it('handles mapping relations', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2004/02/skos/core#exactMatch' }, value: { value: 'http://external.org/exact/1' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#closeMatch' }, value: { value: 'http://external.org/close/1' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#broadMatch' }, value: { value: 'http://external.org/broad/1' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.exactMatch).toContain('http://external.org/exact/1')
      expect(details.value?.closeMatch).toContain('http://external.org/close/1')
      expect(details.value?.broadMatch).toContain('http://external.org/broad/1')
    })

    it('handles notation with datatype', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2004/02/skos/core#notation' }, value: { value: '1.2.3', datatype: 'http://www.w3.org/2001/XMLSchema#string' } },
          ],
        },
      })
      ;(resolveUris as Mock).mockResolvedValue(new Map([
        ['http://www.w3.org/2001/XMLSchema#string', { prefix: 'xsd', localName: 'string' }],
      ]))

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.notations).toHaveLength(1)
      expect(details.value?.notations[0].value).toBe('1.2.3')
      expect(details.value?.notations[0].datatype).toBe('xsd:string')
    })

    it('handles documentation properties', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2004/02/skos/core#scopeNote' }, value: { value: 'Scope note text', 'xml:lang': 'en' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#historyNote' }, value: { value: 'History note', 'xml:lang': 'en' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#changeNote' }, value: { value: 'Change note', 'xml:lang': 'en' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#editorialNote' }, value: { value: 'Editorial note', 'xml:lang': 'en' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#example' }, value: { value: 'Example text', 'xml:lang': 'en' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.scopeNotes).toHaveLength(1)
      expect(details.value?.historyNotes).toHaveLength(1)
      expect(details.value?.changeNotes).toHaveLength(1)
      expect(details.value?.editorialNotes).toHaveLength(1)
      expect(details.value?.examples).toHaveLength(1)
    })

    it('sets error on query failure', async () => {
      ;(executeSparql as Mock).mockRejectedValueOnce(new Error('Network error'))

      const { loadDetails, details, error, loading } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value).toBeNull()
      expect(error.value).toContain('Network error')
      expect(loading.value).toBe(false)
    })

    it('clears previous error on new load', async () => {
      ;(executeSparql as Mock).mockRejectedValueOnce(new Error('First error'))

      const { loadDetails, error } = useConceptData()
      await loadDetails('http://example.org/concept/1')
      expect(error.value).toContain('First error')

      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      await loadDetails('http://example.org/concept/2')
      expect(error.value).toBeNull()
    })
  })

  describe('loadRelatedLabels', () => {
    it('loads labels for related concepts', async () => {
      // First call returns concept with broader
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2004/02/skos/core#broader' }, value: { value: 'http://example.org/broader/1' } },
          ],
        },
      })
      // Second call returns labels for related concepts
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { concept: { value: 'http://example.org/broader/1' }, notation: { value: 'B1' }, label: { value: 'Broader Concept' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.broader[0].label).toBe('Broader Concept')
      expect(details.value?.broader[0].notation).toBe('B1')
    })

    it('applies label type priority', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2004/02/skos/core#broader' }, value: { value: 'http://example.org/broader/1' } },
          ],
        },
      })
      // Multiple label types for the same concept
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { concept: { value: 'http://example.org/broader/1' }, label: { value: 'Alt Label' }, labelLang: { value: 'en' }, labelType: { value: 'altLabel' } },
            { concept: { value: 'http://example.org/broader/1' }, label: { value: 'Pref Label' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      // Should select prefLabel over altLabel
      expect(details.value?.broader[0].label).toBe('Pref Label')
    })

    it('selects label based on language priority', async () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('fr')

      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2004/02/skos/core#broader' }, value: { value: 'http://example.org/broader/1' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { concept: { value: 'http://example.org/broader/1' }, label: { value: 'English Label' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
            { concept: { value: 'http://example.org/broader/1' }, label: { value: 'French Label' }, labelLang: { value: 'fr' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.broader[0].label).toBe('French Label')
    })
  })

  describe('loadXLLabels', () => {
    it('loads SKOS-XL extended labels', async () => {
      // 1. Main query (empty - no relations)
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 2. XL labels query (no loadRelatedLabels call since no relations)
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { xlLabel: { value: 'http://example.org/xl/1' }, labelType: { value: 'prefLabel' }, literalForm: { value: 'XL Pref Label' }, literalLang: { value: 'en' } },
            { xlLabel: { value: 'http://example.org/xl/2' }, labelType: { value: 'altLabel' }, literalForm: { value: 'XL Alt Label' }, literalLang: { value: 'en' } },
          ],
        },
      })
      // 3. Other properties query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.prefLabelsXL).toHaveLength(1)
      expect(details.value?.prefLabelsXL[0].uri).toBe('http://example.org/xl/1')
      expect(details.value?.prefLabelsXL[0].literalForm.value).toBe('XL Pref Label')
      expect(details.value?.altLabelsXL).toHaveLength(1)
    })

    it('deduplicates XL labels by URI', async () => {
      // 1. Main query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 2. XL labels query
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { xlLabel: { value: 'http://example.org/xl/1' }, labelType: { value: 'prefLabel' }, literalForm: { value: 'XL Label' }, literalLang: { value: 'en' } },
            { xlLabel: { value: 'http://example.org/xl/1' }, labelType: { value: 'prefLabel' }, literalForm: { value: 'XL Label' }, literalLang: { value: 'en' } },
          ],
        },
      })
      // 3. Other properties query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.prefLabelsXL).toHaveLength(1)
    })

    it('continues silently on XL labels query failure', async () => {
      // 1. Main query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 2. XL labels query fails
      ;(executeSparql as Mock).mockRejectedValueOnce(new Error('XL query failed'))
      // 3. Other properties query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details, error } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value).not.toBeNull()
      expect(error.value).toBeNull()
      expect(details.value?.prefLabelsXL).toHaveLength(0)
    })
  })

  describe('loadOtherProperties', () => {
    it('loads non-SKOS properties', async () => {
      // 1. Main query (empty - no relations)
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 2. XL labels query (no loadRelatedLabels since no relations)
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 3. Other properties query
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { predicate: { value: 'http://example.org/custom#property' }, value: { value: 'Custom value', 'xml:lang': 'en' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.otherProperties).toHaveLength(1)
      expect(details.value?.otherProperties[0].predicate).toBe('http://example.org/custom#property')
      expect(details.value?.otherProperties[0].values[0].value).toBe('Custom value')
    })

    it('groups values by predicate', async () => {
      // 1. Main query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 2. XL labels query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 3. Other properties query
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { predicate: { value: 'http://example.org/prop' }, value: { value: 'Value 1', 'xml:lang': 'en' } },
            { predicate: { value: 'http://example.org/prop' }, value: { value: 'Value 2', 'xml:lang': 'fr' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.otherProperties).toHaveLength(1)
      expect(details.value?.otherProperties[0].values).toHaveLength(2)
    })

    it('deduplicates values by value+lang', async () => {
      // 1. Main query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 2. XL labels query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 3. Other properties query
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { predicate: { value: 'http://example.org/prop' }, value: { value: 'Same Value', 'xml:lang': 'en' } },
            { predicate: { value: 'http://example.org/prop' }, value: { value: 'Same Value', 'xml:lang': 'en' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.otherProperties[0].values).toHaveLength(1)
    })

    it('detects URI values', async () => {
      // 1. Main query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 2. XL labels query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 3. Other properties query
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { predicate: { value: 'http://example.org/link' }, value: { value: 'http://example.org/target', type: 'uri' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.otherProperties[0].values[0].isUri).toBe(true)
    })

    it('resolves predicate URIs', async () => {
      // 1. Main query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 2. XL labels query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 3. Other properties query
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { predicate: { value: 'http://example.org/custom#prop' }, value: { value: 'test' } },
          ],
        },
      })
      ;(resolveUris as Mock).mockResolvedValue(new Map([
        ['http://example.org/custom#prop', { prefix: 'ex', localName: 'prop' }],
      ]))

      const { loadDetails, resolvedPredicates } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(resolvedPredicates.value.get('http://example.org/custom#prop')).toEqual({ prefix: 'ex', localName: 'prop' })
    })

    it('continues silently on other properties query failure', async () => {
      // 1. Main query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 2. XL labels query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 3. Other properties query fails
      ;(executeSparql as Mock).mockRejectedValueOnce(new Error('Query failed'))

      const { loadDetails, details, error } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value).not.toBeNull()
      expect(error.value).toBeNull()
      expect(details.value?.otherProperties).toHaveLength(0)
    })
  })

  describe('selectBestLabelByLanguage (via loadRelatedLabels)', () => {
    it('returns preferred language match', async () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('de')

      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2004/02/skos/core#broader' }, value: { value: 'http://example.org/broader/1' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { concept: { value: 'http://example.org/broader/1' }, label: { value: 'English' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
            { concept: { value: 'http://example.org/broader/1' }, label: { value: 'German' }, labelLang: { value: 'de' }, labelType: { value: 'prefLabel' } },
            { concept: { value: 'http://example.org/broader/1' }, label: { value: 'French' }, labelLang: { value: 'fr' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.broader[0].label).toBe('German')
    })

    it('falls back to endpoint language priorities', async () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('es') // Not available

      const endpointStore = useEndpointStore()
      endpointStore.updateEndpoint(endpointStore.currentId!, {
        languagePriorities: ['fr', 'en'], // French is first priority
      })

      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2004/02/skos/core#broader' }, value: { value: 'http://example.org/broader/1' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { concept: { value: 'http://example.org/broader/1' }, label: { value: 'English' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
            { concept: { value: 'http://example.org/broader/1' }, label: { value: 'French' }, labelLang: { value: 'fr' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.broader[0].label).toBe('French')
    })

    it('falls back to no-lang label when no language match', async () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('es')

      const endpointStore = useEndpointStore()
      endpointStore.updateEndpoint(endpointStore.currentId!, {
        languagePriorities: ['it'], // Not available
      })

      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2004/02/skos/core#broader' }, value: { value: 'http://example.org/broader/1' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { concept: { value: 'http://example.org/broader/1' }, label: { value: 'No Lang Label' }, labelLang: { value: '' }, labelType: { value: 'prefLabel' } },
            { concept: { value: 'http://example.org/broader/1' }, label: { value: 'Japanese' }, labelLang: { value: 'ja' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.broader[0].label).toBe('No Lang Label')
    })

    it('returns first available as last resort', async () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('es')

      const endpointStore = useEndpointStore()
      endpointStore.updateEndpoint(endpointStore.currentId!, {
        languagePriorities: [],
      })

      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2004/02/skos/core#broader' }, value: { value: 'http://example.org/broader/1' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { concept: { value: 'http://example.org/broader/1' }, label: { value: 'First Label' }, labelLang: { value: 'ja' }, labelType: { value: 'prefLabel' } },
            { concept: { value: 'http://example.org/broader/1' }, label: { value: 'Second Label' }, labelLang: { value: 'zh' }, labelType: { value: 'prefLabel' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.broader[0].label).toBe('First Label')
    })
  })
})
