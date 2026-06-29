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
import { withPrefixes } from './sparql'
import type { EndpointGraph } from '../types'

/**
 * Label predicates in display precedence (highest first). General RDF has no
 * single label predicate, so labels are resolved by trying these in order.
 */
export const LABEL_PREDICATES: readonly string[] = [
  'http://www.w3.org/2000/01/rdf-schema#label',
  'http://www.w3.org/2004/02/skos/core#prefLabel',
  'http://purl.org/dc/terms/title',
  'http://purl.org/dc/elements/1.1/title',
  'http://xmlns.com/foaf/0.1/name',
  'http://schema.org/name',
]

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

/* ───────────────────────── Discovery / list ───────────────────────── */

/**
 * Type inventory: every rdf:type with its distinct-instance count, commonest
 * first. COUNT(DISTINCT ?s) so cross-graph multiplicity never inflates counts.
 */
export function buildTypeInventoryQuery(s: GraphStrategy): string {
  return `SELECT ?type (COUNT(DISTINCT ?s) AS ?count) WHERE { ${membership('?type', s)} } GROUP BY ?type ORDER BY DESC(?count) LIMIT 500`
}

/** Total distinct instances of a type (instance-list header / paging). */
export function buildInstanceCountQuery(typeUri: string, s: GraphStrategy): string {
  const iri = sanitizeIri(typeUri)
  return `SELECT (COUNT(DISTINCT ?s) AS ?total) WHERE { ${membership(`<${iri}>`, s)} }`
}

/**
 * One page of instances of a type. GROUP BY ?s + SAMPLE → exactly one row per
 * instance. Label OPTIONALs read the default view (fine on merged/triple stores;
 * a navigation index, full labels are one click away in the resource view).
 */
export function buildInstanceListQuery(typeUri: string, s: GraphStrategy, limit = 100, offset = 0): string {
  const iri = sanitizeIri(typeUri)
  const lim = Math.max(1, Math.floor(limit))
  const off = Math.max(0, Math.floor(offset))
  return withPrefixes(`SELECT ?s (SAMPLE(?lbl) AS ?label) WHERE {
  ${membership(`<${iri}>`, s)}
  OPTIONAL { ?s rdfs:label ?l1 }
  OPTIONAL { ?s skos:prefLabel ?l2 }
  OPTIONAL { ?s dct:title ?l3 }
  BIND(COALESCE(?l1, ?l2, ?l3, STR(?s)) AS ?lbl)
}
GROUP BY ?s
ORDER BY ?label
LIMIT ${lim} OFFSET ${off}`)
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
  const values = embedTypeUris.filter(isNavigableIri).slice(0, 64).map(u => `<${u}>`).join(' ')
  const body = s.useDefault
    ? `?o a ?e . ?s ?p ?o . ?s a ?c .`
    : `GRAPH ?ge { ?o a ?e } GRAPH ?gp { ?s ?p ?o } GRAPH ?gc { ?s a ?c }`
  // ?n = distinct embed-value instances reachable from instances of ?c, so a
  // nested embed shows a count relative to its composing class, not the global
  // type total (Acronym under PublicBody ≠ all Acronyms in the store).
  return `SELECT ?c ?e (COUNT(DISTINCT ?o) AS ?n) WHERE { VALUES ?e { ${values} } ${body} FILTER(?c != ?e) } GROUP BY ?c ?e`
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
  const hops = chain.length - 1
  let gi = 0
  const stmt = (pat: string) => (s.useDefault ? pat : `GRAPH ?g${gi++} { ${pat} }`)
  const lines = [stmt(`?x0 a <${chain[0]}>`)]
  for (let i = 1; i <= hops; i++) {
    lines.push(stmt(`?x${i - 1} ?p${i} ?x${i}`))
    lines.push(stmt(`?x${i} a <${chain[i]}>`))
  }
  return `SELECT (COUNT(DISTINCT ?x${hops}) AS ?n) WHERE { ${lines.join(' ')} }`
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
  const values = typeUris.filter(isNavigableIri).slice(0, 500).map(u => `<${u}>`).join(' ')
  const pred = `<${SUBCLASS_OF}>`
  const body = s.useDefault
    ? `?sub ${pred} ?super .`
    : `GRAPH ?g { ?sub ${pred} ?super }`
  return `SELECT DISTINCT ?sub ?super WHERE { VALUES ?sub { ${values} } ${body} FILTER(?sub != ?super) }`
}

/* ───────────────────────── Labels / embed ───────────────────────── */

/**
 * Best label AND the MOST SPECIFIC type per IRI. OPTIONAL label so label-less
 * subjects still return a type (badge / fallback). Default-view scoped (labels
 * live there on merged/triple stores). Unsafe IRIs are skipped.
 *
 * Most-specific = a type the subject asserts that has no more-specific asserted
 * type below it (no `?more rdfs:subClassOf+ ?t`). So an object typed Result →
 * ProjectPublication → JournalPaper badges as "JournalPaper", not an arbitrary
 * ancestor. Self-contained — the picking happens in the query, no client-side
 * hierarchy needed. (SAMPLE breaks ties on genuine multiple inheritance.)
 */
export function buildLabelsQuery(uris: string[]): string {
  const values = uris
    .filter(isNavigableIri)
    .slice(0, 256)
    .map(u => `<${u}>`)
    .join(' ')
  const labelPreds = LABEL_PREDICATES.map(p => `<${p}>`).join(' ')
  const subClassOf = `<${SUBCLASS_OF}>`
  return `SELECT ?s (SAMPLE(?lbl) AS ?label) (SAMPLE(?t) AS ?type) WHERE {
  VALUES ?s { ${values} }
  OPTIONAL { VALUES ?lp { ${labelPreds} } ?s ?lp ?lbl }
  OPTIONAL {
    ?s a ?t .
    FILTER NOT EXISTS { ?s a ?more . ?more ${subClassOf}+ ?t . FILTER(?more != ?t) }
  }
} GROUP BY ?s`
}

/**
 * Triples of several resources at once (batch), for inline embedding of value
 * objects. Depth-1, and graph-aware: `?g` is projected so the caller folds each
 * (p,o) into a graphs[] set — provenance is kept, not discarded (a value in two
 * graphs shows a multi-graph badge, never silent dedup). Mirrors the resource
 * query's branching per strategy.
 */
export function buildEmbeddedTriplesQuery(uris: string[], s: GraphStrategy): string {
  const values = uris
    .filter(isNavigableIri)
    .slice(0, 64)
    .map(u => `<${u}>`)
    .join(' ')
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
