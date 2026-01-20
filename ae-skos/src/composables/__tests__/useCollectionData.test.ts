/**
 * useCollectionData Composable Tests
 *
 * Tests for SKOS Collection details and member loading.
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCollectionData } from '../useCollectionData'
import { useEndpointStore } from '../../stores'

// Mock the services
vi.mock('../../services/sparql', () => ({
  executeSparql: vi.fn(),
  withPrefixes: vi.fn((q) => q),
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

import { executeSparql } from '../../services/sparql'

describe('useCollectionData', () => {
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
      // First call is for details, second for members
      ;(executeSparql as Mock)
        .mockResolvedValueOnce({ results: { bindings: [] } }) // details
        .mockResolvedValueOnce({
          results: {
            bindings: [
              {
                member: { value: 'http://example.org/concept/1' },
                label: { value: 'Concept One' },
                labelLang: { value: 'en' },
                labelType: { value: 'prefLabel' },
              },
              {
                member: { value: 'http://example.org/concept/2' },
                label: { value: 'Concept Two' },
                labelLang: { value: 'en' },
                labelType: { value: 'prefLabel' },
              },
            ],
          },
        })

      const { loadDetails, members, loadingMembers } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      // Wait for members to finish loading
      await vi.waitFor(
        () => {
          expect(loadingMembers.value).toBe(false)
        },
        { timeout: 1000 }
      )

      expect(members.value).toHaveLength(2)
      expect(members.value[0].uri).toBe('http://example.org/concept/1')
      expect(members.value[0].label).toBe('Concept One')
    })

    it('picks prefLabel over dcTitle for members', async () => {
      ;(executeSparql as Mock)
        .mockResolvedValueOnce({ results: { bindings: [] } }) // details
        .mockResolvedValueOnce({
          results: {
            bindings: [
              {
                member: { value: 'http://example.org/concept/1' },
                label: { value: 'DC Title' },
                labelLang: { value: 'en' },
                labelType: { value: 'dcTitle' },
              },
              {
                member: { value: 'http://example.org/concept/1' },
                label: { value: 'Pref Label' },
                labelLang: { value: 'en' },
                labelType: { value: 'prefLabel' },
              },
            ],
          },
        })

      const { loadDetails, members, loadingMembers } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      await vi.waitFor(
        () => {
          expect(loadingMembers.value).toBe(false)
        },
        { timeout: 1000 }
      )

      expect(members.value[0].label).toBe('Pref Label')
    })

    it('picks dcTitle when no higher priority label exists for members', async () => {
      ;(executeSparql as Mock)
        .mockResolvedValueOnce({ results: { bindings: [] } }) // details
        .mockResolvedValueOnce({
          results: {
            bindings: [
              {
                member: { value: 'http://example.org/concept/1' },
                label: { value: 'RDFS Label' },
                labelLang: { value: 'en' },
                labelType: { value: 'rdfsLabel' },
              },
              {
                member: { value: 'http://example.org/concept/1' },
                label: { value: 'DC Title' },
                labelLang: { value: 'en' },
                labelType: { value: 'dcTitle' },
              },
            ],
          },
        })

      const { loadDetails, members, loadingMembers } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      await vi.waitFor(
        () => {
          expect(loadingMembers.value).toBe(false)
        },
        { timeout: 1000 }
      )

      expect(members.value[0].label).toBe('DC Title')
    })

    it('handles member notation', async () => {
      ;(executeSparql as Mock)
        .mockResolvedValueOnce({ results: { bindings: [] } }) // details
        .mockResolvedValueOnce({
          results: {
            bindings: [
              {
                member: { value: 'http://example.org/concept/1' },
                label: { value: 'Concept One' },
                labelLang: { value: 'en' },
                labelType: { value: 'prefLabel' },
                notation: { value: 'C1' },
              },
            ],
          },
        })

      const { loadDetails, members, loadingMembers } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      await vi.waitFor(
        () => {
          expect(loadingMembers.value).toBe(false)
        },
        { timeout: 1000 }
      )

      expect(members.value[0].notation).toBe('C1')
    })

    it('sorts members by label', async () => {
      ;(executeSparql as Mock)
        .mockResolvedValueOnce({ results: { bindings: [] } }) // details
        .mockResolvedValueOnce({
          results: {
            bindings: [
              {
                member: { value: 'http://example.org/concept/2' },
                label: { value: 'Zebra' },
                labelLang: { value: 'en' },
                labelType: { value: 'prefLabel' },
              },
              {
                member: { value: 'http://example.org/concept/1' },
                label: { value: 'Alpha' },
                labelLang: { value: 'en' },
                labelType: { value: 'prefLabel' },
              },
            ],
          },
        })

      const { loadDetails, members, loadingMembers } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      await vi.waitFor(
        () => {
          expect(loadingMembers.value).toBe(false)
        },
        { timeout: 1000 }
      )

      expect(members.value[0].label).toBe('Alpha')
      expect(members.value[1].label).toBe('Zebra')
    })

    it('extracts hasNarrower for member icons', async () => {
      ;(executeSparql as Mock)
        .mockResolvedValueOnce({ results: { bindings: [] } }) // details
        .mockResolvedValueOnce({
          results: {
            bindings: [
              {
                member: { value: 'http://example.org/concept/1' },
                label: { value: 'Parent Concept' },
                labelLang: { value: 'en' },
                labelType: { value: 'prefLabel' },
                hasNarrower: { value: 'true' },
              },
              {
                member: { value: 'http://example.org/concept/2' },
                label: { value: 'Leaf Concept' },
                labelLang: { value: 'en' },
                labelType: { value: 'prefLabel' },
                hasNarrower: { value: 'false' },
              },
            ],
          },
        })

      const { loadDetails, members, loadingMembers } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      await vi.waitFor(
        () => {
          expect(loadingMembers.value).toBe(false)
        },
        { timeout: 1000 }
      )

      // Find members by URI
      const parentMember = members.value.find((m) => m.uri === 'http://example.org/concept/1')
      const leafMember = members.value.find((m) => m.uri === 'http://example.org/concept/2')

      // Parent has children
      expect(parentMember?.hasNarrower).toBe(true)
      // Leaf has no children (hasNarrower is undefined when false)
      expect(leafMember?.hasNarrower).toBeUndefined()
    })

    it('detects nested collections (isCollection sets type)', async () => {
      ;(executeSparql as Mock)
        .mockResolvedValueOnce({ results: { bindings: [] } }) // details
        .mockResolvedValueOnce({
          results: {
            bindings: [
              {
                member: { value: 'http://example.org/concept/1' },
                isCollection: { value: 'false' },
              },
              {
                member: { value: 'http://example.org/collection/nested' },
                isCollection: { value: 'true' },
              },
            ],
          },
        })

      const { loadDetails, members, loadingMembers } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      await vi.waitFor(
        () => {
          expect(loadingMembers.value).toBe(false)
        },
        { timeout: 1000 }
      )

      const conceptMember = members.value.find((m) => m.uri === 'http://example.org/concept/1')
      const collectionMember = members.value.find((m) => m.uri === 'http://example.org/collection/nested')

      expect(conceptMember?.type).toBe('concept')
      expect(collectionMember?.type).toBe('collection')
    })

    it('extracts inCurrentScheme boolean for cross-scheme indicator', async () => {
      // Set up a scheme for cross-scheme detection
      const { useSchemeStore } = await import('../../stores')
      const schemeStore = useSchemeStore()
      schemeStore.schemes = [{ uri: 'http://example.org/scheme/1', label: 'Test Scheme' }]
      schemeStore.selectScheme('http://example.org/scheme/1')

      ;(executeSparql as Mock)
        .mockResolvedValueOnce({ results: { bindings: [] } }) // details
        .mockResolvedValueOnce({
          results: {
            bindings: [
              {
                member: { value: 'http://example.org/concept/same-scheme' },
                inCurrentScheme: { value: 'true' },
              },
              {
                member: { value: 'http://external.org/concept/other-scheme' },
                inCurrentScheme: { value: 'false' },
              },
            ],
          },
        })

      const { loadDetails, members, loadingMembers } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      await vi.waitFor(
        () => {
          expect(loadingMembers.value).toBe(false)
        },
        { timeout: 1000 }
      )

      const sameScheme = members.value.find((m) => m.uri === 'http://example.org/concept/same-scheme')
      const otherScheme = members.value.find((m) => m.uri === 'http://external.org/concept/other-scheme')

      expect(sameScheme?.inCurrentScheme).toBe(true)
      expect(otherScheme?.inCurrentScheme).toBe(false)
    })

    it('extracts displayScheme (first value found)', async () => {
      ;(executeSparql as Mock)
        .mockResolvedValueOnce({ results: { bindings: [] } }) // details
        .mockResolvedValueOnce({
          results: {
            bindings: [
              // First binding has displayScheme
              {
                member: { value: 'http://example.org/concept/1' },
                displayScheme: { value: 'http://example.org/scheme/first' },
              },
              // Second binding for same member has different displayScheme (should be ignored)
              {
                member: { value: 'http://example.org/concept/1' },
                displayScheme: { value: 'http://example.org/scheme/second' },
              },
            ],
          },
        })

      const { loadDetails, members, loadingMembers } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      await vi.waitFor(
        () => {
          expect(loadingMembers.value).toBe(false)
        },
        { timeout: 1000 }
      )

      // Should use first displayScheme value found
      expect(members.value[0].displayScheme).toBe('http://example.org/scheme/first')
    })

    it('does not set cross-scheme fields on collection members', async () => {
      ;(executeSparql as Mock)
        .mockResolvedValueOnce({ results: { bindings: [] } }) // details
        .mockResolvedValueOnce({
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
        })

      const { loadDetails, members, loadingMembers } = useCollectionData()
      await loadDetails('http://example.org/collection/1')

      await vi.waitFor(
        () => {
          expect(loadingMembers.value).toBe(false)
        },
        { timeout: 1000 }
      )

      const nestedCollection = members.value.find((m) => m.uri === 'http://example.org/nested-collection')

      // Collection members should not have cross-scheme fields
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
