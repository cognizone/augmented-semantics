/**
 * Tests for the RDF query builders — pure, deterministic string output.
 * Focus: the SPARQL-injection guard (sanitizeIri), resolveGraphStrategy's truth
 * table, and the per-strategy query shapes. See /spec/ae-rdf/rdf-overview.md.
 */
import { describe, it, expect } from 'vitest'
import {
  sanitizeIri,
  isNavigableIri,
  LABEL_PREDICATES,
  resolveGraphStrategy,
  buildResourceTriplesQuery,
  buildTypeInventoryQuery,
  buildInstanceCountQuery,
  buildInstanceListQuery,
  buildLabelsQuery,
  buildEmbeddedTriplesQuery,
  buildCompositionQuery,
  buildSubclassQuery,
  buildPathCountQuery,
} from '../rdfQueries'

const RES = 'http://data.europa.eu/s66#endDate'
const TYPE = 'http://data.europa.eu/s66#Acronym'

// Strategy fixtures
const BOTH = { useNamed: true, useDefault: true } // own / unknown
const NAMED = { useNamed: true, useDefault: false } // merged
const DEFAULT = { useNamed: false, useDefault: true } // no quads

describe('sanitizeIri', () => {
  it('accepts http/https/urn IRIs and trims', () => {
    expect(sanitizeIri(RES)).toBe(RES)
    expect(sanitizeIri('  https://example.org/x  ')).toBe('https://example.org/x')
    expect(sanitizeIri('urn:isbn:123')).toBe('urn:isbn:123')
  })

  it('rejects dangerous protocols', () => {
    expect(() => sanitizeIri('javascript:alert(1)')).toThrow()
    expect(() => sanitizeIri('data:text/html,x')).toThrow()
    expect(() => sanitizeIri('file:///etc/passwd')).toThrow()
  })

  it('rejects IRIs with characters that could break out of <...> (injection guard)', () => {
    expect(() => sanitizeIri('http://e.org/x> } INSERT DATA { <a> <b> <c> }')).toThrow()
    expect(() => sanitizeIri('http://e.org/a b')).toThrow()
    expect(() => sanitizeIri('http://e.org/a"b')).toThrow()
    expect(() => sanitizeIri('http://e.org/a{b}')).toThrow()
  })
})

describe('isNavigableIri', () => {
  it('is true for safe http(s)/urn and false otherwise', () => {
    expect(isNavigableIri(RES)).toBe(true)
    expect(isNavigableIri('mailto:a@b.c')).toBe(false)
    expect(isNavigableIri('http://e.org/x> }')).toBe(false)
  })
})

describe('LABEL_PREDICATES', () => {
  it('orders rdfs:label before skos:prefLabel before dct:title', () => {
    expect(LABEL_PREDICATES.indexOf('http://www.w3.org/2000/01/rdf-schema#label'))
      .toBeLessThan(LABEL_PREDICATES.indexOf('http://www.w3.org/2004/02/skos/core#prefLabel'))
    expect(LABEL_PREDICATES.indexOf('http://www.w3.org/2004/02/skos/core#prefLabel'))
      .toBeLessThan(LABEL_PREDICATES.indexOf('http://purl.org/dc/terms/title'))
  })
})

describe('resolveGraphStrategy', () => {
  it('triple store (quads:false) → default only', () => {
    expect(resolveGraphStrategy({ quads: false })).toEqual({ useNamed: false, useDefault: true })
  })
  it('merged quad store → named only (never the default view)', () => {
    expect(resolveGraphStrategy({ quads: true, defaultView: 'merged' })).toEqual({ useNamed: true, useDefault: false })
  })
  it('own quad store → both scopes', () => {
    expect(resolveGraphStrategy({ quads: true, defaultView: 'own' })).toEqual({ useNamed: true, useDefault: true })
  })
  it('unknown → safe superset (both)', () => {
    expect(resolveGraphStrategy({})).toEqual({ useNamed: true, useDefault: true })
    expect(resolveGraphStrategy(undefined)).toEqual({ useNamed: true, useDefault: true })
    expect(resolveGraphStrategy({ quads: true })).toEqual({ useNamed: true, useDefault: true })
  })
})

