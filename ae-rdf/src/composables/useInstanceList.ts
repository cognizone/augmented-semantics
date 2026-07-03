/**
 * useInstanceList - paged list of a type's instances (the T5 navigation index).
 *
 * Reads the selected type from the browse store, loads one page of instances
 * plus the total count, both graph-mode-gated and DISTINCT (see rdfQueries).
 * requestId race-guard per com02. Reloads on type, page, or graph change.
 *
 * @see /spec/ae-rdf
 * @see /spec/common/com02-StateManagement.md
 */
import { ref, watch, onScopeDispose, type Ref } from 'vue'
import { useEndpointStore, useBrowseStore, useTypeConfigStore, useLanguageStore } from '../stores'
import {
  executeSparql,
  resolveUris,
  logger,
  buildInstanceListQuery,
  buildInstanceCountQuery,
  resolveGraphStrategy,
  resolveSearchPredicates,
} from '../services'
import { composeLabels, resolveLabels } from './composeLabels'
import { labelLangs } from '../utils/labelLang'

export interface Instance {
  uri: string
  label: string
}

export const PAGE_SIZE = 25

export function useInstanceList() {
  const endpointStore = useEndpointStore()
  const browseStore = useBrowseStore()
  const typeConfig = useTypeConfigStore()
  const languageStore = useLanguageStore()

  const instances: Ref<Instance[]> = ref([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const page = ref(0)
  const typeLabel = ref('')
  const filter = ref('') // label/URI substring; empty = unfiltered
  let requestId = 0
  let countedFor: string | null = null // `${endpointId}|${type}|${filter}` the total is valid for

  async function load(): Promise<void> {
    const type = browseStore.currentType
    const endpoint = endpointStore.current
    if (!type || !endpoint) {
      instances.value = []
      total.value = 0
      return
    }
    const endpointId = endpoint.id
    const strategy = resolveGraphStrategy(browseStore.graph)
    const id = ++requestId
    const isCurrent = () => id === requestId && endpointStore.current?.id === endpointId

    loading.value = true
    error.value = null
    const term = filter.value.trim()
    // Fields the text filter matches: explicit `search` → `label` → trimmed
    // defaults (see resolveSearchPredicates). Folded into countKey so the count
    // tracks the filtered set (and any config change to the searchable fields).
    const searchPredicates = resolveSearchPredicates(typeConfig.get(type), endpoint.typeProperties?.[type])
    const countKey = `${endpointId}|${strategy.useNamed}${strategy.useDefault}|${type}|${term}|${searchPredicates.join(',')}`
    const needCount = countedFor !== countKey

    logger.info('useInstanceList', 'Loading instances', { type, page: page.value, strategy })

    // Lazy count: the COUNT(DISTINCT) scans the whole type and is the slow part,
    // so don't block the list on it — fire it separately and fill total in when
    // it lands. Reset stale total now so the header doesn't show the old type's.
    if (needCount) total.value = 0

    try {
      const [listRes, typeResolved] = await Promise.all([
        executeSparql(endpoint, buildInstanceListQuery(type, strategy, PAGE_SIZE, page.value * PAGE_SIZE, term, searchPredicates), { retries: 1 }),
        resolveUris([type]),
      ])
      if (!isCurrent()) return

      const uris = listRes.results.bindings.map(b => b.s?.value ?? '').filter(Boolean)

      const r = typeResolved.get(type)
      typeLabel.value = r?.prefix ? `${r.prefix}:${r.localName}` : (r?.localName ?? type)

      // Canonical labels for the page via the SHARED resolver (6-predicate
      // precedence + SKOS-XL + language) — the same one the detail heading and
      // links use, so a resource reads identically in the list and on its own
      // page (hand-rolling a subset in the list query is what drifted them apart).
      // Then the per-type composed label on top when the browsed type configures
      // one (resolves URI label fields to the referent's own label, not a UUID).
      const langs = labelLangs(endpoint.languagePriorities, languageStore.preferred)
      const labelMap = new Map<string, string>()
      const typeMap = new Map(uris.map(u => [u, type]))
      await resolveLabels(endpoint, uris, langs, labelMap, typeMap, isCurrent)
      if (!isCurrent()) return
      if ((typeConfig.get(type).label?.length ?? 0) && uris.length) {
        await composeLabels(endpoint, labelMap, typeMap, typeConfig, langs, '', isCurrent)
        if (!isCurrent()) return
      }
      instances.value = uris.map(u => ({ uri: u, label: labelMap.get(u) ?? u }))

      if (needCount) {
        executeSparql(endpoint, buildInstanceCountQuery(type, strategy, term, searchPredicates), { retries: 1 })
          .then(countRes => {
            if (!isCurrent()) return
            total.value = parseInt(countRes.results.bindings[0]?.total?.value ?? '0', 10)
            countedFor = countKey
          })
          .catch(e => logger.warn('useInstanceList', 'Count failed', { type, error: e }))
      }

      logger.info('useInstanceList', 'Loaded instances', { shown: instances.value.length, total: total.value })
    } catch (e: unknown) {
      if (!isCurrent()) return
      const msg = e && typeof e === 'object' && 'message' in e ? (e as { message: string }).message : 'Unknown error'
      logger.error('useInstanceList', 'Failed to load instances', { type, error: e })
      error.value = `Failed to load instances: ${msg}`
      instances.value = []
    } finally {
      if (isCurrent()) loading.value = false
    }
  }

  // New type → reset to page 0 and (re)load. Page / graph changes reload too.
  watch(
    () => browseStore.currentType,
    (t) => {
      page.value = 0
      countedFor = null
      if (t) load()
      else { instances.value = []; total.value = 0 }
    },
    { immediate: true }
  )
  watch(page, () => { if (browseStore.currentType) load() })
  // Graph scope changed → the result set differs, so return to page 0; a deep
  // OFFSET would otherwise land past the new (smaller) total and show an empty
  // page. Already on page 0 → load() directly; else let the page watcher fire
  // (setting page here reloads via that watcher — avoids a double load).
  watch(() => browseStore.graph, () => {
    if (!browseStore.currentType) return
    if (page.value === 0) load()
    else page.value = 0
  })

  // Filter changed → debounce (no query per keystroke), then reset to page 0 and
  // reload. The new term makes a new result set AND a new count (countKey folds
  // the term in, so needCount re-fires). load()'s requestId guard drops any
  // in-flight page load, so a fast typist never lands stale rows on a new term.
  // Filter is kept across type changes — the box stays visible so it's not a
  // hidden constraint, and the type watcher's load() already picks up the term.
  let filterTimer: ReturnType<typeof setTimeout> | undefined
  watch(filter, () => {
    clearTimeout(filterTimer)
    filterTimer = setTimeout(() => {
      if (!browseStore.currentType) return
      if (page.value === 0) load()
      else page.value = 0 // page watcher reloads
    }, 300)
  })
  onScopeDispose(() => clearTimeout(filterTimer))

  function setPage(n: number) {
    page.value = n
  }

  return { instances, total, loading, error, page, pageSize: PAGE_SIZE, typeLabel, filter, setPage }
}
