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
  infer?: boolean                               // GraphDB: send `infer=<value>` with every query — false disables inferred triples. Omit to send nothing.
  types?: Record<string, TypeConfig>           // per-type display config, keyed by type IRI
  typeInventory?: TypeCount[]                   // cached type inventory for instant sidebar
  typeProperties?: Record<string, TypeProfile> // discovered per-type property schema (script-generated)
  subclasses?: Record<string, string[]>         // cached rdfs:subClassOf hierarchy: superclass IRI → subtype IRIs
  composition?: Record<string, CompositionEntry[]> // cached embed composition: class IRI → embed types it contains
  orphanCounts?: Record<string, number>         // cached embed-orphan counts: embed type IRI → instances with no owner
  deprecatedPredicates?: string[]               // predicates that flag a resource deprecated when asserted `true` (profiler-detected)
  extraLabelPredicates?: string[]               // endpoint-specific label predicates, appended to LABEL_PREDICATES at lowest precedence (e.g. foaf:name on LINDAS)
  prefixes?: Record<string, string>             // endpoint-declared prefix → namespace, seeded into the resolver at highest precedence when this endpoint is active
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
  /** Predicate IRIs whose (numeric) values are grouped with thousands separators
   *  — `312500` → `312,500` — both in the property row and anywhere the value
   *  composes a label (heading, links, "Has total cost"). Opt-in per field
   *  (default none): the data types amounts inconsistently, so we group by
   *  explicit choice, not datatype. Set via the per-row toggle in edit mode. */
  number?: string[]
  /** Predicate IRIs whose object list flows into responsive columns instead of a
   *  tall single-file stack. EXPLICIT opt-in per field (default none) — never
   *  automatic. Set via the per-row columns toggle in edit mode. */
  columns?: string[]
  /** Predicate IRIs whose literal values cap to a readable reading measure
   *  (~72ch) — for long prose (abstract/description). EXPLICIT opt-in per field
   *  (default none) — never automatic. Set via the per-row width-cap toggle. */
  capWidth?: string[]
  /** Contextual object labels: when a resource of THIS type links out via a
   *  predicate listed here, its object's DISPLAY label is composed from the
   *  given field IRIs instead of the object type's own label — so a node shared
   *  across directions reads per-context. Keyed by the outgoing predicate IRI →
   *  field IRIs (same rule as `label`: literals joined by ' · ', a URI field →
   *  the referent's label). E.g. on Grant, `hasBeneficiary` → [roleLabel,
   *  isRoleOf]. Applies to LINKED objects only (embeds render their properties). */
  viaLabels?: Record<string, string[]>
  /** Faceted-browsing filters for this type's instance list. Each entry facets a
   *  property: a VALUE facet lists that property's distinct values with counts
   *  (click to narrow the list), a RANGE facet buckets a numeric property into
   *  configured bands. Config-file-authored only for v1 (no gear UI). Absent/empty
   *  → no facet panel. @see FacetConfig, /spec/ae-rdf */
  facets?: FacetConfig[]
}

/**
 * One faceted-browsing filter over a type's instances (see TypeConfig.facets).
 *
 * The presence of `ranges` decides the KIND:
 * - no `ranges` → a VALUE facet: lists the property's distinct values with a
 *   per-value distinct-instance count, most common first; clicking values narrows
 *   the instance list (multi-select within a facet = OR).
 * - `ranges` set → a RANGE facet: the numeric property is bucketed into the given
 *   bands, each shown with a count; clicking bands narrows the list.
 *
 * Across facets, selections combine with AND (all must hold); within one facet,
 * with OR. A facet's OWN counts are computed with the OTHER facets' selections
 * applied but NOT its own (classic faceted search), so its values always show what
 * ADDING them would yield.
 */
export interface FacetConfig {
  /** The faceted property IRI. */
  predicate: string
  /** Facet heading. Default: the humanized local name of `predicate`. */
  label?: string
  /** Numeric buckets. Presence makes this a RANGE facet; each band counts values
   *  where `min <= v < max` (either bound may be omitted for an open-ended band). */
  ranges?: { label: string; min?: number; max?: number }[]
  /** Max distinct values listed for a VALUE facet (default 15). One extra is
   *  fetched to detect (and note) truncation. Ignored for range facets. */
  limit?: number
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
  /** Max string length over this property's LITERAL values (absent/0 for URI-only
   *  properties). A display-config size hint: high maxLen ⇒ long prose (suggest
   *  `capWidth`); many short repeated values ⇒ suggest `columns`. */
  maxLen?: number
  /** Value node-kind distribution over the property's distinct (s,o) pairs — same
   *  dedup basis as `count`, so `iri+literal+bnode === count`; zero kinds omitted.
   *  PRESENCE of this object (even `{}`) is the "facts measured" marker. */
  nodeKinds?: { iri?: number; literal?: number; bnode?: number }
  /** Literal datatype distribution (full IRIs, count-desc). An `rdf:langString`
   *  entry ⇒ language-tagged text. Omitted when the property has no literal values. */
  datatypes?: UriCount[]
  /** Language-tag → count over langString values, keys sorted. Omitted if none. */
  languages?: Record<string, number>
  /** Object classes of IRI values: distinct (s,o) pairs per object class, count-desc,
   *  top RANGES_MAX (SAME basis as `count`/`nodeKinds`). A multi-typed object counts once
   *  per class, so Σ`ranges` + `untyped` ≥ `nodeKinds.iri`, with equality when objects are
   *  single-typed. Omitted when empty (no typed IRI objects). */
  ranges?: UriCount[]
  /** Distinct (s,o) pairs whose IRI object has NO rdf:type at all. Always present (even 0)
   *  once ranges were measured — its presence distinguishes "ranges measured" from "ranges
   *  timed out" (both `ranges` and `untyped` are absent when the ranges step timed out). */
  untyped?: number
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
  /** ALL instances of this type are blank nodes (profiler hint) — reachable only
   *  inline via a parent, so it wants render:embed + sidebar:hide. Set only when
   *  the type is EXCLUSIVELY blank; a mixed type keeps named instances navigable. */
  blank?: boolean
  /** Count of blank-node instances of this type (profiler hint), recorded whenever
   *  non-zero — even for mixed types (where `blank` is unset). */
  bnodeCount?: number
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
