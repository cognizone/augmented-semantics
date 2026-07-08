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
import { executeSparql, resolveUris, logger, buildResourceTriplesQuery, buildEmbeddedTriplesQuery, buildBlankNodeTriplesQuery, buildInverseEmbedQuery, resolveGraphStrategy, LABEL_PREDICATES, DEFAULT_DEPRECATED_PREDICATES, EMBED_BATCH } from '../services'
import { labelLangs as computeLabelLangs, pickByLangs } from '../utils/labelLang'
import { headingParts } from '../utils/propertyOrder'
import { formatLiteral } from '../utils/format'
import { composeLabels, composeViaLabels, resolveLabels, resolveDeprecated } from './composeLabels'

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
  // predicate IRI → (object IRI → contextual label), from the viewed type's
  // viaLabels: overrides a linked object's label per referring predicate.
  const contextLabels: Ref<Map<string, Map<string, string>>> = ref(new Map())
  const objectTypes: Ref<Map<string, string>> = ref(new Map()) // object IRI → a type IRI
  const deprecated = ref(false) // the viewed resource is flagged deprecated
  const deprecatedObjects: Ref<Set<string>> = ref(new Set()) // linked/embedded objects flagged deprecated
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

  // Label language priority for the CURRENT endpoint: its configured
  // languagePriorities (from the endpoint JSON), else the user's global
  // preference, always ending in 'en' as a universal fallback. The first entry
  // drives single-language label resolution (resolveLabels).
  const labelLangs = () => computeLabelLangs(endpointStore.current?.languagePriorities, languageStore.preferred)

  /** Preferred-language literal value for a predicate group, or a URI object's
   *  fetched label / local name. Undefined when the group has no usable value. */
  function groupValue(
    group: PropertyGroup | undefined,
    objLabels: Map<string, string>,
  ): string | undefined {
    if (!group?.objects.length) return undefined
    const lits = group.objects.filter(o => o.termType === 'literal')
    if (lits.length) return pickByLangs(lits, labelLangs())?.value
    // URI-valued label field: use the referent's resolved (possibly composed)
    // label. Drop referents with no known label instead of showing a raw local
    // name — composeLabels drops them too, so the heading matches the link/embed
    // label for the same referent (rather than "AnnualReport" here / dropped there).
    const labeled = group.objects.find(o => objLabels.has(o.value))
    return labeled ? objLabels.get(labeled.value) : undefined
  }

  /** Pick a display label: a per-type composed label if configured, else the
   *  predicate-precedence + language heuristic. */
  function deriveLabel(groups: PropertyGroup[], typeUris: string[], objLabels: Map<string, string>): string | null {
    // Compose from the SAME config type the edit panel writes to (cfgType), not
    // an independently-picked "first type with a label" — those drifted so the
    // heading composed one type while the label toggles wrote another. (R28)
    const labelType = typeConfig.configType(typeUris)
    const preds = labelType ? typeConfig.get(labelType).label ?? [] : []
    const grp = new Set(labelType ? typeConfig.get(labelType).number ?? [] : [])
    if (preds.length) {
      // On the resource's OWN page there is no relation context to trim against
      // (composeLabels' selfUri drop only fires for embeds/links), so the full
      // composed identity would headline every linked entity — org · role ·
      // project. Keep all literal parts + the FIRST linked entity, drop the rest:
      // the others are already listed below as relations. `labelFull` opts out
      // (a reified-relationship type whose identity needs several linked parts,
      // e.g. OrganisationRole = role + org). All-literal labels are untouched.
      const items: { value: string; linked: boolean }[] = []
      for (const p of preds) {
        const group = groups.find(g => g.predicate === p)
        let value = groupValue(group, objLabels)
        if (!value) continue
        value = formatLiteral(value, grp.has(p))
        items.push({ value, linked: !group?.objects.some(o => o.termType === 'literal') })
      }
      const full = !!(labelType && typeConfig.get(labelType).labelFull)
      const parts = headingParts(items, full)
      if (parts.length) return parts.join(' · ')
    }

    const langs = labelLangs()
    for (const pred of LABEL_PREDICATES) {
      const group = groups.find(g => g.predicate === pred)
      if (!group) continue
      const literals = group.objects.filter(o => o.termType === 'literal')
      if (!literals.length) continue
      return pickByLangs(literals, langs)?.value ?? literals[0]!.value
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
    // Clear derived state up-front. The header (title, type chips, graph chips)
    // renders even while loading, so leaving the previous resource's values here
    // shows them against the new URI — and a stale type chip navigates to the
    // wrong type — until the query resolves. See ae-rdf/CLAUDE.md (reset-on-switch).
    triples.value = []
    types.value = []
    objectLabels.value = new Map()
    contextLabels.value = new Map()
    deprecated.value = false
    deprecatedObjects.value = new Set()
    objectTypes.value = new Map()
    embedded.value = new Map()
    resolved.value = new Map()

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

    // Inverse-embed predicates: types configured `render:embed` with `embedVia:"^P"`
    // inline the referrer that points here via P. Query those referrers alongside
    // the outgoing triples (skipped entirely when no type opts in).
    const invPredicates = [...new Set(
      Object.values(endpoint.types ?? {})
        .filter(c => c.render === 'embed' && c.embedVia?.startsWith('^'))
        .map(c => c.embedVia!.slice(1)),
    )]

    try {
      const [results, invResults] = await Promise.all([
        executeSparql(endpoint, query, { retries: 1 }),
        invPredicates.length
          ? executeSparql(endpoint, buildInverseEmbedQuery(uri, invPredicates, strategy), { retries: 1 }).catch(() => null)
          : Promise.resolve(null),
      ])
      if (!isCurrent()) return

      // (referrer, predicate-arrived-by) pairs — seeded into the embed BFS below as
      // roots with via `^predicate`, and surfaced as synthetic `^predicate` groups.
      const invPairs: { uri: string; via: string }[] = []
      for (const b of invResults?.results.bindings ?? []) {
        const s = b.s?.value, via = b.via?.value
        if (s && via && s !== uri) invPairs.push({ uri: s, via })
      }

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
      // Inverse referrers need labels/types (badge + embed decision) and prefixes.
      for (const { uri: s, via } of invPairs) { objectIris.add(s); toResolve.add(s); toResolve.add(via) }

      // Resolve prefixes and canonical object labels in parallel (Phase 2). The
      // shared resolver does the 6-predicate precedence label + SKOS-XL language
      // pick, so heading / list / link / embed all agree on a resource's label.
      const labelMap = new Map<string, string>()
      const typeMap = new Map<string, string>()
      // ALL most-specific types per object, so the embed decision sees every type
      // of a multi-typed node (typeMap keeps only one, arbitrarily).
      const allTypes = new Map<string, Set<string>>()
      const [resolvedMap] = await Promise.all([
        resolveUris([...toResolve]),
        resolveLabels(endpoint, [...objectIris], labelLangs(), labelMap, typeMap, isCurrent, allTypes),
      ])
      if (!isCurrent()) return

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
      // Check EVERY type of the object (a node can carry several independent
      // most-specific types); embed if any is render:embed for this predicate.
      // Fall back to the single typeMap entry if allTypes has nothing yet.
      const isEmbed = (u: string, via: string) => {
        const types = allTypes.get(u)
        const candidates = types?.size ? types : new Set([typeMap.get(u) ?? ''])
        for (const t of candidates) {
          const cfg = typeConfig.get(t)
          if (cfg.render === 'embed' && (!cfg.embedVia || cfg.embedVia === via)) return true
        }
        return false
      }
      // Distinct object IRIs to inline, from (object, predicate-reached-by) pairs
      // so embedVia can gate on the predicate.
      const embedFrontier = (pairs: { uri: string; via: string }[]) =>
        [...new Set(pairs.filter(x => !seen.has(x.uri) && isEmbed(x.uri, x.via)).map(x => x.uri))]
      let frontier = capFrontier(embedFrontier([
        ...propGroups.flatMap(g => g.objects.filter(o => o.termType === 'uri').map(o => ({ uri: o.value, via: g.predicate }))),
        // Inverse-embed roots: referrer reached via `^predicate` (isEmbed matches the
        // type's `embedVia:"^predicate"`). Fetched + inlined by the same BFS.
        ...invPairs.map(p => ({ uri: p.uri, via: `^${p.via}` })),
      ]))

      for (let depth = 0; depth < MAX_EMBED_DEPTH && frontier.length; depth++) {
        embedBudget -= frontier.length
        frontier.forEach(u => seen.add(u))
        // buildEmbeddedTriplesQuery caps its VALUES list at EMBED_BATCH; the
        // frontier can be up to MAX_EMBED_TOTAL, so fetch in batches and concat —
        // else objects past the cap are marked seen (and charged to embedBudget)
        // but never fetched, silently rendering as plain links with breadth unspent.
        const batches: string[][] = []
        for (let i = 0; i < frontier.length; i += EMBED_BATCH) batches.push(frontier.slice(i, i + EMBED_BATCH))
        const embResults = await Promise.all(
          batches.map(b => executeSparql(endpoint, buildEmbeddedTriplesQuery(b, strategy), { retries: 1 }).catch(() => null)),
        )
        if (!isCurrent()) return
        const embBindings = embResults.flatMap(r => r?.results.bindings ?? [])

        // Fold (s,p,o) across graphs into a graphs[] set — keep provenance, don't
        // discard it (a value in 2 graphs gets a multi-graph badge, not silent
        // dedup). Collect the uri-valued objects appearing at this level.
        const nestedIris = new Set<string>()
        const nestedPairs: { uri: string; via: string }[] = []
        const embObjByKey = new Map<string, ResourceObject>()
        for (const b of embBindings) {
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
        // Refetch when EITHER label OR type is missing (not both): an object with
        // a label but no type (e.g. a SKOS-XL-labelled object whose type the first
        // pass missed) still needs its type for the badge and the embed decision.
        // `&&` skipped it. Guard the sets so filling the missing one never clobbers
        // an already-resolved label/type. Matches composeLabels' sibling filter.
        const newIris = [...nestedIris].filter(u => !labelMap.has(u) || !typeMap.has(u))
        if (newIris.length) {
          await resolveLabels(endpoint, newIris, labelLangs(), labelMap, typeMap, isCurrent, allTypes)
          if (!isCurrent()) return
        }

        frontier = embedBudget > 0 ? capFrontier(embedFrontier(nestedPairs)) : []
      }

      // Blank-node value objects (e.g. MappedCode) can't go in a VALUES list — no
      // stable, queryable id — so the URI embed BFS above skips them. Fetch them
      // PATH-SCOPED from the resource and inline them: a bnode has no standalone
      // view, so it's always embedded. One hop (these value objects are flat).
      if (propGroups.some(g => g.objects.some(o => o.termType === 'bnode'))) {
        const bnRes = await executeSparql(endpoint, buildBlankNodeTriplesQuery(uri, strategy), { retries: 1 }).catch(() => null)
        if (!isCurrent()) return
        const bnObjByKey = new Map<string, ResourceObject>()
        for (const b of bnRes?.results.bindings ?? []) {
          const bn = b.b?.value, p = b.p?.value, o = b.o
          if (!bn || !p || !o) continue
          if (p === RDF_TYPE) { // the bnode's type → its embed badge + config (order/hide)
            if (o.type === 'uri') { if (!typeMap.has(bn)) typeMap.set(bn, o.value); embToResolve.add(o.value) }
            continue
          }
          const termType = o.type === 'uri' ? 'uri' : o.type === 'bnode' ? 'bnode' : 'literal'
          const graph = b.g?.value
          const key = `${bn} ${p} ${termType} ${o.value} ${o['xml:lang'] ?? ''} ${o.datatype ?? ''}`
          let obj = bnObjByKey.get(key)
          if (!obj) {
            obj = { termType, value: o.value, lang: o['xml:lang'] || undefined, datatype: o.datatype || undefined, graphs: [] }
            bnObjByKey.set(key, obj)
            let eg = embeddedMap.get(bn); if (!eg) { eg = []; embeddedMap.set(bn, eg) }
            let g = eg.find(x => x.predicate === p); if (!g) { g = { predicate: p, objects: [] }; eg.push(g) }
            g.objects.push(obj)
          }
          if (graph && !obj.graphs.includes(graph)) obj.graphs.push(graph)
          embToResolve.add(p)
          if (o.type === 'uri') embToResolve.add(o.value)
          if (o.datatype) embToResolve.add(o.datatype)
          if (graph) embToResolve.add(graph)
        }
      }

      // Composed labels: override standard labels with the per-type composed label
      // (label graph walk), for the heading, embedded objects, and every linked
      // object. `uri` is the viewed resource, so a role's redundant back-reference
      // to it is dropped from the composed label. See composeLabels.
      await composeLabels(endpoint, labelMap, typeMap, typeConfig, labelLangs(), uri, isCurrent)
      if (!isCurrent()) return

      // Contextual object labels: the viewed type may relabel a LINKED object per
      // referring predicate (viaLabels) — e.g. show a role's "role · org" under a
      // Grant's hasBeneficiary, though that role's own page leads with its project.
      // Same config type the heading/edit panel use (configType over the rdf:types).
      const srcType = typeConfig.configType((typeGroup?.objects ?? []).filter(o => o.termType === 'uri').map(o => o.value))
      const contextMap = await composeViaLabels(endpoint, srcType, propGroups, labelMap, typeMap, typeConfig, labelLangs(), uri, isCurrent)
      if (!isCurrent()) return

      // Deprecation: the viewed resource is flagged from its own triples (a
      // deprecation predicate asserted `true`); linked/embedded objects are checked
      // in one batched query so links + the header badge consistently. Predicates
      // are profiler-detected (endpoint.deprecatedPredicates) or the built-in default.
      const depPreds = endpoint.deprecatedPredicates ?? [...DEFAULT_DEPRECATED_PREDICATES]
      const depSelf = propGroups.some(g => depPreds.includes(g.predicate) && g.objects.some(o => o.termType === 'literal' && o.value === 'true'))
      const depObjects = new Set<string>()
      await resolveDeprecated(endpoint, [...objectIris], depPreds, depObjects, isCurrent)
      if (!isCurrent()) return

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

      // Inverse-embed referrers → synthetic `^predicate` relationship groups, shown
      // in RELATIONSHIPS with an incoming (↤) marker. Only embed-configured referrers
      // (isEmbed); those past the embed budget aren't in embeddedMap and so render as
      // plain links inside the group. Kept OUT of `propGroups` above so they don't
      // affect the heading label or the graph summary.
      const invGroups = new Map<string, PropertyGroup>()
      for (const { uri: s, via } of invPairs) {
        const pred = `^${via}`
        if (!isEmbed(s, pred)) continue
        let g = invGroups.get(pred)
        if (!g) { g = { predicate: pred, objects: [] }; invGroups.set(pred, g) }
        if (!g.objects.some(o => o.value === s)) g.objects.push({ termType: 'uri', value: s, graphs: [] })
      }

      triples.value = [...propGroups, ...invGroups.values()]
      types.value = typeGroup?.objects ?? []
      resolved.value = resolvedMap
      objectLabels.value = labelMap
      contextLabels.value = contextMap
      deprecated.value = depSelf
      deprecatedObjects.value = depObjects
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

  return { triples, types, label, loading, error, resolved, objectLabels, contextLabels, objectTypes, embedded, deprecated, deprecatedObjects, loadResource }
}
