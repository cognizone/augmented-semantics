/**
 * useEndpointAnalysis - Endpoint analysis and reanalysis composable
 *
 * Handles SPARQL endpoint capability analysis including:
 * - Named graph detection
 * - SKOS graph detection
 * - Language detection
 * - Analysis logging for user feedback
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import { ref, type Ref } from 'vue'
import {
  analyzeEndpoint as analyzeEndpointService,
  detectGraphs,
  detectSkosGraphs,
  detectLanguages,
} from '../services/sparql'
import { useElapsedTime } from './useElapsedTime'
import type { SPARQLEndpoint } from '../types'

export interface AnalysisLogEntry {
  message: string
  status: 'pending' | 'success' | 'warning' | 'error' | 'info'
}

export function useEndpointAnalysis() {
  const analyzing = ref(false)
  const analyzeStep: Ref<string | null> = ref(null)
  const analyzeElapsed = useElapsedTime(analyzing)
  const analysisLog: Ref<AnalysisLogEntry[]> = ref([])
  const analysisDuration: Ref<number | null> = ref(null)

  /**
   * Simple analysis for new endpoints (connection test + basic analysis)
   */
  async function analyzeEndpoint(endpoint: SPARQLEndpoint): Promise<SPARQLEndpoint['analysis']> {
    analyzing.value = true
    analyzeStep.value = 'Analyzing endpoint structure...'

    try {
      const analysis = await analyzeEndpointService(endpoint)

      analyzeStep.value = 'Done!'
      analyzing.value = false

      return {
        supportsNamedGraphs: analysis.supportsNamedGraphs,
        skosGraphCount: analysis.skosGraphCount,
        languages: analysis.languages,
        analyzedAt: analysis.analyzedAt,
      }
    } catch (e) {
      analyzing.value = false
      analyzeStep.value = `Error: ${e instanceof Error ? e.message : 'Unknown error'}`
      throw e
    }
  }

  /**
   * Full reanalysis with detailed logging
   */
  async function reanalyzeEndpoint(endpoint: SPARQLEndpoint): Promise<SPARQLEndpoint['analysis']> {
    const startTime = performance.now()
    analyzing.value = true
    analysisLog.value = [] // Clear previous log
    analyzeStep.value = 'Analyzing...'

    try {
      // Step 1: Detect graph support
      logStep('(1/3) Detecting graph support...', 'pending')
      const graphResult = await detectGraphs(endpoint)

      if (graphResult.supportsNamedGraphs === null) {
        updateLastLog(`(1/3) Graph support: unknown`, 'warning')
      } else if (graphResult.supportsNamedGraphs === false) {
        updateLastLog(`(1/3) Graph support: no`, 'info')
      } else {
        updateLastLog(`(1/3) Graph support: yes`, 'success')
      }

      // Step 2: Detect SKOS graphs (only if graphs supported)
      let skosGraphCount: number | null = null
      let skosGraphUris: string[] | null = null
      if (graphResult.supportsNamedGraphs === true) {
        logStep('(2/3) Detecting SKOS graphs...', 'pending')
        const skosResult = await detectSkosGraphs(endpoint)
        skosGraphCount = skosResult.skosGraphCount
        skosGraphUris = skosResult.skosGraphUris
        if (skosGraphCount === null) {
          updateLastLog(`(2/3) SKOS graphs: detection failed`, 'warning')
        } else if (skosGraphCount === 0) {
          updateLastLog(`(2/3) SKOS graphs: none found`, 'warning')
        } else {
          const batchInfo = skosGraphUris ? ' (will batch)' : ' (too many to batch)'
          updateLastLog(`(2/3) SKOS graphs: ${skosGraphCount}${batchInfo}`, 'success')
        }
      } else {
        logStep('(2/3) SKOS graphs: skipped (no graph support)', 'info')
      }

      // Step 3: Detect languages
      // Use graph scope if we found SKOS graphs
      const useGraphScope = skosGraphUris !== null && skosGraphUris.length > 0
      const queryMode = skosGraphUris
        ? `batched, ${skosGraphUris.length} graphs`
        : 'default'
      logStep(`(3/3) Detecting languages (${queryMode})...`, 'pending')
      const languages = await detectLanguages(endpoint, useGraphScope, skosGraphUris)
      updateLastLog(`(3/3) Languages: found ${languages.length} (${queryMode})`, 'success')

      // Calculate total duration
      analysisDuration.value = Math.round((performance.now() - startTime) / 1000)

      const analysis = {
        supportsNamedGraphs: graphResult.supportsNamedGraphs,
        skosGraphCount,
        languages,
        analyzedAt: new Date().toISOString(),
      }

      analyzeStep.value = null
      analyzing.value = false

      return analysis
    } catch (e) {
      logStep(`Error: ${e instanceof Error ? e.message : 'Analysis failed'}`, 'error')
      analysisDuration.value = Math.round((performance.now() - startTime) / 1000)
      analyzeStep.value = null
      analyzing.value = false
      throw e
    }
  }

  /**
   * Add entry to analysis log
   */
  function logStep(message: string, status: AnalysisLogEntry['status'] = 'pending') {
    analysisLog.value.push({ message, status })
  }

  /**
   * Update last log entry status
   */
  function updateLastLog(message: string, status: AnalysisLogEntry['status']) {
    const last = analysisLog.value[analysisLog.value.length - 1]
    if (last) {
      last.message = message
      last.status = status
    }
  }

  /**
   * Clear analysis state
   */
  function clearAnalysis() {
    analyzing.value = false
    analyzeStep.value = null
    analysisLog.value = []
    analysisDuration.value = null
  }

  return {
    analyzing,
    analyzeStep,
    analyzeElapsed,
    analysisLog,
    analysisDuration,
    analyzeEndpoint,
    reanalyzeEndpoint,
    logStep,
    clearAnalysis,
  }
}
