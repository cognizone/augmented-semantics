/**
 * useInstanceList - paged list of a type's instances (the T5 navigation index).
 *
 * Reads the selected type from the browse store, loads one page of instances plus
 * the total count, both graph-mode-gated and DISTINCT (see rdfQueries). Faceted
 * browsing lives in the FACET STORE (the sidebar's Filters rail owns the panel and
 * the counts); this composable READS the store's `activeSelections` to narrow the
 * list + count, and folds its `selectionVersion` into a watcher so a facet toggle
 * re-queries the list. The list's shown total stays the FILTERED total.
 *
 * requestId race-guard per com02 — ONE token for the list + count loads, so
 * switching type / endpoint / graph / facet invalidates every in-flight write
 * (see ae-rdf/CLAUDE.md: a reset must bump the token the load actually checks).
 *
 * @see /spec/ae-rdf
 * @see /spec/common/com02-StateManagement.md
 */
import { ref, computed, watch, onScopeDispose, type Ref } from 'vue'
import { useEndpointStore, useBrowseStore, useTypeConfigStore, useLanguageStore, useFacetStore } from '../stores'
import {
  executeSparql,
  resolveUris,
  logger,
  buildInstanceListQuery,
  buildInstanceCountQuery,
  buildInstanceColumnsQuery,
  buildFacetConstraints,
  resolveGraphStrategy,
  resolveSearchPredicates,
} from '../services'
import { composeLabels, resolveLabels, resolveDeprecated } from './composeLabels'
import { DEFAULT_DEPRECATED_PREDICATES } from '../services'
import { labelLangs } from '../utils/labelLang'

export interface Instance {
  uri: string
  label: string
  deprecated?: boolean
  /** Extra column values (display strings), aligned to the type's `columns` config;
   *  filled in after the row loads (empty string = no value / not yet loaded). */
  cells?: string[]
}

export const PAGE_SIZE = 25

