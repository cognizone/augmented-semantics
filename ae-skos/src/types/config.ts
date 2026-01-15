/**
 * Configuration Types - External app configuration
 *
 * Supports pre-configured deployments where administrators provide
 * a config file with endpoints, app name, and other settings.
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import type { EndpointAnalysis, EndpointAuth, SuggestedEndpointSource } from './endpoint'

/**
 * Pre-configured endpoint from external config file.
 * Extends SuggestedEndpointSource with optional auth and analysis.
 */
export interface ConfigEndpoint extends SuggestedEndpointSource {
  /** Authentication configuration for protected endpoints */
  auth?: EndpointAuth
  /** Pre-calculated analysis (optional - runs on first connect if missing) */
  analysis?: EndpointAnalysis
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
  /** Link to documentation (replaces default GitHub docs link) */
  documentationUrl?: string
  /** Pre-configured SPARQL endpoints (when set, disables user endpoint management) */
  endpoints?: ConfigEndpoint[]
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
