/**
 * composeLabels - THE label resolver. Given the standard labels + most-specific
 * types already fetched for a set of resources, override with the per-type
 * COMPOSED label wherever a type configures one (TypeConfig.label): join the
 * label fields' values, in order, with ' · '.
 *
 * A URI-valued label field resolves to the REFERENT's own label — and that
 * referent may itself be composed — so we walk the label graph a few hops
 * (GrantPayment → hasRecipient → OrganisationRole → isRoleOf → Organisation)
 * rather than one. Referents reached only via label fields get their labels
 * fetched here too, else a linked object's composed label collapses to raw UUIDs.
 *
 * Mutates `labelMap` (and may add referent types to `typeMap`) in place. Every
 * label path routes through this so the base resolver (resolveLabels: standard
 * predicates only) is just the seed, never the final answer — otherwise
 * composed-label types with no standard label (a Grant) show their UUID, and
 * types with a verbose raw rdfs:label (an OrganisationRole) show that instead of
 * the clean composed label.
 *
 * @see /spec/ae-rdf
 */
import { executeSparql, buildValuesQuery, buildDeprecatedQuery, buildLabelValuesQuery, buildTypeQuery, buildTypeSubclassQuery, buildSkosxlLabelsQuery, LABEL_PREDICATES, LABEL_PREDICATE_BATCH } from '../services'
import { useTypeConfigStore } from '../stores'
import { pickByLangs } from '../utils/labelLang'
import { formatLiteral } from '../utils/format'
import type { SPARQLEndpoint } from '../types/endpoint'
import type { AppError } from '../types/errors'

// ponytail: cap the label graph walk at 3 hops (payment→role→org is 2).
const MAX_LABEL_HOPS = 3

// A referent whose resolved label is a bare UUID carries no more meaning than its
// URI (R17: rdfs:label is highest-precedence here, so a UUID there beats a good
// prefLabel and would pollute the parent's composed label). Keep the pattern narrow
// on purpose — a real name like "NVR Vehicle ID" passes.
// ponytail: UUID-shaped only; widen if other opaque id shapes appear in the wild.
const UUID_LABEL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isOpaqueLabel = (v: string): boolean => UUID_LABEL.test(v.trim())

// Subject VALUES-list chunk size. Big enough that ordinary resources fetch in one
// request; larger sets chunk, and a WAF-rejected chunk split-retries below.
// ponytail: tune down if a WAF blocks even 20 subjects; split-retry self-heals anyway.
export const SUBJECT_BATCH = 20

/**
 * Run a VALUES-over-URIs query in subject chunks of `batch`, merging bindings.
 * If a chunk is rejected for a PAYLOAD reason — a cumulative-anomaly WAF 400
 * (QUERY_ERROR) or a WAF HTML interstitial (INVALID_RESPONSE) — split it and retry
 * the halves, down to a single URI (then drop it: its label just won't resolve).
 * Non-payload failures (timeout / server / network) do NOT split — splitting can't
 * help and would amplify load during an outage — the chunk is dropped instead.
 * `attempt` resolves a chunk's bindings or throws an AppError. Pure (no endpoint
 * dependency) so the split logic is unit-tested apart from the network.
 */
export async function fetchInChunks<B>(
  uris: string[],
  batch: number,
  attempt: (chunk: string[]) => Promise<B[]>,
): Promise<B[]> {
  const splittable = (e: unknown): boolean => {
    const code = (e as AppError | undefined)?.code
    return code === 'QUERY_ERROR' || code === 'INVALID_RESPONSE'
  }
  const run = async (chunk: string[]): Promise<B[]> => {
    if (!chunk.length) return []
    try {
      return await attempt(chunk)
    } catch (e) {
      if (chunk.length <= 1 || !splittable(e)) return []
      const mid = chunk.length >> 1
      const [a, b] = await Promise.all([run(chunk.slice(0, mid)), run(chunk.slice(mid))])
      return [...a, ...b]
    }
  }
  const size = Math.max(1, batch)
  const chunks: string[][] = []
  for (let i = 0; i < uris.length; i += size) chunks.push(uris.slice(i, i + size))
  const out = await Promise.all(chunks.map(run))
  return out.flat()
}

/** Chunked + WAF-split VALUES-over-`list` query for one endpoint (fetchInChunks
 *  wired to executeSparql). retries:0 — the split IS the recovery for a WAF block,
 *  and a deterministic 400 gains nothing from a plain retry. */
function fetchValues(endpoint: SPARQLEndpoint, list: string[], build: (u: string[]) => string) {
  return fetchInChunks(list, SUBJECT_BATCH, async (chunk) => {
    const q = build(chunk)
    return q ? (await executeSparql(endpoint, q, { retries: 0 })).results.bindings : []
  })
}

