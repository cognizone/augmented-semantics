import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useEndpointAnalysis } from '../useEndpointAnalysis'
import type { SPARQLEndpoint } from '../../types'

// Mock the SPARQL service functions
vi.mock('../../services/sparql', () => ({
  analyzeEndpoint: vi.fn(),
  detectGraphs: vi.fn(),
  detectSkosGraphs: vi.fn(),
  detectDuplicates: vi.fn(),
  detectLanguages: vi.fn(),
}))

import {
  analyzeEndpoint as analyzeEndpointService,
  detectGraphs,
  detectSkosGraphs,
  detectDuplicates,
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
        supportsNamedGraphs: true,
        graphCount: 5,
        graphCountExact: true,
        hasDuplicateTriples: false,
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
        graphCount: 3,
        graphCountExact: true,
        queryMethod: 'empty-pattern',
      })
      ;(detectSkosGraphs as Mock).mockResolvedValue({ skosGraphCount: 2, skosGraphUris: ['http://g1', 'http://g2'] })
      ;(detectDuplicates as Mock).mockResolvedValue({ hasDuplicates: false })
      ;(detectLanguages as Mock).mockResolvedValue([
        { lang: 'en', count: 100 },
        { lang: 'fr', count: 50 },
      ])

      const { reanalyzeEndpoint, analysisLog } = useEndpointAnalysis()

      const result = await reanalyzeEndpoint(mockEndpoint)

      expect(result.supportsNamedGraphs).toBe(true)
      expect(result.graphCount).toBe(3)
      expect(result.skosGraphCount).toBe(2)
      expect(result.hasDuplicateTriples).toBe(false)
      expect(result.languages).toHaveLength(2)
      expect(result.analyzedAt).toBeDefined()

      // Check log entries (4 steps: graphs, skos graphs, duplicates, languages)
      expect(analysisLog.value).toHaveLength(4)
    })

    it('skips duplicate check for single graph', async () => {
      ;(detectGraphs as Mock).mockResolvedValue({
        supportsNamedGraphs: true,
        graphCount: 1,
        graphCountExact: true,
        queryMethod: 'empty-pattern',
      })
      ;(detectSkosGraphs as Mock).mockResolvedValue({ skosGraphCount: 1, skosGraphUris: ['http://g1'] })
      ;(detectLanguages as Mock).mockResolvedValue([])

      const { reanalyzeEndpoint, analysisLog } = useEndpointAnalysis()

      const result = await reanalyzeEndpoint(mockEndpoint)

      expect(detectDuplicates).not.toHaveBeenCalled()
      expect(result.hasDuplicateTriples).toBe(false)
      expect(analysisLog.value.some(e => e.message.includes('single graph'))).toBe(true)
    })

    it('skips duplicate check when graphs not supported', async () => {
      ;(detectGraphs as Mock).mockResolvedValue({
        supportsNamedGraphs: null,
        graphCount: null,
        graphCountExact: false,
        queryMethod: 'none',
      })
      ;(detectLanguages as Mock).mockResolvedValue([])

      const { reanalyzeEndpoint, analysisLog } = useEndpointAnalysis()

      const result = await reanalyzeEndpoint(mockEndpoint)

      expect(detectDuplicates).not.toHaveBeenCalled()
      expect(result.hasDuplicateTriples).toBe(false)
      expect(analysisLog.value.some(e => e.message.includes('not supported'))).toBe(true)
    })

    it('uses graph-scoped language detection when duplicates exist and too many graphs', async () => {
      ;(detectGraphs as Mock).mockResolvedValue({
        supportsNamedGraphs: true,
        graphCount: 5,
        graphCountExact: true,
        queryMethod: 'empty-pattern',
      })
      // Return null for skosGraphUris (too many graphs to batch)
      ;(detectSkosGraphs as Mock).mockResolvedValue({ skosGraphCount: 600, skosGraphUris: null })
      ;(detectDuplicates as Mock).mockResolvedValue({ hasDuplicates: true })
      ;(detectLanguages as Mock).mockResolvedValue([])

      const { reanalyzeEndpoint, analysisLog } = useEndpointAnalysis()

      await reanalyzeEndpoint(mockEndpoint)

      // When no skosGraphUris available, falls back to graph-scoped
      expect(detectLanguages).toHaveBeenCalledWith(mockEndpoint, true, null)
      expect(analysisLog.value.some(e => e.message.includes('graph-scoped'))).toBe(true)
    })

    it('uses batched language detection when SKOS graph URIs available', async () => {
      const mockGraphUris = ['http://ex.org/g1', 'http://ex.org/g2', 'http://ex.org/g3']
      ;(detectGraphs as Mock).mockResolvedValue({
        supportsNamedGraphs: true,
        graphCount: 5,
        graphCountExact: true,
        queryMethod: 'empty-pattern',
      })
      ;(detectSkosGraphs as Mock).mockResolvedValue({ skosGraphCount: 3, skosGraphUris: mockGraphUris })
      ;(detectDuplicates as Mock).mockResolvedValue({ hasDuplicates: false })
      ;(detectLanguages as Mock).mockResolvedValue([])

      const { reanalyzeEndpoint, analysisLog } = useEndpointAnalysis()

      await reanalyzeEndpoint(mockEndpoint)

      // When skosGraphUris available, uses batched detection
      expect(detectLanguages).toHaveBeenCalledWith(mockEndpoint, false, mockGraphUris)
      expect(analysisLog.value.some(e => e.message.includes('batched'))).toBe(true)
    })

    it('logs graph count with approximation when not exact', async () => {
      ;(detectGraphs as Mock).mockResolvedValue({
        supportsNamedGraphs: true,
        graphCount: 10000,
        graphCountExact: false,
        queryMethod: 'fallback-limit',
      })
      ;(detectSkosGraphs as Mock).mockResolvedValue({ skosGraphCount: 500, skosGraphUris: null })
      ;(detectDuplicates as Mock).mockResolvedValue({ hasDuplicates: false })
      ;(detectLanguages as Mock).mockResolvedValue([])

      const { reanalyzeEndpoint, analysisLog } = useEndpointAnalysis()

      await reanalyzeEndpoint(mockEndpoint)

      expect(analysisLog.value.some(e => e.message.includes('10000+'))).toBe(true)
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
        graphCount: 1,
        graphCountExact: true,
        queryMethod: 'empty-pattern',
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
