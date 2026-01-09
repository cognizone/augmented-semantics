/**
 * useXLLabels Composable Tests
 *
 * Tests for SKOS-XL extended label loading.
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useXLLabels } from '../useXLLabels'
import { useEndpointStore } from '../../stores'

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
  withPrefixes: vi.fn((q) => q),
}))

import { executeSparql } from '../../services/sparql'
import type { Mock } from 'vitest'

describe('useXLLabels', () => {
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

    // Default mock - empty results
    ;(executeSparql as Mock).mockResolvedValue({ results: { bindings: [] } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createTarget() {
    return {
      prefLabelsXL: [],
      altLabelsXL: [],
      hiddenLabelsXL: [],
    }
  }

  describe('loadXLLabels', () => {
    it('returns early if no endpoint', async () => {
      const endpointStore = useEndpointStore()
      endpointStore.selectEndpoint(null as unknown as string)

      const { loadXLLabels } = useXLLabels()
      const target = createTarget()

      await loadXLLabels('http://ex.org/concept', target)

      expect(executeSparql).not.toHaveBeenCalled()
    })

    it('loads prefLabelsXL', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            {
              xlLabel: { value: 'http://ex.org/xl1' },
              labelType: { value: 'prefLabel' },
              literalForm: { value: 'Preferred Label' },
              literalLang: { value: 'en' },
            },
          ],
        },
      })

      const { loadXLLabels } = useXLLabels()
      const target = createTarget()

      await loadXLLabels('http://ex.org/concept', target)

      expect(target.prefLabelsXL).toHaveLength(1)
      expect(target.prefLabelsXL[0]).toEqual({
        uri: 'http://ex.org/xl1',
        literalForm: { value: 'Preferred Label', lang: 'en' },
      })
    })

    it('loads altLabelsXL', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            {
              xlLabel: { value: 'http://ex.org/xl2' },
              labelType: { value: 'altLabel' },
              literalForm: { value: 'Alternative Label' },
              literalLang: { value: 'fr' },
            },
          ],
        },
      })

      const { loadXLLabels } = useXLLabels()
      const target = createTarget()

      await loadXLLabels('http://ex.org/concept', target)

      expect(target.altLabelsXL).toHaveLength(1)
      expect(target.altLabelsXL[0]).toEqual({
        uri: 'http://ex.org/xl2',
        literalForm: { value: 'Alternative Label', lang: 'fr' },
      })
    })

    it('loads hiddenLabelsXL', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            {
              xlLabel: { value: 'http://ex.org/xl3' },
              labelType: { value: 'hiddenLabel' },
              literalForm: { value: 'Hidden Label' },
            },
          ],
        },
      })

      const { loadXLLabels } = useXLLabels()
      const target = createTarget()

      await loadXLLabels('http://ex.org/concept', target)

      expect(target.hiddenLabelsXL).toHaveLength(1)
      expect(target.hiddenLabelsXL[0]).toEqual({
        uri: 'http://ex.org/xl3',
        literalForm: { value: 'Hidden Label', lang: undefined },
      })
    })

    it('deduplicates by XL label URI', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            {
              xlLabel: { value: 'http://ex.org/xl1' },
              labelType: { value: 'prefLabel' },
              literalForm: { value: 'Label 1' },
            },
            {
              xlLabel: { value: 'http://ex.org/xl1' }, // Same URI
              labelType: { value: 'prefLabel' },
              literalForm: { value: 'Label 1 Again' },
            },
          ],
        },
      })

      const { loadXLLabels } = useXLLabels()
      const target = createTarget()

      await loadXLLabels('http://ex.org/concept', target)

      expect(target.prefLabelsXL).toHaveLength(1)
    })

    it('skips bindings without literalForm', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            {
              xlLabel: { value: 'http://ex.org/xl1' },
              labelType: { value: 'prefLabel' },
              // No literalForm
            },
          ],
        },
      })

      const { loadXLLabels } = useXLLabels()
      const target = createTarget()

      await loadXLLabels('http://ex.org/concept', target)

      expect(target.prefLabelsXL).toHaveLength(0)
    })

    it('handles SPARQL errors gracefully', async () => {
      ;(executeSparql as Mock).mockRejectedValue(new Error('SKOS-XL not supported'))

      const { loadXLLabels } = useXLLabels()
      const target = createTarget()

      // Should not throw
      await loadXLLabels('http://ex.org/concept', target)

      expect(target.prefLabelsXL).toHaveLength(0)
    })

    it('loads multiple label types in one query', async () => {
      ;(executeSparql as Mock).mockResolvedValue({
        results: {
          bindings: [
            {
              xlLabel: { value: 'http://ex.org/xl1' },
              labelType: { value: 'prefLabel' },
              literalForm: { value: 'Pref' },
            },
            {
              xlLabel: { value: 'http://ex.org/xl2' },
              labelType: { value: 'altLabel' },
              literalForm: { value: 'Alt' },
            },
            {
              xlLabel: { value: 'http://ex.org/xl3' },
              labelType: { value: 'hiddenLabel' },
              literalForm: { value: 'Hidden' },
            },
          ],
        },
      })

      const { loadXLLabels } = useXLLabels()
      const target = createTarget()

      await loadXLLabels('http://ex.org/concept', target)

      expect(target.prefLabelsXL).toHaveLength(1)
      expect(target.altLabelsXL).toHaveLength(1)
      expect(target.hiddenLabelsXL).toHaveLength(1)
    })
  })
})
