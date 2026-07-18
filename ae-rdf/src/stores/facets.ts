/**
 * Facet Store - the single source of truth for config-driven FACETED browsing
 * over the current type's instance list.
 *
 * Driven by the CURRENT TYPE (browse store), endpoint and graph — NOT by the
 * instance-list component's lifecycle. The instance list unmounts while a resource
 * is open (?resource wins), yet ?type persists and the sidebar's Filters rail stays
 * live, so facet state must survive independently of what's mounted.
 *
 * Owns: the facet DEFINITIONS (from typeConfig), the current SELECTIONS (value term
 * keys / range band indexes), and each facet's RESULTS (values-with-counts or range
 * buckets, truncation, loading). The instance list READS `activeSelections` to filter
 * its list + count and folds `selectionVersion` into its reactive key so a toggle
 * re-queries the list.
 *
 * INVALIDATION (see ae-rdf/CLAUDE.md): one `requestId` token, bumped on every load
 * AND on any type/endpoint/graph change. Every async write is guarded by `isCurrent()`
 * which re-checks the token AND that the endpoint + type are still current — a stale
 * facet result never lands on a new selection/type.
 *
 * FACETING CORRECTNESS: each facet's OWN counts apply the OTHER facets' selections but
 * NOT its own (collectSelections(exclude)); the instance list applies ALL selections.
 *
 * @see /spec/ae-rdf
 * @see /spec/common/com02-StateManagement.md
 */
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useEndpointStore } from './endpoint'
import { useBrowseStore } from './browse'
import { useTypeConfigStore } from './typeConfig'
import { useLanguageStore } from './language'
import {
  executeSparql,
  resolveUris,
  logger,
  buildFacetConstraints,
  buildFacetValuesQuery,
  buildFacetRangesQuery,
  resolveGraphStrategy,
  type GraphStrategy,
  type FacetSelection,
  type FacetValueTerm,
} from '../services'
import { resolveLabels } from '../composables/composeLabels'
import { labelLangs } from '../utils/labelLang'
import { qname, formatLiteral, humanizeLocalName } from '../utils/format'
import type { SPARQLEndpoint, FacetConfig } from '../types/endpoint'

export const DEFAULT_FACET_LIMIT = 15

/** One selectable value in a VALUE facet (with its resolved display label). */
export interface FacetValueItem {
  key: string
  term: FacetValueTerm
  label: string
  count: number
}

/** One selectable band in a RANGE facet. */
export interface FacetRangeItem {
  index: number
  label: string
  count: number
}

/** A facet ready for the panel: heading + its value rows or range bands. */
export interface FacetView {
  predicate: string
  label: string
  kind: 'value' | 'range'
  /** VALUE facets: values, count-desc (zero-count hidden by the UI). */
  values?: FacetValueItem[]
  /** VALUE facets: more values exist than `limit` (show a "top N" note). */
  truncated?: boolean
  limit?: number
  /** RANGE facets: configured bands with counts. */
  ranges?: FacetRangeItem[]
}

/** Stable key for a facet term so a selection round-trips (URI vs literal, with
 *  its lang/datatype — two literals differing only by lang are distinct terms). */
export function facetTermKey(t: FacetValueTerm): string {
  if (t.isUri) return `u:${t.value}`
  return `l:${t.value}${t.lang ?? ''}${t.datatype ?? ''}`
}

