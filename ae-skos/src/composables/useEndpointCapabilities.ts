/**
 * useEndpointCapabilities - Endpoint capabilities display composable
 *
 * Provides computed properties for displaying endpoint capability status
 * including named graphs and duplicate triple detection.
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import { computed, type Ref } from 'vue'
import type { SPARQLEndpoint } from '../types'

export function useEndpointCapabilities(endpoint: Ref<SPARQLEndpoint | null>) {
  // Graph capabilities
  const graphStatus = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis) return 'Unknown'
    if (analysis.supportsNamedGraphs === null) return 'Not supported'
    if (analysis.supportsNamedGraphs === false) return 'None'
    if (analysis.graphCount == null) return 'Detected'
    if (analysis.graphCountExact) return `${formatCount(analysis.graphCount)} graphs`
    return `${formatCount(analysis.graphCount)}+ graphs`
  })

  const graphSeverity = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis) return 'secondary'
    if (analysis.supportsNamedGraphs === null || analysis.supportsNamedGraphs === false) return 'secondary'
    return 'info'
  })

  const graphIcon = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis) return 'pi pi-minus-circle muted-icon'
    if (analysis.supportsNamedGraphs === null || analysis.supportsNamedGraphs === false) {
      return 'pi pi-minus-circle muted-icon'
    }
    return 'pi pi-check-circle success-icon'
  })

  const graphDescription = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis) return null
    if (analysis.supportsNamedGraphs === null) return 'This endpoint doesn\'t support named graph queries'
    if (analysis.supportsNamedGraphs === false) return null
    if (analysis.graphCountExact === false) return 'This endpoint uses named graphs (exact count unavailable)'
    return 'This endpoint uses named graphs to organize data'
  })

  // Graph support capabilities (Yes/No)
  const graphSupportStatus = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis) return 'Unknown'
    if (analysis.supportsNamedGraphs === null) return 'Unknown'
    return analysis.supportsNamedGraphs ? 'Yes' : 'No'
  })

  const graphSupportSeverity = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || analysis.supportsNamedGraphs === null) return 'secondary'
    return analysis.supportsNamedGraphs ? 'success' : 'info'
  })

  const graphSupportIcon = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || analysis.supportsNamedGraphs === null) return 'pi pi-question-circle muted-icon'
    return analysis.supportsNamedGraphs ? 'pi pi-check-circle success-icon' : 'pi pi-minus-circle muted-icon'
  })

  const graphSupportDescription = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || analysis.supportsNamedGraphs === null) return 'Could not determine if endpoint supports GRAPH queries'
    if (analysis.supportsNamedGraphs) return 'Endpoint supports named graph queries'
    return 'Endpoint does not use named graphs'
  })

  // SKOS graph capabilities
  const skosGraphStatus = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || analysis.skosGraphCount === undefined) return 'Unknown'
    if (analysis.skosGraphCount === null) return 'Unknown'
    if (analysis.skosGraphCount === 0) return 'None'
    return `${formatCount(analysis.skosGraphCount)} graph${analysis.skosGraphCount === 1 ? '' : 's'}`
  })

  const skosGraphSeverity = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || analysis.skosGraphCount === undefined || analysis.skosGraphCount === null) return 'secondary'
    if (analysis.skosGraphCount === 0) return 'warn'
    return 'success'
  })

  const skosGraphIcon = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || analysis.skosGraphCount === undefined || analysis.skosGraphCount === null) return 'pi pi-minus-circle muted-icon'
    if (analysis.skosGraphCount === 0) return 'pi pi-exclamation-triangle warning-icon'
    return 'pi pi-check-circle success-icon'
  })

  const skosGraphDescription = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || analysis.skosGraphCount === undefined || analysis.skosGraphCount === null) return null
    if (analysis.skosGraphCount === 0) return 'No graphs contain SKOS concepts or schemes'
    return `${formatCount(analysis.skosGraphCount)} graph${analysis.skosGraphCount === 1 ? '' : 's'} contain SKOS data`
  })

  // Duplicate capabilities
  const duplicateStatus = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || analysis.hasDuplicateTriples === null) return 'Unknown'
    return analysis.hasDuplicateTriples ? 'Detected' : 'None'
  })

  const duplicateSeverity = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || analysis.hasDuplicateTriples === null) return 'secondary'
    return analysis.hasDuplicateTriples ? 'warn' : 'success'
  })

  const duplicateIcon = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || analysis.hasDuplicateTriples === null) return 'pi pi-minus-circle muted-icon'
    return analysis.hasDuplicateTriples ? 'pi pi-exclamation-triangle warning-icon' : 'pi pi-check-circle success-icon'
  })

  const duplicateDescription = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || analysis.hasDuplicateTriples === null) return null
    if (analysis.hasDuplicateTriples) return 'Same triples exist in multiple graphs. This may cause duplicate results.'
    return null
  })

  // Formatters
  function formatQueryMethod(method?: string): string {
    if (!method) return ''
    switch (method) {
      case 'empty-pattern': return 'empty graph pattern'
      case 'blank-node-pattern': return 'triple pattern'
      case 'fallback-limit': return 'enumeration'
      case 'none': return 'not supported'
      default: return method
    }
  }

  function formatCount(n: number): string {
    return n.toLocaleString('de-DE') // Uses period as thousand separator
  }

  return {
    // Graph support (Yes/No)
    graphSupportStatus,
    graphSupportSeverity,
    graphSupportIcon,
    graphSupportDescription,
    // Named graphs (count)
    graphStatus,
    graphSeverity,
    graphIcon,
    graphDescription,
    // SKOS graphs (count)
    skosGraphStatus,
    skosGraphSeverity,
    skosGraphIcon,
    skosGraphDescription,
    // Duplicates
    duplicateStatus,
    duplicateSeverity,
    duplicateIcon,
    duplicateDescription,
    // Formatters
    formatQueryMethod,
    formatCount,
  }
}