/**
 * Per subject, keep only the MOST SPECIFIC of its asserted types: drop any type
 * that is a supertype of another type the same subject asserts. `subsOf` maps a
 * super-type to its (transitive) subtypes (from buildTypeSubclassQuery). Pure, so
 * the narrowing that replaces the old server-side FILTER NOT EXISTS is unit-tested.
 */
export function mostSpecificTypes(
  subjectTypes: Map<string, Set<string>>,
  subsOf: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const [s, types] of subjectTypes) {
    const keep = new Set<string>()
    for (const t of types) {
      const subs = subsOf.get(t)
      if (subs && [...types].some(u => u !== t && subs.has(u))) continue // t has a more-specific sibling
      keep.add(t)
    }
    out.set(s, keep)
  }
  return out
}

/**
 * THE base label + most-specific-type resolver for a set of URIs — the shared
 * seed every label path uses (heading, instance list, links, embeds): the
 * 6-predicate precedence label (buildLabelValuesQuery, batched + merged by
 * precedence client-side) + most-specific type (buildTypeQuery) + the SKOS-XL
 * literalForm override, all picked by language. Fills `labelMap`/`typeMap` in
 * place, never overwriting an entry the caller pre-seeded. composeLabels runs ON
 * TOP of this for types that configure a composed label. Hand-rolling a predicate
 * subset anywhere is exactly how the list / heading / link labels drifted apart.
 */
export async function resolveLabels(
  endpoint: SPARQLEndpoint,
  uris: string[],
  langs: string[],
  labelMap: Map<string, string>,
  typeMap: Map<string, string>,
  isCurrent: () => boolean,
  // Optional: collect ALL most-specific types per subject (not just the one kept
  // in typeMap). A node with several independent most-specific types — e.g.
  // ConsultationTask + ResultOfAConsultationPublication — needs every type visible
  // to the embed decision, else which one "wins" typeMap is arbitrary (no ORDER BY)
  // and a render:embed type gets silently missed.
  allTypes?: Map<string, Set<string>>,
): Promise<void> {
  if (!uris.length) return
  // Labels are fetched in small PREDICATE BATCHES (buildLabelValuesQuery) rather
  // than one query with COALESCE over all predicates — a cumulative-anomaly WAF
  // (Fedlex) blocks a request carrying ≥6 external vocab URLs, whether via OPTIONAL
  // or VALUES. Type and SKOS-XL are separate queries. Precedence + language are
  // picked HERE, client-side, preserving the LABEL_PREDICATES order (never an
  // arbitrary SAMPLE). All queries run in parallel.
  const batches: string[][] = []
  for (let i = 0; i < LABEL_PREDICATES.length; i += LABEL_PREDICATE_BATCH)
    batches.push(LABEL_PREDICATES.slice(i, i + LABEL_PREDICATE_BATCH))
  // Predicate batching (above) caps the vocab URLs per request; the SUBJECT VALUES
  // list needs capping too. A resource with many object URIs — e.g. Fedlex file
  // URLs — otherwise builds ONE oversized VALUES list that the cumulative-anomaly
  // WAF rejects wholesale (400), silently dropping EVERY label. fetchValues chunks
  // the subjects and split-retries a rejected chunk.
  const [typeB, skosxlB, ...labelB] = await Promise.all([
    fetchValues(endpoint, uris, u => buildTypeQuery(u)),
    fetchValues(endpoint, uris, u => buildSkosxlLabelsQuery(u)),
    ...batches.map(b => fetchValues(endpoint, uris, u => buildLabelValuesQuery(u, b))),
  ])
  if (!isCurrent()) return

  // Types: buildTypeQuery returns ALL asserted types (DISTINCT); most-specific is
  // narrowed HERE, client-side. A SECOND query fetches subclass edges among just
  // those types (bounded VALUES → cheap) — doing it server-side times out on
  // endpoints that duplicate `?s a ?t` across thousands of graphs (Fedlex). If that
  // query fails/returns nothing, subsOf is empty ⇒ no narrowing (all types kept).
  const subjectTypes = new Map<string, Set<string>>()
  const seenTypes = new Set<string>()
  for (const b of typeB) {
    const s = b.s?.value, t = b.t?.value
    if (!s || !t) continue
    let set = subjectTypes.get(s); if (!set) { set = new Set(); subjectTypes.set(s, set) }
    set.add(t); seenTypes.add(t)
  }
  const subsOf = new Map<string, Set<string>>() // super → its (transitive) subtypes
  if (seenTypes.size) {
    const scB = await fetchValues(endpoint, [...seenTypes], u => buildTypeSubclassQuery(u))
    if (!isCurrent()) return
    for (const b of scB) {
      const sub = b.sub?.value, sup = b.super?.value
      if (!sub || !sup) continue
      let set = subsOf.get(sup); if (!set) { set = new Set(); subsOf.set(sup, set) }
      set.add(sub)
    }
  }
  // typeMap keeps ONE most-specific (badge/label, don't clobber a caller pre-seed);
  // allTypes (if provided) keeps ALL most-specific for the embed decision.
  for (const [s, types] of mostSpecificTypes(subjectTypes, subsOf)) {
    for (const t of types) {
      if (!typeMap.has(s)) typeMap.set(s, t)
      if (allTypes) {
        let set = allTypes.get(s)
        if (!set) { set = new Set(); allTypes.set(s, set) }
        set.add(t)
      }
    }
  }

  // Label: gather every (predicate, value) row, then per subject take the value of
  // the HIGHEST-PRECEDENCE predicate (LABEL_PREDICATES order), then the best
  // language — the client-side equivalent of the old COALESCE precedence.
  const rank = new Map(LABEL_PREDICATES.map((p, i) => [p, i]))
  const cands = new Map<string, { p: string; v: string; lang?: string }[]>()
  for (const arr of labelB) for (const b of arr) {
    const s = b.s?.value, p = b.p?.value, l = b.l
    if (!s || !p || !l?.value) continue
    const c = { p, v: l.value, lang: l['xml:lang'] }
    const arr = cands.get(s); if (arr) arr.push(c); else cands.set(s, [c])
  }
  for (const [s, arr] of cands) {
    if (labelMap.has(s)) continue // respect caller pre-seed
    const best = Math.min(...arr.map(c => rank.get(c.p) ?? 99))
    const pick = pickByLangs(arr.filter(c => (rank.get(c.p) ?? 99) === best).map(c => ({ v: c.v, lang: c.lang })), langs)
    if (pick) labelMap.set(s, pick.v)
  }

  // SKOS-XL: override with the best-language literalForm per subject (a Concept
  // labelled skosxl:prefLabel → its English literalForm, not a UUID or arbitrary
  // language). Its reified shape can't carry the language FILTER server-side, so
  // it's a separate query picked client-side here — and it WINS over the above.
  const xlBySubj = new Map<string, { v: string; lang?: string }[]>()
  for (const b of skosxlB) {
    const s = b.s?.value, lf = b.lf
    if (!s || !lf?.value) continue
    const arr = xlBySubj.get(s) ?? []
    arr.push({ v: lf.value, lang: lf['xml:lang'] })
    xlBySubj.set(s, arr)
  }
  for (const [s, cands] of xlBySubj) {
    const best = pickByLangs(cands, langs)
    if (best) labelMap.set(s, best.v)
  }
}

