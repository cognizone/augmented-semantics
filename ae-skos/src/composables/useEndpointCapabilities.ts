/**
 * useEndpointCapabilities - Endpoint capabilities display composable
 *
 * Provides computed properties for displaying endpoint capability status
 * for graph support and SKOS graphs.
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import { computed, type Ref } from 'vue'
import type { SPARQLEndpoint } from '../types'

export function useEndpointCapabilities(endpoint: Ref<SPARQLEndpoint | null>) {
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
    // Show "500+" if we hit the limit (skosGraphUris will be null)
    const hitLimit = analysis.skosGraphCount > 500 && !analysis.skosGraphUris
    if (hitLimit) return `500+ graphs`
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

    // Check if we hit the limit (too many to list individually)
    const hitLimit = analysis.skosGraphCount > 500 && !analysis.skosGraphUris
    if (hitLimit) {
      return `More than 500 graphs contain SKOS data (too many to process individually)`
    }

    return `${formatCount(analysis.skosGraphCount)} graph${analysis.skosGraphCount === 1 ? '' : 's'} contain SKOS data`
  })

  // Scheme count
  const schemeCountStatus = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || analysis.schemeCount === undefined) return 'Unknown'
    if (analysis.schemeCount === 0) return 'None'
    if (analysis.schemesLimited) return `${analysis.schemeCount}+`
    return `${formatCount(analysis.schemeCount)} scheme${analysis.schemeCount === 1 ? '' : 's'}`
  })

  const schemeCountSeverity = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || analysis.schemeCount === undefined) return 'secondary'
    if (analysis.schemeCount === 0) return 'warn'
    return 'success'
  })

  const schemeCountIcon = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || analysis.schemeCount === undefined) return 'pi pi-question-circle muted-icon'
    if (analysis.schemeCount === 0) return 'pi pi-exclamation-triangle warning-icon'
    return 'pi pi-check-circle success-icon'
  })

  const schemeCountDescription = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || analysis.schemeCount === undefined) return 'Could not determine scheme count'
    if (analysis.schemeCount === 0) return 'No concept schemes found'
    if (analysis.schemesLimited) {
      return `${analysis.schemeCount} schemes found (first ${analysis.schemeUris?.length || 0} stored)`
    }
    return `${formatCount(analysis.schemeCount)} concept scheme${analysis.schemeCount === 1 ? '' : 's'} found`
  })

  // Concept count
  const conceptCountStatus = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || analysis.totalConcepts === undefined) return 'Unknown'
    return formatCount(analysis.totalConcepts)
  })

  const conceptCountSeverity = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || analysis.totalConcepts === undefined) return 'secondary'
    return 'success'
  })

  const conceptCountIcon = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || analysis.totalConcepts === undefined) return 'pi pi-question-circle muted-icon'
    return 'pi pi-check-circle success-icon'
  })

  const conceptCountDescription = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || analysis.totalConcepts === undefined) return 'Could not determine concept count'
    return `${formatCount(analysis.totalConcepts)} SKOS concepts in endpoint`
  })

  // Relationships summary
  const relationshipsStatus = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || !analysis.relationships) return 'Unknown'
    const count = Object.values(analysis.relationships).filter(Boolean).length
    return `${count}/7 available`
  })

  const relationshipsSeverity = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || !analysis.relationships) return 'secondary'
    const count = Object.values(analysis.relationships).filter(Boolean).length
    if (count === 0) return 'warn'
    return 'success'
  })

  const relationshipsIcon = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || !analysis.relationships) return 'pi pi-question-circle muted-icon'
    const count = Object.values(analysis.relationships).filter(Boolean).length
    if (count === 0) return 'pi pi-exclamation-triangle warning-icon'
    return 'pi pi-check-circle success-icon'
  })

  const relationshipsDescription = computed(() => {
    const analysis = endpoint.value?.analysis
    if (!analysis || !analysis.relationships) return null

    // Only show description if no relationships detected
    const count = Object.values(analysis.relationships).filter(Boolean).length
    if (count === 0) return 'No SKOS relationships detected'

    return null // Badges show the details
  })

  // Formatters
  function formatCount(n: number): string {
    return n.toLocaleString('de-DE') // Uses period as thousand separator
  }

  return {
    // Graph support (Yes/No)
    graphSupportStatus,
    graphSupportSeverity,
    graphSupportIcon,
    graphSupportDescription,
    // SKOS graphs (count)
    skosGraphStatus,
    skosGraphSeverity,
    skosGraphIcon,
    skosGraphDescription,
    // Concept schemes
    schemeCountStatus,
    schemeCountSeverity,
    schemeCountIcon,
    schemeCountDescription,
    // SKOS statistics
    conceptCountStatus,
    conceptCountSeverity,
    conceptCountIcon,
    conceptCountDescription,
    relationshipsStatus,
    relationshipsSeverity,
    relationshipsIcon,
    relationshipsDescription,
    // Formatters
    formatCount,
  }
}
