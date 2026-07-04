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
  // WAF blocks that vocab pair anyway. Re-add if an endpoint labels only via them.
]

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
  const named = `GRAPH ?g { ?s a ${typeTerm} }`
  const def = `?s a ${typeTerm}`
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
function instanceMatch(iri: string, s: GraphStrategy, filter?: string, predicates: readonly string[] = LABEL_PREDICATES, orphanVia?: string): string {
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
    const labelBranch = `{ ${base} VALUES ?lp { ${labelValues} } ${scoped('?s ?lp ?lbl', s, '?lg')} FILTER(isLiteral(?lbl) && ${allContain('?lbl')}) }`
    const uriBranch = `{ ${base} FILTER(${allContain('?s')}) }`
    core = `${labelBranch} UNION ${uriBranch}`
  }
  // Orphan filter: keep only instances with NO owner via the embed's owning
  // predicate — the ones that surface ONLY in this list, never inline under a
  // parent. Wraps the (possibly union) core so the FILTER applies to every branch.
  if (orphanVia && isNavigableIri(orphanVia)) {
    core = `{ ${core} } FILTER NOT EXISTS { ${scoped(`?owner <${sanitizeIri(orphanVia)}> ?s`, s, '?og')} }`
  }
  return core
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
export function buildInstanceCountQuery(typeUri: string, s: GraphStrategy, filter?: string, predicates?: readonly string[], orphanVia?: string): string {
  const iri = sanitizeIri(typeUri)
  return `SELECT (COUNT(DISTINCT ?s) AS ?total) WHERE { ${instanceMatch(iri, s, filter, predicates, orphanVia)} }`
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
export function buildInstanceListQuery(typeUri: string, s: GraphStrategy, limit = 100, offset = 0, filter?: string, predicates?: readonly string[], orphanVia?: string): string {
  const iri = sanitizeIri(typeUri)
  const lim = Math.max(1, Math.floor(limit))
  const off = Math.max(0, Math.floor(offset))
  return `SELECT DISTINCT ?s WHERE { ${instanceMatch(iri, s, filter, predicates, orphanVia)} } LIMIT ${lim} OFFSET ${off}`
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
 * MOST SPECIFIC asserted type per IRI, as (?s ?t) rows. Most-specific = a type the
 * subject asserts with no more-specific asserted type below it (no
 * `?more rdfs:subClassOf+ ?t`) — so an object typed Result → ProjectPublication →
 * JournalPaper resolves to "JournalPaper", not an arbitrary ancestor. Split from
 * the label lookup (above) so neither carries the other's WAF/planner cost; the
 * caller merges both into its label/type maps. Empty when no safe subjects.
 */
export function buildTypeQuery(uris: string[]): string {
  const values = iriValues(uris, 256)
  if (!values) return ''
  const subClassOf = `<${SUBCLASS_OF}>`
  return `SELECT ?s ?t WHERE {
  VALUES ?s { ${values} }
  ?s a ?t .
  FILTER NOT EXISTS { ?s a ?more . ?more ${subClassOf}+ ?t . FILTER(?more != ?t) }
}`
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
  return `SELECT ${proj} WHERE { ${incomingPattern(iri, s)} } ORDER BY ?p ?s LIMIT ${lim}`
}
