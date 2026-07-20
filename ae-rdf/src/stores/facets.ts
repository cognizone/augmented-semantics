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
  buildFacetMissingCountQuery,
  resolveGraphStrategy,
  type GraphStrategy,
  type FacetSelection,
  type FacetValueTerm,
  type SPARQLResults,
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

/** One selectable band in a RANGE facet. `count` is null while its count is still
 *  loading (bands appear from config immediately; counts fill in per query). */
export interface FacetRangeItem {
  index: number
  label: string
  count: number | null
}

/** A facet ready for the panel: heading + its value rows or range bands. */
export interface FacetView {
  predicate: string
  label: string
  kind: 'value' | 'range'
  /** This facet still has a count query in flight (progressive load). */
  pending?: boolean
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
  // The current load's abort handle. A new load (or leaving the type) ABORTS the
  // previous one — dropping its still-QUEUED queries from the concurrency gate before
  // they ever hit the endpoint. Without this, navigating away leaves the superseded
  // burst (esp. the heavy background date scans) draining against the DB, stealing
  // slots from what the user is looking at now.
  let loadController: AbortController | null = null

  // LAZY COUNTS: the heavy count queries run ONLY while the Filters panel is mounted
  // (FacetPanel sets this on mount/unmount). Counts have exactly one consumer — the
  // panel; the instance list applies `activeSelections` (pure state, no queries) and
  // the tab badge reads `activeCount` (selections only). So while the user is on the
  // TYPES rail or just browsing the list, a type/graph change marks the counts dirty
  // instead of firing four full-type scans nobody can see; opening Filters settles up.
  let panelVisible = false
  let countsDirty = false
  function setPanelVisible(visible: boolean): void {
    panelVisible = visible
    if (visible && countsDirty) load()
  }

