import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useEndpointCapabilities } from '../useEndpointCapabilities'
import type { SPARQLEndpoint } from '../../types'

function createEndpoint(analysis?: SPARQLEndpoint['analysis']): SPARQLEndpoint {
  return {
    id: 'test-1',
    name: 'Test Endpoint',
    url: 'https://example.org/sparql',
    createdAt: '2024-01-01',
    accessCount: 0,
    analysis,
  }
}

describe('useEndpointCapabilities', () => {
  describe('graphSupportStatus', () => {
    it('returns Unknown when no analysis', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint())
      const { graphSupportStatus } = useEndpointCapabilities(endpoint)
      expect(graphSupportStatus.value).toBe('Unknown')
    })

    it('returns Unknown when supportsNamedGraphs is null', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: null,
        skosGraphCount: null,
        analyzedAt: '2024-01-01',
      }))
      const { graphSupportStatus } = useEndpointCapabilities(endpoint)
      expect(graphSupportStatus.value).toBe('Unknown')
    })

    it('returns Yes when graphs are supported', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: 5,
        analyzedAt: '2024-01-01',
      }))
      const { graphSupportStatus } = useEndpointCapabilities(endpoint)
      expect(graphSupportStatus.value).toBe('Yes')
    })

    it('returns No when graphs are not supported', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: false,
        skosGraphCount: null,
        analyzedAt: '2024-01-01',
      }))
      const { graphSupportStatus } = useEndpointCapabilities(endpoint)
      expect(graphSupportStatus.value).toBe('No')
    })
  })

  describe('skosGraphStatus', () => {
    it('returns Unknown when no analysis', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint())
      const { skosGraphStatus } = useEndpointCapabilities(endpoint)
      expect(skosGraphStatus.value).toBe('Unknown')
    })

    it('returns Unknown when skosGraphCount is undefined', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        analyzedAt: '2024-01-01',
        // skosGraphCount not set
      }))
      const { skosGraphStatus } = useEndpointCapabilities(endpoint)
      expect(skosGraphStatus.value).toBe('Unknown')
    })

    it('returns Unknown when skosGraphCount is null', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: null,
        analyzedAt: '2024-01-01',
      }))
      const { skosGraphStatus } = useEndpointCapabilities(endpoint)
      expect(skosGraphStatus.value).toBe('Unknown')
    })

    it('returns None when skosGraphCount is 0', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: 0,
        analyzedAt: '2024-01-01',
      }))
      const { skosGraphStatus } = useEndpointCapabilities(endpoint)
      expect(skosGraphStatus.value).toBe('None')
    })

    it('returns singular graph when count is 1', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: 1,
        analyzedAt: '2024-01-01',
      }))
      const { skosGraphStatus } = useEndpointCapabilities(endpoint)
      expect(skosGraphStatus.value).toBe('1 graph')
    })

    it('returns plural graphs when count > 1', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: 5,
        analyzedAt: '2024-01-01',
      }))
      const { skosGraphStatus } = useEndpointCapabilities(endpoint)
      expect(skosGraphStatus.value).toBe('5 graphs')
    })

    it('formats large numbers with thousand separators', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: 1234,
        analyzedAt: '2024-01-01',
      }))
      const { skosGraphStatus } = useEndpointCapabilities(endpoint)
      expect(skosGraphStatus.value).toBe('1.234 graphs')
    })
  })

  describe('skosGraphSeverity', () => {
    it('returns secondary when unknown', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint())
      const { skosGraphSeverity } = useEndpointCapabilities(endpoint)
      expect(skosGraphSeverity.value).toBe('secondary')
    })

    it('returns warn when count is 0', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: 0,
        analyzedAt: '2024-01-01',
      }))
      const { skosGraphSeverity } = useEndpointCapabilities(endpoint)
      expect(skosGraphSeverity.value).toBe('warn')
    })

    it('returns success when count > 0', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: 3,
        analyzedAt: '2024-01-01',
      }))
      const { skosGraphSeverity } = useEndpointCapabilities(endpoint)
      expect(skosGraphSeverity.value).toBe('success')
    })
  })

  describe('skosGraphDescription', () => {
    it('returns null when unknown', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint())
      const { skosGraphDescription } = useEndpointCapabilities(endpoint)
      expect(skosGraphDescription.value).toBe(null)
    })

    it('returns message when count is 0', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: 0,
        analyzedAt: '2024-01-01',
      }))
      const { skosGraphDescription } = useEndpointCapabilities(endpoint)
      expect(skosGraphDescription.value).toBe('No graphs contain SKOS concepts or schemes')
    })

    it('returns singular description when count is 1', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: 1,
        analyzedAt: '2024-01-01',
      }))
      const { skosGraphDescription } = useEndpointCapabilities(endpoint)
      expect(skosGraphDescription.value).toBe('1 graph contain SKOS data')
    })

    it('returns plural description when count > 1', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: 5,
        analyzedAt: '2024-01-01',
      }))
      const { skosGraphDescription } = useEndpointCapabilities(endpoint)
      expect(skosGraphDescription.value).toBe('5 graphs contain SKOS data')
    })
  })

  describe('formatCount', () => {
    it('formats numbers with German locale (period separator)', () => {
      const endpoint = ref<SPARQLEndpoint | null>(null)
      const { formatCount } = useEndpointCapabilities(endpoint)
      expect(formatCount(1234567)).toBe('1.234.567')
    })
  })
})
