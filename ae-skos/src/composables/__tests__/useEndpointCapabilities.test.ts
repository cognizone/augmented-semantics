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
  describe('skosContentStatus', () => {
    it('returns Unknown when no analysis', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint())
      const { skosContentStatus } = useEndpointCapabilities(endpoint)
      expect(skosContentStatus.value).toBe('Unknown')
    })

    it('returns Unknown when hasSkosContent is undefined', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: 5,
        analyzedAt: '2024-01-01',
        // hasSkosContent not set
      }))
      const { skosContentStatus } = useEndpointCapabilities(endpoint)
      expect(skosContentStatus.value).toBe('Unknown')
    })

    it('returns Yes when hasSkosContent is true', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        hasSkosContent: true,
        supportsNamedGraphs: true,
        skosGraphCount: 5,
        analyzedAt: '2024-01-01',
      }))
      const { skosContentStatus } = useEndpointCapabilities(endpoint)
      expect(skosContentStatus.value).toBe('Yes')
    })

    it('returns No when hasSkosContent is false', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        hasSkosContent: false,
        supportsNamedGraphs: true,
        skosGraphCount: 0,
        analyzedAt: '2024-01-01',
      }))
      const { skosContentStatus } = useEndpointCapabilities(endpoint)
      expect(skosContentStatus.value).toBe('No')
    })
  })

  describe('skosContentSeverity', () => {
    it('returns secondary when unknown', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint())
      const { skosContentSeverity } = useEndpointCapabilities(endpoint)
      expect(skosContentSeverity.value).toBe('secondary')
    })

    it('returns success when hasSkosContent is true', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        hasSkosContent: true,
        analyzedAt: '2024-01-01',
      }))
      const { skosContentSeverity } = useEndpointCapabilities(endpoint)
      expect(skosContentSeverity.value).toBe('success')
    })

    it('returns warn when hasSkosContent is false', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        hasSkosContent: false,
        analyzedAt: '2024-01-01',
      }))
      const { skosContentSeverity } = useEndpointCapabilities(endpoint)
      expect(skosContentSeverity.value).toBe('warn')
    })
  })

  describe('skosContentIcon', () => {
    it('returns question circle when unknown', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint())
      const { skosContentIcon } = useEndpointCapabilities(endpoint)
      expect(skosContentIcon.value).toContain('pi-question-circle')
    })

    it('returns check circle when hasSkosContent is true', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        hasSkosContent: true,
        analyzedAt: '2024-01-01',
      }))
      const { skosContentIcon } = useEndpointCapabilities(endpoint)
      expect(skosContentIcon.value).toContain('pi-check-circle')
    })

    it('returns warning triangle when hasSkosContent is false', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        hasSkosContent: false,
        analyzedAt: '2024-01-01',
      }))
      const { skosContentIcon } = useEndpointCapabilities(endpoint)
      expect(skosContentIcon.value).toContain('pi-exclamation-triangle')
    })
  })

  describe('skosContentDescription', () => {
    it('returns unknown message when no analysis', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint())
      const { skosContentDescription } = useEndpointCapabilities(endpoint)
      expect(skosContentDescription.value).toBe('Could not determine if endpoint contains SKOS data')
    })

    it('returns positive message when hasSkosContent is true', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        hasSkosContent: true,
        analyzedAt: '2024-01-01',
      }))
      const { skosContentDescription } = useEndpointCapabilities(endpoint)
      expect(skosContentDescription.value).toBe('Endpoint contains SKOS concepts or schemes')
    })

    it('returns negative message when hasSkosContent is false', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        hasSkosContent: false,
        analyzedAt: '2024-01-01',
      }))
      const { skosContentDescription } = useEndpointCapabilities(endpoint)
      expect(skosContentDescription.value).toBe('No SKOS concepts or schemes found in endpoint')
    })
  })

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
        skosGraphUris: new Array(1234).fill('http://example.org/graph'), // Provide array to avoid 500+ display
        analyzedAt: '2024-01-01',
      }))
      const { skosGraphStatus } = useEndpointCapabilities(endpoint)
      expect(skosGraphStatus.value).toBe('1.234 graphs')
    })

    it('shows "500+ graphs" when count > 500 and skosGraphUris is null', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: 750,
        skosGraphUris: null, // Hit the limit, couldn't enumerate
        analyzedAt: '2024-01-01',
      }))
      const { skosGraphStatus } = useEndpointCapabilities(endpoint)
      expect(skosGraphStatus.value).toBe('500+ graphs')
    })

    it('shows "500+ graphs" when count is exactly 501 and skosGraphUris is null', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: 501,
        skosGraphUris: null,
        analyzedAt: '2024-01-01',
      }))
      const { skosGraphStatus } = useEndpointCapabilities(endpoint)
      expect(skosGraphStatus.value).toBe('500+ graphs')
    })

    it('shows exact count when count > 500 but skosGraphUris array exists', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: 600,
        skosGraphUris: new Array(600).fill('http://example.org/graph'), // Array exists
        analyzedAt: '2024-01-01',
      }))
      const { skosGraphStatus } = useEndpointCapabilities(endpoint)
      expect(skosGraphStatus.value).toBe('600 graphs')
    })

    it('shows exact count when count ≤ 500', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: 500,
        skosGraphUris: new Array(500).fill('http://example.org/graph'),
        analyzedAt: '2024-01-01',
      }))
      const { skosGraphStatus } = useEndpointCapabilities(endpoint)
      expect(skosGraphStatus.value).toBe('500 graphs')
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

    it('returns special limit message when count > 500 and skosGraphUris is null', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: 750,
        skosGraphUris: null, // Hit the limit
        analyzedAt: '2024-01-01',
      }))
      const { skosGraphDescription } = useEndpointCapabilities(endpoint)
      expect(skosGraphDescription.value).toBe('More than 500 graphs contain SKOS data (too many to process individually)')
    })

    it('returns exact description when count > 500 but skosGraphUris array exists', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: 600,
        skosGraphUris: new Array(600).fill('http://example.org/graph'),
        analyzedAt: '2024-01-01',
      }))
      const { skosGraphDescription } = useEndpointCapabilities(endpoint)
      expect(skosGraphDescription.value).toBe('600 graphs contain SKOS data')
    })

    it('returns exact description when count ≤ 500', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: 500,
        skosGraphUris: new Array(500).fill('http://example.org/graph'),
        analyzedAt: '2024-01-01',
      }))
      const { skosGraphDescription } = useEndpointCapabilities(endpoint)
      expect(skosGraphDescription.value).toBe('500 graphs contain SKOS data')
    })

    it('formats large numbers in description with thousand separators', () => {
      const endpoint = ref<SPARQLEndpoint | null>(createEndpoint({
        supportsNamedGraphs: true,
        skosGraphCount: 1234,
        skosGraphUris: new Array(1234).fill('http://example.org/graph'),
        analyzedAt: '2024-01-01',
      }))
      const { skosGraphDescription } = useEndpointCapabilities(endpoint)
      expect(skosGraphDescription.value).toBe('1.234 graphs contain SKOS data')
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
