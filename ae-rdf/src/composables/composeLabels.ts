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
import { executeSparql, buildValuesQuery, buildLabelValuesQuery, buildTypeQuery, buildSkosxlLabelsQuery, LABEL_PREDICATES, LABEL_PREDICATE_BATCH } from '../services'
import { useTypeConfigStore } from '../stores'
import { pickByLangs } from '../utils/labelLang'
import type { SPARQLEndpoint } from '../types/endpoint'

// ponytail: cap the label graph walk at 3 hops (payment→role→org is 2).
const MAX_LABEL_HOPS = 3

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
  // than one query with COALESCE over all 6 — a cumulative-anomaly WAF (Fedlex)
  // blocks a request carrying ≥6 external vocab URLs, whether via OPTIONAL or
  // VALUES. Type and SKOS-XL are separate queries. Precedence + language are
  // picked HERE, client-side, preserving the LABEL_PREDICATES order (never an
  // arbitrary SAMPLE). All queries run in parallel.
  const batches: string[][] = []
  for (let i = 0; i < LABEL_PREDICATES.length; i += LABEL_PREDICATE_BATCH)
    batches.push(LABEL_PREDICATES.slice(i, i + LABEL_PREDICATE_BATCH))
  const skosxlQ = buildSkosxlLabelsQuery(uris)
  const run = (q: string) => (q ? executeSparql(endpoint, q, { retries: 1 }).catch(() => null) : Promise.resolve(null))
  const [typeRes, skosxlRes, ...labelRes] = await Promise.all([
    run(buildTypeQuery(uris)),
    run(skosxlQ),
    ...batches.map(b => run(buildLabelValuesQuery(uris, b))),
  ])
  if (!isCurrent()) return

  // Most-specific type per subject: typeMap keeps ONE (badge/label, don't clobber
  // a caller pre-seed); allTypes (if provided) keeps ALL for the embed decision.
  for (const b of typeRes?.results.bindings ?? []) {
    const s = b.s?.value, t = b.t?.value
    if (!s || !t) continue
    if (!typeMap.has(s)) typeMap.set(s, t)
    if (allTypes) {
      let set = allTypes.get(s)
      if (!set) { set = new Set(); allTypes.set(s, set) }
      set.add(t)
    }
  }

  // Label: gather every (predicate, value) row, then per subject take the value of
  // the HIGHEST-PRECEDENCE predicate (LABEL_PREDICATES order), then the best
  // language — the client-side equivalent of the old COALESCE precedence.
  const rank = new Map(LABEL_PREDICATES.map((p, i) => [p, i]))
  const cands = new Map<string, { p: string; v: string; lang?: string }[]>()
  for (const res of labelRes) for (const b of res?.results.bindings ?? []) {
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
  for (const b of skosxlRes?.results.bindings ?? []) {
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
    const q = buildValuesQuery(frontier, preds)
    if (!q) break
    const vr = await executeSparql(endpoint, q, { retries: 1 }).catch(() => null)
    if (!isCurrent()) return
    const targets = new Set<string>()
    for (const b of vr?.results.bindings ?? []) {
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
    // URI fields: drop the self-reference (never repeat the viewed resource), and
    // only emit targets that are THEMSELVES a composed-label type. `labelMap.has`
    // alone let through a referent whose only label is an opaque raw rdfs:label
    // (e.g. a UUID) with no composed type — surfacing UUIDs in headings/links.
    // URI label fields are configured to point at composed entities (role → org,
    // role → project); a non-composed referent renders as a link, not inlined.
    const targets = arr
      .filter(x => x.v !== selfUri && composeType.has(x.v) && labelMap.has(x.v))
      .map(x => ({ v: labelMap.get(x.v)!, lang: labelLang.get(x.v) }))
    return targets.length ? pickByLang(targets) : undefined
  }
  // Resolve bottom-up: enough passes for the deepest chain to settle (payment ← role ← org).
  for (let pass = 0; pass < MAX_LABEL_HOPS; pass++) {
    for (const [s, t] of composeType) {
      const preds = typeConfig.get(t).label ?? []
      const parts = preds.map(p => resolve(s, p)).filter((c): c is { v: string; lang?: string } => !!c?.v)
      if (parts.length) {
        labelMap.set(s, parts.map(c => c.v).join(' · '))
        labelLang.set(s, parts[0]!.lang)
      }
    }
  }
}
