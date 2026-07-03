/**
 * Build a deployable app.json (AppConfig) from the live app state, and download
 * it. The authoring loop: tweak endpoints + per-type config live → export →
 * deploy as config/app.json → config mode (locked) for end users.
 *
 * @see /spec/ae-rdf/rdf-overview.md (Per-type config)
 */
import type { AppConfig, ConfigEndpoint, SPARQLEndpoint } from '../types'

export interface ExportInput {
  endpoints: SPARQLEndpoint[]
  /** Global prefix → namespace map (prefixes are shared, not per-endpoint). */
  prefixes?: Record<string, string>
  appName?: string
  logoUrl?: string
  documentationUrl?: string
}

/** Filename-safe slug for an endpoint, matching config/endpoints/<slug>.json.
 *  Falls back to 'endpoint' for a name with no ASCII alphanumerics, so the
 *  download is `endpoint.json`, not a base-less `.json` dotfile. (R35) */
export function endpointSlug(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'endpoint'
}

/** Build one endpoint's deployable config, omitting empty sections. */
export function buildEndpointConfig(e: SPARQLEndpoint): ConfigEndpoint {
  const ce: ConfigEndpoint = { name: e.name, url: e.url }
  // Signal that auth is required, but NEVER bake credentials into a shared
  // static file — the deployer supplies them at runtime.
  if (e.auth && e.auth.type !== 'none') ce.auth = { type: e.auth.type }
  if (e.graph && (e.graph.quads !== undefined || e.graph.defaultView !== undefined)) ce.graph = e.graph
  if (e.types && Object.keys(e.types).length) ce.types = e.types
  if (e.typeInventory?.length) ce.typeInventory = e.typeInventory
  if (e.typeProperties && Object.keys(e.typeProperties).length) ce.typeProperties = e.typeProperties
  if (e.subclasses && Object.keys(e.subclasses).length) ce.subclasses = e.subclasses
  if (e.composition && Object.keys(e.composition).length) ce.composition = e.composition
  if (e.orphanCounts && Object.keys(e.orphanCounts).length) ce.orphanCounts = e.orphanCounts
  if (e.languagePriorities?.length) ce.suggestedLanguagePriorities = e.languagePriorities
  if (e.profiledAt) ce.profiledAt = e.profiledAt
  return ce
}

/** Assemble an AppConfig from per-endpoint config, omitting empty sections. */
export function buildAppConfig(input: ExportInput): AppConfig {
  const config: AppConfig = {}
  if (input.appName) config.appName = input.appName
  if (input.logoUrl) config.logoUrl = input.logoUrl
  if (input.documentationUrl) config.documentationUrl = input.documentationUrl

  if (input.endpoints.length) {
    config.endpoints = input.endpoints.map(buildEndpointConfig)
  }

  if (input.prefixes && Object.keys(input.prefixes).length) config.prefixes = input.prefixes
  return config
}

/** Download an object as pretty-printed JSON. */
export function downloadJson(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