describe('buildResourceTriplesQuery', () => {
  it('both: GRAPH ?g UNION default-only (NOT EXISTS), provenance', () => {
    const q = buildResourceTriplesQuery(RES, BOTH)
    expect(q).toContain('?g ?p ?o')
    expect(q).toContain(`GRAPH ?g { <${RES}> ?p ?o }`)
    expect(q).toContain('UNION')
    expect(q).toContain('FILTER NOT EXISTS')
  })
  it('named only (merged): GRAPH ?g alone, no default branch', () => {
    const q = buildResourceTriplesQuery(RES, NAMED)
    expect(q).toContain(`GRAPH ?g { <${RES}> ?p ?o }`)
    expect(q).not.toContain('UNION')
    expect(q).not.toContain('NOT EXISTS')
  })
  it('default only (no quads): plain, no GRAPH', () => {
    const q = buildResourceTriplesQuery(RES, DEFAULT)
    expect(q).toBe(`SELECT ?p ?o WHERE { <${RES}> ?p ?o } ORDER BY ?p`)
  })
  it('refuses an unsafe resource IRI', () => {
    expect(() => buildResourceTriplesQuery('http://e.org/x> } DROP ALL', BOTH)).toThrow()
  })
})

describe('membership-driven aggregates always COUNT(DISTINCT ?s)', () => {
  it('type inventory: distinct count + membership per strategy', () => {
    expect(buildTypeInventoryQuery(BOTH)).toContain('COUNT(DISTINCT ?s)')
    expect(buildTypeInventoryQuery(BOTH)).toContain('{ GRAPH ?g { ?s a ?type } } UNION { ?s a ?type }')
    expect(buildTypeInventoryQuery(NAMED)).toContain('GRAPH ?g { ?s a ?type }')
    expect(buildTypeInventoryQuery(NAMED)).not.toContain('UNION')
    const def = buildTypeInventoryQuery(DEFAULT)
    expect(def).toContain('?s a ?type')
    expect(def).not.toContain('GRAPH')
  })

  it('instance count: distinct, graph-scoped per strategy', () => {
    expect(buildInstanceCountQuery(TYPE, NAMED)).toBe(
      `SELECT (COUNT(DISTINCT ?s) AS ?total) WHERE { GRAPH ?g { ?s a <${TYPE}> } }`
    )
    expect(buildInstanceCountQuery(TYPE, DEFAULT)).toBe(
      `SELECT (COUNT(DISTINCT ?s) AS ?total) WHERE { ?s a <${TYPE}> }`
    )
    expect(buildInstanceCountQuery(TYPE, BOTH)).toContain('UNION')
    expect(() => buildInstanceCountQuery('http://e.org/x> }', BOTH)).toThrow()
  })
})

describe('buildInstanceListQuery', () => {
  it('one row per instance (GROUP BY ?s + SAMPLE) with prefixes + label precedence', () => {
    const q = buildInstanceListQuery(TYPE, NAMED, 100, 0)
    expect(q).toContain('PREFIX rdfs:')
    expect(q).toContain(`GRAPH ?g { ?s a <${TYPE}> }`)
    expect(q).toContain('SAMPLE(?lbl) AS ?label')
    expect(q).toContain('GROUP BY ?s')
    expect(q).toContain('COALESCE(?l1, ?l2, ?l3, STR(?s))')
    expect(q).toContain('LIMIT 100 OFFSET 0')
  })
  it('sanitizes limit/offset (no injection via paging)', () => {
    const q = buildInstanceListQuery(TYPE, DEFAULT, 100.9, -5)
    expect(q).toContain('LIMIT 100 OFFSET 0')
    expect(q).not.toContain('GRAPH')
  })
  it('positive offset for later pages', () => {
    expect(buildInstanceListQuery(TYPE, NAMED, 100, 200)).toContain('LIMIT 100 OFFSET 200')
  })
})

describe('buildLabelsQuery', () => {
  it('OPTIONAL label + MOST SPECIFIC type per subject, grouped', () => {
    const q = buildLabelsQuery([RES, TYPE])
    expect(q).toContain(`VALUES ?s { <${RES}> <${TYPE}> }`)
    expect(q).toContain('SAMPLE(?lbl) AS ?label')
    expect(q).toContain('SAMPLE(?t) AS ?type')
    expect(q).toContain('OPTIONAL { VALUES ?lp {')
    expect(q).toContain('?s a ?t')
    // leaf-type picker: exclude any type that has a more-specific asserted type
    expect(q).toContain('FILTER NOT EXISTS')
    expect(q).toContain('subClassOf')
    expect(q).toContain('GROUP BY ?s')
  })
  it('skips unsafe IRIs', () => {
    const q = buildLabelsQuery(['http://e.org/x> }', RES])
    expect(q).toContain(`<${RES}>`)
    expect(q).not.toContain('x> }')
  })
})

