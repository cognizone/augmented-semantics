/**
 * useInstanceList - paged list of a type's instances (the T5 navigation index).
 *
 * Reads the selected type from the browse store, loads one page of instances
 * plus the total count, both graph-mode-gated and DISTINCT (see rdfQueries).
 * requestId race-guard per com02. Reloads on type, page, or graphMode change.
 *
 * @see /spec/ae-rdf
 * @see /spec/common/com02-StateManagement.md
 */
import { ref, watch, type Ref } from 'vue'
import { useEndpointStore, useBrowseStore } from '../stores'
import {
  executeSparql,
  resolveUris,
  logger,
  buildInstanceListQuery,
  buildInstanceCountQuery,
} from '../services'

export interface Instance {
  uri: string
  label: string
}

export const PAGE_SIZE = 100

export function useInstanceList() {
  const endpointStore = useEndpointStore()
  const browseStore = useBrowseStore()

  const instances: Ref<Instance[]> = ref([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const page = ref(0)
  const typeLabel = ref('')
  let requestId = 0
  let countedFor: string | null = null // `${endpointId}|${type}` the total is valid for

  async function load(): Promise<void> {
    const type = browseStore.currentType
    const endpoint = endpointStore.current
    if (!type || !endpoint) {
      instances.value = []
      total.value = 0
      return
    }
    const endpointId = endpoint.id
    const mode = browseStore.graphMode
    const id = ++requestId
    const isCurrent = () => id === requestId && endpointStore.current?.id === endpointId

    loading.value = true
    error.value = null
    const countKey = `${endpointId}|${mode}|${type}`
    const needCount = countedFor !== countKey

    logger.info('useInstanceList', 'Loading instances', { type, page: page.value, mode })

    try {
      const [listRes, countRes, typeResolved] = await Promise.all([
        executeSparql(endpoint, buildInstanceListQuery(type, mode, PAGE_SIZE, page.value * PAGE_SIZE), { retries: 1 }),
        needCount
          ? executeSparql(endpoint, buildInstanceCountQuery(type, mode), { retries: 1 })
          : Promise.resolve(null),
        resolveUris([type]),
      ])
      if (!isCurrent()) return

      instances.value = listRes.results.bindings
        .map(b => ({ uri: b.s?.value ?? '', label: b.label?.value ?? b.s?.value ?? '' }))
        .filter(i => i.uri)

      if (countRes) {
        total.value = parseInt(countRes.results.bindings[0]?.total?.value ?? '0', 10)
        countedFor = countKey
      }

      const r = typeResolved.get(type)
      typeLabel.value = r?.prefix ? `${r.prefix}:${r.localName}` : (r?.localName ?? type)

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

  // New type → reset to page 0 and (re)load. Page / graphMode changes reload too.
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
  watch(() => browseStore.graphMode, () => { if (browseStore.currentType) load() })

  function setPage(n: number) {
    page.value = n
  }

  return { instances, total, loading, error, page, pageSize: PAGE_SIZE, typeLabel, setPage }
}