export const useFacetStore = defineStore('facets', () => {
  const endpointStore = useEndpointStore()
  const browseStore = useBrowseStore()
  const typeConfig = useTypeConfigStore()
  const languageStore = useLanguageStore()

  // Per-facet results ready for the panel, plus a loading flag.
  const results = ref<FacetView[]>([])
  const loading = ref(false)
  // Bumped on every selection edit — the instance list folds this into its reactive
  // key so a facet toggle re-queries the list (facets live here, not in the list).
  const selectionVersion = ref(0)
  // Selections are the source of truth for BOTH the facet counts and the list:
  //  - value facet → predicate → (termKey → term)
  //  - range facet → predicate → set of selected band indexes
  const valueSelections = ref<Map<string, Map<string, FacetValueTerm>>>(new Map())
  const rangeSelections = ref<Map<string, Set<number>>>(new Map())

  let requestId = 0

  // Definitions for the current type, straight from its config (reactive to the
  // endpoint's type map). Empty when no type is selected or none are configured.
  const definitions = computed<FacetConfig[]>(() => {
    const type = browseStore.currentType
    return type ? (typeConfig.get(type).facets ?? []) : []
  })
  const hasFacets = computed(() => definitions.value.length > 0)

  const activeCount = computed(() => {
    let n = 0
    for (const m of valueSelections.value.values()) n += m.size
    for (const s of rangeSelections.value.values()) n += s.size
    return n
  })
  const hasSelections = computed(() => activeCount.value > 0)

  /** Current selections as FacetSelection[], optionally EXCLUDING one facet's own
   *  predicate — the exclude is how a facet's counts show "what adding this value
   *  would yield" while every OTHER facet stays applied (classic faceted search). */
  function collectSelections(exclude?: string): FacetSelection[] {
    const out: FacetSelection[] = []
    for (const def of definitions.value) {
      if (def.predicate === exclude) continue
      if (def.ranges?.length) {
        const set = rangeSelections.value.get(def.predicate)
        if (set?.size) out.push({
          predicate: def.predicate,
          ranges: [...set].map(i => def.ranges![i]).filter((r): r is { label: string; min?: number; max?: number } => !!r),
          via: def.via,
          datatype: def.datatype,
        })
      } else {
        const sel = valueSelections.value.get(def.predicate)
        if (sel?.size) out.push({ predicate: def.predicate, terms: [...sel.values()], via: def.via })
      }
    }
    return out
  }

  /** All current selections (no exclude) — what the instance list applies to its
   *  list + total. Recomputed when any selection changes. */
  const activeSelections = computed<FacetSelection[]>(() => {
    // Touch selectionVersion so consumers folding it into a key stay in sync even
    // if they read this getter (the Maps are replaced wholesale, so this is belt-
    // and-braces, but keeps the contract explicit).
    void selectionVersion.value
    return collectSelections()
  })

  /**
   * Load every configured facet's counts. Each facet's counts apply the OTHER
   * facets' selections but NOT its own (collectSelections(def.predicate)), so an
   * unselected value shows what narrowing to it would yield. URI value labels come
   * from the canonical resolver (batched), falling back to a qname; literals render
   * as-is. Guarded by isCurrent (token + endpoint + type). Facet failures are warned,
   * never surfaced as an error — the list stays usable.
   */
  async function load(): Promise<void> {
    const type = browseStore.currentType
    const endpoint = endpointStore.current
    const defs = definitions.value
    if (!type || !endpoint || !defs.length) {
      results.value = []
      return
    }
    const endpointId = endpoint.id
    const strategy = resolveGraphStrategy(browseStore.graph)
    const id = ++requestId
    const isCurrent = () =>
      id === requestId &&
      endpointStore.current?.id === endpointId &&
      browseStore.currentType === type

    loading.value = true
    logger.info('facetStore', 'Loading facet counts', { type, active: activeCount.value })
    try {
      await loadCounts(endpoint, type, defs, strategy, isCurrent)
    } catch (e) {
      logger.warn('facetStore', 'Facet load failed', { type, error: e })
    } finally {
      if (isCurrent()) loading.value = false
    }
  }

  async function loadCounts(
    endpoint: SPARQLEndpoint,
    type: string,
    defs: FacetConfig[],
    strategy: GraphStrategy,
    isCurrent: () => boolean,
  ): Promise<void> {
    const raw = await Promise.all(defs.map(async def => {
      const fragment = buildFacetConstraints(collectSelections(def.predicate), strategy)
      if (def.ranges?.length) {
        const q = buildFacetRangesQuery(type, def.predicate, def.ranges, fragment, strategy, def.via, def.datatype === 'date')
        const res = await executeSparql(endpoint, q, { retries: 1 })
        const b = res.results.bindings[0] ?? {}
        const counts = def.ranges.map((_, i) => parseInt(b[`b${i}`]?.value ?? '0', 10))
        return { def, kind: 'range' as const, counts }
      }
      const limit = def.limit ?? DEFAULT_FACET_LIMIT
      const q = buildFacetValuesQuery(type, def.predicate, fragment, strategy, limit, def.via)
      const res = await executeSparql(endpoint, q, { retries: 1 })
      const rows = res.results.bindings
        .map(bd => {
          const v = bd.v
          const term: FacetValueTerm = {
            value: v?.value ?? '',
            isUri: v?.type === 'uri',
            datatype: v?.datatype,
            lang: v?.['xml:lang'],
          }
          return { term, key: facetTermKey(term), count: parseInt(bd.n?.value ?? '0', 10) }
        })
        .filter(row => row.term.value)
      const truncated = rows.length > limit
      return { def, kind: 'value' as const, rows: rows.slice(0, limit), truncated, limit }
    }))
    if (!isCurrent()) return

    // Batch-resolve URI value labels (canonical resolver + qname fallback).
    const uriValues = [...new Set(raw.flatMap(r => (r.kind === 'value' ? r.rows.filter(x => x.term.isUri).map(x => x.term.value) : [])))]
    const labelMap = new Map<string, string>()
    const langs = labelLangs(endpoint.languagePriorities, languageStore.preferred)
    if (uriValues.length) {
      await resolveLabels(endpoint, uriValues, langs, labelMap, new Map(), isCurrent)
      if (!isCurrent()) return
    }
    const resolved = uriValues.length ? await resolveUris(uriValues) : new Map()
    if (!isCurrent()) return

    results.value = raw.map((r): FacetView => {
      const heading = r.def.label?.trim() || humanizeLocalName(r.def.predicate)
      if (r.kind === 'range') {
        return {
          predicate: r.def.predicate, label: heading, kind: 'range',
          ranges: r.def.ranges!.map((band, i) => ({ index: i, label: band.label, count: r.counts[i] ?? 0 })),
        }
      }
      return {
        predicate: r.def.predicate, label: heading, kind: 'value', truncated: r.truncated, limit: r.limit,
        values: r.rows.map(x => ({
          key: x.key,
          term: x.term,
          count: x.count,
          label: x.term.isUri ? (labelMap.get(x.term.value) ?? qname(x.term.value, resolved)) : formatLiteral(x.term.value, false),
        })),
      }
    })
  }

  /** Drop all selections + results (a fresh type/endpoint carries no filters). */
  function resetState() {
    valueSelections.value = new Map()
    rangeSelections.value = new Map()
    results.value = []
  }

  // ── Interactions ───────────────────────────────────────────────────────────
  // TODO(com04): facet selections are NOT persisted or URL-synced in v1.
  // See /spec/common/com04-URLRouting.md when adding deep-link support.
  function toggleValue(predicate: string, item: FacetValueItem) {
    const next = new Map(valueSelections.value)
    const sel = new Map(next.get(predicate) ?? [])
    if (sel.has(item.key)) sel.delete(item.key)
    else sel.set(item.key, item.term)
    if (sel.size) next.set(predicate, sel)
    else next.delete(predicate)
    valueSelections.value = next
    selectionVersion.value++
    load()
  }
  function toggleRange(predicate: string, index: number) {
    const next = new Map(rangeSelections.value)
    const set = new Set(next.get(predicate) ?? [])
    if (set.has(index)) set.delete(index)
    else set.add(index)
    if (set.size) next.set(predicate, set)
    else next.delete(predicate)
    rangeSelections.value = next
    selectionVersion.value++
    load()
  }
  function isValueSelected(predicate: string, key: string): boolean {
    return valueSelections.value.get(predicate)?.has(key) ?? false
  }
  function isRangeSelected(predicate: string, index: number): boolean {
    return rangeSelections.value.get(predicate)?.has(index) ?? false
  }
  function clearAll() {
    if (!hasSelections.value) return
    // Clear only the selections — keep the facet views on screen; the reload
    // recomputes their counts (now unconstrained) in place.
    valueSelections.value = new Map()
    rangeSelections.value = new Map()
    selectionVersion.value++
    load()
  }

  /** Reset selections + results and (re)load counts for a type. Callable, but the
   *  watchers below drive it — kept exported for an explicit sync if ever needed. */
  function syncType() {
    resetState()
    load()
  }

  // ── URL round-trip (?filters) ───────────────────────────────────────────────
  // Selections serialize to a compact array keyed by the facet's INDEX in the
  // current type's config (not its long predicate URI), so a shared/bookmarked
  // list carries its filters. Range facet → [i,'r',[bandIdx…]]; value facet →
  // [i,'v',[term…]] with term ['u',uri] or ['l',value,lang,datatype]. Index-keyed,
  // so a config reorder degrades gracefully (out-of-range/kind-mismatch entries
  // are skipped, never misapplied). RdfView owns reading/writing the URL param.
  const termTuple = (t: FacetValueTerm): (string)[] =>
    t.isUri ? ['u', t.value] : ['l', t.value, t.lang ?? '', t.datatype ?? '']
  function tupleTerm(tup: unknown): FacetValueTerm | null {
    if (!Array.isArray(tup) || typeof tup[1] !== 'string') return null
    if (tup[0] === 'u') return { value: tup[1], isUri: true }
    if (tup[0] === 'l') return { value: tup[1], isUri: false, lang: tup[2] || undefined, datatype: tup[3] || undefined }
    return null
  }

  /** Current selections as a compact string, or null when nothing is selected. */
  function serialize(): string | null {
    const out: unknown[] = []
    definitions.value.forEach((def, i) => {
      if (def.ranges?.length) {
        const set = rangeSelections.value.get(def.predicate)
        if (set?.size) out.push([i, 'r', [...set].sort((a, b) => a - b)])
      } else {
        const sel = valueSelections.value.get(def.predicate)
        if (sel?.size) out.push([i, 'v', [...sel.values()].map(termTuple)])
      }
    })
    return out.length ? JSON.stringify(out) : null
  }

  /** Replace selections from a serialized string (empty/invalid → cleared), then
   *  reload counts. Entries are matched to the current type's facets by index and
   *  validated against the facet's kind/bands — anything that doesn't fit is dropped. */
  function applyEncoded(enc: string): void {
    const defs = definitions.value
    const vNext = new Map<string, Map<string, FacetValueTerm>>()
    const rNext = new Map<string, Set<number>>()
    try {
      const parsed = enc ? JSON.parse(enc) : []
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (!Array.isArray(entry) || entry.length < 3) continue
          const [i, kind, payload] = entry
          const def = defs[i as number]
          if (!def || !Array.isArray(payload)) continue
          if (kind === 'r' && def.ranges?.length) {
            const set = new Set<number>()
            for (const idx of payload) if (Number.isInteger(idx) && idx >= 0 && idx < def.ranges.length) set.add(idx)
            if (set.size) rNext.set(def.predicate, set)
          } else if (kind === 'v' && !def.ranges?.length) {
            const m = new Map<string, FacetValueTerm>()
            for (const tup of payload) {
              const term = tupleTerm(tup)
              if (term) m.set(facetTermKey(term), term)
            }
            if (m.size) vNext.set(def.predicate, m)
          }
        }
      }
    } catch (e) {
      logger.warn('facetStore', 'Bad ?filters payload, ignoring', { error: e })
    }
    valueSelections.value = vNext
    rangeSelections.value = rNext
    selectionVersion.value++
    load()
  }

  // Type or endpoint change → selections/results are meaningless on a new type or
  // dataset: reset, then load the new type's counts. One watcher over both keys so
  // a same-type endpoint switch is still clean. Immediate so the first type loads.
  watch(
    () => [browseStore.currentType, endpointStore.current?.id],
    () => {
      resetState()
      load()
    },
    { immediate: true },
  )
  // Graph scope change → the counts differ but the selections still apply; reload
  // counts in place (keep selections), same as the instance list reloads its list.
  watch(() => browseStore.graph, () => load())

  return {
    // state / getters
    definitions, results, loading, hasFacets, activeCount, hasSelections,
    selectionVersion, activeSelections,
    // interactions
    toggleValue, toggleRange, isValueSelected, isRangeSelected, clearAll, syncType,
    // URL round-trip
    serialize, applyEncoded,
  }
})