describe('buildEmbeddedTriplesQuery', () => {
  it('projects ?g (graph-aware) and is scoped per strategy; caller folds, no DISTINCT', () => {
    expect(buildEmbeddedTriplesQuery([RES], NAMED)).toContain('SELECT ?s ?g ?p ?o')
    expect(buildEmbeddedTriplesQuery([RES], NAMED)).toContain('GRAPH ?g { ?s ?p ?o }')
    expect(buildEmbeddedTriplesQuery([RES], NAMED)).not.toContain('DISTINCT')
    expect(buildEmbeddedTriplesQuery([RES], BOTH)).toContain('FILTER NOT EXISTS')
    const def = buildEmbeddedTriplesQuery([RES], DEFAULT)
    expect(def).toContain('VALUES ?s { <' + RES + '> }')
    expect(def).not.toContain('GRAPH')
  })
  it('skips unsafe IRIs', () => {
    const q = buildEmbeddedTriplesQuery(['http://e.org/x> } DELETE', RES], BOTH)
    expect(q).toContain(`<${RES}>`)
    expect(q).not.toContain('DELETE')
  })
})

describe('buildCompositionQuery', () => {
  it('counts embed values per (class, embed-type) edge; plain when default queryable', () => {
    const q = buildCompositionQuery([TYPE], DEFAULT)
    expect(q).toContain('SELECT ?c ?e (COUNT(DISTINCT ?o) AS ?n)')
    expect(q).toContain('GROUP BY ?c ?e')
    expect(q).toContain(`VALUES ?e { <${TYPE}> }`)
    expect(q).toContain('?o a ?e . ?s ?p ?o . ?s a ?c .')
    expect(q).toContain('FILTER(?c != ?e)')
    expect(q).not.toContain('GRAPH')
  })
  it('merged (never default) wraps each pattern in its own GRAPH for cross-graph', () => {
    const q = buildCompositionQuery([TYPE], NAMED)
    expect(q).toContain('GRAPH ?ge { ?o a ?e }')
    expect(q).toContain('GRAPH ?gp { ?s ?p ?o }')
    expect(q).toContain('GRAPH ?gc { ?s a ?c }')
  })
  it('skips unsafe IRIs', () => {
    const q = buildCompositionQuery(['http://e.org/x> } DROP', TYPE], BOTH)
    expect(q).toContain(`<${TYPE}>`)
    expect(q).not.toContain('DROP')
  })
})

describe('buildSubclassQuery', () => {
  const SUBCLASS = '<http://www.w3.org/2000/01/rdf-schema#subClassOf>'
  it('finds DISTINCT (sub, super) pairs bounded to the inventory; plain on default', () => {
    const q = buildSubclassQuery([TYPE], DEFAULT)
    expect(q).toContain('SELECT DISTINCT ?sub ?super')
    expect(q).toContain(`VALUES ?sub { <${TYPE}> }`)
    expect(q).toContain(`?sub ${SUBCLASS} ?super`)
    expect(q).toContain('FILTER(?sub != ?super)')
    expect(q).not.toContain('GRAPH')
  })
  it('merged (never default) wraps in GRAPH', () => {
    expect(buildSubclassQuery([TYPE], NAMED)).toContain(`GRAPH ?g { ?sub ${SUBCLASS} ?super }`)
  })
  it('skips unsafe IRIs', () => {
    const q = buildSubclassQuery(['http://e.org/x> } DROP', TYPE], BOTH)
    expect(q).toContain(`<${TYPE}>`)
    expect(q).not.toContain('DROP')
  })
})

describe('buildPathCountQuery', () => {
  const C = 'http://e.org/PublicBody'
  const E1 = 'http://e.org/Site'
  const E2 = 'http://e.org/PostalAddress'
  it('chains class → embeds and counts the leaf; plain on default', () => {
    const q = buildPathCountQuery([C, E1, E2], DEFAULT)
    expect(q).toContain('SELECT (COUNT(DISTINCT ?x2) AS ?n)')
    expect(q).toContain(`?x0 a <${C}>`)
    expect(q).toContain(`?x0 ?p1 ?x1`)
    expect(q).toContain(`?x1 a <${E1}>`)
    expect(q).toContain(`?x1 ?p2 ?x2`)
    expect(q).toContain(`?x2 a <${E2}>`)
    expect(q).not.toContain('GRAPH')
  })
  it('merged (never default) wraps each statement in its own GRAPH', () => {
    expect(buildPathCountQuery([C, E1], NAMED)).toContain(`GRAPH ?g0 { ?x0 a <${C}> }`)
  })
  it('returns empty for too-short chains or unsafe IRIs', () => {
    expect(buildPathCountQuery([C], DEFAULT)).toBe('')
    expect(buildPathCountQuery([C, 'http://e.org/x> } DROP'], DEFAULT)).toBe('')
  })
})
