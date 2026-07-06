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
import { executeSparql, resolveUris, logger, buildIncomingQuery, buildIncomingCountQuery, buildIncomingBlankNodeQuery, resolveGraphStrategy } from '../services'
import { composeLabels, resolveLabels } from './composeLabels'
import { labelLangs } from '../utils/labelLang'
import type { PropertyGroup, ResourceObject } from './useResourceView'

const INCOMING_LIMIT = 1000
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

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
  const embedded: Ref<Map<string, PropertyGroup[]>> = ref(new Map()) // bnode referrer → its own triples (inlined)
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
    embedded.value = new Map()
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

    let listQuery: string, countQuery: string, blankQuery: string
    try {
      listQuery = buildIncomingQuery(uri, strategy, INCOMING_LIMIT)
      countQuery = buildIncomingCountQuery(uri, strategy)
      blankQuery = buildIncomingBlankNodeQuery(uri, strategy)
    } catch (e) {
      logger.warn('useIncomingRelations', 'Rejected unsafe resource URI', { uri, error: e })
      error.value = 'Invalid resource URI'
      loading.value = false
      return
    }

    logger.info('useIncomingRelations', 'Loading incoming relations', { uri })
    try {
      // Count, list, and blank-node referrers in parallel; a slow/failed count or
      // blank query shouldn't block the list.
      const [listRes, countRes, blankRes] = await Promise.all([
        executeSparql(endpoint, listQuery, { retries: 1 }),
        executeSparql(endpoint, countQuery, { retries: 1 }).catch(() => null),
        executeSparql(endpoint, blankQuery, { retries: 1 }).catch(() => null),
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

      // Blank-node referrers: anonymous, so instead of a bare useless id we inline
      // their OWN triples (a restriction reads "onProperty … someValuesFrom Class").
      // Grouped under the predicate that points here (?xp); rdf:type is pulled out
      // as the badge, the rest becomes the inlined body. The bnode label is
      // self-consistent within this single query (buildIncomingBlankNodeQuery).
      const embedMap = new Map<string, PropertyGroup[]>() // bnode → its prop groups
      const bnodeTypes = new Map<string, string>() // bnode → rdf:type (badge); kept OUT of typeMap so composeLabels never VALUES-queries a bnode id
      const embedObjectIris = new Set<string>() // URI objects inside bnode props — need labels/types too
      const bnodeShown = new Set<string>()
      for (const b of blankRes?.results.bindings ?? []) {
        const bn = b.b?.value, xp = b.xp?.value, p = b.p?.value, o = b.o
        if (!bn || !xp || !p || !o) continue
        const graph = b.g?.value
        // The referrer object, under its pointing predicate group (create the
        // group if the URI list didn't already have this predicate).
        let entry = byPredicate.get(xp)
        if (!entry) {
          const group: PropertyGroup = { predicate: xp, objects: [] }
          entry = { group, subjects: new Map() }
          byPredicate.set(xp, entry)
          out.push(group)
        }
        let ro = entry.subjects.get(bn)
        if (!ro) {
          ro = { termType: 'bnode', value: bn, graphs: [] }
          entry.subjects.set(bn, ro)
          entry.group.objects.push(ro)
          bnodeShown.add(bn)
          toResolve.add(xp)
        }
        if (graph && !ro.graphs.includes(graph)) ro.graphs.push(graph)
        if (p === RDF_TYPE) {
          if (o.type === 'uri' && !bnodeTypes.has(bn)) { bnodeTypes.set(bn, o.value); toResolve.add(o.value) }
          continue
        }
        // The bnode's own property → an inlined row.
        let bg = embedMap.get(bn)
        if (!bg) { bg = []; embedMap.set(bn, bg) }
        let g = bg.find(x => x.predicate === p)
        if (!g) { g = { predicate: p, objects: [] }; bg.push(g) }
        const termType = o.type === 'uri' ? 'uri' : o.type === 'bnode' ? 'bnode' : 'literal'
        g.objects.push({ termType, value: o.value, lang: o['xml:lang'] || undefined, datatype: o.datatype || undefined, graphs: graph ? [graph] : [] })
        toResolve.add(p)
        if (o.type === 'uri') { toResolve.add(o.value); embedObjectIris.add(o.value) }
        if (o.datatype) toResolve.add(o.datatype)
      }

      // Labels + most-specific types for the referencing subjects (and the URI
      // objects inside inlined bnode props), via the shared resolver (batched/WAF-
      // safe label lookup + precedence + SKOS-XL).
      const labelMap = new Map<string, string>()
      const typeMap = new Map<string, string>()
      const toLabel = new Set([...subjectIris, ...embedObjectIris])
      if (toLabel.size) {
        await resolveLabels(endpoint, [...toLabel], labelLangs(endpoint.languagePriorities, languageStore.preferred), labelMap, typeMap, isCurrent)
        if (!isCurrent()) return
      }

      // Compose per-type labels (same resolver as the resource view), so a
      // referencing Grant reads "project · amount" not its UUID, and an
      // OrganisationRole reads "org · role" not its verbose raw rdfs:label.
      await composeLabels(endpoint, labelMap, typeMap, typeConfig, labelLangs(endpoint.languagePriorities, languageStore.preferred), uri, isCurrent)
      if (!isCurrent()) return
      for (const t of typeMap.values()) toResolve.add(t) // incl. referent types the walk found
      // Bnode type badges: merged AFTER composeLabels so bnode ids never reach its
      // VALUES queries. A real referrer type wins if one somehow shares the key.
      for (const [bn, t] of bnodeTypes) if (!typeMap.has(bn)) typeMap.set(bn, t)

      const resolvedMap = await resolveUris([...toResolve])
      if (!isCurrent()) return

      groups.value = out
      objectLabels.value = labelMap
      objectTypes.value = typeMap
      embedded.value = embedMap
      resolved.value = resolvedMap
      // Only overwrite on success: a failed list-time count must NOT erase the
      // value the eager loadCount() already put in the headline (R27). count stays
      // whatever it was (loadCount's number, or null if that hadn't landed either).
      if (countRes) count.value = parseInt(countRes.results.bindings[0]?.n?.value ?? '0', 10)
      // The list query projects raw ?s ?g ?p (no DISTINCT), so a quad store
      // multiplies rows per graph — hitting the row cap does NOT mean 1,000
      // distinct subjects. Report the real count assembled, and only flag
      // truncation when more subjects exist than we displayed.
      shown.value = subjectIris.size + bnodeShown.size
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

  return { groups, count, shown, truncated, loading, loaded, error, resolved, objectLabels, objectTypes, embedded, load, loadCount, reset }
}
