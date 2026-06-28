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
import { ref, watch, onMounted, onUnmounted, type Ref } from 'vue'
import { useEndpointStore, useBrowseStore } from '../stores'
import { executeSparql, resolveUris, logger, eventBus, buildTypeInventoryQuery } from '../services'

export interface RdfType {
  uri: string
  count: number
}

type ResolvedMap = Map<string, { prefix: string; localName: string }>

export function useRdfTypes() {
  const endpointStore = useEndpointStore()
  const browseStore = useBrowseStore()

  const types: Ref<RdfType[]> = ref([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const resolved: Ref<ResolvedMap> = ref(new Map())
  let requestId = 0

  async function loadTypes(): Promise<void> {
    const endpoint = endpointStore.current
    if (!endpoint) {
      types.value = []
      return
    }
    const endpointId = endpoint.id
    const id = ++requestId
    const isCurrent = () => id === requestId && endpointStore.current?.id === endpointId

    loading.value = true
    error.value = null
    logger.info('useRdfTypes', 'Loading type inventory', { endpoint: endpoint.url })

    try {
      const results = await executeSparql(endpoint, buildTypeInventoryQuery(browseStore.graphMode), { retries: 1 })
      if (!isCurrent()) return

      const list: RdfType[] = results.results.bindings
        .map(b => ({ uri: b.type?.value ?? '', count: parseInt(b.count?.value ?? '0', 10) }))
        .filter(t => t.uri)

      const resolvedMap = await resolveUris(list.map(t => t.uri))
      if (!isCurrent()) return

      types.value = list
      resolved.value = resolvedMap
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
  // graphMode resolves async (probe or SKOS reuse); reload so a 'named'→'none'
  // (or vice-versa) flip re-runs the inventory with the correct query shape.
  watch(() => browseStore.graphMode, () => { if (endpointStore.current) loadTypes() })
  onMounted(() => {
    if (endpointStore.current) loadTypes()
  })
  onUnmounted(() => sub.unsubscribe())

  return { types, loading, error, resolved, loadTypes }
}
