import { describe, it, expect } from 'vitest'
import {
  stripComments,
  stripPrologue,
  firstKeyword,
  hasTopLevelLimit,
  ensureLimit,
  prepareQuery,
  DEFAULT_LIMIT,
} from '../sparqlGuard'

describe('stripComments', () => {
  it('removes # line comments', () => {
    expect(stripComments('SELECT * # trailing\nWHERE {}')).toBe('SELECT * \nWHERE {}')
  })
  it('keeps a # inside an <IRI> fragment', () => {
    const q = 'SELECT * WHERE { ?s <http://x#frag> ?o }'
    expect(stripComments(q)).toBe(q)
  })
  it('keeps a # inside a string literal', () => {
    const q = 'SELECT * WHERE { ?s ?p "a # b" }'
    expect(stripComments(q)).toBe(q)
  })
})

describe('stripPrologue / firstKeyword', () => {
  it('drops PREFIX and BASE declarations', () => {
    const q = 'PREFIX ex: <http://ex/>\nBASE <http://b/>\nSELECT ?s WHERE {}'
    expect(stripPrologue(q).startsWith('SELECT')).toBe(true)
  })
  it('finds the verb through comments + prologue', () => {
    const q = '# note\nPREFIX ex: <http://ex/>\n\nselect ?s WHERE {}'
    expect(firstKeyword(q)).toBe('SELECT')
  })
  it('finds a blocked verb by name', () => {
    expect(firstKeyword('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }')).toBe('CONSTRUCT')
  })
  it('returns null when there is no verb', () => {
    expect(firstKeyword('# only a comment\n')).toBeNull()
  })
})

describe('hasTopLevelLimit / ensureLimit', () => {
  it('detects a top-level LIMIT', () => {
    expect(hasTopLevelLimit('SELECT * WHERE { ?s ?p ?o } LIMIT 10')).toBe(true)
  })
  it('detects LIMIT after ORDER BY', () => {
    expect(hasTopLevelLimit('SELECT * WHERE { ?s ?p ?o } ORDER BY ?s LIMIT 5')).toBe(true)
  })
  it('ignores a LIMIT that only belongs to an inner sub-SELECT', () => {
    const q = 'SELECT * WHERE { { SELECT * WHERE { ?s ?p ?o } LIMIT 10 } }'
    expect(hasTopLevelLimit(q)).toBe(false)
  })
  it('appends LIMIT when none is present', () => {
    const r = ensureLimit('SELECT * WHERE { ?s ?p ?o }')
    expect(r.added).toBe(true)
    expect(r.query).toMatch(new RegExp(`LIMIT ${DEFAULT_LIMIT}$`))
  })
  it('leaves an existing LIMIT untouched', () => {
    const r = ensureLimit('SELECT * WHERE { ?s ?p ?o } LIMIT 3')
    expect(r.added).toBe(false)
    expect(r.query).toBe('SELECT * WHERE { ?s ?p ?o } LIMIT 3')
  })
})

describe('prepareQuery', () => {
  it('rejects an empty query', () => {
    const r = prepareQuery('   ')
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('allows SELECT and appends the default LIMIT when missing', () => {
    const r = prepareQuery('SELECT ?s ?p ?o WHERE { ?s ?p ?o }')
    expect(r.ok).toBe(true)
    expect(r.keyword).toBe('SELECT')
    expect(r.limitAdded).toBe(true)
    expect(r.query).toMatch(new RegExp(`LIMIT ${DEFAULT_LIMIT}$`))
  })

  it('allows SELECT and keeps an existing LIMIT', () => {
    const r = prepareQuery('SELECT * WHERE { ?s ?p ?o } LIMIT 5')
    expect(r.ok).toBe(true)
    expect(r.limitAdded).toBe(false)
    expect(r.query).not.toMatch(new RegExp(`LIMIT ${DEFAULT_LIMIT}`))
  })

  it('autoLimit=false sends an unbounded SELECT verbatim (no LIMIT appended)', () => {
    const r = prepareQuery('SELECT ?s ?p ?o WHERE { ?s ?p ?o }', false)
    expect(r.ok).toBe(true)
    expect(r.keyword).toBe('SELECT')
    expect(r.limitAdded).toBe(false)
    expect(r.query).not.toMatch(/LIMIT/)
  })

  it('allows ASK without adding a LIMIT', () => {
    const r = prepareQuery('ASK { ?s ?p ?o }')
    expect(r.ok).toBe(true)
    expect(r.keyword).toBe('ASK')
    expect(r.limitAdded).toBe(false)
    expect(r.query).toBe('ASK { ?s ?p ?o }')
  })

  it('is case-insensitive and sees through the prologue', () => {
    const r = prepareQuery('prefix ex: <http://ex/>\nselect ?s where { ?s a ex:Thing }')
    expect(r.ok).toBe(true)
    expect(r.keyword).toBe('SELECT')
  })

  it.each(['CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }', 'DESCRIBE <http://x>', 'INSERT DATA { <a> <b> <c> }', 'DELETE WHERE { ?s ?p ?o }', 'LOAD <http://x>'])(
    'blocks non read-only query: %s',
    (q) => {
      const r = prepareQuery(q)
      expect(r.ok).toBe(false)
      expect(r.error).toContain('read-only')
    },
  )
})
