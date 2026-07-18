import { describe, it, expect } from 'vitest'
import { injectPrefixes } from '../injectPrefixes'

const P = {
  era: 'http://data.europa.eu/949/',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
}

describe('injectPrefixes', () => {
  it('prepends a PREFIX for a used-but-undeclared known prefix', () => {
    const out = injectPrefixes('SELECT * { ?s a era:VehicleRegistrationApplication }', P)
    expect(out).toBe('PREFIX era: <http://data.europa.eu/949/>\nSELECT * { ?s a era:VehicleRegistrationApplication }')
  })

  it('does not redeclare a prefix the query already declares', () => {
    const q = 'PREFIX era: <http://x/>\nSELECT * { ?s a era:Foo }'
    expect(injectPrefixes(q, P)).toBe(q)
  })

  it('declares several used prefixes, sorted, and ignores unknown ones', () => {
    const out = injectPrefixes('SELECT * { ?s skos:prefLabel ?l FILTER(?d < xsd:date) ?s foo:bar ?x }', P)
    expect(out.startsWith('PREFIX skos: <http://www.w3.org/2004/02/skos/core#>\nPREFIX xsd:')).toBe(true)
    expect(out).not.toContain('PREFIX foo:') // unknown → left alone (endpoint will error, honestly)
  })

  it('ignores a colon inside an IRI or a string literal', () => {
    const q = 'SELECT * { ?s <http://data.europa.eu/949/state> "note: era:x" }'
    expect(injectPrefixes(q, P)).toBe(q) // no era: qname actually used
  })

  it('is a no-op when nothing known is used', () => {
    const q = 'SELECT * { ?s ?p ?o }'
    expect(injectPrefixes(q, P)).toBe(q)
  })
})
