/**
 * Type Config Store - per-type display strategy, authored live.
 *
 * Seeded from the deployed app.json (`config.types`), then overlaid with the
 * user's local edits (localStorage `ae-rdf-type-config`). The authoring gears
 * write here; a later step exports this back out as app.json `types`.
 *
 * @see /spec/ae-rdf/rdf-overview.md
 */
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { logger, getConfig } from '../services'
import type { TypeConfig } from '../types'

const STORAGE_KEY = 'ae-rdf-type-config'

export const useTypeConfigStore = defineStore('typeConfig', () => {
  const config = ref<Record<string, TypeConfig>>({})

  function load() {
    const fromApp = getConfig()?.types ?? {}
    let stored: Record<string, TypeConfig> = {}
    try {
      const s = localStorage.getItem(STORAGE_KEY)
      if (s) stored = JSON.parse(s)
    } catch (e) {
      logger.warn('TypeConfigStore', 'Failed to load type config', { error: e })
    }
    config.value = { ...fromApp, ...stored } // local edits win over deployed defaults
  }

  function get(typeUri: string): TypeConfig {
    return config.value[typeUri] ?? {}
  }

  /** Merge a patch into a type's config; drop the entry when it becomes empty. */
  function set(typeUri: string, patch: Partial<TypeConfig>) {
    const next: TypeConfig = { ...get(typeUri), ...patch }
    for (const k of Object.keys(next) as (keyof TypeConfig)[]) {
      if (next[k] === undefined) delete next[k]
    }
    const all = { ...config.value }
    if (Object.keys(next).length) all[typeUri] = next
    else delete all[typeUri]
    config.value = all
  }

  watch(
    config,
    () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config.value))
      } catch (e) {
        logger.warn('TypeConfigStore', 'Failed to save type config', { error: e })
      }
    },
    { deep: true }
  )

  load()

  return { config, get, set, load }
})
