/**
 * RDF query builders for the live browser. Pure functions returning SPARQL.
 *
 * Graph model (the source of truth is /spec/ae-rdf/rdf-overview.md "Graph model"):
 * every builder takes a GraphStrategy derived from the endpoint's two axes
 * (quads, defaultView) via resolveGraphStrategy. Cross-graph duplicates are
 * removed by folding (p,o) client-side or COUNT(DISTINCT ?s)/GROUP BY ?s — never
 * by ad-hoc SELECT DISTINCT.
 *
 * @see /spec/ae-rdf/rdf-overview.md
 */
import { validateURI } from './security'
import type { EndpointGraph, TypeConfig, TypeProfile } from '../types'

/**
 * Label predicates in display precedence (highest first). General RDF has no
 * single label predicate, so labels are resolved by trying these in order.
 */
export const LABEL_PREDICATES: readonly string[] = [
  'http://www.w3.org/2000/01/rdf-schema#label',
  'http://www.w3.org/2004/02/skos/core#prefLabel',
  'http://purl.org/dc/terms/title',
  'http://purl.org/dc/elements/1.1/title',
  // ponytail: dropped foaf:name / schema:name — lowest precedence, and Fedlex's
  // WAF blocks that vocab pair anyway. Re-add PER ENDPOINT via the config's
  // `extraLabelPredicates` (labelPredicatesFor) when an endpoint labels only via them.
]

/** Effective label predicates for an endpoint: the built-in precedence plus any
 *  `extraLabelPredicates` from config, appended at lowest precedence. Keeps the
 *  default set lean (Fedlex WAF) while letting e.g. LINDAS opt into foaf:name. */
export function labelPredicatesFor(endpoint: { extraLabelPredicates?: string[] }): readonly string[] {
  const extra = endpoint.extraLabelPredicates
  return extra?.length ? [...LABEL_PREDICATES, ...extra] : LABEL_PREDICATES
}

// SKOS-XL reifies labels: ?s skosxl:prefLabel ?label . ?label skosxl:literalForm "…".
// The text is one hop away, so generic label resolution must follow it.
const SKOSXL_PREFLABEL = 'http://www.w3.org/2008/05/skos-xl#prefLabel'
const SKOSXL_LITERALFORM = 'http://www.w3.org/2008/05/skos-xl#literalForm'

