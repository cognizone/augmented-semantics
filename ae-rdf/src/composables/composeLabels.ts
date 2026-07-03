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
 * label path routes through this so buildLabelsQuery (standard predicates only)
 * is just the seed, never the final answer — otherwise composed-label types with
 * no standard label (a Grant) show their UUID, and types with a verbose raw
 * rdfs:label (an OrganisationRole) show that instead of the clean composed label.
 *
 * @see /spec/ae-rdf
 */
import { executeSparql, buildValuesQuery, buildLabelsQuery } from '../services'
import { useTypeConfigStore } from '../stores'
import { pickByLangs } from '../utils/labelLang'
import type { SPARQLEndpoint } from '../types/endpoint'

// ponytail: cap the label graph walk at 3 hops (payment→role→org is 2).
const MAX_LABEL_HOPS = 3

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
    // next hop.
    const unknown = [...targets].filter(u => !labelMap.has(u) || !typeMap.has(u))
    if (unknown.length) {
      const tr = await executeSparql(endpoint, buildLabelsQuery(unknown), { retries: 1 }).catch(() => null)
      if (!isCurrent()) return
      for (const b of tr?.results.bindings ?? []) {
        const s = b.s?.value
        if (!s) continue
        if (b.label?.value && !labelMap.has(s)) labelMap.set(s, b.label.value)
        if (b.type?.value && !typeMap.has(s)) typeMap.set(s, b.type.value)
      }
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
    // only emit targets whose label is known — never a raw UUID (which would
    // clobber a generic/SKOS-XL label resolved elsewhere).
    const targets = arr
      .filter(x => x.v !== selfUri && labelMap.has(x.v))
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
