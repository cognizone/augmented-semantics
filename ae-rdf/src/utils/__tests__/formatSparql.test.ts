import { describe, it, expect } from 'vitest'
import { formatSparql } from '../formatSparql'

/** Collapse all whitespace outside string literals — two queries equal under this
 *  are semantically identical (SPARQL is whitespace-insensitive). */
const normalize = (q: string) =>
  q.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\s+/g, (_m, str) => (str ? str : ' ')).trim()

describe('formatSparql', () => {
  const LIST =
    'SELECT DISTINCT ?s WHERE { GRAPH ?g { ?s a <http://data.europa.eu/949/VehicleRegistrationApplication> } ' +
    '{ VALUES ?f0 { <http://data.europa.eu/949/concepts/evidence-document-states/submitted> } ' +
    'GRAPH ?fg0 { ?s <http://data.europa.eu/949/state> ?f0 } } ' +
    '{ VALUES ?f1 { <http://data.europa.eu/949/organisation/body/LUX> } ' +
    'GRAPH ?fg1 { ?s <http://purl.org/dc/terms/audience> ?f1 } } FILTER(!isBlank(?s)) } LIMIT 100 OFFSET 0'

  it('preserves semantics (same query modulo whitespace)', () => {
    expect(normalize(formatSparql(LIST))).toBe(normalize(LIST))
  })

  it('actually indents (multi-line, nested)', () => {
    const out = formatSparql(LIST)
    expect(out.split('\n').length).toBeGreaterThan(8)
    expect(out).toMatch(/\n {4}\?s a </) // triple indented two levels under WHERE > GRAPH
    expect(out).toMatch(/\n {2}FILTER\(!isBlank\(\?s\)\)/) // FILTER on its own line, not after '}'
    expect(out).toMatch(/\n?LIMIT 100 OFFSET 0$/)
  })

  it('does not break a decimal point or clobber real numbers', () => {
    const q = 'SELECT ?s WHERE { ?s <http://p/v> ?v . FILTER(xsd:decimal(?v) >= 2010.5) } LIMIT 100'
    const out = formatSparql(q)
    expect(out).toContain('2010.5') // decimal intact, not split into a statement
    expect(out).toContain('LIMIT 100') // number not swallowed by the unmask step
    expect(normalize(out)).toBe(normalize(q))
  })

  it('keeps a typed-literal FILTER (string + datatype IRI) intact', () => {
    const q =
      'SELECT ?s WHERE { ?s <http://p/d> ?d . FILTER(?d >= "2014-01-01"^^<http://www.w3.org/2001/XMLSchema#date>) }'
    expect(normalize(formatSparql(q))).toBe(normalize(q))
    expect(formatSparql(q)).toContain('"2014-01-01"^^<http://www.w3.org/2001/XMLSchema#date>')
  })

  it('is idempotent', () => {
    const once = formatSparql(LIST)
    expect(formatSparql(once)).toBe(once)
  })
})