// Characters that must never appear unescaped inside a SPARQL <IRI> — guards
// against query injection via a crafted resource URI.
const UNSAFE_IRI = /[\s<>"{}|\\^`]/

/**
 * Validate and return a safe IRI for interpolation into `<...>`.
 * Throws on dangerous protocols (javascript:, data:, ...) or unsafe characters.
 */
export function sanitizeIri(uri: string): string {
  const validated = validateURI(uri)
  if (!validated || UNSAFE_IRI.test(validated)) {
    throw new Error(`Unsafe or invalid IRI: ${uri}`)
  }
  return validated
}

/** Whether an IRI is safe to use as a navigation target / query subject. */
export function isNavigableIri(uri: string): boolean {
  try {
    sanitizeIri(uri)
    return true
  } catch {
    return false
  }
}

/**
 * Escape a user string for safe interpolation inside a SPARQL `"..."` literal.
 * Backslash FIRST, then the quote and control chars — an unescaped `"` or `\`
 * in a filter term would otherwise break out of the literal or inject query
 * syntax (the string-literal counterpart to sanitizeIri for `<...>`).
 */
export function sparqlString(term: string): string {
  return term
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

/**
 * A `<iri>`-per-term VALUES fragment: each IRI sanitized (trimmed + validated),
 * unsafe ones dropped, capped at `cap`. Sanitizing AT the interpolation point is
 * the fix for R29 — `filter(isNavigableIri).map(u => `<${u}>`)` validated the
 * trimmed form but emitted the RAW one, so a whitespace-padded URI passed the
 * guard yet produced a malformed `<  iri  >` that 400s the whole query.
 */
function iriValues(uris: readonly string[], cap = Infinity): string {
  const out: string[] = []
  for (const u of uris) {
    let safe: string
    try { safe = sanitizeIri(u) } catch { continue }
    out.push(`<${safe}>`)
    if (out.length >= cap) break
  }
  return out.join(' ')
}

/* ───────────────────────── Graph strategy ───────────────────────── */

/** Which graph scopes a query should touch, derived from the endpoint axes. */
export interface GraphStrategy {
  /** Query named graphs (`GRAPH ?g { … }`). */
  useNamed: boolean
  /** Query the explicit default (no-GRAPH) view. */
  useDefault: boolean
}

/**
 * Resolve the query strategy from an endpoint's two graph axes.
 *
 *   useNamed   = quads !== false        (query named graphs unless we KNOW there are none)
 *   useDefault = quads === false  ||  defaultView !== 'merged'
 *
 * Cases:
 * - quads false (triple store)      → { named:false, default:true }  plain.
 * - quads true,  defaultView merged → { named:true,  default:false } GRAPH only — the
 *   default view is a redundant, bag-y merge of the quads, so never query it.
 * - quads true,  defaultView own    → { named:true,  default:true }  GRAPH ∪ default.
 * - anything unknown                → safe superset (query both; folding (p,o)
 *   dedups any merge artefacts, so it's correct, just not optimised).
 */
export function resolveGraphStrategy(graph?: EndpointGraph): GraphStrategy {
  const quads = graph?.quads
  return {
    useNamed: quads !== false,
    useDefault: quads === false || graph?.defaultView !== 'merged',
  }
}

/** `?s a <TYPE>` (or `?s a ?type`) scoped per strategy, for the aggregate queries. */
function membership(typeTerm: string, s: GraphStrategy): string {
  const named = `GRAPH ?g { ?s a ${typeTerm} . }`
  const def = `?s a ${typeTerm} .`
  if (s.useNamed && s.useDefault) return `{ ${named} } UNION { ${def} }`
  return s.useNamed ? named : def
}

/**
 * Scope an arbitrary triple pattern per strategy, using a caller-supplied graph
 * var so it can sit next to the type-membership pattern without colliding on ?g
 * (a resource's label may live in a different named graph than its type triple).
 */
function scoped(body: string, s: GraphStrategy, gvar: string): string {
  const named = `GRAPH ${gvar} { ${body} }`
  if (s.useNamed && s.useDefault) return `{ ${named} } UNION { ${body} }`
  return s.useNamed ? named : body
}

/**
 * WHERE body for a type's instances, optionally narrowed to those whose URI OR
 * any `predicates` label CONTAINS `filter` (case-insensitive, both sides LCASE'd).
 * Shared by the list and count builders so they scope IDENTICALLY — a filtered
 * list paged against an unfiltered count would run past a wrong total.
 *
 * `predicates` defaults to the 6 LABEL_PREDICATES; callers pass the union with a
 * type's configured label fields so search matches the curator's chosen name
 * field (e.g. Cordis `s66#title`, which isn't one of the 6). Config-sourced, so
 * sanitized here.
 *
 * `isLiteral(?lbl)` — match only a field's DIRECT literal value. A composed label
 * predicate (a URI hop, e.g. Grant→funds) yields a URI here and is dropped, so
 * adding such a predicate is inert until multi-hop resolution exists. The label
 * test is an EXISTS (not a join) so several matching labels still count once;
 * URI matching keeps unlabeled resources findable.
 * ponytail: no SKOS-XL reified labels and no multi-hop composed labels — direct
 * literals + URI only, to start with.
 */
function instanceMatch(iri: string, s: GraphStrategy, filter?: string, predicates: readonly string[] = LABEL_PREDICATES, orphanVia?: string, facetConstraint?: string): string {
  const base = membership(`<${iri}>`, s)
  const term = (filter ?? '').trim().slice(0, 200)
  let core: string
  if (!term) {
    core = base
  } else {
    // AND-of-tokens: every whitespace-separated word must appear (any order) in the
    // SAME value. Matches "all my words" intent, and — unlike a contiguous phrase —
    // usually HAS hits, so LIMIT can stop early instead of scanning the whole type.
    const tokens = term.split(/\s+/).filter(Boolean).map(sparqlString)
    const allContain = (v: string) => tokens.map(t => `CONTAINS(LCASE(STR(${v})), LCASE("${t}"))`).join(' && ')
    const preds = predicates.filter(isNavigableIri)
    // iriValues sanitizes at the interpolation point (R29) — a whitespace-padded
    // configured predicate passed isNavigableIri but would emit a malformed `<  p  >`.
    const labelValues = iriValues(preds.length ? preds : LABEL_PREDICATES)
    // JOIN, not correlated EXISTS: lets the planner drive from the selective label
    // match rather than re-testing every instance of the type (measured ~3× faster
    // on a 700k-instance type). DISTINCT ?s (in the caller) collapses a resource
    // with several matching labels. isLiteral drops composed URI-hop fields; the URI
    // branch keeps unlabeled resources findable.
    const labelBranch = `{ ${base} VALUES ?lp { ${labelValues} } ${scoped('?s ?lp ?lbl .', s, '?lg')} FILTER(isLiteral(?lbl) && ${allContain('?lbl')}) }`
    const uriBranch = `{ ${base} FILTER(${allContain('?s')}) }`
    core = `${labelBranch} UNION ${uriBranch}`
  }
  // Orphan filter: keep only instances with NO owner via the embed's owning
  // predicate — the ones that surface ONLY in this list, never inline under a
  // parent. Wraps the (possibly union) core so the FILTER applies to every branch.
  if (orphanVia && isNavigableIri(orphanVia)) {
    core = `{ ${core} } FILTER NOT EXISTS { ${scoped(`?owner <${sanitizeIri(orphanVia)}> ?s .`, s, '?og')} }`
  }
  // Facet selections (buildFacetConstraints) narrow ?s further — self-contained
  // braced groups, so they concatenate next to core with AND semantics. Empty when
  // nothing is selected. In instanceMatch so the list and count share IDENTICALLY.
  const facet = facetConstraint ? ` ${facetConstraint}` : ''
  // Blank-node instances have no standalone view — they're only ever reached inline
  // via a parent (see useResourceView's bnode pass). Drop them from the navigable
  // index so a mixed type (some named, some bnode instances — e.g. owl:Class,
  // foaf:Document) doesn't list anonymous rows that navigate to a broken resource.
  // In instanceMatch so the list and count filter IDENTICALLY.
  return `${core}${facet} FILTER(!isBlank(?s))`
}

/* ───────────────────────── Discovery / list ───────────────────────── */

/**
 * Type inventory: every rdf:type with its distinct-instance count, commonest
 * first. COUNT(DISTINCT ?s) so cross-graph multiplicity never inflates counts.
 */
export function buildTypeInventoryQuery(s: GraphStrategy): string {
  return `SELECT ?type (COUNT(DISTINCT ?s) AS ?count) WHERE { ${membership('?type', s)} } GROUP BY ?type ORDER BY DESC(?count) LIMIT 500`
}

/**
 * Which predicates the instance-list text filter matches for a type, in
 * precedence:
 *   1. explicit `search` config — the curator's exact choice;
 *   2. `label` fields — search what NAMES the type (and skips the default-set
 *      redundancy, e.g. Cordis `label:[title]` when title == rdfs:label);
 *   3. the 6 defaults, trimmed to a COMPLETE profile's present predicates — a
 *      sampled profile may omit a real one, so it isn't trusted to trim.
 * Values are matched literally (isLiteral) at query time, so a composed URI-hop
 * field listed here is simply inert. Result feeds buildInstance*Query's
 * `predicates` (which sanitizes).
 */
export function resolveSearchPredicates(cfg: TypeConfig, profile?: TypeProfile): readonly string[] {
  if (cfg.search?.length) return cfg.search
  if (cfg.label?.length) return cfg.label
  if (profile?.ok && !profile.sampled) {
    const present = new Set(profile.properties.map(p => p.uri))
    const trimmed = LABEL_PREDICATES.filter(p => present.has(p))
    if (trimmed.length) return trimmed
  }
  return LABEL_PREDICATES
}

/** Total distinct instances of a type (instance-list header / paging), optionally
 *  narrowed by the same label/URI filter (and predicate set) the list uses. */
export function buildInstanceCountQuery(typeUri: string, s: GraphStrategy, filter?: string, predicates?: readonly string[], orphanVia?: string, facetConstraint?: string): string {
  const iri = sanitizeIri(typeUri)
  return `SELECT (COUNT(DISTINCT ?s) AS ?total) WHERE { ${instanceMatch(iri, s, filter, predicates, orphanVia, facetConstraint)} }`
}

/**
 * One page of DISTINCT instances of a type (the ?s only). Labels are resolved
 * SEPARATELY by the caller via the canonical resolver (resolveLabels →
 * buildLabelValuesQuery precedence + SKOS-XL + language pick), on the bounded page of
 * ~25 URIs — so the instance-list label matches the detail-heading label for the
 * same resource. Resolving labels here hand-rolled a 3-of-6-predicate subset with
 * no SKOS-XL / language, which drifted from the heading (e.g. foaf:name-only
 * resources fell back to the raw URI).
 *
 * No ORDER BY: sorting forces a full materialize + sort before LIMIT can apply.
 * We take the engine's natural order; this is a navigation index, not a report
 * (so paging is by the engine's order, not a stable key — acceptable here).
 */
export function buildInstanceListQuery(typeUri: string, s: GraphStrategy, limit = 100, offset = 0, filter?: string, predicates?: readonly string[], orphanVia?: string, facetConstraint?: string): string {
  const iri = sanitizeIri(typeUri)
  const lim = Math.max(1, Math.floor(limit))
  const off = Math.max(0, Math.floor(offset))
  return `SELECT DISTINCT ?s WHERE { ${instanceMatch(iri, s, filter, predicates, orphanVia, facetConstraint)} } LIMIT ${lim} OFFSET ${off}`
}

/**
 * One value per (instance, column) for a page of instances — powers the instance
 * list's extra columns. Each column is an OPTIONAL graph-scoped path (direct or
 * `via` multi-hop, reusing facetPath), SAMPLE'd under GROUP BY ?s so a subject
 * yields at most one row and one value per column (columns target near-functional
 * properties). Result vars: ?s plus ?v{i} per column (missing when that column's
 * predicate/via is unsafe — its OPTIONAL is dropped, so the cell is just empty).
 * Returns '' when no uris or no safe columns (caller then renders the plain list).
 */
export function buildInstanceColumnsQuery(
  uris: string[],
  columns: { predicate: string; via?: string | string[] }[],
  s: GraphStrategy,
): string {
  const values = uris.map(u => { try { return `<${sanitizeIri(u)}>` } catch { return '' } }).filter(Boolean).join(' ')
  const cols = columns.map((c, i) => {
    let pred: string
    try { pred = sanitizeIri(c.predicate) } catch { return null }
    const path = facetPath('?s', pred, c.via, `?c${i}`, s, `?cg${i}`)
    return path ? { sel: `(SAMPLE(?c${i}) AS ?v${i})`, opt: `OPTIONAL { ${path} }` } : null
  }).filter((x): x is { sel: string; opt: string } => !!x)
  if (!values || !cols.length) return ''
  return `SELECT ?s ${cols.map(c => c.sel).join(' ')} WHERE { VALUES ?s { ${values} } ${cols.map(c => c.opt).join(' ')} } GROUP BY ?s`
}

/* ───────────────────────── Faceted browsing ───────────────────────── */

/** Full IRI cast so the range FILTER needs no `xsd:` prefix declaration. */
const XSD_DECIMAL = '<http://www.w3.org/2001/XMLSchema#decimal>'
const XSD_DATE = '<http://www.w3.org/2001/XMLSchema#date>'

/** One selected value of a VALUE facet — a URI object, or a literal with its
 *  datatype/language preserved so the constraint matches the exact stored term. */
export interface FacetValueTerm {
  value: string
  /** True → interpolate as `<uri>`; false → a `"literal"` (with datatype/lang). */
  isUri: boolean
  /** Datatype IRI for a typed literal (ignored when `lang` is set or `isUri`). */
  datatype?: string
  /** Language tag for a lang-tagged literal (wins over `datatype`). */
  lang?: string
}

/** A VALUE facet's current selection: the property + the chosen terms (OR'd). */
export interface FacetValueSelection {
  predicate: string
  terms: FacetValueTerm[]
  /** Hop predicate(s) to the value (see FacetConfig.via). */
  via?: string | string[]
}

/** A RANGE facet's current selection: the property + the chosen bands (OR'd). */
export interface FacetRangeSelection {
  predicate: string
  ranges: { min?: number; max?: number; missing?: boolean }[]
  /** Hop predicate(s) to the value (see FacetConfig.via). */
  via?: string | string[]
  /** `date` → bands are YEARs compared as xsd:date; else numeric (decimal cast). */
  datatype?: 'date'
}

export type FacetSelection = FacetValueSelection | FacetRangeSelection

const isRangeSelection = (s: FacetSelection): s is FacetRangeSelection =>
  Array.isArray((s as FacetRangeSelection).ranges)

/** Serialize one facet value term for a VALUES list, or '' when the URI is unsafe
 *  (dropped rather than throwing the whole query). Literals are escaped; a
 *  lang-tag/datatype is appended when known and safe. */
function renderFacetTerm(t: FacetValueTerm): string {
  if (t.isUri) {
    try { return `<${sanitizeIri(t.value)}>` } catch { return '' }
  }
  const lit = `"${sparqlString(t.value)}"`
  if (t.lang && /^[a-zA-Z]+(-[a-zA-Z0-9]+)*$/.test(t.lang)) return `${lit}@${t.lang}`
  if (t.datatype) {
    try { return `${lit}^^<${sanitizeIri(t.datatype)}>` } catch { return lit }
  }
  return lit
}

/** `min <= v < max` as a SPARQL condition (either bound optional). Numeric by
 *  default (decimal cast, so a string like "1499837" compares numerically); when
 *  `date`, min/max are YEARs compared as xsd:date (`>= "Y-01-01"`, `< "Y-01-01"`).
 *  ponytail: date granularity is whole years — finer bands would need real dates. */
function rangeCond(v: string, r: { min?: number; max?: number }, date = false): string {
  const c: string[] = []
  const lhs = date ? v : `${XSD_DECIMAL}(${v})`
  const bound = (n: number) => (date ? `"${Math.trunc(n)}-01-01"^^${XSD_DATE}` : `${n}`)
  if (Number.isFinite(r.min)) c.push(`${lhs} >= ${bound(r.min!)}`)
  if (Number.isFinite(r.max)) c.push(`${lhs} < ${bound(r.max!)}`)
  return c.length ? c.join(' && ') : 'true'
}

/** Graph-scoped pattern(s) binding `valueVar` to the facet value of `subj`: the
 *  direct object of `pred` (`?s <pred> ?v`), or N nodes further when `via` names a
 *  path of predicates (`?s <pred> ?m0 . ?m0 <via0> ?m1 . … . ?mk <viaK> ?v`). `via`
 *  may be a single predicate or an ordered array (a walk to a value that lives
 *  several hops away, e.g. Organisation hasSite→hasAddress→addressCountry). Each
 *  triple is scoped() per strategy with its own graph var. Returns null when any via
 *  hop is unsafe — the caller then skips the whole facet rather than silently
 *  faceting on an intermediate node. `pred` is pre-sanitized by callers; via hops are
 *  sanitized here. */
function facetPath(subj: string, pred: string, via: string | string[] | undefined, valueVar: string, s: GraphStrategy, gvar: string): string | null {
  const hops = via == null ? [] : (Array.isArray(via) ? via : [via])
  if (!hops.length) return scoped(`${subj} <${pred}> ${valueVar} .`, s, gvar)
  const preds = [pred] // pred is caller-sanitized; via hops sanitized below
  for (const h of hops) {
    if (!isNavigableIri(h)) return null
    try { preds.push(sanitizeIri(h)) } catch { return null }
  }
  // Intermediate hop vars derive from gvar (always a ?var) — never valueVar, which
  // may be an inlined term (`<uri>`/literal) for a single-value facet.
  const parts: string[] = []
  let cur = subj
  preds.forEach((p, i) => {
    const next = i === preds.length - 1 ? valueVar : `${gvar}_m${i}`
    parts.push(scoped(`${cur} <${p}> ${next} .`, s, `${gvar}${String.fromCharCode(97 + i)}`))
    cur = next
  })
  return parts.join(' ')
}

/**
 * Serialize the current facet selections into SPARQL patterns that narrow `?s`.
 * ACROSS facets the fragments concatenate = AND; WITHIN a facet, multi-select = OR
 * (a VALUES list of terms, or `||`'d range bands). Each fragment is a self-contained
 * braced group with its OWN value/graph var (`?fN` / `?fgN`) so several facets never
 * collide, and a group can be dot- or space-joined next to the membership/aggregate
 * patterns. Value terms go through renderFacetTerm (sanitized URIs, escaped literals);
 * an unsafe predicate or a facet with no safe terms is skipped. Graph scoping mirrors
 * instanceMatch (the constraint triple is `scoped()` per strategy). Returns '' when
 * nothing is selected — the caller then emits the unconstrained query.
 *
 * FACETING CORRECTNESS: this only serializes what it is given; the caller computes a
 * facet's OWN values with the other facets' selections but NOT its own (excludes the
 * self predicate), and applies ALL selections for the instance list + total.
 */
export function buildFacetConstraints(selections: FacetSelection[], s: GraphStrategy): string {
  const parts: string[] = []
  let i = 0
  for (const sel of selections) {
    if (!isNavigableIri(sel.predicate)) continue
    const pred = sanitizeIri(sel.predicate)
    const v = `?f${i}`
    if (isRangeSelection(sel)) {
      const path = facetPath('?s', pred, sel.via, v, s, `?fg${i}`)
      if (!path) continue
      const isDate = sel.datatype === 'date'
      const ranged = sel.ranges.filter(r => !r.missing)
      const wantMissing = sel.ranges.some(r => r.missing)
      if (!ranged.length && !wantMissing) continue
      if (!wantMissing) {
        // Value-in-band only: inner-join the value, OR the bands. (unchanged path)
        parts.push(`{ ${path} FILTER(${ranged.map(r => `(${rangeCond(v, r, isDate)})`).join(' || ')}) }`)
      } else {
        // A "No date" band is selected (± value bands): OPTIONAL-bind the value so
        // the constraint also matches type instances that HAVE NO value. Emitted at
        // group level (unbraced) so ?s (bound by the caller's membership/core) anchors
        // the OPTIONAL and the group FILTER — mirrors the orphanVia NOT-EXISTS pattern.
        const alts = ranged.map(r => `(BOUND(${v}) && (${rangeCond(v, r, isDate)}))`)
        alts.push(`!BOUND(${v})`)
        parts.push(`OPTIONAL { ${path} } FILTER(${alts.join(' || ')})`)
      }
    } else {
      const terms = sel.terms.map(renderFacetTerm).filter(Boolean)
      if (!terms.length) continue
      // A single value goes straight into the object position (`?s <p> <v>`); only
      // a multi-select needs a VALUES list bound to the facet var to OR the terms.
      if (terms.length === 1) {
        const path = facetPath('?s', pred, sel.via, terms[0]!, s, `?fg${i}`)
        if (!path) continue
        parts.push(`{ ${path} }`)
      } else {
        const path = facetPath('?s', pred, sel.via, v, s, `?fg${i}`)
        if (!path) continue
        parts.push(`{ VALUES ${v} { ${terms.join(' ')} } ${path} }`)
      }
    }
    i++
  }
  return parts.join(' ')
}

/**
 * A VALUE facet's values with per-value distinct-instance counts, commonest first.
 * `constraintFragment` (from buildFacetConstraints, the OTHER facets' selections)
 * narrows `?s`; membership + the value triple are graph-scoped per strategy the way
 * instanceMatch is. LIMIT is `limit + 1` so the caller detects truncation (drop the
 * extra row, show a "top N" note). COUNT(DISTINCT ?s) so cross-graph multiplicity
 * never inflates a value's count.
 */
export function buildFacetValuesQuery(
  typeUri: string,
  predicate: string,
  constraintFragment: string,
  s: GraphStrategy,
  limit = 15,
  via?: string | string[],
): string {
  const iri = sanitizeIri(typeUri)
  const pred = sanitizeIri(predicate)
  const lim = Math.max(1, Math.floor(limit)) + 1
  const frag = constraintFragment ? `${constraintFragment} ` : ''
  const valTriple = facetPath('?s', pred, via, '?v', s, '?vg') ?? 'FILTER(false)'
  return `SELECT ?v (COUNT(DISTINCT ?s) AS ?n) WHERE { ${membership(`<${iri}>`, s)} ${frag}${valTriple} } GROUP BY ?v ORDER BY DESC(?n) LIMIT ${lim}`
}

/**
 * A RANGE facet's VALUE-bucket counts in ONE query: a per-bucket `SUM(IF(cond, 1, 0))`
 * aggregate (`?b0`, `?b1`, …) over the type's (constrained) values, INNER-joined on the
 * value so the value index stays usable and the query is fast. Graph-scoped per strategy
 * like buildFacetValuesQuery.
 *
 * A "no value" (missing) bucket is NOT counted here: it needs an OPTIONAL/NOT-EXISTS
 * full-type scan that would drag EVERY bucket down to that speed. It's a SEPARATE query
 * (buildFacetMissingCountQuery) so the fast value buckets render without waiting on the
 * slow scan — callers pass only value bands here and run the missing count on the side.
 *
 * NOTE: this counts value OCCURRENCES, not distinct subjects — correct for a
 * max-1 (functional) numeric property, which is what range facets target; a
 * multi-valued property would count a subject once per value in a band.
 */
export function buildFacetRangesQuery(
  typeUri: string,
  predicate: string,
  buckets: { min?: number; max?: number }[],
  constraintFragment: string,
  s: GraphStrategy,
  via?: string | string[],
  date = false,
): string {
  const iri = sanitizeIri(typeUri)
  const pred = sanitizeIri(predicate)
  const frag = constraintFragment ? `${constraintFragment} ` : ''
  const valTriple = facetPath('?s', pred, via, '?v', s, '?vg') ?? 'FILTER(false)'
  const aggs = buckets.map((b, i) => `(SUM(IF(${rangeCond('?v', b, date)}, 1, 0)) AS ?b${i})`).join(' ')
  return `SELECT ${aggs} WHERE { ${membership(`<${iri}>`, s)} ${frag}${valTriple} }`
}

/**
 * Count of a type's instances that have NO value for a range facet's property — the
 * "no value" bucket, run SEPARATELY from the value buckets (buildFacetRangesQuery) so
 * that fast, index-friendly query renders first while this full-type scan fills in late.
 * `constraintFragment` (other facets) narrows `?s` the same way; the value path is scoped
 * per strategy and negated with a group-level NOT EXISTS (?s bound by membership —
 * mirrors the orphanVia pattern in instanceMatch). COUNT(DISTINCT ?s) counts SUBJECTS,
 * which is exactly right for "has no value at all". Returns '' when the via path is
 * unsafe (caller then leaves the bucket at 0 rather than emitting a broken query).
 */
export function buildFacetMissingCountQuery(
  typeUri: string,
  predicate: string,
  constraintFragment: string,
  s: GraphStrategy,
  via?: string | string[],
): string {
  const iri = sanitizeIri(typeUri)
  const pred = sanitizeIri(predicate)
  const valTriple = facetPath('?s', pred, via, '?v', s, '?vg')
  if (!valTriple) return ''
  const frag = constraintFragment ? `${constraintFragment} ` : ''
  return `SELECT (COUNT(DISTINCT ?s) AS ?n) WHERE { ${membership(`<${iri}>`, s)} ${frag}FILTER NOT EXISTS { ${valTriple} } }`
}

/**
 * Composition discovery: which classes embed which value-types. A class C
 * "composes" embed-type E when some instance of C has a property whose object
 * is an instance of E. Returns DISTINCT (?c, ?e) pairs — the result set is tiny
 * (embed types are few, config-driven), so no count/paging.
 *
 * Scope: when a default/merged view is queryable (useDefault) we read it plain —
 * the safe superset. Only in the never-touch-default case (merged quads) do we
 * wrap each pattern in its own GRAPH so cross-graph composition still resolves.
 * Provenance is irrelevant here — this is a structural map, not displayed triples.
 */
export function buildCompositionQuery(embedTypeUris: string[], s: GraphStrategy): string {
  const values = iriValues(embedTypeUris, 64)
  const body = s.useDefault
    ? `?o a ?e . ?s ?p ?o . ?s a ?c .`
    : `GRAPH ?ge { ?o a ?e } GRAPH ?gp { ?s ?p ?o } GRAPH ?gc { ?s a ?c }`
  // ?n = distinct embed-value instances reachable from instances of ?c, so a
  // nested embed shows a count relative to its composing class, not the global
  // type total (Acronym under PublicBody ≠ all Acronyms in the store).
  return `SELECT ?c ?e (COUNT(DISTINCT ?o) AS ?n) WHERE { VALUES ?e { ${values} } ${body} FILTER(?c != ?e) } GROUP BY ?c ?e`
}

/**
 * Incoming predicates for a type: which (predicate, source class) pairs point AT
 * instances of `typeUri`, with a distinct-target count, commonest first. Powers
 * the embed "owning predicate" picker — pick the relationship that should inline
 * this value (e.g. Grant via isFundedBy ← Project), so it isn't embedded under
 * every other type that merely references it. Same join as buildCompositionQuery,
 * just projecting the predicate and grouping by it too.
 */
/** Sample cap on the type's instances when discovering its incoming predicates.
 *  Walking every instance → every incoming edge → every owner type times out on
 *  large endpoints; a bounded sample is enough to surface the owning predicates.
 *  The count is exact when a type has ≤ this many instances, approximate above. */
export const INCOMING_PREDICATES_SAMPLE = 2000

export function buildIncomingPredicatesQuery(typeUri: string, s: GraphStrategy): string {
  const iri = sanitizeIri(typeUri)
  // Bound the scan to a sample of the type's instances (the expensive part is
  // the unbounded fan-out over every ?o), then find what points at them.
  const body = s.useDefault
    ? `{ SELECT ?o WHERE { ?o a <${iri}> } LIMIT ${INCOMING_PREDICATES_SAMPLE} } ?s ?p ?o . ?s a ?c .`
    : `{ SELECT ?o WHERE { GRAPH ?ge { ?o a <${iri}> } } LIMIT ${INCOMING_PREDICATES_SAMPLE} } GRAPH ?gp { ?s ?p ?o } GRAPH ?gc { ?s a ?c }`
  return `SELECT ?p ?c (COUNT(DISTINCT ?o) AS ?n) WHERE { ${body} FILTER(?c != <${iri}>) } GROUP BY ?p ?c ORDER BY DESC(?n)`
}

/**
 * For each (embed type, owning predicate) pair, count instances LINKED to an
 * owner via that predicate. Orphans = the type's total − linked, computed by the
 * caller (it has the inventory totals). Drives the sidebar's "not all owned"
 * warning on embed types that pin an embedVia (e.g. the 14 grants with no
 * Project). Paired VALUES + a variable predicate, one query for all such types.
 * Returns '' when no pair has safe IRIs (caller skips an empty query).
 */
export function buildEmbedOrphanQuery(pairs: { type: string; via: string }[], s: GraphStrategy): string {
  const values = pairs
    .filter(p => isNavigableIri(p.type) && isNavigableIri(p.via))
    .map(p => `(<${sanitizeIri(p.type)}> <${sanitizeIri(p.via)}>)`) // sanitized (trimmed), not raw (R29)
    .join(' ')
  if (!values) return ''
  const body = s.useDefault
    ? `?o a ?e . ?s ?via ?o .`
    : `GRAPH ?ge { ?o a ?e } GRAPH ?gp { ?s ?via ?o }`
  return `SELECT ?e (COUNT(DISTINCT ?o) AS ?linked) WHERE { VALUES (?e ?via) { ${values} } ${body} } GROUP BY ?e`
}

/**
 * Path-scoped count for one branch of the embed tree. `chain` is [rootClass,
 * embedType1, …, embedTypeN]; returns the number of distinct leaf instances
 * reachable along that exact chain (e.g. PostalAddresses belonging to the Sites
 * of PublicBodies). Computed on demand (one chained join), not eagerly — too
 * costly to run for every nested embed on load.
 *
 * Returns '' if the chain is too short (<2) or any IRI is unsafe.
 */
export function buildPathCountQuery(chain: string[], s: GraphStrategy): string {
  if (chain.length < 2 || chain.some(u => !isNavigableIri(u))) return ''
  const safe = chain.map(u => sanitizeIri(u)) // trimmed+validated; interpolate these, not raw chain (R29)
  const hops = chain.length - 1
  let gi = 0
  const stmt = (pat: string) => (s.useDefault ? pat : `GRAPH ?g${gi++} { ${pat} }`)
  const lines = [stmt(`?x0 a <${safe[0]}>`)]
  for (let i = 1; i <= hops; i++) {
    lines.push(stmt(`?x${i - 1} ?p${i} ?x${i}`))
    lines.push(stmt(`?x${i} a <${safe[i]}>`))
  }
  // Join with ' . ': bare triple patterns (useDefault) REQUIRE a dot separator,
  // and a dot after a GRAPH{…} block is also valid, so it works for both shapes.
  return `SELECT (COUNT(DISTINCT ?x${hops}) AS ?n) WHERE { ${lines.join(' . ')} }`
}

const SUBCLASS_OF = 'http://www.w3.org/2000/01/rdf-schema#subClassOf'

/**
 * Subclass discovery: which listed types are a more specific kind of another
 * listed type (rdfs:subClassOf). VALUES bounds it to the inventory, so we never
 * pull in superclasses that aren't even browsable (owl:Thing &c) — the caller
 * still filters ?super to the inventory set. Returns DISTINCT (?sub, ?super).
 *
 * Scope: plain when a default/merged view is queryable (the safe superset),
 * else GRAPH-wrapped for the never-touch-default (merged quads) case. The
 * relationship is structural, so provenance doesn't matter here.
 */
export function buildSubclassQuery(typeUris: string[], s: GraphStrategy): string {
  const values = iriValues(typeUris, 500)
  const pred = `<${SUBCLASS_OF}>`
  const body = s.useDefault
    ? `?sub ${pred} ?super .`
    : `GRAPH ?g { ?sub ${pred} ?super }`
  return `SELECT DISTINCT ?sub ?super WHERE { VALUES ?sub { ${values} } ${body} FILTER(?sub != ?super) }`
}

/* ───────────────────────── Labels / embed ───────────────────────── */

/**
 * Label lookup as (?s ?p ?l) rows for a batch of subjects × a batch of label
 * predicates — the CALLER (resolveLabels) picks the best value per subject by
 * LABEL_PREDICATES precedence, then language, client-side.
 *
 * Why not one query with COALESCE over all predicates (server-side precedence)?
 * Some endpoints sit behind a cumulative-anomaly-score WAF that blocks a request
 * carrying too many external vocab URLs — Fedlex blocks at 6 (≤5 OK), whether via
 * OPTIONAL or VALUES. So predicates are batched (LABEL_PREDICATE_BATCH) and merged
 * client-side; a single VALUES ?p pattern also keeps the query cheap. The resolver
 * catches each batch independently, so a batch the WAF blocks just contributes no
 * labels while the rest resolve. Empty when no safe subjects/predicates (caller
 * skips). SKOS-XL is a separate query. Type resolution (buildTypeQuery) and per-type
 * composed labels (buildValuesQuery) are separate paths that don't depend on these.
 */
export const LABEL_PREDICATE_BATCH = 2

export function buildLabelValuesQuery(uris: string[], predicates: readonly string[]): string {
  const s = iriValues(uris, 256)
  const p = iriValues(predicates)
  if (!s || !p) return ''
  return `SELECT ?s ?p ?l WHERE { VALUES ?s { ${s} } VALUES ?p { ${p} } ?s ?p ?l }`
}

/**
 * ALL asserted types per IRI, as DISTINCT (?s ?t) rows. The caller (resolveLabels)
 * narrows these to the MOST SPECIFIC client-side, using buildTypeSubclassQuery for
 * the subclass edges — so an object typed Result → ProjectPublication → JournalPaper
 * still resolves to "JournalPaper". Empty when no safe subjects.
 *
 * Why not filter to most-specific server-side (FILTER NOT EXISTS { ?s a ?more .
 * ?more rdfs:subClassOf+ ?t })? On endpoints that duplicate `?s a ?t` across
 * thousands of named graphs (Fedlex: one `FRA a skos:Concept` appears >100k times),
 * NOT EXISTS re-scans that pile per row AND the unbounded transitive closure never
 * returns — every server-side variant (NOT EXISTS / MINUS, transitive or single-hop)
 * times out. DISTINCT here collapses the duplicates at scan; the subclass step is
 * bounded by a small VALUES type set, so its `+` closure stays cheap.
 */
export function buildTypeQuery(uris: string[]): string {
  const values = iriValues(uris, 256)
  if (!values) return ''
  return `SELECT DISTINCT ?s ?t WHERE { VALUES ?s { ${values} } ?s a ?t }`
}

/**
 * Subclass edges (?sub rdfs:subClassOf+ ?super) among a KNOWN set of types — the
 * VALUES list bounds the transitive start, so the `+` closure is cheap where an
 * unbounded one blows up. resolveLabels feeds it the types buildTypeQuery found and
 * drops any type that is a supertype of another asserted type. Empty when none safe.
 */
export function buildTypeSubclassQuery(typeUris: string[]): string {
  const values = iriValues(typeUris, 256)
  if (!values) return ''
  return `SELECT DISTINCT ?sub ?super WHERE { VALUES ?sub { ${values} } ?sub <${SUBCLASS_OF}>+ ?super . FILTER(?sub != ?super) }`
}

/**
 * SKOS-XL labels for a set of subjects: (?s ?lf) rows where ?lf is the
 * literalForm (lang-tagged) reached via skosxl:prefLabel. Plain required
 * patterns — fast, and returns nothing for non-SKOS-XL subjects. The caller
 * picks the best language client-side, same as the base label resolution. Empty
 * when no safe subjects.
 */
export function buildSkosxlLabelsQuery(uris: string[]): string {
  const s = iriValues(uris, 256)
  if (!s) return ''
  return `SELECT ?s ?lf WHERE { VALUES ?s { ${s} } ?s <${SKOSXL_PREFLABEL}> ?l . ?l <${SKOSXL_LITERALFORM}> ?lf }`
}

/**
 * Raw values of specific predicates for specific subjects, for composing labels
 * from a type's configured label fields. Returns (?s ?p ?v) rows. Empty string
 * when there are no safe subjects/predicates (caller skips).
 */
export function buildValuesQuery(uris: string[], predicates: string[]): string {
  const s = iriValues(uris, 256)
  const p = iriValues(predicates)
  if (!s || !p) return ''
  return `SELECT ?s ?p ?v WHERE { VALUES ?s { ${s} } VALUES ?p { ${p} } ?s ?p ?v }`
}

/** Built-in deprecation flag used when an endpoint has no configured/profiled set. */
export const DEFAULT_DEPRECATED_PREDICATES = ['http://www.w3.org/2002/07/owl#deprecated'] as const

/** Which of `uris` are deprecated — assert any of `predicates` with a `true`
 *  value (owl:deprecated & friends). The flag may live in the default graph or a
 *  named graph, so check both. Returns just the deprecated subjects. */
export function buildDeprecatedQuery(uris: string[], predicates: readonly string[]): string {
  const s = iriValues(uris, 256)
  const p = iriValues([...predicates])
  if (!s || !p) return ''
  return `SELECT DISTINCT ?s WHERE { VALUES ?s { ${s} } VALUES ?p { ${p} } { ?s ?p ?d } UNION { GRAPH ?g { ?s ?p ?d } } FILTER(str(?d) = "true") }`
}

/**
 * Triples of several resources at once (batch), for inline embedding of value
 * objects. Depth-1, and graph-aware: `?g` is projected so the caller folds each
 * (p,o) into a graphs[] set — provenance is kept, not discarded (a value in two
 * graphs shows a multi-graph badge, never silent dedup). Mirrors the resource
 * query's branching per strategy.
 *
 * The VALUES list is capped at EMBED_BATCH: a caller with more URIs than this
 * MUST chunk into batches of EMBED_BATCH and union the results, or objects past
 * the cap are silently never fetched (marked seen but rendered as plain links).
 */
export const EMBED_BATCH = 64

export function buildEmbeddedTriplesQuery(uris: string[], s: GraphStrategy): string {
  const values = iriValues(uris, EMBED_BATCH)
  let pattern: string
  if (s.useNamed && s.useDefault) {
    pattern = `{ GRAPH ?g { ?s ?p ?o } } UNION { ?s ?p ?o FILTER NOT EXISTS { GRAPH ?ng { ?s ?p ?o } } }`
  } else if (s.useNamed) {
    pattern = `GRAPH ?g { ?s ?p ?o }`
  } else {
    pattern = `?s ?p ?o`
  }
  return `SELECT ?s ?g ?p ?o WHERE { VALUES ?s { ${values} } ${pattern} } ORDER BY ?s ?p`
}

/**
 * Referrers to INVERSE-embed: subjects `?s` that point at `resourceUri` through one
 * of `predicates` (a type pinning `embedVia: "^<predicate>"`). Returns (?s ?via) so
 * the caller groups each referrer under the predicate it arrived by, then feeds it
 * into the embed BFS. Bounded by the fixed object, so it stays cheap. Empty when no
 * predicates. Graph strategy mirrors the incoming/embed queries.
 */
export function buildInverseEmbedQuery(resourceUri: string, predicates: string[], s: GraphStrategy): string {
  const iri = sanitizeIri(resourceUri)
  const vias = iriValues(predicates)
  if (!vias) return ''
  const triple = `?s ?via <${iri}>`
  let pattern: string
  if (s.useNamed && s.useDefault) {
    pattern = `{ GRAPH ?g { ${triple} } } UNION { ${triple} FILTER NOT EXISTS { GRAPH ?ng { ${triple} } } }`
  } else if (s.useNamed) {
    pattern = `GRAPH ?g { ${triple} }`
  } else {
    pattern = triple
  }
  return `SELECT DISTINCT ?s ?via WHERE { VALUES ?via { ${vias} } ${pattern} }`
}

/* ───────────────────────── Resource detail (core) ───────────────────────── */

/**
 * Outgoing triples of a resource, graph-aware. The same (p,o) can come back once
 * per graph; the caller folds them into a graphs[] set (provenance + dedup).
 *
 * - both scopes (own / unknown): named graphs UNION the default-only triples
 *   (FILTER NOT EXISTS keeps the default branch to genuinely default-only
 *   triples, so a merged default doesn't mislabel named triples as "default").
 * - named only (merged): `GRAPH ?g` alone — folding dedups cross-graph copies.
 * - default only (no quads): plain.
 */
export function buildResourceTriplesQuery(resourceUri: string, s: GraphStrategy): string {
  const iri = sanitizeIri(resourceUri)
  if (s.useNamed && s.useDefault) {
    return `SELECT ?g ?p ?o WHERE {
  { GRAPH ?g { <${iri}> ?p ?o } }
  UNION
  { <${iri}> ?p ?o FILTER NOT EXISTS { GRAPH ?ng { <${iri}> ?p ?o } } }
} ORDER BY ?p`
  }
  if (s.useNamed) {
    return `SELECT ?g ?p ?o WHERE { GRAPH ?g { <${iri}> ?p ?o } } ORDER BY ?p`
  }
  return `SELECT ?p ?o WHERE { <${iri}> ?p ?o } ORDER BY ?p`
}

/**
 * Triples of a resource's BLANK-NODE objects, fetched PATH-SCOPED from the resource
 * (`<iri> ?x ?b . ?b ?p ?o`) — a blank node has no stable, queryable id, so it can't
 * go in a VALUES list like a URI embed; it's only reachable relative to a parent.
 * `?b` is the blank node (its label is consistent within this result set, and stable
 * across queries on RDF4J/GraphDB, so the caller correlates it to the parent triple's
 * bnode object). One hop — the value objects here (e.g. MappedCode) are flat. Graph
 * handling mirrors buildResourceTriplesQuery so provenance is preserved.
 */
export function buildBlankNodeTriplesQuery(resourceUri: string, s: GraphStrategy): string {
  const iri = sanitizeIri(resourceUri)
  const link = s.useNamed
    ? `{ GRAPH ?gl { <${iri}> ?xp ?b } }${s.useDefault ? ` UNION { <${iri}> ?xp ?b }` : ''}`
    : `<${iri}> ?xp ?b`
  if (s.useNamed && s.useDefault) {
    return `SELECT ?g ?b ?p ?o WHERE {
  ${link} FILTER(isBlank(?b))
  { GRAPH ?g { ?b ?p ?o } } UNION { ?b ?p ?o FILTER NOT EXISTS { GRAPH ?ng { ?b ?p ?o } } }
} ORDER BY ?b ?p`
  }
  if (s.useNamed) {
    return `SELECT ?g ?b ?p ?o WHERE { ${link} FILTER(isBlank(?b)) GRAPH ?g { ?b ?p ?o } } ORDER BY ?b ?p`
  }
  return `SELECT ?b ?p ?o WHERE { ${link} FILTER(isBlank(?b)) . ?b ?p ?o } ORDER BY ?b ?p`
}

/* ───────────────────────── Incoming (inverse) relations ───────────────────────── */

/** Graph-aware `?s ?p <iri>` body — who references this resource. */
function incomingPattern(iri: string, s: GraphStrategy): string {
  if (s.useNamed && s.useDefault) {
    return `{ GRAPH ?g { ?s ?p <${iri}> } } UNION { ?s ?p <${iri}> FILTER NOT EXISTS { GRAPH ?ng { ?s ?p <${iri}> } } }`
  }
  if (s.useNamed) return `GRAPH ?g { ?s ?p <${iri}> }`
  return `?s ?p <${iri}>`
}

/** How many distinct resources reference this one (the "Referenced by" headline). */
export function buildIncomingCountQuery(resourceUri: string, s: GraphStrategy): string {
  const iri = sanitizeIri(resourceUri)
  return `SELECT (COUNT(DISTINCT ?s) AS ?n) WHERE { ${incomingPattern(iri, s)} }`
}

/**
 * Incoming triples (subject + predicate + graph), capped. The object is the
 * fixed resource, so only ?s/?p/?g are projected; the caller groups by ?p and
 * folds ?g for provenance. LIMIT bounds the fetch on hub nodes (the true total
 * comes from buildIncomingCountQuery); the UI caps display per predicate too.
 */
export function buildIncomingQuery(resourceUri: string, s: GraphStrategy, limit = 1000): string {
  const iri = sanitizeIri(resourceUri)
  const lim = Math.max(1, Math.floor(limit))
  const proj = s.useNamed ? '?s ?g ?p' : '?s ?p'
  // Blank-node referrers are anonymous (no navigable view); they're fetched
  // separately WITH their own triples by buildIncomingBlankNodeQuery and inlined,
  // so exclude them here to avoid a bare, useless id and a cross-query id mismatch.
  return `SELECT ${proj} WHERE { ${incomingPattern(iri, s)} FILTER(!isBlank(?s)) } ORDER BY ?p ?s LIMIT ${lim}`
}

/**
 * Blank-node referrers of a resource, WITH their own triples, in one query so the
 * bnode label is self-consistent (`?b ?xp <iri> . ?b ?p ?o`). `?xp` is the
 * predicate pointing at the resource (the group), `?p ?o` the bnode's own
 * properties — inlined in "Referenced by" (a restriction reads "onProperty …
 * someValuesFrom Class", not a bare `b10081`). One hop; graph handling mirrors
 * buildBlankNodeTriplesQuery. Capped: a hub can be referenced by many bnodes.
 */
export function buildIncomingBlankNodeQuery(resourceUri: string, s: GraphStrategy, limit = 2000): string {
  const iri = sanitizeIri(resourceUri)
  const lim = Math.max(1, Math.floor(limit))
  const link = s.useNamed
    ? `{ GRAPH ?gl { ?b ?xp <${iri}> } }${s.useDefault ? ` UNION { ?b ?xp <${iri}> }` : ''}`
    : `?b ?xp <${iri}>`
  if (s.useNamed && s.useDefault) {
    return `SELECT ?g ?xp ?b ?p ?o WHERE {
  ${link} FILTER(isBlank(?b))
  { GRAPH ?g { ?b ?p ?o } } UNION { ?b ?p ?o FILTER NOT EXISTS { GRAPH ?ng { ?b ?p ?o } } }
} ORDER BY ?b ?p LIMIT ${lim}`
  }
  if (s.useNamed) {
    return `SELECT ?g ?xp ?b ?p ?o WHERE { ${link} FILTER(isBlank(?b)) GRAPH ?g { ?b ?p ?o } } ORDER BY ?b ?p LIMIT ${lim}`
  }
  return `SELECT ?xp ?b ?p ?o WHERE { ${link} FILTER(isBlank(?b)) . ?b ?p ?o } ORDER BY ?b ?p LIMIT ${lim}`
}
