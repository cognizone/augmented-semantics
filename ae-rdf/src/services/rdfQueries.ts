/**
 * RDF query builders for the live browser.
 *
 * Pure functions returning SPARQL query strings. No prefixes are needed for
 * the resource-triples query (it uses full IRIs only), so callers don't wrap
 * with withPrefixes().
 *
 * @see /spec/ae-rdf/rdf01-QueryLibrary.md
 * @see ae-rdf/PLAN.md (Query Library)
 */
import { validateURI } from './security'
import { withPrefixes } from './sparql'

/**
 * Label predicates in display precedence (highest first). Used to derive a
 * human label from a resource's outgoing triples — general RDF has no single
 * label predicate.
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

/**
 * The `?s a <TYPE>` membership pattern, gated by graphMode (Option A).
 * - 'named': scoped to named graphs (`GRAPH ?g { … }`).
 * - 'none':  plain default-graph pattern.
 *
 * `<TYPE>` is interpolated raw — callers pass either a sanitized `<iri>` or the
 * variable `?type`. COUNTs always use COUNT(DISTINCT ?s): on a quad store a
 * subject is typed once per graph, so a non-distinct count is inflated by graph
 * multiplicity (CORDIS: 580,939 raw vs 536,703 distinct).
 *
 * ponytail (Option A): on 'named' endpoints we count/list within named graphs
 * and do NOT also union the default graph. Misses the rare case of triples that
 * live ONLY in a separate default graph — that completeness pass is the parked
 * endpoint-profiler's job. See ae-rdf/PLAN.md "Graph awareness".
 */
function membership(typeTerm: string, graphMode: GraphMode): string {
  return graphMode === 'named'
    ? `GRAPH ?g { ?s a ${typeTerm} }`
    : `?s a ${typeTerm}`
}

/**
 * Type inventory: every rdf:type with its distinct-instance count, commonest
 * first. graphMode-gated (see membership). ~5s on CORDIS for the distinct count.
 */
export function buildTypeInventoryQuery(graphMode: GraphMode = 'named'): string {
  return `SELECT ?type (COUNT(DISTINCT ?s) AS ?count) WHERE { ${membership('?type', graphMode)} } GROUP BY ?type ORDER BY DESC(?count) LIMIT 500`
}

/** Total distinct instances of a type (for the instance-list header / paging). */
export function buildInstanceCountQuery(typeUri: string, graphMode: GraphMode = 'named'): string {
  const iri = sanitizeIri(typeUri)
  return `SELECT (COUNT(DISTINCT ?s) AS ?total) WHERE { ${membership(`<${iri}>`, graphMode)} }`
}

/**
 * One page of instances of a type, with a display label resolved by precedence
 * (rdfs:label, skos:prefLabel, dct:title, else the URI). GROUP BY ?s + SAMPLE
 * gives exactly one row per instance (so the page size = instance count, not
 * inflated by multi-language labels or multi-graph membership). Label OPTIONALs
 * read the default graph — fine for a navigation index; full graph-aware triples
 * are one click away in the resource view.
 */
export function buildInstanceListQuery(
  typeUri: string,
  graphMode: GraphMode = 'named',
  limit = 100,
  offset = 0
): string {
  const iri = sanitizeIri(typeUri)
  const lim = Math.max(1, Math.floor(limit))
  const off = Math.max(0, Math.floor(offset))
  return withPrefixes(`SELECT ?s (SAMPLE(?lbl) AS ?label) WHERE {
  ${membership(`<${iri}>`, graphMode)}
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
 * Whether the connected endpoint uses named graphs.
 * - 'named': quad store — fetch with graph provenance (?g).
 * - 'none':  triple/default-graph-only — lean query, every triple is "default".
 *
 * This is an OPTIMIZATION hint, not a correctness switch: the 'named' query is
 * correct on every endpoint class (on a triple-only store its GRAPH branch is
 * empty and the default branch returns everything). 'none' just lets us skip
 * the GRAPH machinery once we know it's pointless. So callers may safely
 * default to 'named' until detection completes.
 *
 * @see graph-provenance-is-core (memory) and ae-rdf/PLAN.md "Graph awareness"
 */
export type GraphMode = 'named' | 'none'

/**
 * Outgoing triples of a resource (the core resource-detail query), graph-aware.
 *
 * For every triple we display we must KNOW its full set of graphs — a triple
 * `(s,p,o)` can assert in several graphs at once, so the 'named' query returns
 * one row per (graph, p, o) and the caller folds them into a graphs[] set.
 * The label is derived client-side from these triples (see LABEL_PREDICATES).
 *
 * The 'named' query:
 *   - branch 1: triples inside named graphs, with ?g bound (provenance).
 *   - branch 2: triples in the default graph that are in NO named graph
 *     (?g unbound ⇒ "default graph"); FILTER NOT EXISTS stops double-counting
 *     when the default graph is the union of all named graphs (e.g. Virtuoso).
 *
 * ponytail: we do NOT try to detect the default-graph *semantics* (union vs
 * separate vs empty) — that's a deployment config, not reliably introspectable
 * via SPARQL, and lives in the parked endpoint-profiler. The NOT EXISTS branch
 * makes it correct regardless; detecting union-default to drop the branch is a
 * perf nicety we skip.
 */
/**
 * Best label AND a sample type for each of a set of resource IRIs.
 * Turns opaque object localnames (e.g. `MENV`) into human labels, and gives a
 * type to show as a badge — including for label-less resources (a UUID then
 * reads as e.g. `[Beneficiary]`). Unsafe IRIs are skipped, not fatal.
 *
 * The label match is OPTIONAL so a subject with no label still returns its type;
 * `SAMPLE` collapses to one label and one type per subject. Default-graph scoped.
 */
export function buildLabelsQuery(uris: string[]): string {
  const values = uris
    .filter(isNavigableIri)
    .slice(0, 256)
    .map(u => `<${u}>`)
    .join(' ')
  const labelPreds = LABEL_PREDICATES.map(p => `<${p}>`).join(' ')
  return `SELECT ?s (SAMPLE(?lbl) AS ?label) (SAMPLE(?t) AS ?type) WHERE {
  VALUES ?s { ${values} }
  OPTIONAL { VALUES ?lp { ${labelPreds} } ?s ?lp ?lbl }
  OPTIONAL { ?s a ?t }
} GROUP BY ?s`
}

export function buildResourceTriplesQuery(resourceUri: string, graphMode: GraphMode = 'named'): string {
  const iri = sanitizeIri(resourceUri)
  if (graphMode === 'none') {
    return `SELECT ?p ?o WHERE { <${iri}> ?p ?o } ORDER BY ?p`
  }
  return `SELECT ?g ?p ?o WHERE {
  { GRAPH ?g { <${iri}> ?p ?o } }
  UNION
  { <${iri}> ?p ?o FILTER NOT EXISTS { GRAPH ?ng { <${iri}> ?p ?o } } }
} ORDER BY ?p`
}
