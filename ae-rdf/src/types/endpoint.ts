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
  typeProperties?: Record<string, TypeProfile> // discovered per-type property schema (script-generated)
  subclasses?: Record<string, string[]>         // cached rdfs:subClassOf hierarchy: superclass IRI → subtype IRIs
  composition?: Record<string, CompositionEntry[]> // cached embed composition: class IRI → embed types it contains
  orphanCounts?: Record<string, number>         // cached embed-orphan counts: embed type IRI → instances with no owner
  profiledAt?: string                           // ISO timestamp of the last property-profiling run
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
  /** When `render` is `embed`, only inline this object where it is reached via
   *  THIS predicate (its owning relationship). Unset = inline wherever the type
   *  is an object — fine for pure value objects with a single owner, but set it
   *  for entities referenced by several types (e.g. a Grant owned by its Project
   *  via isFundedBy, not by every FundingAgency that disburses it). */
  embedVia?: string
  sidebar?: TypeSidebar
  /** Optional sidebar group label (e.g. "Ontology") — collects this type under a
   *  collapsible group header instead of the flat top level. */
  group?: string
  /** Field display order for a resource of this type: predicate IRIs, in the
   *  order they should appear. Listed predicates come first (in this order);
   *  any not listed fall to the end in the default priority order. Attributes
   *  then relationships, concatenated. Authored by drag-reorder in edit mode. */
  order?: string[]
  /** Predicate IRIs to hide from a resource of this type's detail view. Removed
   *  entirely in normal mode; shown greyed in edit mode so they can be un-hidden. */
  hide?: string[]
  /** Predicate IRIs whose values compose the display label for a resource of
   *  this type (joined, in property-display order). Empty/unset → the default
   *  label heuristic (prefLabel → title → rdfs:label → …). */
  label?: string[]
}

/** A type IRI with its distinct-instance count (the cached inventory entry). */
export interface TypeCount {
  uri: string
  count: number
}

/**
 * One discovered property of a type: the predicate IRI and how often it occurs
 * across that type's instances. Intentionally an open object — more per-property
 * metadata (datatype, object-vs-literal, ranges) can be added later.
 */
export interface TypeProperty {
  uri: string
  count: number
}

/**
 * Discovered schema for one type, generated offline by
 * `scripts/profile-properties.ts` (per-type property queries are unreliable at
 * runtime). Carries provenance so a consumer knows whether to trust it or fall
 * back to live behaviour:
 * - `ok`:      the profiling query for this type succeeded.
 * - `sampled`: derived from a sample (LIMIT) rather than a full scan, so the
 *              property list may be incomplete / counts are of the sample.
 * Kept as an object (not a bare array) so more metadata can be added later.
 */
export interface TypeProfile {
  ok: boolean
  sampled?: boolean
  properties: TypeProperty[]
}

/** One embed type composed by a class, with a count scoped to that class. */
export interface CompositionEntry {
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
