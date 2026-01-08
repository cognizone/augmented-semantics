import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useEndpointAnalysis } from '../useEndpointAnalysis'
import type { SPARQLEndpoint } from '../../types'

// Mock the SPARQL service functions
vi.mock('../../services/sparql', () => ({
  analyzeEndpoint: vi.fn(),
  detectGraphs: vi.fn(),
  detectSkosGraphs: vi.fn(),
  detectLanguages: vi.fn(),
}))

import {
  analyzeEndpoint as analyzeEndpointService,
  detectGraphs,
  detectSkosGraphs,
  detectLanguages,
} from '../../services/sparql'

describe('useEndpointAnalysis', () => {
  const mockEndpoint: SPARQLEndpoint = {
    id: 'test-1',
    name: 'Test Endpoint',
    url: 'https://example.org/sparql',
    createdAt: '2024-01-01',
    accessCount: 0,
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('has correct initial values', () => {
      const { analyzing, analyzeStep, analysisLog, analysisDuration } = useEndpointAnalysis()

      expect(analyzing.value).toBe(false)
      expect(analyzeStep.value).toBeNull()
      expect(analysisLog.value).toEqual([])
      expect(analysisDuration.value).toBeNull()
    })
  })

  describe('analyzeEndpoint', () => {
    it('performs simple analysis and returns result', async () => {
      const mockAnalysis = {
        hasSkosContent: true,
        supportsNamedGraphs: true,
        skosGraphCount: 5,
        languages: [{ lang: 'en', count: 100 }],
        analyzedAt: '2024-01-01T00:00:00Z',
      }
      ;(analyzeEndpointService as Mock).mockResolvedValue(mockAnalysis)

      const { analyzeEndpoint, analyzing, analyzeStep } = useEndpointAnalysis()

      const resultPromise = analyzeEndpoint(mockEndpoint)

      // Check loading state
      expect(analyzing.value).toBe(true)
      expect(analyzeStep.value).toBe('Analyzing endpoint structure...')

      const result = await resultPromise

      expect(result).toEqual(mockAnalysis)
      expect(analyzing.value).toBe(false)
      expect(analyzeStep.value).toBe('Done!')
    })

    it('handles errors gracefully', async () => {
      const error = new Error('Analysis failed')
      ;(analyzeEndpointService as Mock).mockRejectedValue(error)

      const { analyzeEndpoint, analyzing, analyzeStep } = useEndpointAnalysis()

      await expect(analyzeEndpoint(mockEndpoint)).rejects.toThrow('Analysis failed')
      expect(analyzing.value).toBe(false)
      expect(analyzeStep.value).toContain('Error:')
    })
  })

  describe('reanalyzeEndpoint', () => {
    it('performs full analysis with logging', async () => {
      ;(detectGraphs as Mock).mockResolvedValue({
        supportsNamedGraphs: true,
      })
      ;(detectSkosGraphs as Mock).mockResolvedValue({ skosGraphCount: 2, skosGraphUris: ['http://g1', 'http://g2'] })
      ;(detectLanguages as Mock).mockResolvedValue([
        { lang: 'en', count: 100 },
        { lang: 'fr', count: 50 },
      ])

      const { reanalyzeEndpoint, analysisLog } = useEndpointAnalysis()

      const result = await reanalyzeEndpoint(mockEndpoint)

      expect(result.supportsNamedGraphs).toBe(true)
      expect(result.skosGraphCount).toBe(2)
      expect(result.languages).toHaveLength(2)
      expect(result.analyzedAt).toBeDefined()

      // Check log entries (3 steps: graphs, skos graphs, languages)
      expect(analysisLog.value).toHaveLength(3)
    })

    it('skips SKOS graph detection when graphs not supported', async () => {
      ;(detectGraphs as Mock).mockResolvedValue({
        supportsNamedGraphs: null,
      })
      ;(detectLanguages as Mock).mockResolvedValue([])

      const { reanalyzeEndpoint, analysisLog } = useEndpointAnalysis()

      const result = await reanalyzeEndpoint(mockEndpoint)

      expect(detectSkosGraphs).not.toHaveBeenCalled()
      expect(result.skosGraphCount).toBe(null)
      expect(analysisLog.value.some(e => e.message.includes('skipped'))).toBe(true)
    })

    it('uses batched language detection when SKOS graph URIs available', async () => {
      const mockGraphUris = ['http://ex.org/g1', 'http://ex.org/g2', 'http://ex.org/g3']
      ;(detectGraphs as Mock).mockResolvedValue({
        supportsNamedGraphs: true,
      })
      ;(detectSkosGraphs as Mock).mockResolvedValue({ skosGraphCount: 3, skosGraphUris: mockGraphUris })
      ;(detectLanguages as Mock).mockResolvedValue([])

      const { reanalyzeEndpoint, analysisLog } = useEndpointAnalysis()

      await reanalyzeEndpoint(mockEndpoint)

      // When skosGraphUris available, uses batched detection with useGraphScope=true
      expect(detectLanguages).toHaveBeenCalledWith(mockEndpoint, true, mockGraphUris)
      expect(analysisLog.value.some(e => e.message.includes('batched'))).toBe(true)
    })

    it('uses default language detection when no SKOS graph URIs', async () => {
      ;(detectGraphs as Mock).mockResolvedValue({
        supportsNamedGraphs: true,
      })
      // Return null for skosGraphUris (too many graphs to batch)
      ;(detectSkosGraphs as Mock).mockResolvedValue({ skosGraphCount: 600, skosGraphUris: null })
      ;(detectLanguages as Mock).mockResolvedValue([])

      const { reanalyzeEndpoint, analysisLog } = useEndpointAnalysis()

      await reanalyzeEndpoint(mockEndpoint)

      // When no skosGraphUris available, falls back to default
      expect(detectLanguages).toHaveBeenCalledWith(mockEndpoint, false, null)
      expect(analysisLog.value.some(e => e.message.includes('default'))).toBe(true)
    })

    it('handles errors during reanalysis', async () => {
      ;(detectGraphs as Mock).mockRejectedValue(new Error('Network error'))

      const { reanalyzeEndpoint, analysisLog } = useEndpointAnalysis()

      await expect(reanalyzeEndpoint(mockEndpoint)).rejects.toThrow('Network error')
      expect(analysisLog.value.some(e => e.status === 'error')).toBe(true)
    })
  })

  describe('logStep', () => {
    it('adds log entries', () => {
      const { logStep, analysisLog } = useEndpointAnalysis()

      logStep('Test message', 'success')

      expect(analysisLog.value).toEqual([
        { message: 'Test message', status: 'success' }
      ])
    })

    it('defaults to pending status', () => {
      const { logStep, analysisLog } = useEndpointAnalysis()

      logStep('Pending message')

      expect(analysisLog.value[0].status).toBe('pending')
    })
  })

  describe('clearAnalysis', () => {
    it('resets all analysis state', async () => {
      ;(detectGraphs as Mock).mockResolvedValue({
        supportsNamedGraphs: true,
      })
      ;(detectSkosGraphs as Mock).mockResolvedValue({ skosGraphCount: 1, skosGraphUris: ['http://g1'] })
      ;(detectLanguages as Mock).mockResolvedValue([])

      const {
        reanalyzeEndpoint,
        clearAnalysis,
        analyzing,
        analyzeStep,
        analysisLog,
        analysisDuration
      } = useEndpointAnalysis()

      await reanalyzeEndpoint(mockEndpoint)

      clearAnalysis()

      expect(analyzing.value).toBe(false)
      expect(analyzeStep.value).toBeNull()
      expect(analysisLog.value).toEqual([])
      expect(analysisDuration.value).toBeNull()
    })
  })
})
