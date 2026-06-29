/**
 * Tests for the RDF query builders — pure, deterministic string output.
 * Focus: the SPARQL-injection guard (sanitizeIri) and the graphMode/DISTINCT
 * query shapes, per ae-rdf/PLAN.md Verification.
 */
import { describe, it, expect } from 'vitest'
import {
  sanitizeIri,
  isNavigableIri,
  LABEL_PREDICATES,
  buildResourceTriplesQuery,
  buildTypeInventoryQuery,
  buildInstanceCountQuery,
  buildInstanceListQuery,
  buildLabelsQuery,
  buildEmbeddedTriplesQuery,
} from '../rdfQueries'

const RES = 'http://data.europa.eu/s66#endDate'
const TYPE = 'http://data.europa.eu/s66#Acronym'

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
    // A crafted IRI trying to inject extra SPARQL must be refused.
    expect(() => sanitizeIri('http://e.org/x> } INSERT DATA { <a> <b> <c> }')).toThrow()
    expect(() => sanitizeIri('http://e.org/a b')).toThrow() // whitespace
    expect(() => sanitizeIri('http://e.org/a"b')).toThrow()
    expect(() => sanitizeIri('http://e.org/a{b}')).toThrow()
  })
})

describe('isNavigableIri', () => {
  it('is true for safe http(s)/urn and false otherwise', () => {
    expect(isNavigableIri(RES)).toBe(true)
    expect(isNavigableIri('https://example.org/x')).toBe(true)
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

describe('buildResourceTriplesQuery', () => {
  it("named (default) carries graph provenance via GRAPH ?g + default-branch", () => {
    const q = buildResourceTriplesQuery(RES)
    expect(q).toContain('?g ?p ?o')
    expect(q).toContain(`GRAPH ?g { <${RES}> ?p ?o }`)
    expect(q).toContain('UNION')
    expect(q).toContain('FILTER NOT EXISTS')
    expect(q).toContain('ORDER BY ?p')
  })

  it('none uses the lean default-graph query (no GRAPH)', () => {
    const q = buildResourceTriplesQuery(RES, 'none')
    expect(q).toBe(`SELECT ?p ?o WHERE { <${RES}> ?p ?o } ORDER BY ?p`)
    expect(q).not.toContain('GRAPH')
  })

  it('refuses an unsafe resource IRI', () => {
    expect(() => buildResourceTriplesQuery('http://e.org/x> } DROP ALL')).toThrow()
  })
})

describe('buildTypeInventoryQuery', () => {
  it('always counts DISTINCT subjects', () => {
    expect(buildTypeInventoryQuery('named')).toContain('COUNT(DISTINCT ?s)')
    expect(buildTypeInventoryQuery('none')).toContain('COUNT(DISTINCT ?s)')
  })

  it('gates membership on graphMode', () => {
    expect(buildTypeInventoryQuery('named')).toContain('GRAPH ?g { ?s a ?type }')
    const none = buildTypeInventoryQuery('none')
    expect(none).toContain('?s a ?type')
    expect(none).not.toContain('GRAPH')
  })

  it('orders by count desc and caps at 500', () => {
    const q = buildTypeInventoryQuery('named')
    expect(q).toContain('ORDER BY DESC(?count)')
    expect(q).toContain('LIMIT 500')
  })
})

describe('buildInstanceCountQuery', () => {
  it('counts DISTINCT instances, graphMode-gated', () => {
    expect(buildInstanceCountQuery(TYPE, 'named')).toBe(
      `SELECT (COUNT(DISTINCT ?s) AS ?total) WHERE { GRAPH ?g { ?s a <${TYPE}> } }`
    )
    expect(buildInstanceCountQuery(TYPE, 'none')).toBe(
      `SELECT (COUNT(DISTINCT ?s) AS ?total) WHERE { ?s a <${TYPE}> }`
    )
  })

  it('refuses an unsafe type IRI', () => {
    expect(() => buildInstanceCountQuery('http://e.org/x> }')).toThrow()
  })
})

describe('buildInstanceListQuery', () => {
  it('returns one row per instance (GROUP BY ?s + SAMPLE) with prefixes and label precedence', () => {
    const q = buildInstanceListQuery(TYPE, 'named', 100, 0)
    expect(q).toContain('PREFIX rdfs:')
    expect(q).toContain('GRAPH ?g { ?s a <' + TYPE + '> }')
    expect(q).toContain('SAMPLE(?lbl) AS ?label')
    expect(q).toContain('GROUP BY ?s')
    expect(q).toContain('COALESCE(?l1, ?l2, ?l3, STR(?s))')
    expect(q).toContain('ORDER BY ?label')
    expect(q).toContain('LIMIT 100 OFFSET 0')
  })

  it('sanitizes limit/offset to non-negative integers (no injection via paging)', () => {
    const q = buildInstanceListQuery(TYPE, 'none', 100.9, -5)
    expect(q).toContain('LIMIT 100 OFFSET 0')
    expect(q).not.toContain('GRAPH')
  })

  it('computes a positive offset for later pages', () => {
    expect(buildInstanceListQuery(TYPE, 'none', 100, 200)).toContain('LIMIT 100 OFFSET 200')
  })
})

describe('buildLabelsQuery', () => {
  it('fetches label (OPTIONAL) + a sample type per subject, grouped', () => {
    const q = buildLabelsQuery([RES, TYPE])
    expect(q).toContain(`VALUES ?s { <${RES}> <${TYPE}> }`)
    expect(q).toContain('SAMPLE(?lbl) AS ?label')
    expect(q).toContain('SAMPLE(?t) AS ?type')
    expect(q).toContain('GROUP BY ?s')
    // label is OPTIONAL (so label-less subjects still return a type) over the predicates
    expect(q).toContain('OPTIONAL { VALUES ?lp {')
    expect(q).toContain(`<${LABEL_PREDICATES[0]}>`)
    expect(q).toContain('?s ?lp ?lbl')
    expect(q).toContain('OPTIONAL { ?s a ?t }')
  })

  it('skips unsafe IRIs rather than interpolating them', () => {
    const q = buildLabelsQuery(['http://e.org/x> }', RES])
    expect(q).toContain(`<${RES}>`)
    expect(q).not.toContain('INSERT')
    expect(q).not.toContain('x> }')
  })
})

describe('buildEmbeddedTriplesQuery', () => {
  it('batches subjects via VALUES and selects ?s ?p ?o', () => {
    const q = buildEmbeddedTriplesQuery([RES, TYPE])
    expect(q).toContain(`VALUES ?s { <${RES}> <${TYPE}> }`)
    expect(q).toContain('SELECT DISTINCT ?s ?p ?o')
  })

  it('skips unsafe IRIs', () => {
    const q = buildEmbeddedTriplesQuery(['http://e.org/x> } DELETE', RES])
    expect(q).toContain(`<${RES}>`)
    expect(q).not.toContain('DELETE')
  })
})
