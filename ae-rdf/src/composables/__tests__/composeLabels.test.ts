import { describe, it, expect } from 'vitest'
import { mostSpecificTypes } from '../composeLabels'

// mostSpecificTypes is the client-side narrowing that replaced the server-side
// FILTER NOT EXISTS { ?s a ?more . ?more rdfs:subClassOf+ ?t } — which times out on
// endpoints that duplicate `?s a ?t` across thousands of graphs (Fedlex).
const CONCEPT = 'http://www.w3.org/2004/02/skos/core#Concept'
const JOLUX = 'http://data.legilux.public.lu/resource/ontology/jolux#Language'
const ELI = 'http://data.europa.eu/eli/ontology#Language'
const COLL = 'http://publications.europa.eu/resource/authority/language'
const set = (...xs: string[]) => new Set(xs)

describe('mostSpecificTypes', () => {
  it('keeps everything when there are no subclass edges', () => {
    const out = mostSpecificTypes(new Map([['s', set(CONCEPT, JOLUX)]]), new Map())
    expect(out.get('s')).toEqual(set(CONCEPT, JOLUX))
  })

  it('drops a supertype when the subject also asserts a subtype (the Fedlex case)', () => {
    // FRA is typed Concept + jolux:Language + eli:Language + the collection;
    // both Languages are subclasses of skos:Concept, so Concept is dropped.
    const out = mostSpecificTypes(
      new Map([['FRA', set(CONCEPT, JOLUX, ELI, COLL)]]),
      new Map([[CONCEPT, set(JOLUX, ELI)]]),
    )
    expect(out.get('FRA')).toEqual(set(JOLUX, ELI, COLL))
  })

  it('collapses a multi-level chain to the leaf (transitive edges)', () => {
    const R = 'ex:Result', P = 'ex:ProjectPublication', J = 'ex:JournalPaper'
    const out = mostSpecificTypes(
      new Map([['x', set(R, P, J)]]),
      new Map([[R, set(P, J)], [P, set(J)]]), // buildTypeSubclassQuery gives transitive subtypes
    )
    expect(out.get('x')).toEqual(set(J))
  })

  it('keeps a supertype the subject asserts alone (no more-specific asserted type)', () => {
    const out = mostSpecificTypes(new Map([['s', set(CONCEPT)]]), new Map([[CONCEPT, set(JOLUX)]]))
    expect(out.get('s')).toEqual(set(CONCEPT))
  })

  it('narrows each subject independently', () => {
    const out = mostSpecificTypes(
      new Map([['a', set(CONCEPT, JOLUX)], ['b', set(CONCEPT)]]),
      new Map([[CONCEPT, set(JOLUX)]]),
    )
    expect(out.get('a')).toEqual(set(JOLUX))
    expect(out.get('b')).toEqual(set(CONCEPT))
  })
})
