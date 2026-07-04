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
  resolveSearchPredicates,
  buildLabelValuesQuery,
  buildTypeQuery,
  buildTypeSubclassQuery,
  LABEL_PREDICATE_BATCH,
  buildValuesQuery,
  buildEmbeddedTriplesQuery,
  buildCompositionQuery,
  buildSubclassQuery,
  buildPathCountQuery,
  buildIncomingCountQuery,
  buildIncomingQuery,
  buildIncomingPredicatesQuery,
  buildEmbedOrphanQuery,
} from '../rdfQueries'

const RES = 'http://data.europa.eu/s66#endDate'
const TYPE = 'http://data.europa.eu/s66#Acronym'

// Strategy fixtures
const BOTH = { useNamed: true, useDefault: true } // own / unknown
const NAMED = { useNamed: true, useDefault: false } // merged
const DEFAULT = { useNamed: false, useDefault: true } // no quads

describe('buildValuesQuery', () => {
  it('selects the requested predicates for the requested subjects', () => {
    const q = buildValuesQuery([RES], [TYPE])
    expect(q).toContain(`VALUES ?s { <${RES}> }`)
    expect(q).toContain(`VALUES ?p { <${TYPE}> }`)
    expect(q).toContain('?s ?p ?v')
  })
  it('returns empty string when there are no safe subjects or predicates', () => {
    expect(buildValuesQuery([], [TYPE])).toBe('')
    expect(buildValuesQuery([RES], [])).toBe('')
    expect(buildValuesQuery(['not an iri'], [TYPE])).toBe('')
  })
})

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
  it('one distinct instance per row, page-bounded — labels resolved separately', () => {
    const q = buildInstanceListQuery(TYPE, NAMED, 100, 0)
    expect(q).toContain(`SELECT DISTINCT ?s WHERE { GRAPH ?g { ?s a <${TYPE}> } } LIMIT 100 OFFSET 0`)
    // Labels are NOT hand-rolled here anymore — the caller resolves them via the
    // shared resolveLabels (precedence + SKOS-XL + language) so they match the heading.
    expect(q).not.toContain('SAMPLE')
    expect(q).not.toContain('COALESCE')
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

describe('instance filter (label OR URI)', () => {
  const labelValues = LABEL_PREDICATES.map(p => `<${p}>`).join(' ')
  // WHERE body between `WHERE { ` and the final ` }` — the shared instanceMatch output.
  const bodyOf = (q: string) => q.substring(q.indexOf('WHERE { ') + 8, q.lastIndexOf(' }'))

  it('empty / whitespace / omitted filter leaves the plain membership query', () => {
    const plain = buildInstanceListQuery(TYPE, NAMED, 25, 0)
    expect(buildInstanceListQuery(TYPE, NAMED, 25, 0, '')).toBe(plain)
    expect(buildInstanceListQuery(TYPE, NAMED, 25, 0, '   ')).toBe(plain)
    expect(plain).not.toContain('FILTER')
    expect(buildInstanceCountQuery(TYPE, NAMED, '  ')).toBe(buildInstanceCountQuery(TYPE, NAMED))
  })

  it('matches URI OR every LABEL_PREDICATES label via a JOIN (no correlated EXISTS)', () => {
    const q = buildInstanceListQuery(TYPE, DEFAULT, 25, 0, 'smith')
    expect(q).toContain('CONTAINS(LCASE(STR(?s)), LCASE("smith"))')   // URI branch
    expect(q).toContain(`VALUES ?lp { ${labelValues} }`)              // label branch, joined
    expect(q).toContain('CONTAINS(LCASE(STR(?lbl)), LCASE("smith"))') // label branch
    expect(q).toContain('} UNION {')                                  // two branches...
    expect(q).not.toContain('EXISTS')                                 // ...not a correlated EXISTS
  })

  it('AND-of-tokens: a multi-word term requires every word in the same value', () => {
    const q = buildInstanceListQuery(TYPE, DEFAULT, 25, 0, '  noise   emer ')
    expect(q).toContain('CONTAINS(LCASE(STR(?lbl)), LCASE("noise")) && CONTAINS(LCASE(STR(?lbl)), LCASE("emer"))')
    expect(q).toContain('CONTAINS(LCASE(STR(?s)), LCASE("noise")) && CONTAINS(LCASE(STR(?s)), LCASE("emer"))')
  })

  it('list and count apply the IDENTICAL filtered body (no paging past a stale total)', () => {
    expect(bodyOf(buildInstanceListQuery(TYPE, BOTH, 25, 0, 'acme')))
      .toBe(bodyOf(buildInstanceCountQuery(TYPE, BOTH, 'acme')))
  })

  it('scopes the label triple with a DISTINCT graph var per strategy (not ?g)', () => {
    expect(buildInstanceListQuery(TYPE, NAMED, 25, 0, 'x')).toContain('GRAPH ?lg { ?s ?lp ?lbl }')
    const def = buildInstanceListQuery(TYPE, DEFAULT, 25, 0, 'x')
    expect(def).toContain('?s ?lp ?lbl')
    expect(def).not.toContain('GRAPH ?lg')
    expect(buildInstanceListQuery(TYPE, BOTH, 25, 0, 'x'))
      .toContain('{ GRAPH ?lg { ?s ?lp ?lbl } } UNION { ?s ?lp ?lbl }')
  })

  it('escapes each token so a crafted string cannot break out of the literal (injection)', () => {
    // no spaces → stays one token (the tokenizer splits on whitespace)
    const q = buildInstanceListQuery(TYPE, DEFAULT, 25, 0, 'x")}UNION{?s?p?o}')
    expect(q).toContain('x\\")}UNION{?s?p?o}') // quote escaped in place
    expect(q).not.toContain('x")}UNION')       // ...so no unescaped breakout survives
    expect(buildInstanceListQuery(TYPE, DEFAULT, 25, 0, 'back\\slash')).toContain('back\\\\slash')
  })

  it('matches only LITERAL label values (isLiteral) so composed URI hops fall out', () => {
    expect(buildInstanceListQuery(TYPE, DEFAULT, 25, 0, 'x'))
      .toContain('FILTER(isLiteral(?lbl) && CONTAINS(LCASE(STR(?lbl)), LCASE("x")))')
  })

  it('appends caller predicates (a type’s configured label field) to the VALUES', () => {
    const TITLE = 'http://data.europa.eu/s66#title'
    const q = buildInstanceListQuery(TYPE, DEFAULT, 25, 0, 'x', [...LABEL_PREDICATES, TITLE])
    expect(q).toContain(`VALUES ?lp { ${labelValues} <${TITLE}> }`)
    // list and count still agree with the custom predicate set
    expect(bodyOf(q)).toBe(bodyOf(buildInstanceCountQuery(TYPE, DEFAULT, 'x', [...LABEL_PREDICATES, TITLE])))
  })

  it('sanitizes caller predicates and falls back to the 6 defaults if none are valid', () => {
    const q = buildInstanceListQuery(TYPE, DEFAULT, 25, 0, 'x', ['not a safe iri > }'])
    expect(q).toContain(`VALUES ?lp { ${labelValues} }`)
  })
})

describe('orphan filter (unreferenced-only)', () => {
  const VIA = 'http://data.europa.eu/s66#isFundedBy'
  const bodyOf = (q: string) => q.substring(q.indexOf('WHERE { ') + 8, q.lastIndexOf(' }'))

  it('adds FILTER NOT EXISTS { ?owner <via> ?s } when an orphanVia is given', () => {
    const q = buildInstanceListQuery(TYPE, DEFAULT, 25, 0, undefined, undefined, VIA)
    expect(q).toContain(`FILTER NOT EXISTS { ?owner <${VIA}> ?s }`)
  })

  it('omits the orphan filter when no via (or an unsafe one) is given', () => {
    expect(buildInstanceListQuery(TYPE, DEFAULT, 25, 0)).not.toContain('?owner')
    expect(buildInstanceListQuery(TYPE, DEFAULT, 25, 0, undefined, undefined, 'not safe > }')).not.toContain('?owner')
  })

  it('scopes the owner triple per strategy and applies over a filtered union too', () => {
    // BOTH: owner triple gets its own graph var, and the orphan FILTER wraps the
    // search union so it applies to every branch.
    const q = buildInstanceListQuery(TYPE, BOTH, 25, 0, 'acme', undefined, VIA)
    expect(q).toContain(`{ GRAPH ?og { ?owner <${VIA}> ?s } } UNION { ?owner <${VIA}> ?s }`)
    expect(q).toContain('} UNION {') // the search branches survive inside the wrap
  })

  it('list and count apply the IDENTICAL orphan body', () => {
    expect(bodyOf(buildInstanceListQuery(TYPE, BOTH, 25, 0, 'acme', undefined, VIA)))
      .toBe(bodyOf(buildInstanceCountQuery(TYPE, BOTH, 'acme', undefined, VIA)))
  })
})

describe('resolveSearchPredicates', () => {
  const TITLE = 'http://data.europa.eu/s66#title'
  const RL = 'http://www.w3.org/2000/01/rdf-schema#label'
  const profile = (uris: string[], extra = {}) => ({ ok: true, properties: uris.map(u => ({ uri: u, count: 1 })), ...extra })

  it('explicit search list wins over label and defaults', () => {
    expect(resolveSearchPredicates({ search: [TITLE], label: [RL] }, profile([RL]))).toEqual([TITLE])
  })
  it('falls back to label fields — one field, no default-set redundancy', () => {
    expect(resolveSearchPredicates({ label: [TITLE] }, profile([TITLE, RL]))).toEqual([TITLE])
  })
  it('no config → the 6 defaults trimmed to a COMPLETE profile', () => {
    expect(resolveSearchPredicates({}, profile([RL, 'http://data.europa.eu/s66#rcn']))).toEqual([RL])
  })
  it('does NOT trim by a sampled profile (may omit a present predicate)', () => {
    expect(resolveSearchPredicates({}, profile([RL], { sampled: true }))).toEqual(LABEL_PREDICATES)
  })
  it('no profile → all 6 defaults', () => {
    expect(resolveSearchPredicates({}, undefined)).toEqual(LABEL_PREDICATES)
  })
  it('complete profile with none of the 6 present → falls back to all 6 (not empty)', () => {
    expect(resolveSearchPredicates({}, profile(['http://data.europa.eu/s66#rcn']))).toEqual(LABEL_PREDICATES)
  })
})

describe('buildLabelValuesQuery', () => {
  const RL = 'http://www.w3.org/2000/01/rdf-schema#label'
  const PL = 'http://www.w3.org/2004/02/skos/core#prefLabel'
  it('emits (?s ?p ?l) rows over a VALUES batch of subjects × predicates', () => {
    const q = buildLabelValuesQuery([RES, TYPE], [RL, PL])
    expect(q).toContain(`VALUES ?s { <${RES}> <${TYPE}> }`)
    expect(q).toContain(`VALUES ?p { <${RL}> <${PL}> }`)
    expect(q).toContain('?s ?p ?l')
    expect(q).toContain('SELECT ?s ?p ?l')
  })
  it('carries NO OPTIONAL/COALESCE (precedence is picked client-side) — keeps the WAF footprint low', () => {
    const q = buildLabelValuesQuery([RES], [RL, PL])
    expect(q).not.toContain('OPTIONAL')
    expect(q).not.toContain('COALESCE')
  })
  it('batches so a request never carries ≥6 vocab URLs at once (Fedlex WAF blocks ≥6)', () => {
    expect(LABEL_PREDICATE_BATCH).toBeLessThanOrEqual(5)
  })
  it('skips unsafe/whitespace IRIs on both axes; empty when nothing safe', () => {
    const q = buildLabelValuesQuery([`  ${RES}  `, 'x> }'], [RL])
    expect(q).toContain(`<${RES}>`)
    expect(q).not.toContain('x> }')
    expect(q).not.toContain(`<  ${RES}`)
    expect(buildLabelValuesQuery([], [RL])).toBe('')
    expect(buildLabelValuesQuery([RES], [])).toBe('')
  })
})

describe('buildTypeQuery', () => {
  it('emits DISTINCT (?s ?t) all asserted types, no label patterns (split from labels)', () => {
    const q = buildTypeQuery([RES])
    expect(q).toContain(`VALUES ?s { <${RES}> }`)
    expect(q).toContain('?s a ?t')
    // DISTINCT collapses `?s a ?t` duplicated across many graphs (Fedlex) at scan;
    // most-specific is narrowed client-side, NOT via a server-side NOT EXISTS/+ that
    // times out on such endpoints.
    expect(q).toContain('DISTINCT')
    expect(q).not.toContain('FILTER NOT EXISTS')
    expect(q).not.toContain('subClassOf')
    expect(q).not.toContain('COALESCE')
    expect(q).not.toContain('rdf-schema#label')
  })
  it('skips unsafe IRIs; empty when none safe', () => {
    expect(buildTypeQuery(['x> }'])).toBe('')
    expect(buildTypeQuery([`  ${RES}  `])).toContain(`<${RES}>`)
  })
})

describe('buildTypeSubclassQuery', () => {
  it('emits DISTINCT (?sub ?super) transitive subclass edges bounded by VALUES', () => {
    const q = buildTypeSubclassQuery([RES, TYPE])
    expect(q).toContain(`VALUES ?sub { <${RES}> <${TYPE}> }`)
    expect(q).toContain('subClassOf>+ ?super') // bounded transitive → cheap
    expect(q).toContain('DISTINCT')
    expect(q).toContain('FILTER(?sub != ?super)')
  })
  it('skips unsafe IRIs; empty when none safe', () => {
    expect(buildTypeSubclassQuery(['x> }'])).toBe('')
    expect(buildTypeSubclassQuery([`  ${RES}  `])).toContain(`<${RES}>`)
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
  it('chains class → embeds and counts the leaf; plain on default, DOT-separated', () => {
    const q = buildPathCountQuery([C, E1, E2], DEFAULT)
    expect(q).toContain('SELECT (COUNT(DISTINCT ?x2) AS ?n)')
    // Bare triples MUST be dot-separated or Virtuoso rejects the query
    // (SP030 syntax error) — assert the full joined body, not each triple alone.
    expect(q).toContain(`?x0 a <${C}> . ?x0 ?p1 ?x1 . ?x1 a <${E1}> . ?x1 ?p2 ?x2 . ?x2 a <${E2}>`)
    expect(q).not.toContain('GRAPH')
  })
  it('merged (never default) wraps each statement in its own GRAPH, dot-separated', () => {
    expect(buildPathCountQuery([C, E1], NAMED))
      .toContain(`GRAPH ?g0 { ?x0 a <${C}> } . GRAPH ?g1 { ?x0 ?p1 ?x1 } . GRAPH ?g2 { ?x1 a <${E1}> }`)
  })
  it('returns empty for too-short chains or unsafe IRIs', () => {
    expect(buildPathCountQuery([C], DEFAULT)).toBe('')
    expect(buildPathCountQuery([C, 'http://e.org/x> } DROP'], DEFAULT)).toBe('')
  })
})

describe('incoming (inverse) relations', () => {
  it('count: distinct referencing subjects, graph-scoped per strategy', () => {
    expect(buildIncomingCountQuery(RES, DEFAULT)).toBe(`SELECT (COUNT(DISTINCT ?s) AS ?n) WHERE { ?s ?p <${RES}> }`)
    expect(buildIncomingCountQuery(RES, NAMED)).toContain(`GRAPH ?g { ?s ?p <${RES}> }`)
    expect(buildIncomingCountQuery(RES, BOTH)).toContain('FILTER NOT EXISTS')
    expect(() => buildIncomingCountQuery('http://e.org/x> } DROP', BOTH)).toThrow()
  })
  it('list: projects subject+predicate (+graph when named), capped', () => {
    const named = buildIncomingQuery(RES, NAMED, 500)
    expect(named).toContain('SELECT ?s ?g ?p')
    expect(named).toContain(`GRAPH ?g { ?s ?p <${RES}> }`)
    expect(named).toContain('LIMIT 500')
    const def = buildIncomingQuery(RES, DEFAULT, 500)
    expect(def).toContain('SELECT ?s ?p')
    expect(def).not.toContain('GRAPH')
    expect(buildIncomingQuery(RES, BOTH).split('LIMIT')[1].trim()).toBe('1000') // default cap
  })
})

describe('buildIncomingPredicatesQuery', () => {
  it('lists (predicate, source class) edges into a type with a distinct count; plain on default', () => {
    const q = buildIncomingPredicatesQuery(TYPE, DEFAULT)
    expect(q).toContain('SELECT ?p ?c (COUNT(DISTINCT ?o) AS ?n)')
    expect(q).toContain(`{ SELECT ?o WHERE { ?o a <${TYPE}> } LIMIT 2000 } ?s ?p ?o . ?s a ?c .`)
    expect(q).toContain(`FILTER(?c != <${TYPE}>)`)
    expect(q).toContain('GROUP BY ?p ?c')
    expect(q).toContain('ORDER BY DESC(?n)')
    expect(q).not.toContain('GRAPH')
  })
  it('merged (never default) wraps each pattern in its own GRAPH and samples the type', () => {
    const q = buildIncomingPredicatesQuery(TYPE, NAMED)
    expect(q).toContain(`{ SELECT ?o WHERE { GRAPH ?ge { ?o a <${TYPE}> } } LIMIT 2000 }`)
    expect(q).toContain('GRAPH ?gp { ?s ?p ?o }')
    expect(q).toContain('GRAPH ?gc { ?s a ?c }')
  })
  it('refuses an unsafe IRI', () => {
    expect(() => buildIncomingPredicatesQuery('http://e.org/x> } DROP', BOTH)).toThrow()
  })
})

describe('buildEmbedOrphanQuery', () => {
  const VIA = 'http://data.europa.eu/s66#isFundedBy'
  it('counts owner-linked instances per (type, predicate) pair; plain on default', () => {
    const q = buildEmbedOrphanQuery([{ type: TYPE, via: VIA }], DEFAULT)
    expect(q).toContain('SELECT ?e (COUNT(DISTINCT ?o) AS ?linked)')
    expect(q).toContain(`VALUES (?e ?via) { (<${TYPE}> <${VIA}>) }`)
    expect(q).toContain('?o a ?e . ?s ?via ?o .')
    expect(q).toContain('GROUP BY ?e')
    expect(q).not.toContain('GRAPH')
  })
  it('merged wraps the patterns in GRAPH', () => {
    expect(buildEmbedOrphanQuery([{ type: TYPE, via: VIA }], NAMED)).toContain('GRAPH ?gp { ?s ?via ?o }')
  })
  it('returns empty when no pair has safe IRIs (caller skips it)', () => {
    expect(buildEmbedOrphanQuery([{ type: 'http://e.org/x> }', via: VIA }], DEFAULT)).toBe('')
    expect(buildEmbedOrphanQuery([], DEFAULT)).toBe('')
  })
})
