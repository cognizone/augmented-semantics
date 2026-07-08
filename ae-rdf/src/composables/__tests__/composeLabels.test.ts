import { describe, it, expect } from 'vitest'
import { mostSpecificTypes, fetchInChunks, composeParts, isOpaqueLabel } from '../composeLabels'

// mostSpecificTypes is the client-side narrowing that replaced the server-side
// FILTER NOT EXISTS { ?s a ?more . ?more rdfs:subClassOf+ ?t } — which times out on
// endpoints that duplicate `?s a ?t` across thousands of graphs (Fedlex).
const CONCEPT = 'http://www.w3.org/2004/02/skos/core#Concept'
const JOLUX = 'http://data.legilux.public.lu/resource/ontology/jolux#Language'
const ELI = 'http://data.europa.eu/eli/ontology#Language'
const COLL = 'http://publications.europa.eu/resource/authority/language'
const set = (...xs: string[]) => new Set(xs)

describe('isOpaqueLabel', () => {
  it('treats a bare UUID as opaque (R17) but keeps a real name', () => {
    expect(isOpaqueLabel('8f02b279-37b4-5112-9c0b-387211605eab')).toBe(true)
    expect(isOpaqueLabel('NVR Vehicle ID')).toBe(false)
    expect(isOpaqueLabel('100000027546')).toBe(false)
  })
})

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

// composeParts is the pure compose half of composeViaLabels (contextual object
// labels): literal fields pick by language, URI fields resolve to the referent's
// label (self dropped), joined by ' · ', missing fields skipped.
describe('composeParts (viaLabels)', () => {
  const ROLE = 'ex:roleLabel', OF = 'ex:isRoleOf', IN = 'ex:isInvolvedIn'
  const lit = (v: string, lang?: string) => ({ v, uri: false, lang })
  const uri = (v: string) => ({ v, uri: true })
  const vals = (m: Record<string, { v: string; uri: boolean; lang?: string }[]>) =>
    new Map(Object.entries(m))

  it('composes a literal field + a URI field resolved via labelMap', () => {
    const out = composeParts(
      [ROLE, OF],
      vals({ [ROLE]: [lit('Coordinator')], [OF]: [uri('org1')] }),
      new Map([['org1', 'ACME']]),
      ['en'],
      'grant1',
    )
    expect(out).toBe('Coordinator · ACME')
  })

  it('drops a URI field that points at the viewed resource (self-reference)', () => {
    const out = composeParts(
      [ROLE, IN],
      vals({ [ROLE]: [lit('Coordinator')], [IN]: [uri('grant1')] }),
      new Map([['grant1', 'The Grant']]),
      ['en'],
      'grant1', // IN points back at self ⇒ dropped
    )
    expect(out).toBe('Coordinator')
  })

  it('picks the preferred language for a multilingual literal field', () => {
    const out = composeParts(
      [ROLE],
      vals({ [ROLE]: [lit('Coördinator', 'nl'), lit('Coordinator', 'en')] }),
      new Map(),
      ['en'],
      '',
    )
    expect(out).toBe('Coordinator')
  })

  it('skips absent fields; a URI field with no referent label falls back to the URI (homepage URL)', () => {
    const out = composeParts(
      [ROLE, IN, OF],
      vals({ [ROLE]: [lit('Partner')], [OF]: [uri('http://acme.example/')] }), // IN absent; OF is a bare URL
      new Map(), // no label for the URL — an author-chosen locator field
      ['en'],
      '',
    )
    expect(out).toBe('Partner · http://acme.example/')
  })
})
