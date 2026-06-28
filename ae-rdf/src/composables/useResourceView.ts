/**
 * useResourceView - load a resource's outgoing triples for display.
 *
 * Owns one query (resource-triples), a requestId race-guard (com02), prefix
 * resolution for predicates/objects, and client-side label derivation by
 * precedence. The separate label query (#4) is unnecessary — the label lives
 * among the triples we already fetch.
 *
 * @see /spec/ae-rdf
 * @see /spec/common/com02-StateManagement.md
 */
import { ref, type Ref } from 'vue'
import { useEndpointStore, useLanguageStore } from '../stores'
import { executeSparql, resolveUris, logger, buildResourceTriplesQuery, LABEL_PREDICATES } from '../services'

export interface ResourceObject {
  termType: 'uri' | 'literal' | 'bnode'
  value: string
  lang?: string
  datatype?: string
}

export interface PropertyGroup {
  predicate: string
  objects: ResourceObject[]
}

type ResolvedMap = Map<string, { prefix: string; localName: string }>

export function useResourceView() {
  const endpointStore = useEndpointStore()
  const languageStore = useLanguageStore()

  const triples: Ref<PropertyGroup[]> = ref([])
  const label = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const resolved: Ref<ResolvedMap> = ref(new Map())
  let requestId = 0

  /** Pick a display label from grouped triples, by predicate precedence + language. */
  function deriveLabel(groups: PropertyGroup[]): string | null {
    const preferred = languageStore.preferred
    for (const pred of LABEL_PREDICATES) {
      const group = groups.find(g => g.predicate === pred)
      if (!group) continue
      const literals = group.objects.filter(o => o.termType === 'literal')
      if (!literals.length) continue
      return (
        literals.find(o => o.lang === preferred)?.value ??
        literals.find(o => o.lang === 'en')?.value ??
        literals.find(o => !o.lang)?.value ??
        literals[0]!.value
      )
    }
    return null
  }

  async function loadResource(uri: string): Promise<void> {
    const endpoint = endpointStore.current
    if (!endpoint) return
    const endpointId = endpoint.id
    const id = ++requestId
    const isCurrent = () => id === requestId && endpointStore.current?.id === endpointId

    loading.value = true
    error.value = null

    let query: string
    try {
      query = buildResourceTriplesQuery(uri)
    } catch (e) {
      logger.warn('useResourceView', 'Rejected unsafe resource URI', { uri, error: e })
      error.value = 'Invalid resource URI'
      loading.value = false
      return
    }

    logger.info('useResourceView', 'Loading resource', { uri })

    try {
      const results = await executeSparql(endpoint, query, { retries: 1 })
      if (!isCurrent()) return

      // Group objects by predicate (bindings already ordered by predicate)
      const groups: PropertyGroup[] = []
      const byPredicate = new Map<string, PropertyGroup>()
      for (const b of results.results.bindings) {
        const p = b.p?.value
        const o = b.o
        if (!p || !o) continue
        let group = byPredicate.get(p)
        if (!group) {
          group = { predicate: p, objects: [] }
          byPredicate.set(p, group)
          groups.push(group)
        }
        group.objects.push({
          termType: o.type === 'uri' ? 'uri' : o.type === 'bnode' ? 'bnode' : 'literal',
          value: o.value,
          lang: o['xml:lang'] || undefined,
          datatype: o.datatype || undefined,
        })
      }

      // Resolve prefixes for predicates, object URIs, and datatypes (one batch)
      const toResolve = new Set<string>()
      for (const g of groups) {
        toResolve.add(g.predicate)
        for (const o of g.objects) {
          if (o.termType === 'uri') toResolve.add(o.value)
          if (o.datatype) toResolve.add(o.datatype)
        }
      }
      const resolvedMap = await resolveUris([...toResolve])
      if (!isCurrent()) return

      triples.value = groups
      resolved.value = resolvedMap
      label.value = deriveLabel(groups)

      logger.info('useResourceView', 'Loaded resource', { uri, predicates: groups.length })
    } catch (e: unknown) {
      if (!isCurrent()) return
      const msg = e && typeof e === 'object' && 'message' in e ? (e as { message: string }).message : 'Unknown error'
      logger.error('useResourceView', 'Failed to load resource', { uri, error: e })
      error.value = `Failed to load resource: ${msg}`
      triples.value = []
      label.value = null
    } finally {
      if (isCurrent()) loading.value = false
    }
  }

  return { triples, label, loading, error, resolved, loadResource }
}
