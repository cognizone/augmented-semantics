/**
 * Build a deployable app.json (AppConfig) from the live app state, and download
 * it. The authoring loop: tweak endpoints + per-type config live → export →
 * deploy as config/app.json → config mode (locked) for end users.
 *
 * @see /spec/ae-rdf/rdf-overview.md (Per-type config)
 */
import type { AppConfig, ConfigEndpoint, SPARQLEndpoint, TypeConfig } from '../types'

export interface ExportInput {
  endpoints: SPARQLEndpoint[]
  types: Record<string, TypeConfig>
  appName?: string
  logoUrl?: string
  documentationUrl?: string
}

/** Assemble an AppConfig, omitting empty sections. */
export function buildAppConfig(input: ExportInput): AppConfig {
  const config: AppConfig = {}
  if (input.appName) config.appName = input.appName
  if (input.logoUrl) config.logoUrl = input.logoUrl
  if (input.documentationUrl) config.documentationUrl = input.documentationUrl

  if (input.endpoints.length) {
    config.endpoints = input.endpoints.map(e => {
      const ce: ConfigEndpoint = { name: e.name, url: e.url }
      // Signal that auth is required, but NEVER bake credentials into a shared
      // static file — the deployer supplies them at runtime.
      if (e.auth && e.auth.type !== 'none') ce.auth = { type: e.auth.type }
      return ce
    })
  }

  if (Object.keys(input.types).length) config.types = input.types
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
