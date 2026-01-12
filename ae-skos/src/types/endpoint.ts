/**
 * Endpoint Types - SPARQL endpoint configuration
 *
 * @see /spec/common/com01-EndpointManager.md
 */

export interface SPARQLEndpoint {
  id: string
  name: string
  url: string
  auth?: EndpointAuth
  analysis?: EndpointAnalysis
  selectedGraphs?: string[]
  languagePriorities?: string[]  // User-ordered language codes
  createdAt: string
  lastAccessedAt?: string
  accessCount: number
}

export interface EndpointAuth {
  type: 'none' | 'basic' | 'apikey' | 'bearer'
  credentials?: {
    username?: string
    password?: string
    apiKey?: string
    token?: string
    headerName?: string
  }
}

export interface DetectedLanguage {
  lang: string
  count: number
}

export interface EndpointAnalysis {
  // SKOS content (first check)
  hasSkosContent: boolean              // Has ConceptScheme or Concept

  // Named graphs support
  supportsNamedGraphs: boolean | null  // null = not supported by endpoint, false = none, true = has graphs

  // SKOS graphs
  skosGraphCount: number | null        // null = detection failed, number = graphs with Concept or ConceptScheme
  skosGraphUris?: string[] | null      // Graph URIs when count <= 500, null when too many to process

  // Languages (sorted by count descending)
  languages?: DetectedLanguage[]

  analyzedAt: string

  // SKOS statistics
  totalConcepts?: number
  relationships?: {
    hasInScheme: boolean
    hasTopConceptOf: boolean
    hasHasTopConcept: boolean
    hasBroader: boolean
    hasNarrower: boolean
    hasBroaderTransitive: boolean
    hasNarrowerTransitive: boolean
  }
}

export type EndpointStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * Suggested endpoint source definition (manually curated)
 */
export interface SuggestedEndpointSource {
  name: string
  url: string
  description?: string
}

/**
 * Suggested endpoint with pre-calculated analysis (generated at build time)
 */
export interface SuggestedEndpoint extends SuggestedEndpointSource {
  analysis: EndpointAnalysis
  suggestedLanguagePriorities: string[]
}
