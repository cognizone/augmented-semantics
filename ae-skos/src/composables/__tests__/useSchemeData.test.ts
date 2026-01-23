import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSchemeData } from '../useSchemeData'
import { useEndpointStore } from '../../stores'

// Mock the services
vi.mock('../../services/sparql', () => ({
  executeSparql: vi.fn(),
  withPrefixes: vi.fn((q) => q),
}))

vi.mock('../../services/prefix', () => ({
  resolveUris: vi.fn(),
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

describe('useSchemeData', () => {
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

    // Default mock implementations
    ;(executeSparql as Mock).mockResolvedValue({ results: { bindings: [] } })
    ;(resolveUris as Mock).mockResolvedValue(new Map())
  })

  describe('initial state', () => {
    it('has correct initial values', () => {
      const { details, loading, error, resolvedPredicates } = useSchemeData()

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

      const { loadDetails, loading, error } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(executeSparql).not.toHaveBeenCalled()
      expect(loading.value).toBe(false)
      expect(error.value).toBeNull()
    })

    it('sets loading state during execution', async () => {
      const { loadDetails, loading } = useSchemeData()

      expect(loading.value).toBe(false)
      const promise = loadDetails('http://example.org/scheme/1')
      expect(loading.value).toBe(true)

      await promise
      expect(loading.value).toBe(false)
    })

    it('populates details with SPARQL results', async () => {
      // Main query
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2004/02/skos/core#prefLabel' }, value: { value: 'Test Scheme', 'xml:lang': 'en' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#prefLabel' }, value: { value: 'Schéma Test', 'xml:lang': 'fr' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#altLabel' }, value: { value: 'TS', 'xml:lang': 'en' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#definition' }, value: { value: 'A test scheme', 'xml:lang': 'en' } },
          ],
        },
      })
      // XL labels query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // Other properties query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value).not.toBeNull()
      expect(details.value?.uri).toBe('http://example.org/scheme/1')
      expect(details.value?.prefLabels).toHaveLength(2)
      expect(details.value?.altLabels).toHaveLength(1)
      expect(details.value?.definitions).toHaveLength(1)
    })

    it('handles skos:hiddenLabel', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2004/02/skos/core#hiddenLabel' }, value: { value: 'Hidden Label', 'xml:lang': 'en' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.hiddenLabels).toHaveLength(1)
      expect(details.value?.hiddenLabels[0].value).toBe('Hidden Label')
    })

    it('handles DC terms (title, description)', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://purl.org/dc/terms/title' }, value: { value: 'DCT Title', 'xml:lang': 'en' } },
            { property: { value: 'http://purl.org/dc/elements/1.1/title' }, value: { value: 'DC Title', 'xml:lang': 'en' } },
            { property: { value: 'http://purl.org/dc/terms/description' }, value: { value: 'DC Description', 'xml:lang': 'en' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.dctTitles).toHaveLength(1)
      expect(details.value?.dctTitles[0].value).toBe('DCT Title')
      expect(details.value?.dcTitles).toHaveLength(1)
      expect(details.value?.dcTitles[0].value).toBe('DC Title')
      expect(details.value?.description).toHaveLength(1)
      expect(details.value?.description[0].value).toBe('DC Description')
    })

    it('handles metadata (creator, created, modified)', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://purl.org/dc/terms/creator' }, value: { value: 'http://example.org/person/1' } },
            { property: { value: 'http://purl.org/dc/terms/created' }, value: { value: '2024-01-01', datatype: 'http://www.w3.org/2001/XMLSchema#date' } },
            { property: { value: 'http://purl.org/dc/terms/modified' }, value: { value: '2024-06-15' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.creator).toContain('http://example.org/person/1')
      expect(details.value?.created).toEqual({ value: '2024-01-01', datatype: 'http://www.w3.org/2001/XMLSchema#date' })
      expect(details.value?.modified).toEqual({ value: '2024-06-15', datatype: undefined })
    })

    it('deduplicates creators', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://purl.org/dc/terms/creator' }, value: { value: 'http://example.org/person/1' } },
            { property: { value: 'http://purl.org/dc/terms/creator' }, value: { value: 'http://example.org/person/1' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.creator).toHaveLength(1)
    })

    it('handles documentation properties', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2004/02/skos/core#scopeNote' }, value: { value: 'Scope note', 'xml:lang': 'en' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#historyNote' }, value: { value: 'History note', 'xml:lang': 'en' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#changeNote' }, value: { value: 'Change note', 'xml:lang': 'en' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#editorialNote' }, value: { value: 'Editorial note', 'xml:lang': 'en' } },
            { property: { value: 'http://www.w3.org/2004/02/skos/core#example' }, value: { value: 'Example', 'xml:lang': 'en' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.scopeNotes).toHaveLength(1)
      expect(details.value?.historyNotes).toHaveLength(1)
      expect(details.value?.changeNotes).toHaveLength(1)
      expect(details.value?.editorialNotes).toHaveLength(1)
      expect(details.value?.examples).toHaveLength(1)
    })

    it('handles rdfs:label and rdfs:comment', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2000/01/rdf-schema#label' }, value: { value: 'RDFS Label', 'xml:lang': 'en' } },
            { property: { value: 'http://www.w3.org/2000/01/rdf-schema#comment' }, value: { value: 'RDFS Comment', 'xml:lang': 'en' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.rdfsLabels).toHaveLength(1)
      expect(details.value?.rdfsLabels[0].value).toBe('RDFS Label')
      expect(details.value?.comments).toHaveLength(1)
      expect(details.value?.comments[0].value).toBe('RDFS Comment')
    })

    it('handles skos:notation with datatype', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2004/02/skos/core#notation' }, value: { value: 'ABC123', datatype: 'http://example.org/notationType' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.notations).toHaveLength(1)
      expect(details.value?.notations[0].value).toBe('ABC123')
      expect(details.value?.notations[0].datatype).toBe('http://example.org/notationType')
    })

    it('handles dct:issued', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://purl.org/dc/terms/issued' }, value: { value: '2023-05-15', datatype: 'http://www.w3.org/2001/XMLSchema#date' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.issued).toEqual({ value: '2023-05-15', datatype: 'http://www.w3.org/2001/XMLSchema#date' })
    })

    it('handles owl:deprecated', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2002/07/owl#deprecated' }, value: { value: 'true' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.deprecated).toBe(true)
    })

    it('handles owl:versionInfo', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2002/07/owl#versionInfo' }, value: { value: '1.2.3', datatype: 'http://www.w3.org/2001/XMLSchema#string' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.versionInfo).toEqual({ value: '1.2.3', datatype: 'http://www.w3.org/2001/XMLSchema#string' })
    })

    it('handles rdfs:seeAlso', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2000/01/rdf-schema#seeAlso' }, value: { value: 'http://example.org/related1' } },
            { property: { value: 'http://www.w3.org/2000/01/rdf-schema#seeAlso' }, value: { value: 'http://example.org/related2' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.seeAlso).toHaveLength(2)
      expect(details.value?.seeAlso).toContain('http://example.org/related1')
      expect(details.value?.seeAlso).toContain('http://example.org/related2')
    })

    it('handles dc:identifier', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://purl.org/dc/elements/1.1/identifier' }, value: { value: 'scheme-123' } },
            { property: { value: 'http://purl.org/dc/elements/1.1/identifier' }, value: { value: 'scheme-456' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.identifier).toHaveLength(2)
      expect(details.value?.identifier).toContain('scheme-123')
      expect(details.value?.identifier).toContain('scheme-456')
    })

    it('deduplicates dc:identifier', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://purl.org/dc/elements/1.1/identifier' }, value: { value: 'scheme-123' } },
            { property: { value: 'http://purl.org/dc/elements/1.1/identifier' }, value: { value: 'scheme-123' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.identifier).toHaveLength(1)
    })

    it('handles dct:status as URI (extracts fragment)', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://purl.org/dc/terms/status' }, value: { value: 'http://purl.org/adms/status/Completed' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.status).toBe('Completed')
    })

    it('handles dct:status as literal', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://purl.org/dc/terms/status' }, value: { value: 'draft' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.status).toBe('draft')
    })

    it('deduplicates rdfs:seeAlso', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2000/01/rdf-schema#seeAlso' }, value: { value: 'http://example.org/related1' } },
            { property: { value: 'http://www.w3.org/2000/01/rdf-schema#seeAlso' }, value: { value: 'http://example.org/related1' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.seeAlso).toHaveLength(1)
    })

    it('sets error on query failure', async () => {
      ;(executeSparql as Mock).mockRejectedValueOnce(new Error('Network error'))

      const { loadDetails, details, error, loading } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value).toBeNull()
      expect(error.value).toContain('Network error')
      expect(loading.value).toBe(false)
    })

    it('clears previous error on new load', async () => {
      ;(executeSparql as Mock).mockRejectedValueOnce(new Error('First error'))

      const { loadDetails, error } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')
      expect(error.value).toContain('First error')

      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      await loadDetails('http://example.org/scheme/2')
      expect(error.value).toBeNull()
    })
  })

  describe('loadXLLabels', () => {
    it('loads SKOS-XL extended labels', async () => {
      // Main query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // XL labels query
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { xlLabel: { value: 'http://example.org/xl/1' }, labelType: { value: 'prefLabel' }, literalForm: { value: 'XL Label' }, literalLang: { value: 'en' } },
          ],
        },
      })
      // Other properties query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.prefLabelsXL).toHaveLength(1)
      expect(details.value?.prefLabelsXL[0].uri).toBe('http://example.org/xl/1')
      expect(details.value?.prefLabelsXL[0].literalForm.value).toBe('XL Label')
    })

    it('deduplicates XL labels by URI', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { xlLabel: { value: 'http://example.org/xl/1' }, labelType: { value: 'prefLabel' }, literalForm: { value: 'XL Label' }, literalLang: { value: 'en' } },
            { xlLabel: { value: 'http://example.org/xl/1' }, labelType: { value: 'prefLabel' }, literalForm: { value: 'XL Label' }, literalLang: { value: 'en' } },
          ],
        },
      })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.prefLabelsXL).toHaveLength(1)
    })

    it('continues silently on XL labels query failure', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockRejectedValueOnce(new Error('XL query failed'))
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details, error } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value).not.toBeNull()
      expect(error.value).toBeNull()
      expect(details.value?.prefLabelsXL).toHaveLength(0)
    })
  })

  describe('loadOtherProperties', () => {
    it('loads non-SKOS properties', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { predicate: { value: 'http://example.org/custom#property' }, value: { value: 'Custom value', 'xml:lang': 'en' } },
          ],
        },
      })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.otherProperties).toHaveLength(1)
      expect(details.value?.otherProperties[0].predicate).toBe('http://example.org/custom#property')
      expect(details.value?.otherProperties[0].values[0].value).toBe('Custom value')
    })

    it('groups values by predicate', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { predicate: { value: 'http://example.org/prop' }, value: { value: 'Value 1', 'xml:lang': 'en' } },
            { predicate: { value: 'http://example.org/prop' }, value: { value: 'Value 2', 'xml:lang': 'fr' } },
          ],
        },
      })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.otherProperties).toHaveLength(1)
      expect(details.value?.otherProperties[0].values).toHaveLength(2)
    })

    it('deduplicates values by value+lang', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { predicate: { value: 'http://example.org/prop' }, value: { value: 'Same Value', 'xml:lang': 'en' } },
            { predicate: { value: 'http://example.org/prop' }, value: { value: 'Same Value', 'xml:lang': 'en' } },
          ],
        },
      })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.otherProperties[0].values).toHaveLength(1)
    })

    it('detects URI values', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { predicate: { value: 'http://example.org/link' }, value: { value: 'http://example.org/target', type: 'uri' } },
          ],
        },
      })

      const { loadDetails, details } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value?.otherProperties[0].values[0].isUri).toBe(true)
    })

    it('resolves predicate URIs', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
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

      const { loadDetails, resolvedPredicates } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(resolvedPredicates.value.get('http://example.org/custom#prop')).toEqual({ prefix: 'ex', localName: 'prop' })
    })

    it('continues silently on other properties query failure', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      ;(executeSparql as Mock).mockRejectedValueOnce(new Error('Query failed'))

      const { loadDetails, details, error } = useSchemeData()
      await loadDetails('http://example.org/scheme/1')

      expect(details.value).not.toBeNull()
      expect(error.value).toBeNull()
      expect(details.value?.otherProperties).toHaveLength(0)
    })
  })
})