export async function composeLabels(
  endpoint: SPARQLEndpoint,
  labelMap: Map<string, string>,
  typeMap: Map<string, string>,
  typeConfig: ReturnType<typeof useTypeConfigStore>,
  langs: string[],
  /** The resource currently being viewed. A label field whose value IS this
   *  resource is dropped from the composed label — so on an Organisation's page
   *  its roles read "role · project", not the redundant "thisOrg · role". Pass ''
   *  where there is no single subject (an instance list). */
  selfUri: string,
  isCurrent: () => boolean,
): Promise<void> {
  const composeType = new Map<string, string>() // subject → its label-configured type
  for (const [s, t] of typeMap) if ((typeConfig.get(t).label?.length ?? 0) > 0) composeType.set(s, t)
  if (!composeType.size) return

  // s → p → ALL values [{v, uri, lang}] (kept so we pick by language), across hops.
  const valByS = new Map<string, Map<string, { v: string; uri: boolean; lang?: string }[]>>()
  let frontier = [...composeType.keys()] // subjects whose fields we still need
  for (let hop = 0; hop < MAX_LABEL_HOPS && frontier.length; hop++) {
    const preds = [...new Set(frontier.flatMap(s => typeConfig.get(composeType.get(s)!).label ?? []))]
    if (!preds.length) break
    const vBindings = await fetchValues(endpoint, frontier, u => buildValuesQuery(u, preds))
    if (!isCurrent()) return
    const targets = new Set<string>()
    for (const b of vBindings) {
      const s = b.s?.value, p = b.p?.value, o = b.v
      if (!s || !p || !o?.value) continue
      let m = valByS.get(s)
      if (!m) { m = new Map(); valByS.set(s, m) }
      const arr = m.get(p) ?? []
      arr.push({ v: o.value, uri: o.type === 'uri', lang: o['xml:lang'] })
      m.set(p, arr)
      if (o.type === 'uri') targets.add(o.value)
    }
    // Fetch label + type for referents we don't know yet, so a URI field resolves
    // to a real label — and a referent that is ITSELF label-configured becomes the
    // next hop. Route through resolveLabels (same batched/WAF-safe path).
    const unknown = [...targets].filter(u => !labelMap.has(u) || !typeMap.has(u))
    if (unknown.length) {
      await resolveLabels(endpoint, unknown, langs, labelMap, typeMap, isCurrent)
      if (!isCurrent()) return
    }
    const next: string[] = []
    for (const u of targets) {
      const t = typeMap.get(u)
      if (t && (typeConfig.get(t).label?.length ?? 0) > 0 && !composeType.has(u)) {
        composeType.set(u, t)
        next.push(u)
      }
    }
    frontier = next
  }

  const pickByLang = <T extends { lang?: string }>(cands: T[]): T | undefined => pickByLangs(cands, langs)
  // labelLang carries each subject's chosen language so referrers select consistently.
  const labelLang = new Map<string, string | undefined>()
  const resolve = (s: string, p: string): { v: string; lang?: string } | undefined => {
    const arr = valByS.get(s)?.get(p)
    if (!arr?.length) return undefined
    const lits = arr.filter(x => !x.uri)
    if (lits.length) return pickByLang(lits.map(x => ({ v: x.v, lang: x.lang })))
    // URI fields: drop the self-reference (never repeat the viewed resource), then
    // emit a referent's label when it HAS one — a composed-label type (role → org)
    // OR a plainly-named entity (a Concept's prefLabel: "NVR Vehicle ID"). The old
    // rule required composeType, which assumed URI label fields only point at
    // composed entities — wrong for a plain Concept referent, dropping it so the
    // parent's label lost that part. R17's concern (an opaque raw rdfs:label, e.g. a
    // UUID, polluting headings/links) is kept via isOpaqueLabel; composed-label
    // referents bypass it (their label is already the clean composed one).
    const targets = arr
      .filter(x => x.v !== selfUri && labelMap.has(x.v) && (composeType.has(x.v) || !isOpaqueLabel(labelMap.get(x.v)!)))
      .map(x => ({ v: labelMap.get(x.v)!, lang: labelLang.get(x.v) }))
    return targets.length ? pickByLang(targets) : undefined
  }
  // Resolve bottom-up: enough passes for the deepest chain to settle (payment ← role ← org).
  for (let pass = 0; pass < MAX_LABEL_HOPS; pass++) {
    for (const [s, t] of composeType) {
      const preds = typeConfig.get(t).label ?? []
      const grp = new Set(typeConfig.get(t).number ?? [])
      const parts = preds
        .map(p => ({ p, r: resolve(s, p) }))
        .filter((x): x is { p: string; r: { v: string; lang?: string } } => !!x.r?.v)
      if (parts.length) {
        labelMap.set(s, parts.map(({ p, r }) => formatLiteral(r.v, grp.has(p))).join(' · '))
        labelLang.set(s, parts[0]!.r.lang)
      }
    }
  }
}

