import { describe, it, expect } from 'vitest'
import { prefixifyQuery } from '../prefixifyQuery'

const PREFIXES = {
  eurio: 'http://data.europa.eu/s66#',
  dcterms: 'http://purl.org/dc/terms/',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
}

describe('prefixifyQuery', () => {
  it('collapses IRIs to qnames and prepends only the used PREFIX lines', () => {
    const q = 'SELECT ?s WHERE { ?s a <http://data.europa.eu/s66#Project> }'
    const out = prefixifyQuery(q, PREFIXES)
    expect(out).toContain('PREFIX eurio: <http://data.europa.eu/s66#>')
    expect(out).toContain('?s a eurio:Project')
    expect(out).not.toContain('PREFIX dcterms:') // not used → not declared
    expect(out).not.toContain('PREFIX xsd:')
  })

  it('picks the longest (most specific) matching namespace', () => {
    const prefixes = { dc: 'http://purl.org/dc/', dcterms: 'http://purl.org/dc/terms/' }
    const out = prefixifyQuery('SELECT * { ?s <http://purl.org/dc/terms/title> ?o }', prefixes)
    expect(out).toContain('dcterms:title')
    expect(out).not.toContain('dc:terms/title')
  })

  it('leaves IRIs with no clean local name as full IRIs', () => {
    // local part carries a slash → not a safe PN_LOCAL → keep the full IRI.
    const q = 'SELECT * { ?s ?p <http://data.europa.eu/949/organisation/body/FIN> }'
    const out = prefixifyQuery(q, { era: 'http://data.europa.eu/949/' })
    expect(out).toContain('<http://data.europa.eu/949/organisation/body/FIN>')
    expect(out).not.toContain('PREFIX era:')
  })

  it('does not rewrite an IRI that appears inside a string literal', () => {
    const q = 'SELECT * { ?s ?p "see <http://data.europa.eu/s66#Project>" }'
    const out = prefixifyQuery(q, PREFIXES)
    expect(out).toContain('"see <http://data.europa.eu/s66#Project>"')
    expect(out).not.toContain('eurio:Project')
  })

  it('collapses a datatype IRI (xsd) and is a no-op when no prefixes match', () => {
    expect(prefixifyQuery('FILTER(?y < "2015"^^<http://www.w3.org/2001/XMLSchema#date>)', PREFIXES))
      .toContain('"2015"^^xsd:date')
    const none = 'SELECT * { ?s <http://unknown.example/p> ?o }'
    expect(prefixifyQuery(none, PREFIXES)).toBe(none)
  })
})
