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
   *  via isFundedBy, not by every FundingAgency that disburses it).
   *
   *  Prefix with `^` for an INVERSE embed: `^<predicate>` inlines this object into
   *  the resource it POINTS AT via <predicate> (this object is the subject, the
   *  owner is the object) — e.g. a PublicationProcess shown inline on the
   *  ConsolidationAbstract it references. Rendered as an incoming (`↤`) relation. */
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
  /** Heading uses ALL `label` parts, not just literals + the first linked entity.
   *  The default trims linked entities in the on-page heading (they're listed
   *  below as relations); set this for a reified-relationship type whose identity
   *  needs several linked parts — e.g. OrganisationRole = role + org. (Links and
   *  embeds already show the full composed label; this only affects the heading.) */
  labelFull?: boolean
  /** Predicate IRIs whose (literal) values the instance-list text filter matches
   *  for this type. Unset → the type's `label` fields, else the 6 default label
   *  predicates. Lets search target the right fields and skip redundant ones
   *  (e.g. on Cordis `title` == `rdfs:label` — list just one). */
  search?: string[]
  /** When this type is inlined (render:embed), show properties up to and
   *  including this predicate, and fold everything after it behind a "Show more"
   *  toggle. Unset = show all. Set via the per-row "fold here" toggle in edit
   *  mode; ignored in edit mode so every property stays configurable. */
  foldAfter?: string
  /** Predicate IRIs whose object lists should be grouped by the object's type
   *  (a subheading + count per type) instead of a flat list — for long, mixed-
   *  type relations (e.g. hasResult → publications, datasets, software). Set via
   *  the per-row "group by type" toggle in edit mode. */
  groupByType?: string[]
  /** Predicate IRIs whose literal values are booleans — render "1"/"true" (and
   *  "0"/"false") as a checkbox instead of the raw lexical value. For endpoints
   *  that store booleans as 0/1 without an xsd:boolean datatype (Virtuoso). */
  boolean?: string[]
  /** Contextual object labels: when a resource of THIS type links out via a
   *  predicate listed here, its object's DISPLAY label is composed from the
   *  given field IRIs instead of the object type's own label — so a node shared
   *  across directions reads per-context. Keyed by the outgoing predicate IRI →
   *  field IRIs (same rule as `label`: literals joined by ' · ', a URI field →
   *  the referent's label). E.g. on Grant, `hasBeneficiary` → [roleLabel,
   *  isRoleOf]. Applies to LINKED objects only (embeds render their properties). */
  viaLabels?: Record<string, string[]>
}

/** A URI paired with a count — the shared shape behind the cached inventory,
 *  per-type property, and embed-composition entries. */
export interface UriCount {
  uri: string
  count: number
}

/** A type IRI with its distinct-instance count (the cached inventory entry). */
export type TypeCount = UriCount

/**
 * One discovered property of a type: the predicate IRI and how often it occurs
 * across that type's instances, plus its observed per-instance cardinality when
 * a full (non-sampled) scan measured it:
 * - `min`: 0 if any instance of the type lacks the property, else the smallest
 *          per-instance occurrence count (≥1) — i.e. required (min≥1) vs optional.
 * - `max`: the largest per-instance occurrence count — 1 = single-valued/functional,
 *          >1 = multi-valued.
 * Absent on sampled profiles (a sample can't prove min=0 or the true max). Feeds
 * potential OWL/SHACL cardinality constraints and list-vs-single rendering hints.
 */
export interface TypeProperty extends UriCount {
  min?: number
  max?: number
}

/** One owning edge and the max instances of a type that inline under a SINGLE owner
 *  through it (fan-in). Low `max` ⇒ safe to embed via this edge. Profiler hint. */
export interface EmbedFanEdge {
  via: string
  max: number
}

/**
 * Embed candidacy for a type, measured by `scripts/profile-endpoint.ts` — the
 * per-owner fan-in in each direction, so you can tell whether embedding is safe
 * (low `max`) without querying by hand:
 * - `forward`: this type as an embedded OBJECT (owner ─via→ me) → `render:embed`
 *              with `embedVia:"<via>"`.
 * - `inverse`: this type as an embedded SUBJECT (me ─via→ owner) → `embedVia:"^<via>"`.
 * Each list is sorted by `max` ascending (best candidate first) and only includes
 * edges within the embed budget. `selfMax` is the type's OWN biggest single-property
 * fan-out — how many rows it renders when inlined; a HIGH selfMax is a flood trap (a
 * wall of rows when inlined even at fan-in 1, e.g. an analysis with 1 owner but
 * thousands of child links), so treat high-selfMax as NOT embeddable despite a low
 * fan-in. A profiler hint — not consumed by the app.
 */
export interface EmbedHints {
  selfMax?: number
  forward?: EmbedFanEdge[]
  inverse?: EmbedFanEdge[]
}

/**
 * Discovered schema for one type, generated offline by
 * `scripts/profile-endpoint.ts` (per-type property queries are unreliable at
 * runtime). Carries provenance so a consumer knows whether to trust it or fall
 * back to live behaviour:
 * - `ok`:      the profiling query for this type succeeded.
 * - `sampled`: the property LIST fell back to a sample (LIMIT), so it may be
 *              missing rare predicates. Each listed property's counts/cardinality
 *              are still measured over the full type.
 * Kept as an object (not a bare array) so more metadata can be added later.
 */
export interface TypeProfile {
  ok: boolean
  sampled?: boolean
  properties: TypeProperty[]
  /** Embed candidacy (profiler hint): per-owner fan-in forward + inverse. */
  embed?: EmbedHints
}

/** One embed type composed by a class, with a count scoped to that class. */
export type CompositionEntry = UriCount

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