/** One field's fetched values for a subject: literal or URI, with language. */
export interface FieldValue { v: string; uri: boolean; lang?: string }

/**
 * Compose a label for ONE subject from `fields` (the compose half of
 * composeViaLabels, pure so it's unit-tested apart from the network): a literal
 * field picks the best-language value; a URI field resolves to the referent's
 * label (from `labelMap`), dropping the self-reference. Joined by ' · ', missing
 * fields skipped. Unlike composeLabels' walk, ANY referent that HAS a label is
 * emitted (not only composed-label types) — a via-label points wherever the
 * author says, so a plain-named Organisation must resolve.
 */
export function composeParts(
  fields: string[],
  valuesByField: Map<string, FieldValue[]>,
  labelMap: Map<string, string>,
  langs: string[],
  selfUri: string,
  /** Fields whose numeric value is grouped with thousands separators (the
   *  object type's TypeConfig.number). Default none. */
  groupFields: Set<string> = new Set(),
): string {
  const parts: string[] = []
  for (const f of fields) {
    const arr = valuesByField.get(f)
    if (!arr?.length) continue
    const lits = arr.filter(x => !x.uri)
    if (lits.length) {
      const pick = pickByLangs(lits.map(x => ({ v: x.v, lang: x.lang })), langs)
      if (pick?.v) parts.push(formatLiteral(pick.v, groupFields.has(f)))
      continue
    }
    // URI field: the referent's label, or — since the author explicitly chose this
    // field — the URI itself when it has none (foaf:page → a homepage URL is a
    // locator, not a labelled entity). Self-reference dropped. (composeLabels stays
    // conservative here to avoid UUIDs in the canonical label; via-labels are
    // author-directed, so showing the chosen value is the intent.)
    const ref = arr.find(x => x.v !== selfUri)
    if (ref) parts.push(labelMap.get(ref.v) ?? ref.v)
  }
  return parts.join(' · ')
}

