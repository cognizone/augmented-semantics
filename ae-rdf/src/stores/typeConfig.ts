/**
 * Type Config Store - per-type display strategy for the CURRENT endpoint.
 *
 * Per-endpoint config lives on the endpoint object itself (`endpoint.types`,
 * persisted in the shared `ae-endpoints` store, and carried by config-mode
 * endpoints from app.json). This store is a thin reactive accessor over the
 * current endpoint's `types` map; the authoring gear writes through it.
 *
 * @see /spec/ae-rdf/rdf-overview.md (Per-type config)
 */
import { defineStore } from 'pinia'
import { useEndpointStore } from './endpoint'
import type { TypeConfig } from '../types'

export const useTypeConfigStore = defineStore('typeConfig', () => {
  const endpointStore = useEndpointStore()

  function get(typeUri: string): TypeConfig {
    return endpointStore.current?.types?.[typeUri] ?? {}
  }

  /** Merge a patch into a type's config on the current endpoint; prune empties. */
  function set(typeUri: string, patch: Partial<TypeConfig>) {
    const ep = endpointStore.current
    if (!ep) return
    const next: TypeConfig = { ...get(typeUri), ...patch }
    for (const k of Object.keys(next) as (keyof TypeConfig)[]) {
      if (next[k] === undefined) delete next[k]
    }
    const all = { ...(ep.types ?? {}) }
    if (Object.keys(next).length) all[typeUri] = next
    else delete all[typeUri]
    endpointStore.updateEndpoint(ep.id, { types: Object.keys(all).length ? all : undefined })
  }

  return { get, set }
})
