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
  executeSparql,
  withPrefixes,
} from '../services/sparql'
import { useElapsedTime } from './useElapsedTime'
import { logger } from '../services'
import type { SPARQLEndpoint } from '../types'

export interface AnalysisLogEntry {
  message: string
  status: 'pending' | 'success' | 'warning' | 'error'
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

      // Log analysis results for debugging
      logger.info('EndpointAnalysis', 'Analysis complete', {
        totalConcepts: analysis.totalConcepts,
        relationships: analysis.relationships,
        languages: analysis.languages?.length,
        analyzedAt: analysis.analyzedAt,
      })

      return {
        hasSkosContent: true,
        supportsNamedGraphs: analysis.supportsNamedGraphs,
        skosGraphCount: analysis.skosGraphCount,
        languages: analysis.languages,
        totalConcepts: analysis.totalConcepts,
        relationships: analysis.relationships,
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
      // Step 1: Count total concepts
      logStep('(1/5) Counting concepts...', 'pending')
      const countQuery = withPrefixes(`
        SELECT (COUNT(DISTINCT ?concept) AS ?count)
        WHERE {
          ?concept a skos:Concept .
        }
      `)
      let totalConcepts: number | undefined
      try {
        const countResult = await executeSparql(endpoint, countQuery, { retries: 1 })
        totalConcepts = parseInt(countResult.results.bindings[0]?.count?.value || '0', 10)
        updateLastLog(`(1/5) Concepts: ${totalConcepts?.toLocaleString() ?? 'unknown'}`, 'success')
      } catch (e) {
        updateLastLog(`(1/5) Concepts: count failed`, 'warning')
        logger.warn('EndpointAnalysis', 'Failed to count concepts', { error: e })
      }

      // Step 2: Detect relationships
      // Use EXISTS at dataset level to check if ANY concept has these relationships
      logStep('(2/5) Detecting relationships...', 'pending')
      const relQuery = withPrefixes(`
        SELECT
          (EXISTS { ?c a skos:Concept . ?c skos:inScheme ?x } AS ?hasInScheme)
          (EXISTS { ?c a skos:Concept . ?c skos:topConceptOf ?x } AS ?hasTopConceptOf)
          (EXISTS { ?s skos:hasTopConcept ?x } AS ?hasHasTopConcept)
          (EXISTS { ?c a skos:Concept . ?c skos:broader ?x } AS ?hasBroader)
          (EXISTS { ?c a skos:Concept . ?c skos:narrower ?x } AS ?hasNarrower)
          (EXISTS { ?c a skos:Concept . ?c skos:broaderTransitive ?x } AS ?hasBroaderTransitive)
          (EXISTS { ?c a skos:Concept . ?c skos:narrowerTransitive ?x } AS ?hasNarrowerTransitive)
        WHERE {}
      `)
      let relationships: {
        hasInScheme: boolean
        hasTopConceptOf: boolean
        hasHasTopConcept: boolean
        hasBroader: boolean
        hasNarrower: boolean
        hasBroaderTransitive: boolean
        hasNarrowerTransitive: boolean
      } | undefined
      try {
        const relResult = await executeSparql(endpoint, relQuery, { retries: 1 })
        const binding = relResult.results.bindings[0]
        if (binding) {
          // Helper to parse EXISTS results - some endpoints return "true"/"false", others return "1"/"0"
          const parseExists = (value?: string): boolean => {
            if (!value) return false
            return value === 'true' || value === '1'
          }

          relationships = {
            hasInScheme: parseExists(binding.hasInScheme?.value),
            hasTopConceptOf: parseExists(binding.hasTopConceptOf?.value),
            hasHasTopConcept: parseExists(binding.hasHasTopConcept?.value),
            hasBroader: parseExists(binding.hasBroader?.value),
            hasNarrower: parseExists(binding.hasNarrower?.value),
            hasBroaderTransitive: parseExists(binding.hasBroaderTransitive?.value),
            hasNarrowerTransitive: parseExists(binding.hasNarrowerTransitive?.value),
          }
          const trueCount = Object.values(relationships).filter(Boolean).length
          updateLastLog(`(2/5) Relationships: ${trueCount}/7 available`, 'success')
        }
      } catch (e) {
        updateLastLog(`(2/5) Relationships: detection failed`, 'warning')
        logger.warn('EndpointAnalysis', 'Failed to detect relationships', { error: e })
      }

      // Step 3: Detect graph support
      logStep('(3/5) Detecting graph support...', 'pending')
      const graphResult = await detectGraphs(endpoint)

      if (graphResult.supportsNamedGraphs === null) {
        updateLastLog(`(3/5) Graph support: unknown`, 'warning')
      } else if (graphResult.supportsNamedGraphs === false) {
        updateLastLog(`(3/5) Graph support: no`, 'success')
      } else {
        updateLastLog(`(3/5) Graph support: yes`, 'success')
      }

      // Step 2: Detect SKOS graphs (only if graphs supported)
      let skosGraphCount: number | null = null
      let skosGraphUris: string[] | null = null
      if (graphResult.supportsNamedGraphs === true) {
        logStep('(4/5) Detecting SKOS graphs...', 'pending')
        const skosResult = await detectSkosGraphs(endpoint)
        skosGraphCount = skosResult.skosGraphCount
        skosGraphUris = skosResult.skosGraphUris
        if (skosGraphCount === null) {
          updateLastLog(`(4/5) SKOS graphs: detection failed`, 'warning')
        } else if (skosGraphCount === 0) {
          updateLastLog(`(4/5) SKOS graphs: none found`, 'warning')
        } else {
          const batchInfo = skosGraphUris ? ' (will batch)' : ' (too many to batch)'
          updateLastLog(`(4/5) SKOS graphs: ${skosGraphCount}${batchInfo}`, 'success')
        }
      } else {
        logStep('(4/5) SKOS graphs: skipped (no graph support)', 'success')
      }

      // Step 3: Detect languages
      // Use graph scope if we found SKOS graphs
      const useGraphScope = skosGraphUris !== null && skosGraphUris.length > 0
      const queryMode = skosGraphUris
        ? `batched, ${skosGraphUris.length} graphs`
        : 'default'
      logStep(`(5/5) Detecting languages (${queryMode})...`, 'pending')
      const languages = await detectLanguages(endpoint, useGraphScope, skosGraphUris)
      updateLastLog(`(5/5) Languages: found ${languages.length} (${queryMode})`, 'success')

      // Calculate total duration
      analysisDuration.value = Math.round((performance.now() - startTime) / 1000)

      const analysis = {
        hasSkosContent: true,
        supportsNamedGraphs: graphResult.supportsNamedGraphs,
        skosGraphCount,
        languages,
        totalConcepts,
        relationships,
        analyzedAt: new Date().toISOString(),
      }

      // Log analysis results for debugging
      logger.info('EndpointAnalysis', 'Reanalysis complete', {
        totalConcepts,
        relationships: relationships ? Object.keys(relationships).filter(k => relationships[k as keyof typeof relationships]).length : 0,
        languages: languages.length,
      })

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