/**
 * Contextual object labels (TypeConfig.viaLabels): a SUBJECT type overrides how
 * its object under a given predicate is labelled, so a shared node reads
 * differently by direction — e.g. on a Grant, `hasBeneficiary` → [roleLabel,
 * isRoleOf] shows "Coordinator · ACME", while that same OrganisationRole's own
 * page leads with its project. Returns predicate → (objectURI → composed label);
 * only LINKED objects consult it (embeds render their properties). Kept separate
 * from composeLabels: it's a single hop off the viewed resource, and its compose
 * rule (composeParts) is deliberately more permissive about referents.
 */
/**
 * Which of `uris` are deprecated (assert a deprecation predicate = `true`), added
 * to `deprecatedSet` in place. Batched + WAF-safe like resolveLabels. Separate,
 * cheap query so links / instance rows / the heading can all badge consistently.
 */
export async function resolveDeprecated(
  endpoint: SPARQLEndpoint,
  uris: string[],
  predicates: readonly string[],
  deprecatedSet: Set<string>,
  isCurrent: () => boolean,
): Promise<void> {
  if (!uris.length || !predicates.length) return
  const rows = await fetchValues(endpoint, uris, u => buildDeprecatedQuery(u, predicates))
  if (!isCurrent()) return
  for (const b of rows) { const s = b.s?.value; if (s) deprecatedSet.add(s) }
}

export async function composeViaLabels(
  endpoint: SPARQLEndpoint,
  sourceType: string | null,
  groups: { predicate: string; objects: { value: string; termType: string }[] }[],
  labelMap: Map<string, string>,
  typeMap: Map<string, string>,
  typeConfig: ReturnType<typeof useTypeConfigStore>,
  langs: string[],
  selfUri: string,
  isCurrent: () => boolean,
): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>()
  const via = sourceType ? typeConfig.get(sourceType).viaLabels : undefined
  if (!via || !Object.keys(via).length) return out

  // Requests: each configured predicate present on this resource → its fields +
  // the URI objects reached through it.
  const requests: { predicate: string; fields: string[]; objects: string[] }[] = []
  for (const g of groups) {
    const fields = via[g.predicate]
    if (!fields?.length) continue
    const objects = g.objects.filter(o => o.termType === 'uri').map(o => o.value)
    if (objects.length) requests.push({ predicate: g.predicate, fields, objects })
  }
  if (!requests.length) return out

  const allObjects = [...new Set(requests.flatMap(r => r.objects))]
  const allFields = [...new Set(requests.flatMap(r => r.fields))]
  const bindings = await fetchValues(endpoint, allObjects, u => buildValuesQuery(u, allFields))
  if (!isCurrent()) return out

  const valByS = new Map<string, Map<string, FieldValue[]>>()
  const refTargets = new Set<string>()
  for (const b of bindings) {
    const s = b.s?.value, p = b.p?.value, o = b.v
    if (!s || !p || !o?.value) continue
    let m = valByS.get(s); if (!m) { m = new Map(); valByS.set(s, m) }
    const arr = m.get(p) ?? []
    arr.push({ v: o.value, uri: o.type === 'uri', lang: o['xml:lang'] })
    m.set(p, arr)
    if (o.type === 'uri' && o.value !== selfUri) refTargets.add(o.value)
  }
  // Resolve labels for URI-field referents we don't already know (isRoleOf → org).
  const unknown = [...refTargets].filter(u => !labelMap.has(u))
  if (unknown.length) {
    await resolveLabels(endpoint, unknown, langs, labelMap, typeMap, isCurrent)
    if (!isCurrent()) return out
  }

  for (const r of requests) {
    const m = new Map<string, string>()
    for (const obj of r.objects) {
      // Group the object type's ticked numeric fields (TypeConfig.number).
      const ot = typeMap.get(obj)
      const groupFields = new Set(ot ? typeConfig.get(ot).number ?? [] : [])
      const label = composeParts(r.fields, valByS.get(obj) ?? new Map(), labelMap, langs, selfUri, groupFields)
      if (label) m.set(obj, label)
    }
    if (m.size) out.set(r.predicate, m)
  }
  return out
}
