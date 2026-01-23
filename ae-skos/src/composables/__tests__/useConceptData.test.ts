import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { useConceptData } from '../useConceptData'
import { useEndpointStore, useLanguageStore } from '../../stores'

// Mock the services
vi.mock('../../services/sparql', () => ({
  executeSparql: vi.fn(),
  withPrefixes: vi.fn((q) => q),
  endpointHasCollections: vi.fn(() => true),
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

    it('handles rdfs:label separately', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2000/01/rdf-schema#label' }, value: { value: 'RDFS Label', 'xml:lang': 'en' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.rdfsLabels).toHaveLength(1)
      expect(details.value?.rdfsLabels[0].value).toBe('RDFS Label')
    })

    it('handles dct:title separately', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://purl.org/dc/terms/title' }, value: { value: 'DC Title', 'xml:lang': 'en' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.dctTitles).toHaveLength(1)
      expect(details.value?.dctTitles[0].value).toBe('DC Title')
    })

    it('handles dc:title separately', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://purl.org/dc/elements/1.1/title' }, value: { value: 'DC Elements Title', 'xml:lang': 'en' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.dcTitles).toHaveLength(1)
      expect(details.value?.dcTitles[0].value).toBe('DC Elements Title')
    })

    it('handles rdfs:comment', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2000/01/rdf-schema#comment' }, value: { value: 'A comment about this concept', 'xml:lang': 'en' } },
            { property: { value: 'http://www.w3.org/2000/01/rdf-schema#comment' }, value: { value: 'Un commentaire', 'xml:lang': 'fr' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.comments).toHaveLength(2)
      expect(details.value?.comments[0].value).toBe('A comment about this concept')
      expect(details.value?.comments[0].lang).toBe('en')
      expect(details.value?.comments[1].value).toBe('Un commentaire')
      expect(details.value?.comments[1].lang).toBe('fr')
    })

    it('handles dct:description', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://purl.org/dc/terms/description' }, value: { value: 'A detailed description', 'xml:lang': 'en' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.description).toHaveLength(1)
      expect(details.value?.description[0].value).toBe('A detailed description')
      expect(details.value?.description[0].lang).toBe('en')
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
      // 1. Main query
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2004/02/skos/core#notation' }, value: { value: '1.2.3', datatype: 'http://www.w3.org/2001/XMLSchema#string' } },
          ],
        },
      })
      // 2. Collections query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 3. XL labels query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 4. Other properties query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      ;(resolveUris as Mock).mockResolvedValue(new Map([
        ['http://www.w3.org/2001/XMLSchema#string', { prefix: 'xsd', localName: 'string' }],
      ]))

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.notations).toHaveLength(1)
      expect(details.value?.notations[0].value).toBe('1.2.3')
      // Wait for async datatype resolution (happens in .then() callback after loadOtherProperties)
      await vi.waitFor(() => {
        expect(details.value?.notations[0].datatype).toBe('xsd:string')
      })
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

    it('handles dct:issued', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://purl.org/dc/terms/issued' }, value: { value: '2024-01-15', datatype: 'http://www.w3.org/2001/XMLSchema#date' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.issued).toEqual({ value: '2024-01-15', datatype: 'http://www.w3.org/2001/XMLSchema#date' })
    })

    it('handles owl:versionInfo', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://www.w3.org/2002/07/owl#versionInfo' }, value: { value: '1.2.3', datatype: 'http://www.w3.org/2001/XMLSchema#string' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.versionInfo).toEqual({ value: '1.2.3', datatype: 'http://www.w3.org/2001/XMLSchema#string' })
    })

    it('handles dct:creator as URI', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://purl.org/dc/terms/creator' }, value: { value: 'http://example.org/person/1', type: 'uri' } },
            { property: { value: 'http://purl.org/dc/terms/creator' }, value: { value: 'http://example.org/person/2', type: 'uri' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.creator).toHaveLength(2)
      expect(details.value?.creator).toContain('http://example.org/person/1')
      expect(details.value?.creator).toContain('http://example.org/person/2')
    })

    it('deduplicates dct:creator', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://purl.org/dc/terms/creator' }, value: { value: 'http://example.org/person/1', type: 'uri' } },
            { property: { value: 'http://purl.org/dc/terms/creator' }, value: { value: 'http://example.org/person/1', type: 'uri' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.creator).toHaveLength(1)
    })

    it('handles dct:publisher as URI', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://purl.org/dc/terms/publisher' }, value: { value: 'http://example.org/org/1', type: 'uri' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.publisher).toHaveLength(1)
      expect(details.value?.publisher).toContain('http://example.org/org/1')
    })

    it('handles dct:rights as URI', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://purl.org/dc/terms/rights' }, value: { value: 'http://example.org/rights/1', type: 'uri' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.rights).toHaveLength(1)
      expect(details.value?.rights).toContain('http://example.org/rights/1')
    })

    it('handles dct:license as URI', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://purl.org/dc/terms/license' }, value: { value: 'http://creativecommons.org/licenses/by/4.0/', type: 'uri' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.license).toHaveLength(1)
      expect(details.value?.license).toContain('http://creativecommons.org/licenses/by/4.0/')
    })

    it('handles cc:license as URI', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { property: { value: 'http://creativecommons.org/ns#license' }, value: { value: 'http://creativecommons.org/publicdomain/zero/1.0/', type: 'uri' } },
          ],
        },
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.ccLicense).toHaveLength(1)
      expect(details.value?.ccLicense).toContain('http://creativecommons.org/publicdomain/zero/1.0/')
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

  describe('loadCollections', () => {
    it('loads collections that contain the concept', async () => {
      // Use mockImplementation to handle progressive label loading queries
      ;(executeSparql as Mock).mockImplementation(async (_endpoint, query: string) => {
        // Main concept properties query
        if (query.includes('?property ?value') && query.includes('FILTER (?property IN')) {
          return { results: { bindings: [] } }
        }
        // Collections query
        if (query.includes('skos:member') && query.includes('?collection')) {
          return {
            results: {
              bindings: [
                { collection: { value: 'http://example.org/collection/1' } },
                { collection: { value: 'http://example.org/collection/2' } },
              ],
            },
          }
        }
        // Metadata query (has ?notation, ?hasNarrower but no ?label)
        if (query.includes('?notation') && query.includes('?hasNarrower') && !query.includes('?label')) {
          return {
            results: {
              bindings: [
                { concept: { value: 'http://example.org/collection/1' } },
                { concept: { value: 'http://example.org/collection/2' } },
              ],
            },
          }
        }
        // Label query (has ?label in SELECT)
        if (query.includes('?label') && query.includes('VALUES ?concept')) {
          return {
            results: {
              bindings: [
                { concept: { value: 'http://example.org/collection/1' }, label: { value: 'Collection One' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
                { concept: { value: 'http://example.org/collection/2' }, label: { value: 'Collection Two' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
              ],
            },
          }
        }
        // Default empty response (XL labels, other properties, etc.)
        return { results: { bindings: [] } }
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.collections).toHaveLength(2)
      expect(details.value?.collections[0].uri).toBe('http://example.org/collection/1')
      // Wait for async label loading (labels are loaded progressively)
      await vi.waitFor(() => {
        expect(details.value?.collections[0].label).toBe('Collection One')
      })
      expect(details.value?.collections[0].type).toBe('collection')
    })

    it('deduplicates collection URIs', async () => {
      // 1. Main query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 2. Collections query (same collection twice)
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { collection: { value: 'http://example.org/collection/1' } },
            { collection: { value: 'http://example.org/collection/1' } },
          ],
        },
      })
      // 3. Related labels query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 4. XL labels query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 5. Other properties query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.collections).toHaveLength(1)
    })

    it('continues silently on collections query failure', async () => {
      // 1. Main query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 2. Collections query fails
      ;(executeSparql as Mock).mockRejectedValueOnce(new Error('Collections query failed'))
      // 3. XL labels query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 4. Other properties query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details, error } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value).not.toBeNull()
      expect(error.value).toBeNull()
      expect(details.value?.collections).toHaveLength(0)
    })
  })

  describe('loadRelatedLabels', () => {
    // With progressive label loading, queries run in parallel.
    // We use mockImplementation to return results based on query content.

    function setupMockForRelatedLabelsTest(options: {
      relations: Array<{ property: string; value: string }>
      metadata: Array<{ uri: string; notation?: string; hasNarrower?: boolean }>
      labels: Array<{ uri: string; value: string; lang: string; type: string }>
    }) {
      ;(executeSparql as Mock).mockImplementation(async (_endpoint, query: string) => {
        // Main concept properties query
        if (query.includes('?property ?value') && query.includes('FILTER (?property IN')) {
          return {
            results: {
              bindings: options.relations.map(r => ({
                property: { value: r.property },
                value: { value: r.value },
              })),
            },
          }
        }
        // Collections query
        if (query.includes('skos:member') && query.includes('?collection')) {
          return { results: { bindings: [] } }
        }
        // Metadata query (has ?notation, ?hasNarrower but no ?label)
        if (query.includes('?notation') && query.includes('?hasNarrower') && !query.includes('?label')) {
          return {
            results: {
              bindings: options.metadata.map(m => ({
                concept: { value: m.uri },
                ...(m.notation && { notation: { value: m.notation } }),
                ...(m.hasNarrower !== undefined && { hasNarrower: { value: m.hasNarrower ? 'true' : 'false' } }),
              })),
            },
          }
        }
        // Label query (has ?label in SELECT)
        if (query.includes('?label') && query.includes('VALUES ?concept')) {
          return {
            results: {
              bindings: options.labels.map(l => ({
                concept: { value: l.uri },
                label: { value: l.value },
                labelLang: { value: l.lang },
                labelType: { value: l.type },
              })),
            },
          }
        }
        // Default empty response
        return { results: { bindings: [] } }
      })
    }

    it('loads labels for related concepts', async () => {
      setupMockForRelatedLabelsTest({
        relations: [{ property: 'http://www.w3.org/2004/02/skos/core#broader', value: 'http://example.org/broader/1' }],
        metadata: [{ uri: 'http://example.org/broader/1', notation: 'B1', hasNarrower: true }],
        labels: [{ uri: 'http://example.org/broader/1', value: 'Broader Concept', lang: 'en', type: 'prefLabel' }],
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')
      await flushPromises()

      expect(details.value?.broader[0].label).toBe('Broader Concept')
      expect(details.value?.broader[0].notation).toBe('B1')
    })

    it('extracts hasNarrower from query results', async () => {
      setupMockForRelatedLabelsTest({
        relations: [
          { property: 'http://www.w3.org/2004/02/skos/core#broader', value: 'http://example.org/broader/1' },
          { property: 'http://www.w3.org/2004/02/skos/core#narrower', value: 'http://example.org/narrower/1' },
          { property: 'http://www.w3.org/2004/02/skos/core#narrower', value: 'http://example.org/narrower/2' },
        ],
        metadata: [
          { uri: 'http://example.org/broader/1', hasNarrower: true },
          { uri: 'http://example.org/narrower/1', hasNarrower: true },
          { uri: 'http://example.org/narrower/2', hasNarrower: false },
        ],
        labels: [
          { uri: 'http://example.org/broader/1', value: 'Broader', lang: 'en', type: 'prefLabel' },
          { uri: 'http://example.org/narrower/1', value: 'Narrower With Children', lang: 'en', type: 'prefLabel' },
          { uri: 'http://example.org/narrower/2', value: 'Narrower Leaf', lang: 'en', type: 'prefLabel' },
        ],
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')
      await flushPromises()

      // Broader should have hasNarrower = true
      expect(details.value?.broader[0].hasNarrower).toBe(true)

      // First narrower has children
      const narrowerWithChildren = details.value?.narrower.find(n => n.uri === 'http://example.org/narrower/1')
      expect(narrowerWithChildren?.hasNarrower).toBe(true)

      // Second narrower is a leaf (hasNarrower = false means undefined, since we only set it when true)
      const narrowerLeaf = details.value?.narrower.find(n => n.uri === 'http://example.org/narrower/2')
      expect(narrowerLeaf?.hasNarrower).toBeUndefined()
    })

    it('extracts cross-scheme indicators (inCurrentScheme, displayScheme)', async () => {
      ;(executeSparql as Mock).mockImplementation(async (_endpoint, query: string) => {
        // Main concept properties query
        if (query.includes('?property ?value') && query.includes('FILTER (?property IN')) {
          return {
            results: {
              bindings: [
                { property: { value: 'http://www.w3.org/2004/02/skos/core#broader' }, value: { value: 'http://example.org/same-scheme/1' } },
                { property: { value: 'http://www.w3.org/2004/02/skos/core#broader' }, value: { value: 'http://external.org/other-scheme/1' } },
              ],
            },
          }
        }
        // Collections query
        if (query.includes('skos:member') && query.includes('?collection')) {
          return { results: { bindings: [] } }
        }
        // Metadata query with cross-scheme fields
        if (query.includes('?inCurrentScheme') && query.includes('?displayScheme')) {
          return {
            results: {
              bindings: [
                {
                  concept: { value: 'http://example.org/same-scheme/1' },
                  inCurrentScheme: { value: 'true' },
                  displayScheme: { value: 'http://example.org/scheme/1' },
                },
                {
                  concept: { value: 'http://external.org/other-scheme/1' },
                  inCurrentScheme: { value: 'false' },
                  displayScheme: { value: 'http://external.org/scheme/other' },
                },
              ],
            },
          }
        }
        // Label query
        if (query.includes('?label') && query.includes('VALUES ?concept')) {
          return {
            results: {
              bindings: [
                { concept: { value: 'http://example.org/same-scheme/1' }, label: { value: 'Same Scheme' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
                { concept: { value: 'http://external.org/other-scheme/1' }, label: { value: 'Other Scheme' }, labelLang: { value: 'en' }, labelType: { value: 'prefLabel' } },
              ],
            },
          }
        }
        return { results: { bindings: [] } }
      })

      // Set up a scheme for cross-scheme detection
      const { useSchemeStore } = await import('../../stores')
      const schemeStore = useSchemeStore()
      schemeStore.schemes = [{ uri: 'http://example.org/scheme/1', label: 'Test Scheme' }]
      schemeStore.selectScheme('http://example.org/scheme/1')

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')
      await flushPromises()

      // Same-scheme concept
      const sameScheme = details.value?.broader.find(b => b.uri === 'http://example.org/same-scheme/1')
      expect(sameScheme?.inCurrentScheme).toBe(true)

      // Cross-scheme concept
      const otherScheme = details.value?.broader.find(b => b.uri === 'http://external.org/other-scheme/1')
      expect(otherScheme?.inCurrentScheme).toBe(false)
      expect(otherScheme?.displayScheme).toBe('http://external.org/scheme/other')
    })

    it('applies label type priority', async () => {
      setupMockForRelatedLabelsTest({
        relations: [{ property: 'http://www.w3.org/2004/02/skos/core#broader', value: 'http://example.org/broader/1' }],
        metadata: [{ uri: 'http://example.org/broader/1' }],
        labels: [
          { uri: 'http://example.org/broader/1', value: 'Alt Label', lang: 'en', type: 'altLabel' },
          { uri: 'http://example.org/broader/1', value: 'Pref Label', lang: 'en', type: 'prefLabel' },
        ],
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')
      await flushPromises()

      // Should select prefLabel over altLabel
      expect(details.value?.broader[0].label).toBe('Pref Label')
    })

    it('selects label based on language priority', async () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('fr')

      setupMockForRelatedLabelsTest({
        relations: [{ property: 'http://www.w3.org/2004/02/skos/core#broader', value: 'http://example.org/broader/1' }],
        metadata: [{ uri: 'http://example.org/broader/1' }],
        labels: [
          { uri: 'http://example.org/broader/1', value: 'English Label', lang: 'en', type: 'prefLabel' },
          { uri: 'http://example.org/broader/1', value: 'French Label', lang: 'fr', type: 'prefLabel' },
        ],
      })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')
      await flushPromises()

      expect(details.value?.broader[0].label).toBe('French Label')
    })
  })

  describe('loadXLLabels', () => {
    it('loads SKOS-XL extended labels', async () => {
      // 1. Main query (empty - no relations)
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 2. Collections query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 3. XL labels query (no loadRelatedLabels call since no relations/collections)
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { xlLabel: { value: 'http://example.org/xl/1' }, labelType: { value: 'prefLabel' }, literalForm: { value: 'XL Pref Label' }, literalLang: { value: 'en' } },
            { xlLabel: { value: 'http://example.org/xl/2' }, labelType: { value: 'altLabel' }, literalForm: { value: 'XL Alt Label' }, literalLang: { value: 'en' } },
          ],
        },
      })
      // 4. Other properties query
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
      // 2. Collections query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 3. XL labels query
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            { xlLabel: { value: 'http://example.org/xl/1' }, labelType: { value: 'prefLabel' }, literalForm: { value: 'XL Label' }, literalLang: { value: 'en' } },
            { xlLabel: { value: 'http://example.org/xl/1' }, labelType: { value: 'prefLabel' }, literalForm: { value: 'XL Label' }, literalLang: { value: 'en' } },
          ],
        },
      })
      // 4. Other properties query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value?.prefLabelsXL).toHaveLength(1)
    })

    it('continues silently on XL labels query failure', async () => {
      // 1. Main query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 2. Collections query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 3. XL labels query fails
      ;(executeSparql as Mock).mockRejectedValueOnce(new Error('XL query failed'))
      // 4. Other properties query
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
      // 2. Collections query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 3. XL labels query (no loadRelatedLabels since no relations/collections)
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 4. Other properties query
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
      // 2. Collections query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 3. XL labels query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 4. Other properties query
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
      // 2. Collections query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 3. XL labels query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 4. Other properties query
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
      // 2. Collections query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 3. XL labels query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 4. Other properties query
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
      // 2. Collections query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 3. XL labels query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 4. Other properties query
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

      // Wait for async URI resolution (happens in .then() callback after loadOtherProperties)
      await vi.waitFor(() => {
        expect(resolvedPredicates.value.get('http://example.org/custom#prop')).toEqual({ prefix: 'ex', localName: 'prop' })
      })
    })

    it('continues silently on other properties query failure', async () => {
      // 1. Main query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 2. Collections query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 3. XL labels query
      ;(executeSparql as Mock).mockResolvedValueOnce({ results: { bindings: [] } })
      // 4. Other properties query fails
      ;(executeSparql as Mock).mockRejectedValueOnce(new Error('Query failed'))

      const { loadDetails, details, error } = useConceptData()
      await loadDetails('http://example.org/concept/1')

      expect(details.value).not.toBeNull()
      expect(error.value).toBeNull()
      expect(details.value?.otherProperties).toHaveLength(0)
    })
  })

  describe('selectBestLabelByLanguage (via loadRelatedLabels)', () => {
    // With progressive label loading, queries run in parallel.
    // We use mockImplementation to return results based on query content.

    function setupMockForLabelTest(labels: Array<{ value: string; lang: string; type: string }>) {
      ;(executeSparql as Mock).mockImplementation(async (_endpoint, query: string) => {
        // Main concept properties query
        if (query.includes('?property ?value') && query.includes('FILTER (?property IN')) {
          return {
            results: {
              bindings: [
                { property: { value: 'http://www.w3.org/2004/02/skos/core#broader' }, value: { value: 'http://example.org/broader/1' } },
              ],
            },
          }
        }
        // Collections query
        if (query.includes('skos:member') && query.includes('?collection')) {
          return { results: { bindings: [] } }
        }
        // Metadata query (no labels - checks for notation, hasNarrower)
        if (query.includes('?notation') && query.includes('?hasNarrower') && !query.includes('?label')) {
          return {
            results: {
              bindings: [
                { concept: { value: 'http://example.org/broader/1' } },
              ],
            },
          }
        }
        // Label query (has ?label in SELECT)
        if (query.includes('?label') && query.includes('VALUES ?concept')) {
          return {
            results: {
              bindings: labels.map(l => ({
                concept: { value: 'http://example.org/broader/1' },
                label: { value: l.value },
                labelLang: { value: l.lang },
                labelType: { value: l.type },
              })),
            },
          }
        }
        // Default empty response
        return { results: { bindings: [] } }
      })
    }

    it('returns preferred language match', async () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('de')

      setupMockForLabelTest([
        { value: 'English', lang: 'en', type: 'prefLabel' },
        { value: 'German', lang: 'de', type: 'prefLabel' },
        { value: 'French', lang: 'fr', type: 'prefLabel' },
      ])

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')
      await flushPromises() // Wait for async label loading

      expect(details.value?.broader[0].label).toBe('German')
    })

    it('falls back to endpoint language priorities', async () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('es') // Not available

      const endpointStore = useEndpointStore()
      endpointStore.updateEndpoint(endpointStore.currentId!, {
        languagePriorities: ['fr', 'en'], // French is first priority
      })

      setupMockForLabelTest([
        { value: 'English', lang: 'en', type: 'prefLabel' },
        { value: 'French', lang: 'fr', type: 'prefLabel' },
      ])

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')
      await flushPromises() // Wait for async label loading

      expect(details.value?.broader[0].label).toBe('French')
    })

    it('falls back to no-lang label when no language match', async () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('es')

      const endpointStore = useEndpointStore()
      endpointStore.updateEndpoint(endpointStore.currentId!, {
        languagePriorities: ['it'], // Not available
      })

      setupMockForLabelTest([
        { value: 'No Lang Label', lang: '', type: 'prefLabel' },
        { value: 'Japanese', lang: 'ja', type: 'prefLabel' },
      ])

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')
      await flushPromises() // Wait for async label loading

      expect(details.value?.broader[0].label).toBe('No Lang Label')
    })

    it('returns first available as last resort', async () => {
      const languageStore = useLanguageStore()
      languageStore.setPreferred('es')

      const endpointStore = useEndpointStore()
      endpointStore.updateEndpoint(endpointStore.currentId!, {
        languagePriorities: [],
      })

      setupMockForLabelTest([
        { value: 'First Label', lang: 'ja', type: 'prefLabel' },
        { value: 'Second Label', lang: 'zh', type: 'prefLabel' },
      ])

      const { loadDetails, details } = useConceptData()
      await loadDetails('http://example.org/concept/1')
      await flushPromises() // Wait for async label loading

      expect(details.value?.broader[0].label).toBe('First Label')
    })
  })
})
