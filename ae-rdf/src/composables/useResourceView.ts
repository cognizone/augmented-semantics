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
import { ref, computed, type Ref } from 'vue'
import { useEndpointStore, useLanguageStore, useBrowseStore, useTypeConfigStore } from '../stores'
import { executeSparql, resolveUris, logger, buildResourceTriplesQuery, buildLabelsQuery, buildValuesQuery, buildEmbeddedTriplesQuery, resolveGraphStrategy, LABEL_PREDICATES } from '../services'
import { composeLabel } from '../utils/propertyOrder'
import { localName as localNameOf } from '../utils/format'

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

export interface ResourceObject {
  termType: 'uri' | 'literal' | 'bnode'
  value: string
  lang?: string
  datatype?: string
  /** Named graphs this exact triple asserts in. Empty = default graph. A set,
   *  because the same triple can live in several graphs at once. */
  graphs: string[]
}

export interface PropertyGroup {
  predicate: string
  objects: ResourceObject[]
}

type ResolvedMap = Map<string, { prefix: string; localName: string }>

export function useResourceView() {
  const endpointStore = useEndpointStore()
  const languageStore = useLanguageStore()
  const browseStore = useBrowseStore()
  const typeConfig = useTypeConfigStore()

  const triples: Ref<PropertyGroup[]> = ref([])
  const types: Ref<ResourceObject[]> = ref([]) // rdf:type values, lifted out of the table
  const loading = ref(false)
  const error = ref<string | null>(null)
  const resolved: Ref<ResolvedMap> = ref(new Map())
  const objectLabels: Ref<Map<string, string>> = ref(new Map()) // object IRI → human label
  const objectTypes: Ref<Map<string, string>> = ref(new Map()) // object IRI → a type IRI
  const embedded: Ref<Map<string, PropertyGroup[]>> = ref(new Map()) // embeddable object IRI → its triples
  let requestId = 0

  // The heading label — a computed so it recomposes live when the type's label
  // config (or language) changes, without reloading the resource.
  const label = computed<string | null>(() =>
    deriveLabel(
      triples.value,
      types.value.filter(o => o.termType === 'uri').map(o => o.value),
      objectLabels.value,
    ),
  )

  /** Preferred-language literal value for a predicate group, or a URI object's
   *  fetched label / local name. Undefined when the group has no usable value. */
  function groupValue(
    group: PropertyGroup | undefined,
    objLabels: Map<string, string>,
  ): string | undefined {
    if (!group?.objects.length) return undefined
    const preferred = languageStore.preferred
    const lits = group.objects.filter(o => o.termType === 'literal')
    if (lits.length) {
      return (
        lits.find(o => o.lang === preferred)?.value ??
        lits.find(o => o.lang === 'en')?.value ??
        lits.find(o => !o.lang)?.value ??
        lits[0]!.value
      )
    }
    const o = group.objects[0]!
    return objLabels.get(o.value) ?? localNameOf(o.value)
  }

  /** Pick a display label: a per-type composed label if configured, else the
   *  predicate-precedence + language heuristic. */
  function deriveLabel(groups: PropertyGroup[], typeUris: string[], objLabels: Map<string, string>): string | null {
    const labelType = [...typeUris].sort().find(u => (typeConfig.get(u).label?.length ?? 0) > 0)
    if (labelType) {
      const preds = typeConfig.get(labelType).label!
      const composed = composeLabel(preds, p => groupValue(groups.find(g => g.predicate === p), objLabels))
      if (composed) return composed
    }

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

    const strategy = resolveGraphStrategy(browseStore.graph)
    let query: string
    try {
      query = buildResourceTriplesQuery(uri, strategy)
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

      // Group by predicate, then dedupe objects by their term identity, folding
      // the graph of each row into a graphs[] set — the same (p,o) can come back
      // once per graph it asserts in.
      const groups: PropertyGroup[] = []
      const byPredicate = new Map<string, { group: PropertyGroup; objects: Map<string, ResourceObject> }>()
      for (const b of results.results.bindings) {
        const p = b.p?.value
        const o = b.o
        if (!p || !o) continue
        const termType = o.type === 'uri' ? 'uri' : o.type === 'bnode' ? 'bnode' : 'literal'
        const lang = o['xml:lang'] || undefined
        const datatype = o.datatype || undefined
        const graph = b.g?.value // undefined ⇒ default graph

        let entry = byPredicate.get(p)
        if (!entry) {
          const group: PropertyGroup = { predicate: p, objects: [] }
          entry = { group, objects: new Map() }
          byPredicate.set(p, entry)
          groups.push(group)
        }

        const objKey = `${termType} ${o.value} ${lang ?? ''} ${datatype ?? ''}`
        let obj = entry.objects.get(objKey)
        if (!obj) {
          obj = { termType, value: o.value, lang, datatype, graphs: [] }
          entry.objects.set(objKey, obj)
          entry.group.objects.push(obj)
        }
        if (graph && !obj.graphs.includes(graph)) obj.graphs.push(graph)
      }

      // Lift rdf:type out of the property table (it's identity → header chips).
      const typeGroup = groups.find(g => g.predicate === RDF_TYPE)
      const propGroups = groups.filter(g => g.predicate !== RDF_TYPE)

      // Collect IRIs needing prefix resolution + object IRIs needing labels.
      const toResolve = new Set<string>()
      const objectIris = new Set<string>()
      for (const g of groups) {
        toResolve.add(g.predicate)
        for (const o of g.objects) {
          if (o.termType === 'uri') {
            toResolve.add(o.value)
            objectIris.add(o.value)
          }
          if (o.datatype) toResolve.add(o.datatype)
          for (const gr of o.graphs) toResolve.add(gr)
        }
      }

      // Resolve prefixes and fetch object labels in parallel (Phase 2 readability).
      const [resolvedMap, labelResults] = await Promise.all([
        resolveUris([...toResolve]),
        objectIris.size
          ? executeSparql(endpoint, buildLabelsQuery([...objectIris]), { retries: 1 }).catch(() => null)
          : Promise.resolve(null),
      ])
      if (!isCurrent()) return

      const labelMap = new Map<string, string>()
      const typeMap = new Map<string, string>()
      for (const b of labelResults?.results.bindings ?? []) {
        const s = b.s?.value
        if (!s) continue
        if (b.label?.value) labelMap.set(s, b.label.value)
        if (b.type?.value) typeMap.set(s, b.type.value)
      }

      // Resolve prefixes for the object types too (needed for the 'prefixed'
      // URI-display mode); resolveUris is cached so this is cheap.
      const typeIris = [...new Set(typeMap.values())].filter(t => !resolvedMap.has(t))
      if (typeIris.length) {
        const typeResolved = await resolveUris(typeIris)
        if (!isCurrent()) return
        for (const [k, v] of typeResolved) resolvedMap.set(k, v)
      }

      // Inline value objects (types configured render:embed), recursively:
      // Organisation → Site → PostalAddress. BFS over embed-typed objects, with
      // a depth cap + `seen` set guarding cycles/runaway.
      // ponytail: depth cap 5; raise if real value-object nesting exceeds it.
      const embeddedMap = new Map<string, PropertyGroup[]>()
      const embToResolve = new Set<string>()
      const seen = new Set<string>([uri])
      const MAX_EMBED_DEPTH = 5
      // ponytail: cap total inlined objects (breadth), not just depth. Without
      // this, configuring a high-cardinality type (e.g. a 3M-row entity) to embed
      // makes a resource inline hundreds/thousands of objects recursively and the
      // load hangs. Beyond the cap, objects fall through to plain links.
      const MAX_EMBED_TOTAL = 150
      let embedBudget = MAX_EMBED_TOTAL
      const capFrontier = (f: string[]) => {
        if (f.length <= embedBudget) return f
        logger.warn('useResourceView', 'Embed breadth cap hit — remaining objects shown as links', {
          cap: MAX_EMBED_TOTAL, dropped: f.length - embedBudget,
        })
        return f.slice(0, embedBudget)
      }
      // Embed an object when its TYPE is render:embed AND — if that type pins an
      // owning predicate (embedVia) — it was reached via that predicate. This is
      // what stops a multiply-referenced entity (e.g. a Grant, linked from Project,
      // FundingAgency, GrantPayment…) from inlining everywhere instead of only
      // under its owner. No embedVia ⇒ inline anywhere (plain value objects).
      const isEmbed = (u: string, via: string) => {
        const cfg = typeConfig.get(typeMap.get(u) ?? '')
        return cfg.render === 'embed' && (!cfg.embedVia || cfg.embedVia === via)
      }
      // Distinct object IRIs to inline, from (object, predicate-reached-by) pairs
      // so embedVia can gate on the predicate.
      const embedFrontier = (pairs: { uri: string; via: string }[]) =>
        [...new Set(pairs.filter(x => !seen.has(x.uri) && isEmbed(x.uri, x.via)).map(x => x.uri))]
      let frontier = capFrontier(embedFrontier(
        propGroups.flatMap(g => g.objects.filter(o => o.termType === 'uri').map(o => ({ uri: o.value, via: g.predicate }))),
      ))

      for (let depth = 0; depth < MAX_EMBED_DEPTH && frontier.length; depth++) {
        embedBudget -= frontier.length
        frontier.forEach(u => seen.add(u))
        const embRes = await executeSparql(endpoint, buildEmbeddedTriplesQuery(frontier, strategy), { retries: 1 }).catch(() => null)
        if (!isCurrent()) return

        // Fold (s,p,o) across graphs into a graphs[] set — keep provenance, don't
        // discard it (a value in 2 graphs gets a multi-graph badge, not silent
        // dedup). Collect the uri-valued objects appearing at this level.
        const nestedIris = new Set<string>()
        const nestedPairs: { uri: string; via: string }[] = []
        const embObjByKey = new Map<string, ResourceObject>()
        for (const b of embRes?.results.bindings ?? []) {
          const s = b.s?.value
          const p = b.p?.value
          const o = b.o
          if (!s || !p || !o) continue
          if (p === RDF_TYPE) continue // shown as the embed's type badge
          const termType = o.type === 'uri' ? 'uri' : o.type === 'bnode' ? 'bnode' : 'literal'
          const lang = o['xml:lang'] || undefined
          const datatype = o.datatype || undefined
          const graph = b.g?.value
          const key = `${s} ${p} ${termType} ${o.value} ${lang ?? ''} ${datatype ?? ''}`
          let obj = embObjByKey.get(key)
          if (!obj) {
            obj = { termType, value: o.value, lang, datatype, graphs: [] }
            embObjByKey.set(key, obj)
            let eGroups = embeddedMap.get(s)
            if (!eGroups) {
              eGroups = []
              embeddedMap.set(s, eGroups)
            }
            let g = eGroups.find(x => x.predicate === p)
            if (!g) {
              g = { predicate: p, objects: [] }
              eGroups.push(g)
            }
            g.objects.push(obj)
          }
          if (graph && !obj.graphs.includes(graph)) obj.graphs.push(graph)
          embToResolve.add(p)
          if (o.type === 'uri') { embToResolve.add(o.value); nestedIris.add(o.value); nestedPairs.push({ uri: o.value, via: p }) }
          if (datatype) embToResolve.add(datatype) // so xsd:decimal renders as a qname, not the IRI
          if (graph) embToResolve.add(graph)
        }

        // Labels + types for the nested objects, so they render with a label and
        // we can tell which to embed at the next level.
        const newIris = [...nestedIris].filter(u => !labelMap.has(u) && !typeMap.has(u))
        if (newIris.length) {
          const lr = await executeSparql(endpoint, buildLabelsQuery(newIris), { retries: 1 }).catch(() => null)
          if (!isCurrent()) return
          for (const b of lr?.results.bindings ?? []) {
            const s = b.s?.value
            if (!s) continue
            if (b.label?.value) labelMap.set(s, b.label.value)
            if (b.type?.value) typeMap.set(s, b.type.value)
          }
        }

        frontier = embedBudget > 0 ? capFrontier(embedFrontier(nestedPairs)) : []
      }

      // Composed labels for objects whose type configures one: fetch the label
      // fields' values and join them (per the type's label order), overriding the
      // standard single label. URI-valued fields fall back to their local name
      // (their own label would need another hop). One extra query, only when some
      // shown object is of a configured type.
      const toCompose = [...typeMap.entries()].filter(([, t]) => (typeConfig.get(t).label?.length ?? 0) > 0)
      if (toCompose.length) {
        const preds = [...new Set(toCompose.flatMap(([, t]) => typeConfig.get(t).label ?? []))]
        const q = buildValuesQuery(toCompose.map(([s]) => s), preds)
        if (q) {
          const vr = await executeSparql(endpoint, q, { retries: 1 }).catch(() => null)
          if (!isCurrent()) return
          const valByS = new Map<string, Map<string, { v: string; uri: boolean }>>() // s → (p → raw value), first wins
          for (const b of vr?.results.bindings ?? []) {
            const s = b.s?.value, p = b.p?.value, o = b.v
            if (!s || !p || !o?.value) continue
            let m = valByS.get(s)
            if (!m) { m = new Map(); valByS.set(s, m) }
            if (!m.has(p)) m.set(p, { v: o.value, uri: o.type === 'uri' })
          }
          // A URI-valued label field resolves to the referent's OWN label (one
          // hop) — its composed/generic label from labelMap, else its local name.
          // e.g. an OrganisationRole labelled by isRoleOf shows the Organisation's
          // name, not a UUID. Two passes so a referent composed here is available
          // to its referrer regardless of iteration order.
          const resolve = (s: string, p: string): string | undefined => {
            const c = valByS.get(s)?.get(p)
            if (!c) return undefined
            return c.uri ? (labelMap.get(c.v) ?? localNameOf(c.v)) : c.v
          }
          for (let pass = 0; pass < 2; pass++) {
            for (const [s, t] of toCompose) {
              const composed = composeLabel(typeConfig.get(t).label ?? [], p => resolve(s, p))
              if (composed) labelMap.set(s, composed)
            }
          }
        }
      }

      // Resolve prefixes for everything the embeds introduced (predicates, object
      // IRIs, datatypes, graphs) plus all object types (badges). resolveUris is
      // cached, so re-listing already-resolved IRIs is cheap.
      for (const t of typeMap.values()) embToResolve.add(t)
      const fresh = [...embToResolve].filter(u => !resolvedMap.has(u))
      if (fresh.length) {
        const er = await resolveUris(fresh)
        if (!isCurrent()) return
        for (const [k, v] of er) resolvedMap.set(k, v)
      }

      triples.value = propGroups
      types.value = typeGroup?.objects ?? []
      resolved.value = resolvedMap
      objectLabels.value = labelMap
      objectTypes.value = typeMap
      embedded.value = embeddedMap

      logger.info('useResourceView', 'Loaded resource', { uri, predicates: propGroups.length, labels: labelMap.size })
    } catch (e: unknown) {
      if (!isCurrent()) return
      const msg = e && typeof e === 'object' && 'message' in e ? (e as { message: string }).message : 'Unknown error'
      logger.error('useResourceView', 'Failed to load resource', { uri, error: e })
      error.value = `Failed to load resource: ${msg}`
      triples.value = []
      types.value = []
      embedded.value = new Map()
    } finally {
      if (isCurrent()) loading.value = false
    }
  }

  return { triples, types, label, loading, error, resolved, objectLabels, objectTypes, embedded, loadResource }
}
