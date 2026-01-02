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
    graphStatus,
    graphSeverity,
    graphIcon,
    graphDescription,
    duplicateStatus,
    duplicateSeverity,
    duplicateIcon,
    duplicateDescription,
    formatQueryMethod,
    formatCount,
  }
}
