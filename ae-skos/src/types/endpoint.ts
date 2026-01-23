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

/**
 * Label predicate capabilities for a specific resource type.
 * Indicates which label predicates exist in the endpoint for that type.
 */
export interface LabelPredicateCapabilities {
  prefLabel?: boolean
  xlPrefLabel?: boolean
  dctTitle?: boolean
  dcTitle?: boolean
  rdfsLabel?: boolean
}

/**
 * Label predicates available per resource type.
 * Different resource types may use different label predicates.
 */
export interface LabelPredicatesByResourceType {
  concept?: LabelPredicateCapabilities
  scheme?: LabelPredicateCapabilities
  collection?: LabelPredicateCapabilities
}

export type SkosResourceType = 'concept' | 'scheme' | 'collection'

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

  // Concept schemes (URIs only - labels fetched dynamically)
  schemeUris?: string[]         // List of scheme URIs (max 200)
  schemeCount?: number          // Total count found
  schemesLimited?: boolean      // true if more exist than stored

  // SKOS statistics
  totalConcepts?: number
  totalCollections?: number
  totalOrderedCollections?: number
  relationships?: {
    hasInScheme: boolean
    hasTopConceptOf: boolean
    hasHasTopConcept: boolean
    hasBroader: boolean
    hasNarrower: boolean
    hasBroaderTransitive: boolean
    hasNarrowerTransitive: boolean
  }

  // Label predicates per resource type (detected during analysis)
  labelPredicates?: LabelPredicatesByResourceType
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
