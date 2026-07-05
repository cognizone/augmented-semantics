import { describe, it, expect } from 'vitest'
import { mostSpecificTypes, fetchInChunks } from '../composeLabels'

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

// fetchInChunks is the WAF mitigation: chunk the subject VALUES list, and on a
// payload-level rejection (400 QUERY_ERROR / WAF-HTML INVALID_RESPONSE) split the
// chunk and retry — down to a single URI, which is then dropped.
describe('fetchInChunks', () => {
  const waf = (code: string) => Object.assign(new Error('blocked'), { code })
  const uris = ['a', 'b', 'BAD', 'c', 'd'] // "BAD" is the WAF-tripping URI

  it('chunks the subject list by batch size', async () => {
    const seen: string[][] = []
    await fetchInChunks(uris, 2, async (chunk) => { seen.push(chunk); return chunk.map(u => ({ u })) })
    expect(seen).toEqual([['a', 'b'], ['BAD', 'c'], ['d']])
  })

  it('returns one binding per URI when nothing is rejected', async () => {
    const out = await fetchInChunks(uris, 2, async (chunk) => chunk.map(u => ({ u })))
    expect(out.map(b => b.u).sort()).toEqual(['BAD', 'a', 'b', 'c', 'd'])
  })

  it('split-retries a WAF-rejected chunk and drops only the offending URI', async () => {
    // Reject any chunk containing BAD with a 400; the recursion isolates it.
    const out = await fetchInChunks(uris, 5, async (chunk) => {
      if (chunk.includes('BAD')) throw waf('QUERY_ERROR')
      return chunk.map(u => ({ u }))
    })
    expect(out.map(b => b.u).sort()).toEqual(['a', 'b', 'c', 'd']) // BAD dropped, rest survive
  })

  it('does NOT split on a non-payload error (timeout/outage) — drops the whole chunk', async () => {
    let calls = 0
    const out = await fetchInChunks(['a', 'b', 'c', 'd'], 4, async () => { calls++; throw waf('TIMEOUT') })
    expect(out).toEqual([])
    expect(calls).toBe(1) // one attempt, no recursive splitting
  })
})
