/**
 * useIncomingRelations - lazily load a resource's INVERSE relations: who points
 * at it (`?s ?p <uri>`). Opt-in (fetched on expand) because incoming can be huge
 * on hub nodes. Graph-aware (provenance kept), grouped by predicate, with the
 * referencing subjects resolved to labels + most-specific types.
 *
 * @see /spec/ae-rdf/rdf-overview.md (Resource readability)
 * @see /spec/common/com02-StateManagement.md
 */
import { ref, type Ref } from 'vue'
import { useEndpointStore, useBrowseStore, useLanguageStore, useTypeConfigStore } from '../stores'
import { executeSparql, resolveUris, logger, buildIncomingQuery, buildIncomingCountQuery, buildLabelsQuery, resolveGraphStrategy } from '../services'
import { composeLabels } from './composeLabels'
import { labelLangs } from '../utils/labelLang'
import type { PropertyGroup, ResourceObject } from './useResourceView'

const INCOMING_LIMIT = 1000

type ResolvedMap = Map<string, { prefix: string; localName: string }>

export function useIncomingRelations() {
  const endpointStore = useEndpointStore()
  const browseStore = useBrowseStore()
  const languageStore = useLanguageStore()
  const typeConfig = useTypeConfigStore()

  const groups: Ref<PropertyGroup[]> = ref([]) // predicate → referencing subjects
  const count = ref<number | null>(null) // distinct referencing resources (null = unknown)
  const shown = ref(0) // distinct referencing resources actually displayed
  const truncated = ref(false) // fetched list hit the cap
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)
  const resolved: Ref<ResolvedMap> = ref(new Map())
  const objectLabels: Ref<Map<string, string>> = ref(new Map())
  const objectTypes: Ref<Map<string, string>> = ref(new Map())
  let requestId = 0
  let countReqId = 0

  function reset() {
    groups.value = []
    count.value = null
    shown.value = 0
    truncated.value = false
    loaded.value = false
    loading.value = false
    error.value = null
    objectLabels.value = new Map()
    objectTypes.value = new Map()
    requestId++ // invalidate any in-flight list load() — else it paints the previous resource's data (isCurrent stays true)
    countReqId++ // invalidate any in-flight eager count
  }

  /** Cheap COUNT only — populate the "Referenced by (N)" headline without
   *  fetching the (potentially huge) list. Runs eagerly on resource load. */
  async function loadCount(uri: string): Promise<void> {
    const endpoint = endpointStore.current
    if (!endpoint || !uri) return
    const endpointId = endpoint.id
    const id = ++countReqId
    const ok = () => id === countReqId && endpointStore.current?.id === endpointId
    let q: string
    try {
      q = buildIncomingCountQuery(uri, resolveGraphStrategy(browseStore.graph))
    } catch {
      return // unsafe URI — the full load() surfaces the error
    }
    const res = await executeSparql(endpoint, q, { retries: 1 }).catch(() => null)
    if (!ok() || !res) return
    count.value = parseInt(res.results.bindings[0]?.n?.value ?? '0', 10)
  }

  async function load(uri: string): Promise<void> {
    const endpoint = endpointStore.current
    if (!endpoint || !uri) return
    const endpointId = endpoint.id
    const id = ++requestId
    const isCurrent = () => id === requestId && endpointStore.current?.id === endpointId

    loading.value = true
    error.value = null
    const strategy = resolveGraphStrategy(browseStore.graph)

    let listQuery: string, countQuery: string
    try {
      listQuery = buildIncomingQuery(uri, strategy, INCOMING_LIMIT)
      countQuery = buildIncomingCountQuery(uri, strategy)
    } catch (e) {
      logger.warn('useIncomingRelations', 'Rejected unsafe resource URI', { uri, error: e })
      error.value = 'Invalid resource URI'
      loading.value = false
      return
    }

    logger.info('useIncomingRelations', 'Loading incoming relations', { uri })
    try {
      // Count and list in parallel; a slow/failed count shouldn't block the list.
      const [listRes, countRes] = await Promise.all([
        executeSparql(endpoint, listQuery, { retries: 1 }),
        executeSparql(endpoint, countQuery, { retries: 1 }).catch(() => null),
      ])
      if (!isCurrent()) return

      const bindings = listRes.results.bindings

      // Group by predicate; fold the same (p,s) across graphs into a graphs[] set.
      const byPredicate = new Map<string, { group: PropertyGroup; subjects: Map<string, ResourceObject> }>()
      const out: PropertyGroup[] = []
      const toResolve = new Set<string>()
      const subjectIris = new Set<string>()
      for (const b of bindings) {
        const p = b.p?.value
        const s = b.s?.value
        if (!p || !s) continue
        const graph = b.g?.value
        let entry = byPredicate.get(p)
        if (!entry) {
          const group: PropertyGroup = { predicate: p, objects: [] }
          entry = { group, subjects: new Map() }
          byPredicate.set(p, entry)
          out.push(group)
        }
        let subj = entry.subjects.get(s)
        if (!subj) {
          subj = { termType: 'uri', value: s, graphs: [] }
          entry.subjects.set(s, subj)
          entry.group.objects.push(subj)
        }
        if (graph && !subj.graphs.includes(graph)) subj.graphs.push(graph)
        toResolve.add(p)
        toResolve.add(s)
        subjectIris.add(s)
        if (graph) toResolve.add(graph)
      }

      // Labels + most-specific types for the referencing subjects.
      const labelRes = subjectIris.size
        ? await executeSparql(endpoint, buildLabelsQuery([...subjectIris]), { retries: 1 }).catch(() => null)
        : null
      if (!isCurrent()) return

      const labelMap = new Map<string, string>()
      const typeMap = new Map<string, string>()
      for (const b of labelRes?.results.bindings ?? []) {
        const s = b.s?.value
        if (!s) continue
        if (b.label?.value) labelMap.set(s, b.label.value)
        if (b.type?.value) typeMap.set(s, b.type.value)
      }

      // Compose per-type labels (same resolver as the resource view), so a
      // referencing Grant reads "project · amount" not its UUID, and an
      // OrganisationRole reads "org · role" not its verbose raw rdfs:label.
      await composeLabels(endpoint, labelMap, typeMap, typeConfig, labelLangs(endpoint.languagePriorities, languageStore.preferred), uri, isCurrent)
      if (!isCurrent()) return
      for (const t of typeMap.values()) toResolve.add(t) // incl. referent types the walk found

      const resolvedMap = await resolveUris([...toResolve])
      if (!isCurrent()) return

      groups.value = out
      objectLabels.value = labelMap
      objectTypes.value = typeMap
      resolved.value = resolvedMap
      // Only overwrite on success: a failed list-time count must NOT erase the
      // value the eager loadCount() already put in the headline (R27). count stays
      // whatever it was (loadCount's number, or null if that hadn't landed either).
      if (countRes) count.value = parseInt(countRes.results.bindings[0]?.n?.value ?? '0', 10)
      // The list query projects raw ?s ?g ?p (no DISTINCT), so a quad store
      // multiplies rows per graph — hitting the row cap does NOT mean 1,000
      // distinct subjects. Report the real count assembled, and only flag
      // truncation when more subjects exist than we displayed.
      shown.value = subjectIris.size
      truncated.value = bindings.length >= INCOMING_LIMIT && (count.value === null || count.value > shown.value)
      loaded.value = true
      logger.info('useIncomingRelations', 'Loaded incoming relations', { uri, predicates: out.length, count: count.value })
    } catch (e: unknown) {
      if (!isCurrent()) return
      const msg = e && typeof e === 'object' && 'message' in e ? (e as { message: string }).message : 'Unknown error'
      logger.error('useIncomingRelations', 'Failed to load incoming relations', { uri, error: e })
      error.value = `Failed to load incoming relations: ${msg}`
    } finally {
      if (isCurrent()) loading.value = false
    }
  }

  return { groups, count, shown, truncated, loading, loaded, error, resolved, objectLabels, objectTypes, load, loadCount, reset }
}
