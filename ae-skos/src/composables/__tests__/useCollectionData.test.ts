/**
 * useCollectionData Composable Tests
 *
 * Tests for SKOS Collection details and member loading.
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { useCollectionData } from '../useCollectionData'
import { useEndpointStore } from '../../stores'

// Mock the services
vi.mock('../../services/sparql', () => ({
  executeSparql: vi.fn(),
  withPrefixes: vi.fn((q) => q),
  endpointHasCollections: vi.fn(() => true),
}))

vi.mock('../../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../../services/prefixes', () => ({
  resolveUris: vi.fn().mockResolvedValue(new Map()),
}))

// Mock useOtherProperties
vi.mock('../useOtherProperties', () => ({
  useOtherProperties: () => ({
    loadOtherProperties: vi.fn().mockResolvedValue(undefined),
  }),
  COLLECTION_EXCLUDED_PREDICATES: [],
}))

// Mock useXLLabels - allows tests to populate XL labels via mockXLLabelsData
let mockXLLabelsData: {
  prefLabelsXL?: Array<{ uri: string; literalForm: { value: string; lang?: string } }>
  altLabelsXL?: Array<{ uri: string; literalForm: { value: string; lang?: string } }>
  hiddenLabelsXL?: Array<{ uri: string; literalForm: { value: string; lang?: string } }>
} = {}

vi.mock('../useXLLabels', () => ({
  useXLLabels: () => ({
    loadXLLabels: vi.fn((uri: string, target: { prefLabelsXL: unknown[]; altLabelsXL: unknown[]; hiddenLabelsXL: unknown[] }) => {
      if (mockXLLabelsData.prefLabelsXL) {
        target.prefLabelsXL.push(...mockXLLabelsData.prefLabelsXL)
      }
      if (mockXLLabelsData.altLabelsXL) {
        target.altLabelsXL.push(...mockXLLabelsData.altLabelsXL)
      }
      if (mockXLLabelsData.hiddenLabelsXL) {
        target.hiddenLabelsXL.push(...mockXLLabelsData.hiddenLabelsXL)
      }
      return Promise.resolve()
    }),
  }),
}))

// Mock useLabelResolver
vi.mock('../useLabelResolver', () => ({
  useLabelResolver: () => ({
    selectLabel: vi.fn((labels: { value: string; lang?: string }[]) => {
      // Simple mock: prefer 'en', then first available
      const enLabel = labels.find((l) => l.lang === 'en')
      if (enLabel) return enLabel
      return labels[0]
    }),
    sortLabels: vi.fn((labels) => labels),
  }),
}))

// Mock useProgressiveLabelLoader - allows tests to populate member labels via mockMemberLabelsData
// Use vi.hoisted to ensure the variable is available when the mock is hoisted
const { mockMemberLabelsData } = vi.hoisted(() => ({
  mockMemberLabelsData: { current: new Map<string, { value: string; lang?: string }>() },
}))

vi.mock('../useProgressiveLabelLoader', () => ({
  useProgressiveLabelLoader: () => ({
    loadLabelsProgressively: vi.fn(
      (
        _uris: string[],
        _resourceType: string,
        callback: (resolved: Map<string, { value: string; lang?: string }>) => void
      ) => {
        // Call callback with mock labels data
        callback(mockMemberLabelsData.current)
        return Promise.resolve()
      }
    ),
  }),
}))

import { executeSparql } from '../../services/sparql'

describe('useCollectionData', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    // Reset XL labels mock data
    mockXLLabelsData = {}

    // Reset member labels mock data
    mockMemberLabelsData.current = new Map()

    // Set up default endpoint
    const endpointStore = useEndpointStore()
    const endpoint = endpointStore.addEndpoint({
      name: 'Test Endpoint',
      url: 'https://example.org/sparql',
    })
    endpointStore.selectEndpoint(endpoint.id)

    // Default mock implementation
    ;(executeSparql as Mock).mockResolvedValue({ results: { bindings: [] } })
  })

  describe('initial state', () => {
    it('has correct initial values', () => {
      const { details, members, loading, loadingMembers, error } = useCollectionData()

      expect(details.value).toBeNull()
      expect(members.value).toEqual([])
      expect(loading.value).toBe(false)
      expect(loadingMembers.value).toBe(false)
      expect(error.value).toBeNull()
    })
  })

  describe('loadDetails', () => {
    it('returns early when no endpoint is selected', async () => {
      const endpointStore = useEndpointStore()
      endpointStore.selectEndpoint(null as unknown as string)

      const { loadDetails, loading } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(executeSparql).not.toHaveBeenCalled()
      expect(loading.value).toBe(false)
    })

    it('sets loading state during execution', async () => {
      const { loadDetails, loading } = useCollectionData()

      expect(loading.value).toBe(false)
      const promise = loadDetails('http://example.org/collection/1')
      expect(loading.value).toBe(true)

      await promise
      expect(loading.value).toBe(false)
    })

    it('loads collection with prefLabel', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://www.w3.org/2004/02/skos/core#prefLabel' },
              o: { value: 'Collection One' },
              lang: { value: 'en' },
              labelType: { value: 'prefLabel' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value).not.toBeNull()
      expect(details.value?.uri).toBe('http://example.org/collection/1')
      expect(details.value?.prefLabels).toHaveLength(1)
      expect(details.value?.prefLabels[0].value).toBe('Collection One')
    })

    it('picks prefLabel over other label types', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://www.w3.org/2000/01/rdf-schema#label' },
              o: { value: 'RDFS Label' },
              lang: { value: 'en' },
              labelType: { value: 'rdfsLabel' },
            },
            {
              p: { value: 'http://www.w3.org/2004/02/skos/core#prefLabel' },
              o: { value: 'Pref Label' },
              lang: { value: 'en' },
              labelType: { value: 'prefLabel' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      // Should have only prefLabels (not rdfsLabel)
      expect(details.value?.prefLabels.length).toBeGreaterThanOrEqual(1)
      expect(details.value?.prefLabels.some((l) => l.value === 'Pref Label')).toBe(true)
      expect(details.value?.prefLabels.some((l) => l.value === 'RDFS Label')).toBe(false)
    })

    it('stores dcTitle and rdfsLabel separately', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://www.w3.org/2000/01/rdf-schema#label' },
              o: { value: 'RDFS Label' },
              lang: { value: 'en' },
              labelType: { value: 'rdfsLabel' },
            },
            {
              p: { value: 'http://purl.org/dc/elements/1.1/title' },
              o: { value: 'DC Title' },
              lang: { value: 'en' },
              labelType: { value: 'dcTitle' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      // dcTitle stored in dcTitles array
      expect(details.value?.dcTitles?.length).toBeGreaterThanOrEqual(1)
      expect(details.value?.dcTitles?.some((l) => l.value === 'DC Title')).toBe(true)
      // rdfsLabel stored in rdfsLabels array
      expect(details.value?.rdfsLabels?.length).toBeGreaterThanOrEqual(1)
      expect(details.value?.rdfsLabels?.some((l) => l.value === 'RDFS Label')).toBe(true)
    })

    it('handles notation', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://www.w3.org/2004/02/skos/core#notation' },
              o: { value: 'C1', datatype: 'http://www.w3.org/2001/XMLSchema#string' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.notations).toHaveLength(1)
      expect(details.value?.notations[0].value).toBe('C1')
    })

    it('handles definitions, scopeNotes, and notes', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://www.w3.org/2004/02/skos/core#definition' },
              o: { value: 'A definition' },
              lang: { value: 'en' },
            },
            {
              p: { value: 'http://www.w3.org/2004/02/skos/core#scopeNote' },
              o: { value: 'A scope note' },
              lang: { value: 'en' },
            },
            {
              p: { value: 'http://www.w3.org/2004/02/skos/core#note' },
              o: { value: 'A note' },
              lang: { value: 'en' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.definitions).toHaveLength(1)
      expect(details.value?.definitions[0].value).toBe('A definition')
      expect(details.value?.scopeNotes).toHaveLength(1)
      expect(details.value?.scopeNotes[0].value).toBe('A scope note')
      expect(details.value?.notes).toHaveLength(1)
      expect(details.value?.notes[0].value).toBe('A note')
    })

    it('handles historyNote, changeNote, editorialNote, and example', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://www.w3.org/2004/02/skos/core#historyNote' },
              o: { value: 'History note text' },
              lang: { value: 'en' },
            },
            {
              p: { value: 'http://www.w3.org/2004/02/skos/core#changeNote' },
              o: { value: 'Change note text' },
              lang: { value: 'en' },
            },
            {
              p: { value: 'http://www.w3.org/2004/02/skos/core#editorialNote' },
              o: { value: 'Editorial note text' },
              lang: { value: 'en' },
            },
            {
              p: { value: 'http://www.w3.org/2004/02/skos/core#example' },
              o: { value: 'Example text' },
              lang: { value: 'en' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.historyNotes).toHaveLength(1)
      expect(details.value?.historyNotes[0].value).toBe('History note text')
      expect(details.value?.changeNotes).toHaveLength(1)
      expect(details.value?.changeNotes[0].value).toBe('Change note text')
      expect(details.value?.editorialNotes).toHaveLength(1)
      expect(details.value?.editorialNotes[0].value).toBe('Editorial note text')
      expect(details.value?.examples).toHaveLength(1)
      expect(details.value?.examples[0].value).toBe('Example text')
    })

    it('handles altLabels', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://www.w3.org/2004/02/skos/core#altLabel' },
              o: { value: 'Alternative Label' },
              lang: { value: 'en' },
              labelType: { value: 'altLabel' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.altLabels.length).toBeGreaterThanOrEqual(1)
      expect(details.value?.altLabels.some((l) => l.value === 'Alternative Label')).toBe(true)
    })

    it('handles hiddenLabels', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://www.w3.org/2004/02/skos/core#hiddenLabel' },
              o: { value: 'Hidden Label' },
              lang: { value: 'en' },
              labelType: { value: 'hiddenLabel' },
            },
            {
              p: { value: 'http://www.w3.org/2004/02/skos/core#hiddenLabel' },
              o: { value: 'Étiquette cachée' },
              lang: { value: 'fr' },
              labelType: { value: 'hiddenLabel' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.hiddenLabels).toHaveLength(2)
      expect(details.value?.hiddenLabels[0].value).toBe('Hidden Label')
      expect(details.value?.hiddenLabels[0].lang).toBe('en')
      expect(details.value?.hiddenLabels[1].value).toBe('Étiquette cachée')
      expect(details.value?.hiddenLabels[1].lang).toBe('fr')
    })

    it('handles prefLabelsXL via loadXLLabels', async () => {
      // Set up mock XL labels data
      mockXLLabelsData = {
        prefLabelsXL: [
          { uri: 'http://example.org/xl/pref1', literalForm: { value: 'XL Pref Label', lang: 'en' } },
          { uri: 'http://example.org/xl/pref2', literalForm: { value: 'XL Étiquette préférée', lang: 'fr' } },
        ],
      }

      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: { bindings: [] },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.prefLabelsXL).toHaveLength(2)
      expect(details.value?.prefLabelsXL[0].literalForm.value).toBe('XL Pref Label')
      expect(details.value?.prefLabelsXL[0].literalForm.lang).toBe('en')
      expect(details.value?.prefLabelsXL[1].literalForm.value).toBe('XL Étiquette préférée')
      expect(details.value?.prefLabelsXL[1].literalForm.lang).toBe('fr')
    })

    it('handles altLabelsXL via loadXLLabels', async () => {
      mockXLLabelsData = {
        altLabelsXL: [
          { uri: 'http://example.org/xl/alt1', literalForm: { value: 'XL Alt Label', lang: 'en' } },
        ],
      }

      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: { bindings: [] },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.altLabelsXL).toHaveLength(1)
      expect(details.value?.altLabelsXL[0].literalForm.value).toBe('XL Alt Label')
      expect(details.value?.altLabelsXL[0].literalForm.lang).toBe('en')
    })

    it('handles hiddenLabelsXL via loadXLLabels', async () => {
      mockXLLabelsData = {
        hiddenLabelsXL: [
          { uri: 'http://example.org/xl/hidden1', literalForm: { value: 'XL Hidden Label', lang: 'en' } },
          { uri: 'http://example.org/xl/hidden2', literalForm: { value: 'XL Étiquette cachée', lang: 'fr' } },
        ],
      }

      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: { bindings: [] },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.hiddenLabelsXL).toHaveLength(2)
      expect(details.value?.hiddenLabelsXL[0].literalForm.value).toBe('XL Hidden Label')
      expect(details.value?.hiddenLabelsXL[0].literalForm.lang).toBe('en')
      expect(details.value?.hiddenLabelsXL[1].literalForm.value).toBe('XL Étiquette cachée')
      expect(details.value?.hiddenLabelsXL[1].literalForm.lang).toBe('fr')
    })

    it('handles rdfs:comment', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://www.w3.org/2000/01/rdf-schema#comment' },
              o: { value: 'A comment about this collection' },
              lang: { value: 'en' },
              labelType: { value: 'comment' },
            },
            {
              p: { value: 'http://www.w3.org/2000/01/rdf-schema#comment' },
              o: { value: 'Un commentaire' },
              lang: { value: 'fr' },
              labelType: { value: 'comment' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.comments).toHaveLength(2)
      expect(details.value?.comments[0].value).toBe('A comment about this collection')
      expect(details.value?.comments[0].lang).toBe('en')
      expect(details.value?.comments[1].value).toBe('Un commentaire')
      expect(details.value?.comments[1].lang).toBe('fr')
    })

    it('handles dct:description', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://purl.org/dc/terms/description' },
              o: { value: 'A detailed description of the collection' },
              lang: { value: 'en' },
              labelType: { value: 'description' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.description).toHaveLength(1)
      expect(details.value?.description[0].value).toBe('A detailed description of the collection')
      expect(details.value?.description[0].lang).toBe('en')
    })

    it('handles owl:deprecated', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://www.w3.org/2002/07/owl#deprecated' },
              o: { value: 'true' },
              labelType: { value: 'deprecated' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.deprecated).toBe(true)
    })

    it('handles dct:created', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://purl.org/dc/terms/created' },
              o: { value: '2023-01-15', datatype: 'http://www.w3.org/2001/XMLSchema#date' },
              labelType: { value: 'created' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.created).toEqual({ value: '2023-01-15', datatype: 'http://www.w3.org/2001/XMLSchema#date' })
    })

    it('handles dct:modified', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://purl.org/dc/terms/modified' },
              o: { value: '2024-06-20', datatype: 'http://www.w3.org/2001/XMLSchema#dateTime' },
              labelType: { value: 'modified' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.modified).toEqual({ value: '2024-06-20', datatype: 'http://www.w3.org/2001/XMLSchema#dateTime' })
    })

    it('handles dct:issued', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://purl.org/dc/terms/issued' },
              o: { value: '2024-01-01' },
              labelType: { value: 'issued' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.issued).toEqual({ value: '2024-01-01', datatype: undefined })
    })

    it('handles owl:versionInfo', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://www.w3.org/2002/07/owl#versionInfo' },
              o: { value: '2.0.1', datatype: 'http://www.w3.org/2001/XMLSchema#string' },
              labelType: { value: 'versionInfo' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.versionInfo).toEqual({ value: '2.0.1', datatype: 'http://www.w3.org/2001/XMLSchema#string' })
    })

    it('handles dct:status as URI (extracts fragment)', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://purl.org/dc/terms/status' },
              o: { value: 'http://purl.org/adms/status/Active', type: 'uri' },
              labelType: { value: 'status' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.status).toBe('Active')
    })

    it('handles dct:status as literal', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://purl.org/dc/terms/status' },
              o: { value: 'Published' },
              labelType: { value: 'status' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.status).toBe('Published')
    })

    it('handles dc:identifier', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://purl.org/dc/elements/1.1/identifier' },
              o: { value: 'COLL-001' },
              labelType: { value: 'identifier' },
            },
            {
              p: { value: 'http://purl.org/dc/elements/1.1/identifier' },
              o: { value: 'COLL-001-A' },
              labelType: { value: 'identifier' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.identifier).toHaveLength(2)
      expect(details.value?.identifier).toContain('COLL-001')
      expect(details.value?.identifier).toContain('COLL-001-A')
    })

    it('deduplicates dc:identifier', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://purl.org/dc/elements/1.1/identifier' },
              o: { value: 'COLL-001' },
              labelType: { value: 'identifier' },
            },
            {
              p: { value: 'http://purl.org/dc/elements/1.1/identifier' },
              o: { value: 'COLL-001' },
              labelType: { value: 'identifier' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.identifier).toHaveLength(1)
    })

    it('handles dct:creator', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://purl.org/dc/terms/creator' },
              o: { value: 'http://example.org/person/1', type: 'uri' },
              labelType: { value: 'creator' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.creator).toHaveLength(1)
      expect(details.value?.creator).toContain('http://example.org/person/1')
    })

    it('handles dct:publisher', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://purl.org/dc/terms/publisher' },
              o: { value: 'http://example.org/org/1', type: 'uri' },
              labelType: { value: 'publisher' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.publisher).toHaveLength(1)
      expect(details.value?.publisher).toContain('http://example.org/org/1')
    })

    it('handles dct:rights', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://purl.org/dc/terms/rights' },
              o: { value: 'http://example.org/rights/1', type: 'uri' },
              labelType: { value: 'rights' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.rights).toHaveLength(1)
      expect(details.value?.rights).toContain('http://example.org/rights/1')
    })

    it('handles dct:license', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://purl.org/dc/terms/license' },
              o: { value: 'http://creativecommons.org/licenses/by/4.0/', type: 'uri' },
              labelType: { value: 'license' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.license).toHaveLength(1)
      expect(details.value?.license).toContain('http://creativecommons.org/licenses/by/4.0/')
    })

    it('handles cc:license', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://creativecommons.org/ns#license' },
              o: { value: 'http://creativecommons.org/publicdomain/zero/1.0/', type: 'uri' },
              labelType: { value: 'ccLicense' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.ccLicense).toHaveLength(1)
      expect(details.value?.ccLicense).toContain('http://creativecommons.org/publicdomain/zero/1.0/')
    })

    it('handles rdfs:seeAlso', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://www.w3.org/2000/01/rdf-schema#seeAlso' },
              o: { value: 'http://example.org/related/1', type: 'uri' },
              labelType: { value: 'seeAlso' },
            },
            {
              p: { value: 'http://www.w3.org/2000/01/rdf-schema#seeAlso' },
              o: { value: 'http://example.org/related/2', type: 'uri' },
              labelType: { value: 'seeAlso' },
            },
          ],
        },
      })

      const { loadDetails, details } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value?.seeAlso).toHaveLength(2)
      expect(details.value?.seeAlso).toContain('http://example.org/related/1')
      expect(details.value?.seeAlso).toContain('http://example.org/related/2')
    })

    it('sets error on query failure', async () => {
      ;(executeSparql as Mock).mockRejectedValueOnce(new Error('Network error'))

      const { loadDetails, details, error } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      expect(details.value).toBeNull()
      expect(error.value).toContain('Network error')
    })
  })

  describe('member loading', () => {
    it('loads members with labels', async () => {
      // Use mockImplementation to handle different query types
      ;(executeSparql as Mock).mockImplementation(async (_endpoint, query: string) => {
        // Details query (has UNION for labels)
        if (query.includes('labelType') && !query.includes('skos:member')) {
          return { results: { bindings: [] } }
        }
        // Members metadata query (has skos:member)
        if (query.includes('skos:member')) {
          return {
            results: {
              bindings: [
                { member: { value: 'http://example.org/concept/1' } },
                { member: { value: 'http://example.org/concept/2' } },
              ],
            },
          }
        }
        return { results: { bindings: [] } }
      })

      // Set up mock labels via progressive loader mock
      mockMemberLabelsData.current = new Map([
        ['http://example.org/concept/1', { value: 'Concept One', lang: 'en' }],
        ['http://example.org/concept/2', { value: 'Concept Two', lang: 'en' }],
      ])

      const { loadDetails, members } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      // Wait for all async operations including loadMembers
      await flushPromises()

      expect(members.value).toHaveLength(2)
      expect(members.value[0].uri).toBe('http://example.org/concept/1')
      expect(members.value[0].label).toBe('Concept One')
    })

    it('picks prefLabel over dcTitle for members', async () => {
      // Note: Label priority is now handled by useProgressiveLabelLoader
      ;(executeSparql as Mock).mockImplementation(async (_endpoint, query: string) => {
        if (query.includes('skos:member')) {
          return { results: { bindings: [{ member: { value: 'http://example.org/concept/1' } }] } }
        }
        return { results: { bindings: [] } }
      })

      mockMemberLabelsData.current = new Map([
        ['http://example.org/concept/1', { value: 'Pref Label', lang: 'en' }],
      ])

      const { loadDetails, members } = useCollectionData()
      await loadDetails('http://example.org/collection/1')
      await flushPromises()

      expect(members.value[0].label).toBe('Pref Label')
    })

    it('picks dcTitle when no higher priority label exists for members', async () => {
      ;(executeSparql as Mock).mockImplementation(async (_endpoint, query: string) => {
        if (query.includes('skos:member')) {
          return { results: { bindings: [{ member: { value: 'http://example.org/concept/1' } }] } }
        }
        return { results: { bindings: [] } }
      })

      mockMemberLabelsData.current = new Map([
        ['http://example.org/concept/1', { value: 'DC Title', lang: 'en' }],
      ])

      const { loadDetails, members } = useCollectionData()
      await loadDetails('http://example.org/collection/1')
      await flushPromises()

      expect(members.value[0].label).toBe('DC Title')
    })

    it('handles member notation', async () => {
      ;(executeSparql as Mock).mockImplementation(async (_endpoint, query: string) => {
        if (query.includes('skos:member')) {
          return {
            results: {
              bindings: [{ member: { value: 'http://example.org/concept/1' }, notation: { value: 'C1' } }],
            },
          }
        }
        return { results: { bindings: [] } }
      })

      mockMemberLabelsData.current = new Map([
        ['http://example.org/concept/1', { value: 'Concept One', lang: 'en' }],
      ])

      const { loadDetails, members } = useCollectionData()
      await loadDetails('http://example.org/collection/1')
      await flushPromises()

      expect(members.value[0].notation).toBe('C1')
    })

    it('sorts members by label', async () => {
      ;(executeSparql as Mock).mockImplementation(async (_endpoint, query: string) => {
        if (query.includes('skos:member')) {
          return {
            results: {
              bindings: [
                { member: { value: 'http://example.org/concept/2' } },
                { member: { value: 'http://example.org/concept/1' } },
              ],
            },
          }
        }
        return { results: { bindings: [] } }
      })

      mockMemberLabelsData.current = new Map([
        ['http://example.org/concept/2', { value: 'Zebra', lang: 'en' }],
        ['http://example.org/concept/1', { value: 'Alpha', lang: 'en' }],
      ])

      const { loadDetails, members } = useCollectionData()
      await loadDetails('http://example.org/collection/1')
      await flushPromises()

      expect(members.value[0].label).toBe('Alpha')
      expect(members.value[1].label).toBe('Zebra')
    })

    it('loads ordered collection members in memberList order', async () => {
      const orderedUris = [
        'http://example.org/concept/2',
        'http://example.org/collection/ordered-child',
      ]
      const head = 'http://example.org/list/1'
      const node2 = 'http://example.org/list/2'
      const nil = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil'

      ;(executeSparql as Mock).mockImplementation(async (_endpoint, query: string) => {
        if (query.includes('ASK') && query.includes('skos:OrderedCollection')) {
          return { boolean: true }
        }
        if (query.includes('skos:memberList') && query.includes('rdf:first')) {
          return {
            results: {
              bindings: [
                { head: { value: head }, node: { value: node2 }, first: { value: orderedUris[1] }, rest: { value: nil } },
                { head: { value: head }, node: { value: head }, first: { value: orderedUris[0] }, rest: { value: node2 } },
              ],
            },
          }
        }
        if (query.includes('VALUES ?member')) {
          return {
            results: {
              bindings: [
                { member: { value: orderedUris[1] }, isOrderedCollection: { value: 'true' } },
                { member: { value: orderedUris[0] }, isCollection: { value: 'false' } },
              ],
            },
          }
        }
        if (query.includes('SELECT ?predicate ?value')) {
          return { results: { bindings: [] } }
        }
        if (query.includes('labelType') && !query.includes('skos:member')) {
          return { results: { bindings: [] } }
        }
        if (query.includes('hasNarrower')) {
          return { results: { bindings: [] } }
        }
        return { results: { bindings: [] } }
      })

      mockMemberLabelsData.current = new Map([
        [orderedUris[0], { value: 'ZZZ', lang: 'en' }],
        [orderedUris[1], { value: 'AAA', lang: 'en' }],
      ])

      const { loadDetails, members, memberCount } = useCollectionData()
      await loadDetails('http://example.org/collection/ordered')
      await flushPromises()

      expect(memberCount.value).toBe(2)
      expect(members.value.map((m) => m.uri)).toEqual(orderedUris)
      expect(members.value[1].type).toBe('orderedCollection')
    })

    it('extracts hasNarrower for member icons', async () => {
      ;(executeSparql as Mock).mockImplementation(async (_endpoint, query: string) => {
        if (query.includes('skos:member')) {
          return {
            results: {
              bindings: [
                { member: { value: 'http://example.org/concept/1' }, hasNarrower: { value: 'true' } },
                { member: { value: 'http://example.org/concept/2' }, hasNarrower: { value: 'false' } },
              ],
            },
          }
        }
        return { results: { bindings: [] } }
      })

      mockMemberLabelsData.current = new Map([
        ['http://example.org/concept/1', { value: 'Parent Concept', lang: 'en' }],
        ['http://example.org/concept/2', { value: 'Leaf Concept', lang: 'en' }],
      ])

      const { loadDetails, members } = useCollectionData()
      await loadDetails('http://example.org/collection/1')
      await flushPromises()

      const parentMember = members.value.find((m) => m.uri === 'http://example.org/concept/1')
      const leafMember = members.value.find((m) => m.uri === 'http://example.org/concept/2')

      expect(parentMember?.hasNarrower).toBe(true)
      expect(leafMember?.hasNarrower).toBeUndefined()
    })

    it('detects nested collections (isCollection sets type)', async () => {
      ;(executeSparql as Mock).mockImplementation(async (_endpoint, query: string) => {
        if (query.includes('skos:member')) {
          return {
            results: {
              bindings: [
                { member: { value: 'http://example.org/concept/1' }, isCollection: { value: 'false' } },
                { member: { value: 'http://example.org/collection/nested' }, isCollection: { value: 'true' } },
              ],
            },
          }
        }
        return { results: { bindings: [] } }
      })

      const { loadDetails, members } = useCollectionData()
      await loadDetails('http://example.org/collection/1')
      await flushPromises()

      const conceptMember = members.value.find((m) => m.uri === 'http://example.org/concept/1')
      const collectionMember = members.value.find((m) => m.uri === 'http://example.org/collection/nested')

      expect(conceptMember?.type).toBe('concept')
      expect(collectionMember?.type).toBe('collection')
    })

    it('extracts inCurrentScheme boolean for cross-scheme indicator', async () => {
      const { useSchemeStore } = await import('../../stores')
      const schemeStore = useSchemeStore()
      schemeStore.schemes = [{ uri: 'http://example.org/scheme/1', label: 'Test Scheme' }]
      schemeStore.selectScheme('http://example.org/scheme/1')

      ;(executeSparql as Mock).mockImplementation(async (_endpoint, query: string) => {
        if (query.includes('skos:member')) {
          return {
            results: {
              bindings: [
                { member: { value: 'http://example.org/concept/same-scheme' }, inCurrentScheme: { value: 'true' } },
                { member: { value: 'http://external.org/concept/other-scheme' }, inCurrentScheme: { value: 'false' } },
              ],
            },
          }
        }
        return { results: { bindings: [] } }
      })

      const { loadDetails, members } = useCollectionData()
      await loadDetails('http://example.org/collection/1')
      await flushPromises()

      const sameScheme = members.value.find((m) => m.uri === 'http://example.org/concept/same-scheme')
      const otherScheme = members.value.find((m) => m.uri === 'http://external.org/concept/other-scheme')

      expect(sameScheme?.inCurrentScheme).toBe(true)
      expect(otherScheme?.inCurrentScheme).toBe(false)
    })

    it('extracts displayScheme (first value found)', async () => {
      ;(executeSparql as Mock).mockImplementation(async (_endpoint, query: string) => {
        if (query.includes('skos:member')) {
          return {
            results: {
              bindings: [
                { member: { value: 'http://example.org/concept/1' }, displayScheme: { value: 'http://example.org/scheme/first' } },
                { member: { value: 'http://example.org/concept/1' }, displayScheme: { value: 'http://example.org/scheme/second' } },
              ],
            },
          }
        }
        return { results: { bindings: [] } }
      })

      const { loadDetails, members } = useCollectionData()
      await loadDetails('http://example.org/collection/1')
      await flushPromises()

      expect(members.value[0].displayScheme).toBe('http://example.org/scheme/first')
    })

    it('does not set cross-scheme fields on collection members', async () => {
      ;(executeSparql as Mock).mockImplementation(async (_endpoint, query: string) => {
        if (query.includes('skos:member')) {
          return {
            results: {
              bindings: [
                {
                  member: { value: 'http://example.org/nested-collection' },
                  isCollection: { value: 'true' },
                  inCurrentScheme: { value: 'false' },
                  displayScheme: { value: 'http://example.org/scheme/1' },
                },
              ],
            },
          }
        }
        return { results: { bindings: [] } }
      })

      const { loadDetails, members } = useCollectionData()
      await loadDetails('http://example.org/collection/1')
      await flushPromises()

      const nestedCollection = members.value.find((m) => m.uri === 'http://example.org/nested-collection')

      expect(nestedCollection?.type).toBe('collection')
      expect(nestedCollection?.inCurrentScheme).toBeUndefined()
      expect(nestedCollection?.displayScheme).toBeUndefined()
    })
  })

  describe('reset', () => {
    it('clears all state', async () => {
      ;(executeSparql as Mock).mockResolvedValueOnce({
        results: {
          bindings: [
            {
              p: { value: 'http://www.w3.org/2004/02/skos/core#prefLabel' },
              o: { value: 'Test' },
              labelType: { value: 'prefLabel' },
            },
          ],
        },
      })

      const { loadDetails, details, members, error, reset } = useCollectionData()
      await loadDetails('http://example.org/collection/1')
      expect(details.value).not.toBeNull()

      reset()

      expect(details.value).toBeNull()
      expect(members.value).toEqual([])
      expect(error.value).toBeNull()
    })
  })
})
