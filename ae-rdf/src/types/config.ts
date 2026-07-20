/**
 * Configuration Types - External app configuration
 *
 * Supports pre-configured deployments where administrators provide
 * a config file with endpoints, app name, and other settings.
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import type {
  EndpointAnalysis,
  EndpointAuth,
  EndpointGraph,
  TypeConfig,
  TypeCount,
  TypeProfile,
  CompositionEntry,
  SuggestedEndpointSource,
} from './endpoint'

/**
 * Pre-configured endpoint from external config file. Carries its own per-endpoint
 * config (graph, types, typeInventory) — config is per-endpoint, not app-level.
 */
export interface ConfigEndpoint extends SuggestedEndpointSource {
  /** Authentication configuration for protected endpoints */
  auth?: EndpointAuth
  /** Pre-calculated analysis (optional - runs on first connect if missing) */
  analysis?: EndpointAnalysis
  /** Graph behaviour axes (quads / defaultView) — drives query construction */
  graph?: EndpointGraph
  /** SPARQL engine — profiler-only: picks the property-listing query shape
   *  (graphdb → flat; virtuoso/unset → nested quad-safe). @see scripts/profile-endpoint.ts */
  backend?: 'graphdb' | 'virtuoso'
  /** GraphDB: send `infer=<value>` with every query — false disables inferred
   *  triples. Omit to send nothing. */
  infer?: boolean
  /** Max in-flight SPARQL requests to this endpoint at once (default 4). Raise for a
   *  DB that handles parallelism well, lower for a fragile one. @see services/http.ts */
  maxConcurrency?: number
  /** Per-type display config, keyed by type IRI */
  types?: Record<string, TypeConfig>
  /** Cached type inventory (uri + count) for an instant Types sidebar on deploy */
  typeInventory?: TypeCount[]
  /** Discovered per-type property schema (generated offline by
   *  scripts/profile-endpoint.ts). Keyed by type IRI. */
  typeProperties?: Record<string, TypeProfile>
  /** Cached rdfs:subClassOf hierarchy: superclass IRI → subtype IRIs. When
   *  present the app seeds the sidebar tree from it instead of querying. */
  subclasses?: Record<string, string[]>
  /** Cached embed composition: composing class IRI → embed types it contains
   *  inline (with per-class counts). When present the app skips the live query. */
  composition?: Record<string, CompositionEntry[]>
  /** Cached embed-orphan counts: embed type IRI → number of instances with no
   *  owner via its embedVia predicate. When present the app skips the query. */
  orphanCounts?: Record<string, number>
  /** ISO timestamp of the last profiling run. */
  profiledAt?: string
  /** Predicate IRIs that flag a resource as deprecated when asserted `true`
   *  (profiler-detected from a seed of common flags, e.g. owl:deprecated). The
   *  app badges such resources. Unset → the app's built-in default. */
  deprecatedPredicates?: string[]
  /** Endpoint-specific label predicates appended to the built-in LABEL_PREDICATES
   *  at lowest precedence — for endpoints that label only via a vocab dropped from
   *  the default set (e.g. foaf:name / schema:name on LINDAS agents). */
  extraLabelPredicates?: string[]
  /** Endpoint-declared prefix → namespace map, seeded into the prefix resolver at
   *  highest precedence while this endpoint is active — keeps custom-vocab qnames
   *  correct per endpoint without bloating the global app.json prefixes. */
  prefixes?: Record<string, string>
  /** URI prefixes whose RESOURCES this endpoint serves (e.g. its data hosts).
   *  Drives URL-aware endpoint auto-switch: when a resource URI under one of these
   *  is entered/opened while another endpoint is active, the app switches to this
   *  endpoint and loads the resource there. Unlike `prefixes` (which shapes qname
   *  DISPLAY for vocabularies), these are resource-identity hosts. */
  resourceNamespaces?: string[]
  /** Language priorities (same as SuggestedEndpoint) */
  suggestedLanguagePriorities?: string[]
}

/**
 * External application configuration loaded from /config/app.json
 *
 * When this file exists and contains endpoints, the app operates in
 * "config mode" where endpoint management is disabled.
 */
export interface AppConfig {
  /** Custom application name (displayed in header) */
  appName?: string
  /** Custom logo URL (displayed before app name in header) */
  logoUrl?: string
  /** Link to documentation (replaces default GitHub docs link) */
  documentationUrl?: string
  /** Pre-configured SPARQL endpoints (when set, disables user endpoint management).
   *  Per-endpoint config (graph / types / typeInventory) lives on each entry. */
  endpoints?: ConfigEndpoint[]
  /** Global prefix → namespace map (a prefix is a global IRI-shortening, so it's
   *  shared across endpoints, not per-endpoint). */
  prefixes?: Record<string, string>
  /** Which parts of the DOI citation card to show (when the doiCitations setting
   *  is on). Any omitted field defaults to shown; set false to hide. */
  doi?: DoiDisplayConfig
}

/** Per-field toggles for the DOI citation card. Omitted = shown. */
export interface DoiDisplayConfig {
  authors?: boolean
  year?: boolean
  title?: boolean
  container?: boolean
  publisher?: boolean
  type?: boolean
  categories?: boolean
  abstract?: boolean
  copyright?: boolean
  url?: boolean
  /** Truncate the abstract to this many characters (default 280). */
  abstractMaxChars?: number
}

/**
 * Resolved config state used internally
 */
export interface ResolvedConfig {
  /** Whether app is in config mode (locked endpoints) */
  configMode: boolean
  /** Loaded config (null if not found or failed) */
  config: AppConfig | null
  /** Whether config loading is complete */
  loaded: boolean
  /** Any error during config load */
  error: string | null
}
