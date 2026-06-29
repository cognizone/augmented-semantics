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
  graph?: EndpointGraph
  types?: Record<string, TypeConfig>           // per-type display config, keyed by type IRI
  typeInventory?: TypeCount[]                   // cached type inventory for instant sidebar
  selectedGraphs?: string[]
  languagePriorities?: string[]  // User-ordered language codes
  lastTestStatus?: 'success' | 'error' | 'testing'
  lastTestedAt?: string
  lastTestErrorCode?: string
  createdAt: string
  lastAccessedAt?: string
  accessCount: number
}

/** How a resource of a given type renders when it is the OBJECT of a triple. */
export type TypeRender = 'link' | 'embed' | 'label'

/** What the Types sidebar does with a type. */
export type TypeSidebar = 'show' | 'hide' | 'pin'

/**
 * Per-type configuration (authored live, exported per-endpoint to app.json).
 * `link` (default): clickable navigation chip.
 * `embed`: value object — inline its properties (MonetaryAmount, coordinates).
 * `label`: show identity only, no navigation.
 */
export interface TypeConfig {
  render?: TypeRender
  sidebar?: TypeSidebar
}

/** A type IRI with its distinct-instance count (the cached inventory entry). */
export interface TypeCount {
  uri: string
  count: number
}

/**
 * How an endpoint exposes its data — two orthogonal axes. Either field unset
 * means "unknown" (a connect-time probe fills a best guess; config overrides).
 * See `resolveGraphStrategy` and /spec/ae-rdf/rdf-overview.md (Graph model).
 */
export interface EndpointGraph {
  /** Does the endpoint expose named graphs (quad store)? */
  quads?: boolean
  /**
   * The explicit (default, no-GRAPH) triple view:
   * - 'own':    its own distinct triples → query it alongside the quads.
   * - 'merged': just a merged view of the quads (bag-y, redundant) → never query it.
   */
  defaultView?: 'own' | 'merged'
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
  cors?: boolean

  // SPARQL result formats
  supportsJsonResults?: boolean | null // true = JSON supported, false = XML-only, null = detection failed

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
  schemeUriSlashMismatch?: boolean
  schemeUriSlashMismatchPairs?: Array<{
    declared: string
    used: string
  }>

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