export function useInstanceList() {
  const endpointStore = useEndpointStore()
  const browseStore = useBrowseStore()
  const typeConfig = useTypeConfigStore()
  const languageStore = useLanguageStore()
  const facetStore = useFacetStore()

  const instances: Ref<Instance[]> = ref([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const page = ref(0)
  const typeLabel = ref('')
  const filter = ref('') // label/URI substring; empty = unfiltered
  const orphansOnly = ref(false) // embed types only: show just instances with no owner via embedVia
  let requestId = 0

  // The current type's embed owning predicate, if it's an embed type that pins one.
  // Only such types HAVE orphans (instances with no owner via it), so the toggle
  // shows only when this is set — otherwise "orphan" is undefined.
  const orphanVia = computed(() => {
    const type = browseStore.currentType
    if (!type) return ''
    const cfg = typeConfig.get(type)
    return cfg.render === 'embed' && cfg.embedVia ? cfg.embedVia : ''
  })
  const canFilterOrphans = computed(() => !!orphanVia.value)

  // A type's list columns, inheriting the nearest ancestor's when this exact type
  // configures none — so a superclass (Result) is configured once and its subclasses
  // (JournalPaper, …) get it for free. A subclass with its OWN listColumns overrides.
  // The subclass map (super → subs) ships in the config, so this needs no query.
  function resolveListColumns(type: string) {
    const own = typeConfig.get(type).listColumns
    if (own) return own
    const subs = endpointStore.current?.subclasses
    if (!subs) return []
    const parentOf = new Map<string, string>()
    for (const [sup, kids] of Object.entries(subs)) for (const k of kids ?? []) parentOf.set(k, sup)
    const seen = new Set<string>([type])
    for (let cur = parentOf.get(type); cur && !seen.has(cur); cur = parentOf.get(cur)) {
      seen.add(cur)
      const inherited = typeConfig.get(cur).listColumns
      if (inherited) return inherited
    }
    return []
  }

  // Configured extra columns for the current type (headings for the list table).
  const columns = computed(() => {
    const type = browseStore.currentType
    return type ? resolveListColumns(type) : []
  })
  let countedFor: string | null = null // `${endpointId}|${type}|${filter}|…` the total is valid for

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
    const via = orphansOnly.value ? orphanVia.value : ''
    // Facet selections (owned by the facet store) narrow the list AND its total —
    // ALL of them (no exclude; the exclude is only for a facet's own value counts).
    const facetFragment = buildFacetConstraints(facetStore.activeSelections, strategy)
    const countKey = `${endpointId}|${strategy.useNamed}${strategy.useDefault}|${type}|${term}|${searchPredicates.join(',')}|${via}|${facetFragment}`
    const needCount = countedFor !== countKey

    logger.info('useInstanceList', 'Loading instances', { type, page: page.value, strategy })

    // Lazy count: the COUNT(DISTINCT) scans the whole type and is the slow part,
    // so don't block the list on it — fire it separately and fill total in when
    // it lands. Reset stale total now so the header doesn't show the old type's.
    if (needCount) total.value = 0

    try {
      const [listRes, typeResolved] = await Promise.all([
        executeSparql(endpoint, buildInstanceListQuery(type, strategy, PAGE_SIZE, page.value * PAGE_SIZE, term, searchPredicates, via, facetFragment), { retries: 1 }),
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
      const depSet = new Set<string>()
      await resolveDeprecated(endpoint, uris, endpoint.deprecatedPredicates ?? [...DEFAULT_DEPRECATED_PREDICATES], depSet, isCurrent)
      if (!isCurrent()) return
      instances.value = uris.map(u => ({ uri: u, label: labelMap.get(u) ?? u, deprecated: depSet.has(u) }))

      // Extra columns (config-driven): one SAMPLE'd value per (instance, column)
      // for this page. Fire-and-forget like the count — the rows render immediately
      // and the cells fill in when this lands. URI cells resolve to a qname.
      const columnDefs = resolveListColumns(type)
      if (columnDefs.length && uris.length) {
        const colQuery = buildInstanceColumnsQuery(uris, columnDefs, strategy)
        if (colQuery) {
          executeSparql(endpoint, colQuery, { retries: 1 })
            .then(async colRes => {
              if (!isCurrent()) return
              const rowByUri = new Map<string, Record<number, { value: string; isUri: boolean }>>()
              const uriCells: string[] = []
              for (const b of colRes.results.bindings) {
                const sv = b.s?.value
                if (!sv) continue
                const row: Record<number, { value: string; isUri: boolean }> = {}
                columnDefs.forEach((_, i) => {
                  const cell = b[`v${i}`]
                  if (cell?.value != null) {
                    const isUri = cell.type === 'uri'
                    row[i] = { value: cell.value, isUri }
                    if (isUri) uriCells.push(cell.value)
                  }
                })
                rowByUri.set(sv, row)
              }
              const qn = uriCells.length ? await resolveUris([...new Set(uriCells)]) : new Map()
              if (!isCurrent()) return
              instances.value = instances.value.map(inst => {
                const row = rowByUri.get(inst.uri)
                const cells = columnDefs.map((_, i) => {
                  const c = row?.[i]
                  if (!c) return ''
                  if (!c.isUri) return c.value
                  const r = qn.get(c.value)
                  return r ? `${r.prefix}:${r.localName}` : c.value
                })
                return { ...inst, cells }
              })
            })
            .catch(e => logger.warn('useInstanceList', 'Columns failed', { type, error: e }))
        }
      }

      if (needCount) {
        executeSparql(endpoint, buildInstanceCountQuery(type, strategy, term, searchPredicates, via, facetFragment), { retries: 1 })
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

  // Reset page to 0 without a double load: the page watcher is suppressed for the
  // programmatic reset, then we drive the load ourselves.
  let suppressPageWatch = false
  function reloadFromFirstPage() {
    if (!browseStore.currentType) return
    if (page.value !== 0) { suppressPageWatch = true; page.value = 0 }
    load()
  }

  // New type → reset paging and (re)load the list. Facet selections/results reset
  // in the facet store (its own type watcher).
  watch(
    () => browseStore.currentType,
    (t) => {
      page.value = 0
      countedFor = null
      orphansOnly.value = false // don't carry a hidden orphan constraint to the next type
      if (t) load()
      else { instances.value = []; total.value = 0 }
    },
    { immediate: true }
  )
  // Endpoint change → reload from page 0 (the facet store resets its own state).
  watch(() => endpointStore.current?.id, () => {
    countedFor = null
    if (browseStore.currentType) reloadFromFirstPage()
  })
  watch(page, () => {
    if (suppressPageWatch) { suppressPageWatch = false; return }
    if (browseStore.currentType) load()
  })
  // Graph scope changed → the result set differs, so reload from page 0 (a deep
  // OFFSET would land past the new, smaller total). Facet store reloads its counts.
  watch(() => browseStore.graph, () => reloadFromFirstPage())

  // Facet selection toggled (in the sidebar Filters rail) → the filtered set + its
  // total change, so re-query the list from page 0. selectionVersion bumps on every
  // toggle/clear; load()'s requestId guard drops any in-flight page load.
  watch(() => facetStore.selectionVersion, () => reloadFromFirstPage())

  // Filter changed → debounce (no query per keystroke), then reset to page 0 and
  // reload. load()'s requestId guard drops any in-flight page load, so a fast typist
  // never lands stale rows on a new term. Filter is kept across type changes.
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

  // Orphan toggle → new result set + count, back to page 0 (list only).
  watch(orphansOnly, () => {
    if (!browseStore.currentType) return
    if (page.value === 0) load()
    else page.value = 0 // page watcher reloads
  })

  function setPage(n: number) {
    page.value = n
  }

  /** The SELECT behind the CURRENT list — same type / graph / search / facets /
   *  orphan constraints load() uses, at page 0 with a plain LIMIT — for handing off
   *  to the SPARQL panel ("Open in SPARQL"). Null when nothing is selected. */
  function currentListQuery(limit = 100): string | null {
    const type = browseStore.currentType
    const endpoint = endpointStore.current
    if (!type || !endpoint) return null
    const strategy = resolveGraphStrategy(browseStore.graph)
    const term = filter.value.trim()
    const searchPredicates = resolveSearchPredicates(typeConfig.get(type), endpoint.typeProperties?.[type])
    const via = orphansOnly.value ? orphanVia.value : ''
    const facetFragment = buildFacetConstraints(facetStore.activeSelections, strategy)
    return buildInstanceListQuery(type, strategy, limit, 0, term, searchPredicates, via, facetFragment)
  }

  return {
    instances, total, loading, error, page, pageSize: PAGE_SIZE, typeLabel, filter,
    orphansOnly, canFilterOrphans, columns, setPage, currentListQuery,
  }
}
