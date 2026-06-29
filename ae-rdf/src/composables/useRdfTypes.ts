/**
 * useRdfTypes - load the endpoint's type inventory (rdf:type + counts).
 *
 * Owns one query (type-inventory), a requestId race-guard (com02) and prefix
 * resolution. Reloads on endpoint:changed (emitted by the endpoint store) and
 * loads once on mount if an endpoint is already selected.
 *
 * @see /spec/ae-rdf
 * @see /spec/common/com02-StateManagement.md
 */
import { ref, computed, watch, onMounted, onUnmounted, type Ref } from 'vue'
import { useEndpointStore, useBrowseStore, useTypeConfigStore } from '../stores'
import { executeSparql, resolveUris, logger, eventBus, buildTypeInventoryQuery, buildCompositionQuery, buildSubclassQuery, buildPathCountQuery, resolveGraphStrategy } from '../services'

export interface RdfType {
  uri: string
  count: number
}

type ResolvedMap = Map<string, { prefix: string; localName: string }>

export function useRdfTypes() {
  const endpointStore = useEndpointStore()
  const browseStore = useBrowseStore()
  const typeConfig = useTypeConfigStore()

  const types: Ref<RdfType[]> = ref([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const resolved: Ref<ResolvedMap> = ref(new Map())
  // Embed-type composition: composing class → embed types it contains inline,
  // each with a count scoped to that class (not the global type total).
  const composition: Ref<Map<string, { uri: string; count: number }[]>> = ref(new Map())
  // Subclass hierarchy among listed types: superclass → its more-specific kinds.
  const subclasses: Ref<Map<string, string[]>> = ref(new Map())
  // On-demand path-scoped counts for nested embeds, keyed by chain.join('>').
  const pathCounts: Ref<Map<string, number>> = ref(new Map())
  const pathInflight = new Set<string>()
  let requestId = 0

  // Types configured to render inline as values (per-endpoint config).
  const embedTypes = computed(() =>
    types.value.filter(t => typeConfig.get(t.uri).render === 'embed').map(t => t.uri),
  )

  // Find which classes compose each embed type so the sidebar can nest them
  // under their parent (instead of listing them flat). Async, non-blocking —
  // the flat list paints first; nested rows fill in like prefixes do.
  async function loadComposition(): Promise<void> {
    const endpoint = endpointStore.current
    const embeds = embedTypes.value
    if (!endpoint || !embeds.length) {
      composition.value = new Map()
      return
    }
    const endpointId = endpoint.id
    try {
      const res = await executeSparql(
        endpoint,
        buildCompositionQuery(embeds, resolveGraphStrategy(browseStore.graph)),
        { retries: 1 },
      )
      if (endpointStore.current?.id !== endpointId) return
      const map = new Map<string, { uri: string; count: number }[]>()
      for (const b of res.results.bindings) {
        const c = b.c?.value, e = b.e?.value
        if (!c || !e) continue
        const count = parseInt(b.n?.value ?? '0', 10)
        const arr = map.get(c) ?? []
        if (!arr.some(x => x.uri === e)) arr.push({ uri: e, count })
        map.set(c, arr)
      }
      composition.value = map
      pathCounts.value = new Map() // tree changed → stale path counts
      logger.info('useRdfTypes', 'Loaded embed composition map', { parents: map.size })
    } catch (e: unknown) {
      logger.warn('useRdfTypes', 'Composition discovery failed', { error: e })
    }
  }

  // Fetch (once) the path-scoped count for a nested-embed branch. `chain` is
  // [rootClass, …embedTypes]. Result lands in pathCounts under chain.join('>').
  async function requestPathCount(chain: string[]): Promise<void> {
    const key = chain.join('>')
    if (pathCounts.value.has(key) || pathInflight.has(key)) return
    const endpoint = endpointStore.current
    if (!endpoint) return
    const query = buildPathCountQuery(chain, resolveGraphStrategy(browseStore.graph))
    if (!query) return
    pathInflight.add(key)
    const endpointId = endpoint.id
    try {
      const res = await executeSparql(endpoint, query, { retries: 1 })
      if (endpointStore.current?.id !== endpointId) return
      const n = parseInt(res.results.bindings[0]?.n?.value ?? '0', 10)
      const next = new Map(pathCounts.value)
      next.set(key, n)
      pathCounts.value = next
    } catch (e: unknown) {
      logger.warn('useRdfTypes', 'Path count failed', { chain, error: e })
    } finally {
      pathInflight.delete(key)
    }
  }

  // Discover the subclass hierarchy (rdfs:subClassOf) among the listed types so
  // the sidebar can tuck more-specific kinds under their general type. Async,
  // non-blocking; if the data asserts no subClassOf, the list just stays flat.
  async function loadSubclasses(): Promise<void> {
    const endpoint = endpointStore.current
    if (!endpoint || !types.value.length) {
      subclasses.value = new Map()
      return
    }
    const endpointId = endpoint.id
    const inv = new Set(types.value.map(t => t.uri))
    try {
      const res = await executeSparql(
        endpoint,
        buildSubclassQuery([...inv], resolveGraphStrategy(browseStore.graph)),
        { retries: 1 },
      )
      if (endpointStore.current?.id !== endpointId) return
      const map = new Map<string, string[]>()
      for (const b of res.results.bindings) {
        const sub = b.sub?.value, sup = b.super?.value
        // Both ends must be browsable types, else there's nothing to nest under.
        if (!sub || !sup || !inv.has(sub) || !inv.has(sup)) continue
        const arr = map.get(sup) ?? []
        if (!arr.includes(sub)) arr.push(sub)
        map.set(sup, arr)
      }
      subclasses.value = map
      logger.info('useRdfTypes', 'Loaded subclass hierarchy', { supers: map.size })
    } catch (e: unknown) {
      logger.warn('useRdfTypes', 'Subclass discovery failed', { error: e })
    }
  }

  async function loadTypes(): Promise<void> {
    const endpoint = endpointStore.current
    if (!endpoint) {
      types.value = []
      return
    }

    // Per-endpoint cached inventory (from config or a previous load) → instant
    // first paint, no discovery query.
    const cached = endpoint.typeInventory
    if (cached?.length) {
      const list = cached.map(t => ({ uri: t.uri, count: t.count })).filter(t => t.uri)
      types.value = list
      error.value = null
      loading.value = false
      // Resolve prefixes in the background — local names paint instantly, qnames fill in.
      const epId = endpoint.id
      void resolveUris(list.map(t => t.uri)).then(m => {
        if (endpointStore.current?.id === epId) resolved.value = m
      })
      logger.info('useRdfTypes', 'Seeded type inventory from endpoint cache (no query)', { count: list.length })
      return
    }

    const endpointId = endpoint.id
    const id = ++requestId
    const isCurrent = () => id === requestId && endpointStore.current?.id === endpointId

    loading.value = true
    error.value = null
    logger.info('useRdfTypes', 'Loading type inventory', { endpoint: endpoint.url })

    try {
      const results = await executeSparql(endpoint, buildTypeInventoryQuery(resolveGraphStrategy(browseStore.graph)), { retries: 1 })
      if (!isCurrent()) return

      const list: RdfType[] = results.results.bindings
        .map(b => ({ uri: b.type?.value ?? '', count: parseInt(b.count?.value ?? '0', 10) }))
        .filter(t => t.uri)

      const resolvedMap = await resolveUris(list.map(t => t.uri))
      if (!isCurrent()) return

      types.value = list
      resolved.value = resolvedMap
      // Cache the inventory on the endpoint (persisted + exported per-endpoint).
      endpointStore.updateEndpoint(endpointId, { typeInventory: list })
      logger.info('useRdfTypes', 'Loaded type inventory', { count: list.length })
    } catch (e: unknown) {
      if (!isCurrent()) return
      const msg = e && typeof e === 'object' && 'message' in e ? (e as { message: string }).message : 'Unknown error'
      logger.error('useRdfTypes', 'Failed to load type inventory', { error: e })
      error.value = `Failed to load types: ${msg}`
      types.value = []
    } finally {
      if (isCurrent()) loading.value = false
    }
  }

  const sub = eventBus.on('endpoint:changed', () => loadTypes())
  // graph axes resolve async (config / SKOS / probe); reload so the inventory
  // re-runs with the correct scope once they're known.
  watch(() => browseStore.graph, () => { if (endpointStore.current) loadTypes() })
  // Recompute composition when the embed set changes (types load or a live
  // edit-mode toggle) or the graph scope changes.
  watch([embedTypes, () => browseStore.graph], () => loadComposition())
  // Rediscover the subclass hierarchy when the inventory or graph scope changes.
  const inventoryKey = computed(() => types.value.map(t => t.uri).join('|'))
  watch([inventoryKey, () => browseStore.graph], () => loadSubclasses())
  onMounted(() => {
    if (endpointStore.current) loadTypes()
  })
  onUnmounted(() => sub.unsubscribe())

  return { types, loading, error, resolved, composition, subclasses, pathCounts, requestPathCount, loadTypes }
}
