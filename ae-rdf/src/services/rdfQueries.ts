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
 * Outgoing triples of a resource (the core resource-detail query).
 * The label is derived client-side from these triples (see LABEL_PREDICATES).
 */
export function buildResourceTriplesQuery(resourceUri: string): string {
  const iri = sanitizeIri(resourceUri)
  return `SELECT ?p ?o WHERE { <${iri}> ?p ?o } ORDER BY ?p`
}
