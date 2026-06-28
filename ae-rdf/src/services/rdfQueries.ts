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
 * Type inventory: every rdf:type with its instance count, most common first.
 * ponytail: optimistic, no safe-mode gating. Add a chunked fallback only if a
 * real endpoint times out (CORDIS returns 61 types in ~0.3s).
 */
export function buildTypeInventoryQuery(): string {
  return `SELECT ?type (COUNT(?s) AS ?count) WHERE { ?s a ?type } GROUP BY ?type ORDER BY DESC(?count) LIMIT 500`
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
