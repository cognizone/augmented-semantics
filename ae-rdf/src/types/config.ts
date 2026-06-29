/**
 * Configuration Types - External app configuration
 *
 * Supports pre-configured deployments where administrators provide
 * a config file with endpoints, app name, and other settings.
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import type { EndpointAnalysis, EndpointAuth, EndpointGraph, SuggestedEndpointSource } from './endpoint'

/**
 * Pre-configured endpoint from external config file.
 * Extends SuggestedEndpointSource with optional auth and analysis.
 */
export interface ConfigEndpoint extends SuggestedEndpointSource {
  /** Authentication configuration for protected endpoints */
  auth?: EndpointAuth
  /** Pre-calculated analysis (optional - runs on first connect if missing) */
  analysis?: EndpointAnalysis
  /** Graph behaviour axes (quads / defaultView) — drives query construction */
  graph?: EndpointGraph
  /** Language priorities (same as SuggestedEndpoint) */
  suggestedLanguagePriorities?: string[]
}

/** How a resource of a given type renders when it is the OBJECT of a triple. */
export type TypeRender = 'link' | 'embed' | 'label'

/** What the Types sidebar does with a type. */
export type TypeSidebar = 'show' | 'hide' | 'pin'

/**
 * Per-type configuration (authored live, exported to app.json).
 * `link` (default): clickable navigation chip.
 * `embed`: value object — inline its properties (MonetaryAmount, coordinates).
 * `label`: show identity only, no navigation.
 */
export interface TypeConfig {
  render?: TypeRender
  sidebar?: TypeSidebar
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
  /** Pre-configured SPARQL endpoints (when set, disables user endpoint management) */
  endpoints?: ConfigEndpoint[]
  /** Per-type display config, keyed by type IRI (authored live, see typeConfig store) */
  types?: Record<string, TypeConfig>
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