  // Session cache of facet-count query results, keyed by the full query STRING — which
  // encodes type + graph strategy + every constraint fragment + bands/predicate, so an
  // identical selection state maps to the identical key. Check→uncheck (and re-selecting
  // any state already seen) is served from here instead of re-hitting the endpoint — the
  // point being the slow "No value" scan is computed once per constraint state, not per
  // toggle. MUST be cleared on type/endpoint/graph change (resetState + the graph
  // watcher): two endpoints can share a type IRI and thus a query string. In-memory only,
  // so a page reload always gets fresh counts. Unbounded within a type — the number of
  // selection combinations a user explores in one session is small.
  // ponytail: no eviction; add an LRU cap only if a session ever explores enough facet
  // combinations to matter (it won't).
  const countCache = new Map<string, SPARQLResults>()
  async function runCached(endpoint: SPARQLEndpoint, query: string, background = false, signal?: AbortSignal): Promise<SPARQLResults> {
    const hit = countCache.get(query)
    if (hit) return hit
    const res = await executeSparql(endpoint, query, { retries: 1, background, signal })
    countCache.set(query, res)
    return res
  }

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
          ranges: [...set].map(i => def.ranges![i]).filter((r): r is { label: string; min?: number; max?: number; missing?: boolean } => !!r),
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
   * Load every configured facet's counts PROGRESSIVELY — the whole rail (headings +
   * range bands from config) appears at once, then each facet's counts fill in as its
   * own query returns, so one slow facet never blocks the fast ones. Each facet's counts
   * apply the OTHER facets' selections but NOT its own (collectSelections(def.predicate)),
   * so an unselected value shows what narrowing to it would yield. Guarded by isCurrent
   * (token + endpoint + type). Facet failures are warned, never surfaced as an error.
   */
  async function load(): Promise<void> {
    // Cancel the superseded load unconditionally — INCLUDING when this one bails out
    // (type cleared → types view): its queued queries must die, not drain.
    loadController?.abort()
    const type = browseStore.currentType
    const endpoint = endpointStore.current
    const defs = definitions.value
    if (!type || !endpoint || !defs.length) {
      results.value = []
      return
    }
    // Panel hidden → don't pay for invisible counts; remember to load on reveal.
    if (!panelVisible) {
      countsDirty = true
      return
    }
    countsDirty = false
    loadController = new AbortController()
    const signal = loadController.signal
    const endpointId = endpoint.id
    const strategy = resolveGraphStrategy(browseStore.graph)
    const id = ++requestId
    const isCurrent = () =>
      id === requestId &&
      endpointStore.current?.id === endpointId &&
      browseStore.currentType === type

    loading.value = true
    logger.info('facetStore', 'Loading facet counts', { type, active: activeCount.value })

    // Seed placeholders in config order so the rail structure shows immediately: range
    // bands come from config (counts null = "loading"), value facets start empty+pending.
    // But a reload over the SAME facets (a toggle / clear / graph switch) keeps the
    // current counts ON SCREEN — just flags them pending — so interacting never blanks
    // the rail to "…"; the per-facet patches overwrite counts in place as they land.
    const samePreds =
      results.value.length === defs.length &&
      results.value.every((v, i) => v.predicate === defs[i]!.predicate)
    results.value = samePreds
      ? results.value.map(v => ({ ...v, pending: true }))
      : defs.map((def): FacetView => {
          const heading = def.label?.trim() || humanizeLocalName(def.predicate)
          return def.ranges?.length
            ? { predicate: def.predicate, label: heading, kind: 'range', pending: true, ranges: def.ranges.map((b, i) => ({ index: i, label: b.label, count: null })) }
            : { predicate: def.predicate, label: heading, kind: 'value', pending: true, values: [] }
        })

    try {
      // Each facet loads independently and writes only its own slot.
      await Promise.all(defs.map((def, idx) => loadFacet(endpoint, type, def, idx, strategy, isCurrent, signal)))
    } finally {
      if (isCurrent()) loading.value = false
    }
  }

  /** Replace facet `idx`'s view with `next(current)`, but only if still current AND the
   *  slot still holds the same facet — a stale write from a superseded load is dropped. */
  function patch(idx: number, predicate: string, next: (v: FacetView) => FacetView, isCurrent: () => boolean) {
    if (!isCurrent()) return
    const cur = results.value[idx]
    if (cur?.predicate === predicate) results.value[idx] = next(cur)
  }

  async function loadFacet(
    endpoint: SPARQLEndpoint,
    type: string,
    def: FacetConfig,
    idx: number,
    strategy: GraphStrategy,
    isCurrent: () => boolean,
    signal: AbortSignal,
  ): Promise<void> {
    const fragment = buildFacetConstraints(collectSelections(def.predicate), strategy)
    try {
      if (def.ranges?.length) await loadRangeFacet(endpoint, type, def, idx, fragment, strategy, isCurrent, signal)
      else await loadValueFacet(endpoint, type, def, idx, fragment, strategy, isCurrent, signal)
    } catch (e) {
      // A superseded (aborted) load failing is by design — only warn when current.
      if (isCurrent()) logger.warn('facetStore', 'Facet failed', { predicate: def.predicate, error: e })
      patch(idx, def.predicate, v => ({ ...v, pending: false }), isCurrent)
    }
  }

  /** RANGE facet: value-band counts first (one inner-join query), then the "no value"
   *  count separately (a full-type NOT-EXISTS scan) so it never blocks the value bands.
   *  BOTH run in the gate's background lane — they're heavy aggregate scans, and must
   *  yield their slots to the instance list and the cheap value facets (state, audience)
   *  instead of hogging the gate because they sit first in the config. Bands still beat
   *  the missing count (FIFO within the lane). Each result patches only its own bands. */
  async function loadRangeFacet(
    endpoint: SPARQLEndpoint, type: string, def: FacetConfig, idx: number,
    fragment: string, strategy: GraphStrategy, isCurrent: () => boolean, signal: AbortSignal,
  ): Promise<void> {
    const bands = def.ranges!
    const missingIdx = bands.findIndex(b => b.missing)
    // Config band index → its aggregate var index (?b0, ?b1, …), value bands only.
    const valueBands = bands.map((b, i) => ({ b, i })).filter(x => !x.b.missing)

    if (valueBands.length) {
      const q = buildFacetRangesQuery(type, def.predicate, valueBands.map(x => x.b), fragment, strategy, def.via, def.datatype)
      const res = await runCached(endpoint, q, true, signal)
      const row = res.results.bindings[0] ?? {}
      const counts = new Map(valueBands.map((x, k) => [x.i, parseInt(row[`b${k}`]?.value ?? '0', 10)]))
      patch(idx, def.predicate, v => ({
        ...v,
        pending: missingIdx >= 0, // still one query (the missing count) to go
        ranges: v.ranges!.map(r => (counts.has(r.index) ? { ...r, count: counts.get(r.index)! } : r)),
      }), isCurrent)
    }

    if (missingIdx >= 0) {
      const mq = buildFacetMissingCountQuery(type, def.predicate, fragment, strategy, def.via)
      const n = mq ? parseInt((await runCached(endpoint, mq, true, signal)).results.bindings[0]?.n?.value ?? '0', 10) : 0
      patch(idx, def.predicate, v => ({
        ...v, pending: false,
        ranges: v.ranges!.map(r => (r.index === missingIdx ? { ...r, count: n } : r)),
      }), isCurrent)
    }
  }

  /** VALUE facet: top-N values with counts, then resolve THIS facet's URI value labels
   *  (canonical resolver + qname fallback) so the facet renders as soon as its own
   *  labels land — no cross-facet barrier. */
  async function loadValueFacet(
    endpoint: SPARQLEndpoint, type: string, def: FacetConfig, idx: number,
    fragment: string, strategy: GraphStrategy, isCurrent: () => boolean, signal: AbortSignal,
  ): Promise<void> {
    const limit = def.limit ?? DEFAULT_FACET_LIMIT
    const q = buildFacetValuesQuery(type, def.predicate, fragment, strategy, limit, def.via)
    const res = await runCached(endpoint, q, false, signal)
    if (!isCurrent()) return
    const rows = res.results.bindings
      .map(bd => {
        const v = bd.v
        const term: FacetValueTerm = {
          value: v?.value ?? '', isUri: v?.type === 'uri', datatype: v?.datatype, lang: v?.['xml:lang'],
        }
        return { term, key: facetTermKey(term), count: parseInt(bd.n?.value ?? '0', 10) }
      })
      .filter(row => row.term.value)
    const truncated = rows.length > limit
    const top = rows.slice(0, limit)

    const uriValues = [...new Set(top.filter(x => x.term.isUri).map(x => x.term.value))]
    const labelMap = new Map<string, string>()
    const langs = labelLangs(endpoint.languagePriorities, languageStore.preferred)
    if (uriValues.length) {
      await resolveLabels(endpoint, uriValues, langs, labelMap, new Map(), isCurrent)
      if (!isCurrent()) return
    }
    const resolved = uriValues.length ? await resolveUris(uriValues) : new Map()

    patch(idx, def.predicate, v => ({
      ...v, pending: false, truncated, limit,
      values: top.map(x => ({
        key: x.key, term: x.term, count: x.count,
        label: x.term.isUri ? (labelMap.get(x.term.value) ?? qname(x.term.value, resolved)) : formatLiteral(x.term.value, false),
      })),
    }), isCurrent)
  }

  /** Drop all selections + results (a fresh type/endpoint carries no filters).
   *  `clearCache` — count-cache keys are full query STRINGS (type IRI + graph shape +
   *  constraints baked in), so entries from different TYPES can never collide: a
   *  type-only change passes false and keeps the cache, making A→B→A show A's counts
   *  instantly instead of re-running its heavy scans. Only an ENDPOINT switch can
   *  alias a key (identical query, different data) — that clears. */
  function resetState(clearCache = true) {
    valueSelections.value = new Map()
    rangeSelections.value = new Map()
    results.value = []
    if (clearCache) countCache.clear()
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
  // The count cache is dropped ONLY on an endpoint change (see resetState).
  watch(
    () => [browseStore.currentType, endpointStore.current?.id] as const,
    (next, prev) => {
      // The getter builds a FRESH tuple each evaluation, so Vue also fires this when a
      // dependency merely RECOMPUTES to the same values — e.g. updateEndpoint replacing
      // the endpoints array (typeInventory cache write on a first-ever type load)
      // recomputes `current` to the same id. Identical values = nothing changed =
      // nothing to reset; without this bail the spurious fire wiped ?filters selections
      // freshly restored from a deep link.
      if (prev && next[0] === prev[0] && next[1] === prev[1]) return
      resetState(!prev || next[1] !== prev[1])
      load()
    },
    { immediate: true },
  )
  // Graph scope change → the counts differ but the selections still apply; drop the
  // cache (its counts were for the old scope) and reload in place (keep selections),
  // same as the instance list reloads its list.
  watch(() => browseStore.graph, () => { countCache.clear(); load() })

  return {
    // state / getters
    definitions, results, loading, hasFacets, activeCount, hasSelections,
    selectionVersion, activeSelections,
    // interactions
    toggleValue, toggleRange, isValueSelected, isRangeSelected, clearAll, syncType,
    setPanelVisible,
    // URL round-trip
    serialize, applyEncoded,
  }
})
