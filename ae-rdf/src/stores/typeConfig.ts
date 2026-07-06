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

  /** Profiler hint: this type's instances are blank nodes — anonymous, so they
   *  have no navigable instance view and are only ever reached inline via a
   *  parent. Treated as hidden + non-clickable in the sidebar. */
  function blank(typeUri: string): boolean {
    return endpointStore.current?.typeProperties?.[typeUri]?.blank === true
  }

  /** The one type whose config governs a multi-typed resource: the first (sorted)
   *  of `typeUris` carrying any order/hide/label config, else the first type.
   *  ONE rule so the heading's composed label (useResourceView.deriveLabel) and
   *  the edit-panel toggles (ResourceView.cfgType) act on the SAME config — picked
   *  independently they drifted, so toggling a label wrote a type the heading
   *  didn't read from. (R28) */
  function configType(typeUris: string[]): string | null {
    const sorted = [...typeUris].sort()
    return sorted.find(u => {
      const c = get(u)
      return (c.order?.length ?? 0) > 0 || (c.hide?.length ?? 0) > 0 || (c.label?.length ?? 0) > 0
    }) ?? sorted[0] ?? null
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

  return { get, set, configType, blank }
})
