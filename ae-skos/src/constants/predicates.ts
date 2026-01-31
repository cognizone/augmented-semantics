/**
 * Predicate Constants - URI definitions for RDF predicates
 *
 * Provides exact URI matching for property processing,
 * eliminating ambiguous endsWith() checks.
 *
 * @see /spec/ae-skos/sko06-ConceptDetails.md
 */

// =============================================================================
// Namespace URIs
// =============================================================================

export const NS = {
  RDF: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  RDFS: 'http://www.w3.org/2000/01/rdf-schema#',
  SKOS: 'http://www.w3.org/2004/02/skos/core#',
  SKOSXL: 'http://www.w3.org/2008/05/skos-xl#',
  DCT: 'http://purl.org/dc/terms/',
  DC: 'http://purl.org/dc/elements/1.1/',
  OWL: 'http://www.w3.org/2002/07/owl#',
  CC: 'http://creativecommons.org/ns#',
} as const

// =============================================================================
// Predicate URIs
// =============================================================================

// =============================================================================
// Type URIs (for rdf:type values)
// =============================================================================

export const TYPE = {
  Concept: `${NS.SKOS}Concept`,
  ConceptScheme: `${NS.SKOS}ConceptScheme`,
  Collection: `${NS.SKOS}Collection`,
  OrderedCollection: `${NS.SKOS}OrderedCollection`,
} as const

export type TypeUri = typeof TYPE[keyof typeof TYPE]

export const PRED = {
  // RDF
  type: `${NS.RDF}type`,

  // RDFS
  label: `${NS.RDFS}label`,
  comment: `${NS.RDFS}comment`,
  seeAlso: `${NS.RDFS}seeAlso`,

  // SKOS Labels
  prefLabel: `${NS.SKOS}prefLabel`,
  altLabel: `${NS.SKOS}altLabel`,
  hiddenLabel: `${NS.SKOS}hiddenLabel`,
  notation: `${NS.SKOS}notation`,

  // SKOS Documentation
  definition: `${NS.SKOS}definition`,
  scopeNote: `${NS.SKOS}scopeNote`,
  historyNote: `${NS.SKOS}historyNote`,
  changeNote: `${NS.SKOS}changeNote`,
  editorialNote: `${NS.SKOS}editorialNote`,
  note: `${NS.SKOS}note`,
  example: `${NS.SKOS}example`,

  // SKOS Hierarchy
  broader: `${NS.SKOS}broader`,
  narrower: `${NS.SKOS}narrower`,
  related: `${NS.SKOS}related`,
  inScheme: `${NS.SKOS}inScheme`,

  // SKOS Mappings
  exactMatch: `${NS.SKOS}exactMatch`,
  closeMatch: `${NS.SKOS}closeMatch`,
  broadMatch: `${NS.SKOS}broadMatch`,
  narrowMatch: `${NS.SKOS}narrowMatch`,
  relatedMatch: `${NS.SKOS}relatedMatch`,

  // SKOS-XL
  xlPrefLabel: `${NS.SKOSXL}prefLabel`,
  xlAltLabel: `${NS.SKOSXL}altLabel`,
  xlHiddenLabel: `${NS.SKOSXL}hiddenLabel`,

  // Dublin Core Terms
  dctTitle: `${NS.DCT}title`,
  dctDescription: `${NS.DCT}description`,
  dctCreator: `${NS.DCT}creator`,
  dctCreated: `${NS.DCT}created`,
  dctModified: `${NS.DCT}modified`,
  dctIssued: `${NS.DCT}issued`,
  dctPublisher: `${NS.DCT}publisher`,
  dctRights: `${NS.DCT}rights`,
  dctLicense: `${NS.DCT}license`,
  dctStatus: `${NS.DCT}status`,

  // Dublin Core Elements
  dcTitle: `${NS.DC}title`,
  dcIdentifier: `${NS.DC}identifier`,

  // OWL
  deprecated: `${NS.OWL}deprecated`,
  versionInfo: `${NS.OWL}versionInfo`,

  // Creative Commons
  ccLicense: `${NS.CC}license`,
} as const

export type PredicateKey = keyof typeof PRED
export type PredicateUri = typeof PRED[PredicateKey]
