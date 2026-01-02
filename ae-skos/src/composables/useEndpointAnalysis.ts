/**
 * useEndpointAnalysis - Endpoint analysis and reanalysis composable
 *
 * Handles SPARQL endpoint capability analysis including:
 * - Named graph detection
 * - Duplicate triple detection
 * - Language detection
 * - Analysis logging for user feedback
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import { ref, type Ref } from 'vue'
import {
  analyzeEndpoint as analyzeEndpointService,
  detectGraphs,
  detectDuplicates,
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
        graphCount: analysis.graphCount,
        graphCountExact: analysis.graphCountExact,
        hasDuplicateTriples: analysis.hasDuplicateTriples,
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
      // Step 1: Detect graphs
      logStep('(1/3) Detecting named graphs...', 'pending')
      const graphResult = await detectGraphs(endpoint)

      if (graphResult.supportsNamedGraphs === null) {
        updateLastLog(`(1/3) Graphs: not supported`, 'warning')
      } else if (graphResult.supportsNamedGraphs === false) {
        updateLastLog(`(1/3) Graphs: none found`, 'info')
      } else {
        const countStr = graphResult.graphCountExact
          ? `${graphResult.graphCount} graphs`
          : `${graphResult.graphCount}+ graphs`
        updateLastLog(`(1/3) Graphs: ${countStr} (${formatQueryMethod(graphResult.queryMethod)})`, 'success')
      }

      // Step 2: Detect duplicates (only if multiple graphs exist)
      let hasDuplicateTriples: boolean | null = null
      if (graphResult.supportsNamedGraphs === true && graphResult.graphCount && graphResult.graphCount > 1) {
        logStep('(2/3) Checking for duplicates...', 'pending')
        const duplicateResult = await detectDuplicates(endpoint)
        hasDuplicateTriples = duplicateResult.hasDuplicates
        if (hasDuplicateTriples) {
          updateLastLog(`(2/3) Duplicates: found across graphs`, 'warning')
        } else {
          updateLastLog(`(2/3) Duplicates: none`, 'success')
        }
      } else if (graphResult.supportsNamedGraphs === null) {
        // Graphs not supported = no duplicates possible
        hasDuplicateTriples = false
        logStep('(2/3) Duplicates: not applicable (no graph support)', 'info')
      } else {
        // No graphs or single graph = no duplicates possible
        hasDuplicateTriples = false
        logStep('(2/3) Duplicates: none (single graph)', 'info')
      }

      // Step 3: Detect languages
      // Use GRAPH scope if duplicates exist to ensure concept+labels are in same graph
      const useGraphScope = hasDuplicateTriples === true
      const queryMode = useGraphScope ? 'graph-scoped' : 'default'
      logStep(`(3/3) Detecting languages (${queryMode})...`, 'pending')
      const languages = await detectLanguages(endpoint, useGraphScope)
      updateLastLog(`(3/3) Languages: found ${languages.length} (${queryMode})`, 'success')

      // Calculate total duration
      analysisDuration.value = Math.round((performance.now() - startTime) / 1000)

      const analysis = {
        supportsNamedGraphs: graphResult.supportsNamedGraphs,
        graphCount: graphResult.graphCount,
        graphCountExact: graphResult.graphCountExact,
        hasDuplicateTriples,
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
   * Format query method for display
   */
  function formatQueryMethod(method: string): string {
    switch (method) {
      case 'empty-pattern': return 'empty graph pattern'
      case 'blank-node-pattern': return 'triple pattern'
      case 'fallback-limit': return 'enumeration'
      case 'none': return 'not supported'
      default: return method
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
