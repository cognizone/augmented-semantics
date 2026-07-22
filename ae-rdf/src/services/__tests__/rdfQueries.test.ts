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
  buildBlankNodeTriplesQuery,
  buildDeprecatedQuery,
  buildTypeInventoryQuery,
  buildInstanceCountQuery,
  buildInstanceListQuery,
  buildInstanceColumnsQuery,
  resolveSearchPredicates,
  buildLabelValuesQuery,
  buildTypeQuery,
  buildTypeSubclassQuery,
  LABEL_PREDICATE_BATCH,
  buildValuesQuery,
  buildEmbeddedTriplesQuery,
  buildInverseEmbedQuery,
  buildCompositionQuery,
  buildSubclassQuery,
  buildPathCountQuery,
  buildIncomingCountQuery,
  buildIncomingQuery,
  buildIncomingBlankNodeQuery,
  buildIncomingPredicatesQuery,
  buildEmbedOrphanQuery,
  buildFacetConstraints,
  buildFacetValuesQuery,
  buildFacetRangesQuery,
  buildFacetMissingCountQuery,
  type FacetSelection,
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

describe('buildBlankNodeTriplesQuery', () => {
  it('binds the bnode relative to the resource and never in a VALUES list', () => {
    for (const s of [BOTH, NAMED, DEFAULT]) {
      const q = buildBlankNodeTriplesQuery(RES, s)
      expect(q).toContain(`<${RES}> ?xp1 ?b`) // path-scoped from the resource (depth-1 reach)
      expect(q).toContain('FILTER(isBlank(?b))') // only blank-node objects
      expect(q).toContain('?b ?p ?o') // fetch the bnode's own triples
      expect(q).not.toContain('VALUES') // a bnode has no queryable id
    }
  })
  it('selects the graph for quad strategies, omits it for the default-only strategy', () => {
    expect(buildBlankNodeTriplesQuery(RES, NAMED)).toContain('SELECT ?g ?b ?p ?o')
    expect(buildBlankNodeTriplesQuery(RES, DEFAULT)).toContain('SELECT ?b ?p ?o')
    expect(buildBlankNodeTriplesQuery(RES, DEFAULT)).not.toContain('?g')
  })
  it('rejects an unsafe resource IRI (injection guard)', () => {
    expect(() => buildBlankNodeTriplesQuery('http://x/a> } DROP ALL #', DEFAULT)).toThrow()
  })
})

describe('buildDeprecatedQuery', () => {
  const OWL = 'http://www.w3.org/2002/07/owl#deprecated'
  it('returns subjects asserting a predicate = "true", checking default + named graphs', () => {
    const q = buildDeprecatedQuery([RES], [OWL])
    expect(q).toContain(`VALUES ?s { <${RES}> }`)
    expect(q).toContain(`VALUES ?p { <${OWL}> }`)
    expect(q).toContain('{ ?s ?p ?d }') // default graph
    expect(q).toContain('GRAPH ?g { ?s ?p ?d }') // any named graph
    expect(q).toContain('FILTER(str(?d) = "true")')
  })
  it('returns empty when there are no safe subjects or predicates', () => {
    expect(buildDeprecatedQuery([], [OWL])).toBe('')
    expect(buildDeprecatedQuery([RES], [])).toBe('')
    expect(buildDeprecatedQuery(['not an iri'], [OWL])).toBe('')
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
    expect(buildTypeInventoryQuery(BOTH)).toContain('{ GRAPH ?g { ?s a ?type . } } UNION { ?s a ?type . }')
    expect(buildTypeInventoryQuery(NAMED)).toContain('GRAPH ?g { ?s a ?type . }')
    expect(buildTypeInventoryQuery(NAMED)).not.toContain('UNION')
    const def = buildTypeInventoryQuery(DEFAULT)
    expect(def).toContain('?s a ?type')
    expect(def).not.toContain('GRAPH')
  })

  it('instance count: distinct, graph-scoped per strategy, bnodes excluded', () => {
    expect(buildInstanceCountQuery(TYPE, NAMED)).toBe(
      `SELECT (COUNT(DISTINCT ?s) AS ?total) WHERE { GRAPH ?g { ?s a <${TYPE}> . } FILTER(!isBlank(?s)) }`
    )
    expect(buildInstanceCountQuery(TYPE, DEFAULT)).toBe(
      `SELECT (COUNT(DISTINCT ?s) AS ?total) WHERE { ?s a <${TYPE}> . FILTER(!isBlank(?s)) }`
    )
    expect(buildInstanceCountQuery(TYPE, BOTH)).toContain('UNION')
    expect(() => buildInstanceCountQuery('http://e.org/x> }', BOTH)).toThrow()
  })

  // Bnode instances have no standalone view — the navigable index (list + count,
  // which share instanceMatch) excludes them so a mixed type doesn't offer rows
  // that navigate nowhere. The type-inventory count is membership-total (bnodes in).
  it('list and count exclude bnodes; inventory keeps them', () => {
    expect(buildInstanceListQuery(TYPE, NAMED, 25, 0)).toContain('FILTER(!isBlank(?s))')
    expect(buildInstanceCountQuery(TYPE, NAMED)).toContain('FILTER(!isBlank(?s))')
    expect(buildInstanceListQuery(TYPE, DEFAULT, 25, 0, 'smith')).toContain('FILTER(!isBlank(?s))')
    expect(buildTypeInventoryQuery(BOTH)).not.toContain('isBlank')
  })
})

describe('buildInstanceListQuery', () => {
  it('one distinct instance per row, page-bounded — labels resolved separately', () => {
    const q = buildInstanceListQuery(TYPE, NAMED, 100, 0)
    expect(q).toContain(`SELECT DISTINCT ?s WHERE { GRAPH ?g { ?s a <${TYPE}> . } FILTER(!isBlank(?s)) } LIMIT 100 OFFSET 0`)
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
    expect(plain).not.toContain('CONTAINS') // no search filter (the bnode FILTER is always present)
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
    expect(buildInstanceListQuery(TYPE, NAMED, 25, 0, 'x')).toContain('GRAPH ?lg { ?s ?lp ?lbl . }')
    const def = buildInstanceListQuery(TYPE, DEFAULT, 25, 0, 'x')
    expect(def).toContain('?s ?lp ?lbl')
    expect(def).not.toContain('GRAPH ?lg')
    expect(buildInstanceListQuery(TYPE, BOTH, 25, 0, 'x'))
      .toContain('{ GRAPH ?lg { ?s ?lp ?lbl . } } UNION { ?s ?lp ?lbl . }')
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
    expect(q).toContain(`FILTER NOT EXISTS { ?owner <${VIA}> ?s . }`)
  })

  it('omits the orphan filter when no via (or an unsafe one) is given', () => {
    expect(buildInstanceListQuery(TYPE, DEFAULT, 25, 0)).not.toContain('?owner')
    expect(buildInstanceListQuery(TYPE, DEFAULT, 25, 0, undefined, undefined, 'not safe > }')).not.toContain('?owner')
  })

  it('scopes the owner triple per strategy and applies over a filtered union too', () => {
    // BOTH: owner triple gets its own graph var, and the orphan FILTER wraps the
    // search union so it applies to every branch.
    const q = buildInstanceListQuery(TYPE, BOTH, 25, 0, 'acme', undefined, VIA)
    expect(q).toContain(`{ GRAPH ?og { ?owner <${VIA}> ?s . } } UNION { ?owner <${VIA}> ?s . }`)
    expect(q).toContain('} UNION {') // the search branches survive inside the wrap
  })

  it('list and count apply the IDENTICAL orphan body', () => {
    expect(bodyOf(buildInstanceListQuery(TYPE, BOTH, 25, 0, 'acme', undefined, VIA)))
      .toBe(bodyOf(buildInstanceCountQuery(TYPE, BOTH, 'acme', undefined, VIA)))
  })
})

describe('buildFacetConstraints (selection serialization)', () => {
  const P1 = 'http://data.europa.eu/s66#status'
  const P2 = 'http://data.europa.eu/s66#country'
  const AMOUNT = 'http://data.europa.eu/s66#totalCost'
  const uri = (v: string) => ({ value: v, isUri: true })

  it('single-select → the value inlined into the object position (no VALUES/var)', () => {
    const sel: FacetSelection[] = [{ predicate: P1, terms: [uri('http://x/OPEN')] }]
    const frag = buildFacetConstraints(sel, DEFAULT)
    expect(frag).toBe(`{ ?s <${P1}> <http://x/OPEN> . }`)
    expect(frag).not.toContain('VALUES')
  })

  it('multi-select within a facet = OR (all terms in one VALUES list)', () => {
    const frag = buildFacetConstraints([{ predicate: P1, terms: [uri('http://x/A'), uri('http://x/B')] }], DEFAULT)
    expect(frag).toContain('VALUES ?f0 { <http://x/A> <http://x/B> }')
    expect(frag).toContain(`?s <${P1}> ?f0 .`)
  })

  it('across facets = AND (fragments concatenated, distinct vars per facet)', () => {
    const frag = buildFacetConstraints([
      { predicate: P1, terms: [uri('http://x/A'), uri('http://x/B')] },
      { predicate: P2, terms: [uri('http://x/CH')] },
    ], DEFAULT)
    expect(frag).toContain('VALUES ?f0 { <http://x/A> <http://x/B> }')
    expect(frag).toContain(`?s <${P1}> ?f0 .`)
    expect(frag).toContain(`?s <${P2}> <http://x/CH> .`) // second facet single → inlined
  })

  it('literal terms: escape quotes/backslash, preserve lang and datatype', () => {
    const frag = buildFacetConstraints([{
      predicate: P1,
      terms: [
        { value: 'a"b\\c', isUri: false },
        { value: 'active', isUri: false, lang: 'en' },
        { value: '2020', isUri: false, datatype: 'http://www.w3.org/2001/XMLSchema#gYear' },
      ],
    }], DEFAULT)
    expect(frag).toContain('"a\\"b\\\\c"')                       // escaped, no lang/datatype
    expect(frag).toContain('"active"@en')                        // language tag
    expect(frag).toContain('"2020"^^<http://www.w3.org/2001/XMLSchema#gYear>') // datatype
  })

  it('range facet → decimal-cast FILTER, both bounds, OR of bands', () => {
    const DEC = '<http://www.w3.org/2001/XMLSchema#decimal>'
    const frag = buildFacetConstraints([{
      predicate: AMOUNT,
      ranges: [{ min: 0, max: 1000 }, { min: 1000 }],
    }], DEFAULT)
    expect(frag).toContain(`?s <${AMOUNT}> ?f0`)
    expect(frag).toContain(`(${DEC}(?f0) >= 0 && ${DEC}(?f0) < 1000)`)
    expect(frag).toContain(`(${DEC}(?f0) >= 1000)`)  // open-ended: no upper bound term
    expect(frag).toContain(' || ')                   // multi-band OR
  })

  it('range facet: omits whichever bound is absent', () => {
    const DEC = '<http://www.w3.org/2001/XMLSchema#decimal>'
    const only = buildFacetConstraints([{ predicate: AMOUNT, ranges: [{ max: 500 }] }], DEFAULT)
    expect(only).toContain(`${DEC}(?f0) < 500`)
    expect(only).not.toContain('>=')
  })

  it('missing band → OPTIONAL-bind value + group FILTER so instances with NO value match', () => {
    const DATE = 'http://purl.org/dc/terms/dateAccepted'
    const XDATE = '<http://www.w3.org/2001/XMLSchema#date>'
    // missing only: match instances lacking the value entirely
    const only = buildFacetConstraints([{ predicate: DATE, datatype: 'date', ranges: [{ missing: true }] }], DEFAULT)
    expect(only).toContain(`OPTIONAL { ?s <${DATE}> ?f0 . }`)
    expect(only).toContain('FILTER(!BOUND(?f0))')
    // missing + a value band → guarded band OR'd with !BOUND
    const mixed = buildFacetConstraints([{ predicate: DATE, datatype: 'date', ranges: [{ min: 2022, max: 2023 }, { missing: true }] }], DEFAULT)
    expect(mixed).toContain(`OPTIONAL { ?s <${DATE}> ?f0 . }`)
    expect(mixed).toContain(`(BOUND(?f0) && (?f0 >= "2022-01-01"^^${XDATE} && ?f0 < "2023-01-01"^^${XDATE}))`)
    expect(mixed).toContain('|| !BOUND(?f0)')
  })

  it('scopes the constraint triple per strategy (mirrors instanceMatch)', () => {
    // Two terms so the facet var survives (a single term inlines the object).
    const sel: FacetSelection[] = [{ predicate: P1, terms: [uri('http://x/A'), uri('http://x/B')] }]
    expect(buildFacetConstraints(sel, NAMED)).toContain(`GRAPH ?fg0 { ?s <${P1}> ?f0 . }`)
    expect(buildFacetConstraints(sel, BOTH))
      .toContain(`{ GRAPH ?fg0 { ?s <${P1}> ?f0 . } } UNION { ?s <${P1}> ?f0 . }`)
  })

  it('drops unsafe predicates and unsafe URI terms; empty when nothing selectable', () => {
    expect(buildFacetConstraints([], DEFAULT)).toBe('')
    expect(buildFacetConstraints([{ predicate: 'not safe > }', terms: [uri('http://x/A')] }], DEFAULT)).toBe('')
    // unsafe URI term dropped → no safe terms → whole facet dropped
    expect(buildFacetConstraints([{ predicate: P1, terms: [uri('http://x/a> } DROP')] }], DEFAULT)).toBe('')
  })
})

describe('buildFacetValuesQuery', () => {
  const PRED = 'http://data.europa.eu/s66#status'
  it('distinct-subject counts per value, commonest first, limit+1 to detect truncation', () => {
    const q = buildFacetValuesQuery(TYPE, PRED, '', DEFAULT, 15)
    expect(q).toContain('SELECT ?v (COUNT(DISTINCT ?s) AS ?n)')
    expect(q).toContain(`?s a <${TYPE}>`)          // membership (default strategy)
    expect(q).toContain(`?s <${PRED}> ?v`)          // the faceted value triple
    expect(q).toContain('GROUP BY ?v')
    expect(q).toContain('ORDER BY DESC(?n)')
    expect(q).toContain('LIMIT 16')                 // 15 + 1
  })
  it('embeds the constraint fragment (other facets) and scopes per strategy', () => {
    const frag = buildFacetConstraints([{ predicate: 'http://x/p', terms: [{ value: 'http://x/A', isUri: true }] }], NAMED)
    const q = buildFacetValuesQuery(TYPE, PRED, frag, NAMED, 10)
    expect(q).toContain(frag)
    expect(q).toContain(`GRAPH ?g { ?s a <${TYPE}> . }`) // membership scoped
    expect(q).toContain(`GRAPH ?vg { ?s <${PRED}> ?v . }`) // value triple scoped
    expect(q).toContain('LIMIT 11')
  })
  it('refuses unsafe type / predicate IRIs', () => {
    expect(() => buildFacetValuesQuery('http://e.org/x> } DROP', PRED, '', DEFAULT)).toThrow()
    expect(() => buildFacetValuesQuery(TYPE, 'http://e.org/x> } DROP', '', DEFAULT)).toThrow()
  })
})

describe('buildFacetRangesQuery', () => {
  const AMOUNT = 'http://data.europa.eu/s66#totalCost'
  const DEC = '<http://www.w3.org/2001/XMLSchema#decimal>'
  it('one query, a COUNT subselect with a range FILTER per bucket (literal-index friendly)', () => {
    const q = buildFacetRangesQuery(TYPE, AMOUNT, [{ max: 1000 }, { min: 1000, max: 5000 }], '', DEFAULT)
    expect(q).toContain(`{ SELECT (COUNT(*) AS ?b0) WHERE { ?s a <${TYPE}> . ?s <${AMOUNT}> ?v . FILTER(${DEC}(?v) < 1000) } }`)
    expect(q).toContain(`{ SELECT (COUNT(*) AS ?b1) WHERE { ?s a <${TYPE}> . ?s <${AMOUNT}> ?v . FILTER(${DEC}(?v) >= 1000 && ${DEC}(?v) < 5000) } }`)
    expect(q.startsWith('SELECT ?b0 ?b1 WHERE {')).toBe(true)
    // SUM(IF) is the shape the optimizer can't index — it must be gone.
    expect(q).not.toContain('SUM(IF')
  })
  it('embeds the constraint fragment and scopes membership per strategy', () => {
    const q = buildFacetRangesQuery(TYPE, AMOUNT, [{ min: 0 }], 'FRAG_HERE', NAMED)
    expect(q).toContain('FRAG_HERE')
    expect(q).toContain(`GRAPH ?g { ?s a <${TYPE}> . }`)
  })
  it('date bands: ONE year-grouped scan folded into bands (xsd:date has no literal-index help)', () => {
    const DATE = 'http://purl.org/dc/terms/dateAccepted'
    const q = buildFacetRangesQuery(TYPE, DATE, [{ min: 2022, max: 2023 }, { max: 2000 }], '', DEFAULT, undefined, 'date')
    expect(q).not.toContain('OPTIONAL')
    expect(q).toContain(`?s <${DATE}> ?v`)
    // inner scan groups by year ONCE…
    expect(q).toContain('BIND(YEAR(?v) AS ?y)')
    expect(q).toContain('GROUP BY ?y')
    // …outer aggregate folds year rows into the config bands (BOUND-guarded).
    expect(q).toContain('(SUM(IF(BOUND(?y) && ?y >= 2022 && ?y < 2023, ?n, 0)) AS ?b0)')
    expect(q).toContain('(SUM(IF(BOUND(?y) && ?y < 2000, ?n, 0)) AS ?b1)')
    // exactly one scan of the type join — not one per band
    expect(q.match(/a <http/g)!.length).toBe(1)
  })
  it('dateTime bands compare as xsd:dateTime constants (match the data, keep the index)', () => {
    const DATE = 'http://purl.org/dc/terms/dateAccepted'
    const XDT = '<http://www.w3.org/2001/XMLSchema#dateTime>'
    const q = buildFacetRangesQuery(TYPE, DATE, [{ min: 2022, max: 2023 }], '', DEFAULT, undefined, 'dateTime')
    expect(q).toContain(`FILTER(?v >= "2022-01-01T00:00:00Z"^^${XDT} && ?v < "2023-01-01T00:00:00Z"^^${XDT})`)
  })
})

describe('buildFacetMissingCountQuery ("no value" bucket, run separately)', () => {
  const DATE = 'http://purl.org/dc/terms/dateAccepted'
  it('counts distinct subjects with NO value via a group-level NOT EXISTS', () => {
    const q = buildFacetMissingCountQuery(TYPE, DATE, '', DEFAULT)
    expect(q).toContain('SELECT (COUNT(DISTINCT ?s) AS ?n)')
    expect(q).toContain(`?s a <${TYPE}>`)              // membership binds ?s
    expect(q).toContain(`FILTER NOT EXISTS { ?s <${DATE}> ?v . }`)
  })
  it('embeds the constraint fragment (other facets) and scopes per strategy', () => {
    const q = buildFacetMissingCountQuery(TYPE, DATE, 'FRAG_HERE', NAMED)
    expect(q).toContain('FRAG_HERE')
    expect(q).toContain(`GRAPH ?g { ?s a <${TYPE}> . }`)
    expect(q).toContain(`GRAPH ?vg { ?s <${DATE}> ?v . }`)
  })
  it('returns "" when the via path is unsafe (caller then leaves the bucket at 0)', () => {
    expect(buildFacetMissingCountQuery(TYPE, DATE, '', DEFAULT, 'bad > } DROP')).toBe('')
  })
})

describe('buildInstanceColumnsQuery (instance-list columns)', () => {
  const U = ['http://r/a', 'http://r/b']
  const STATUS = 'http://p/status'
  const COST = 'http://p/cost'
  const VALUE = 'http://p/value'

  it('one SAMPLE per column under GROUP BY ?s, direct + via', () => {
    const q = buildInstanceColumnsQuery(U, [{ predicate: STATUS }, { predicate: COST, via: VALUE }], DEFAULT)
    expect(q).toContain('VALUES ?s { <http://r/a> <http://r/b> }')
    expect(q).toContain('(SAMPLE(?c0) AS ?v0)')
    expect(q).toContain(`OPTIONAL { ?s <${STATUS}> ?c0 . }`)          // direct
    expect(q).toContain(`OPTIONAL { ?s <${COST}> ?cg1_m0 . ?cg1_m0 <${VALUE}> ?c1 . }`) // via
    expect(q).toContain('GROUP BY ?s')
  })

  it('drops an unsafe column but keeps the rest (var index stays with the column)', () => {
    const q = buildInstanceColumnsQuery(U, [{ predicate: 'bad > } DROP' }, { predicate: STATUS }], DEFAULT)
    expect(q).not.toContain('?v0')                                  // unsafe col0 omitted
    expect(q).toContain('(SAMPLE(?c1) AS ?v1)')                     // col1 keeps its index
  })

  it('empty when no uris or no safe columns', () => {
    expect(buildInstanceColumnsQuery([], [{ predicate: STATUS }], DEFAULT)).toBe('')
    expect(buildInstanceColumnsQuery(U, [], DEFAULT)).toBe('')
    expect(buildInstanceColumnsQuery(U, [{ predicate: 'bad > }' }], DEFAULT)).toBe('')
  })

  it('sanitizes the subject URIs (no injection via a crafted uri)', () => {
    const q = buildInstanceColumnsQuery(['http://r/a> } DROP', 'http://r/ok'], [{ predicate: STATUS }], DEFAULT)
    expect(q).toContain('<http://r/ok>')
    expect(q).not.toContain('DROP')
  })
})

describe('facet 2-hop (via) + date ranges', () => {
  const COST = 'http://data.europa.eu/s66#hasTotalCost'
  const VALUE = 'http://data.europa.eu/s66#value'
  const DATE = 'http://data.europa.eu/s66#startDate'
  const DEC = '<http://www.w3.org/2001/XMLSchema#decimal>'
  const XDATE = '<http://www.w3.org/2001/XMLSchema#date>'

  it('via range facet: dot-separated 2-hop, range casts the SECOND-hop value', () => {
    const frag = buildFacetConstraints([{ predicate: COST, via: VALUE, ranges: [{ min: 1000000 }] }], DEFAULT)
    expect(frag).toContain(`?s <${COST}> ?fg0_m0 . ?fg0_m0 <${VALUE}> ?f0 .`)
    expect(frag).toContain(`${DEC}(?f0) >= 1000000`)
  })

  it('via value facet (multi-select): VALUES on the second-hop value var, 2-hop path', () => {
    const frag = buildFacetConstraints([{ predicate: COST, via: VALUE, terms: [{ value: 'EUR', isUri: false }, { value: 'USD', isUri: false }] }], DEFAULT)
    expect(frag).toContain('VALUES ?f0 { "EUR" "USD" }')
    expect(frag).toContain(`?s <${COST}> ?fg0_m0 . ?fg0_m0 <${VALUE}> ?f0 .`)
  })

  it('via single value: inlined at the second hop, no VALUES/var', () => {
    const frag = buildFacetConstraints([{ predicate: COST, via: VALUE, terms: [{ value: 'EUR', isUri: false }] }], DEFAULT)
    expect(frag).not.toContain('VALUES')
    expect(frag).toContain(`?s <${COST}> ?fg0_m0 . ?fg0_m0 <${VALUE}> "EUR" .`)
  })

  it('via scopes BOTH hops per strategy (distinct graph vars)', () => {
    const frag = buildFacetConstraints([{ predicate: COST, via: VALUE, ranges: [{ min: 0 }] }], NAMED)
    expect(frag).toContain(`GRAPH ?fg0a { ?s <${COST}> ?fg0_m0 . }`)
    expect(frag).toContain(`GRAPH ?fg0b { ?fg0_m0 <${VALUE}> ?f0 . }`)
  })

  it('unsafe via → whole facet dropped (never facets on the wrapper node)', () => {
    expect(buildFacetConstraints([{ predicate: COST, via: 'bad > } DROP', ranges: [{ min: 0 }] }], DEFAULT)).toBe('')
  })

  it('via as a PATH walks every hop (Organisation → site → address → country)', () => {
    const SITE = 'http://data.europa.eu/s66#hasSite'
    const ADDR = 'http://data.europa.eu/s66#hasAddress'
    const CTRY = 'http://data.europa.eu/s66#addressCountry'
    const frag = buildFacetConstraints([{ predicate: SITE, via: [ADDR, CTRY], terms: [{ value: 'DE', isUri: false }] }], DEFAULT)
    expect(frag).toContain(`?s <${SITE}> ?fg0_m0 . ?fg0_m0 <${ADDR}> ?fg0_m1 . ?fg0_m1 <${CTRY}> "DE" .`) // single value inlined at the terminal hop
    // any unsafe hop in the path drops the whole facet
    expect(buildFacetConstraints([{ predicate: SITE, via: [ADDR, 'x > } DROP'], terms: [{ value: 'DE', isUri: false }] }], DEFAULT)).toBe('')
  })

  it('date range: bands are YEARs compared as xsd:date, no decimal cast', () => {
    const frag = buildFacetConstraints([{
      predicate: DATE, datatype: 'date', ranges: [{ min: 2015, max: 2020 }],
    }], DEFAULT)
    expect(frag).toContain(`?f0 >= "2015-01-01"^^${XDATE} && ?f0 < "2020-01-01"^^${XDATE}`)
    expect(frag).not.toContain(DEC)
  })

  it('buildFacetRangesQuery threads via + datatype through to the band subselects', () => {
    const q = buildFacetRangesQuery(TYPE, COST, [{ min: 1000000 }], '', DEFAULT, VALUE)
    expect(q).toContain(`?s <${COST}> ?vg_m0 . ?vg_m0 <${VALUE}> ?v .`)
    expect(q).toContain(`FILTER(${DEC}(?v) >= 1000000)`)
    const qd = buildFacetRangesQuery(TYPE, DATE, [{ max: 2015 }], '', DEFAULT, undefined, 'date')
    expect(qd).toContain('?y < 2015')
    expect(qd).toContain('GROUP BY ?y')
  })

  it('buildFacetValuesQuery threads via (2-hop value listing)', () => {
    const q = buildFacetValuesQuery(TYPE, COST, '', DEFAULT, 15, VALUE)
    expect(q).toContain(`?s <${COST}> ?vg_m0 . ?vg_m0 <${VALUE}> ?v .`)
  })
})

describe('facet constraints thread through the instance list + count', () => {
  const PRED = 'http://data.europa.eu/s66#status'
  const bodyOf = (q: string) => q.substring(q.indexOf('WHERE { ') + 8, q.lastIndexOf(' }'))
  it('list and count share the IDENTICAL facet-constrained body', () => {
    const frag = buildFacetConstraints([{ predicate: PRED, terms: [{ value: 'http://x/OPEN', isUri: true }] }], BOTH)
    const list = buildInstanceListQuery(TYPE, BOTH, 25, 0, 'acme', undefined, undefined, frag)
    const count = buildInstanceCountQuery(TYPE, BOTH, 'acme', undefined, undefined, frag)
    expect(list).toContain(frag)
    expect(bodyOf(list)).toBe(bodyOf(count))
  })
  it('no facet constraint → identical to the pre-facet query (backwards compatible)', () => {
    expect(buildInstanceListQuery(TYPE, NAMED, 25, 0))
      .toBe(buildInstanceListQuery(TYPE, NAMED, 25, 0, undefined, undefined, undefined, ''))
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
    // start materialized in a subquery: Virtuoso rejects a bare VALUES transitive start
    expect(q).toContain('{ SELECT ?sub WHERE { VALUES ?sub')
    expect(q).toContain('subClassOf>+ ?super') // bounded transitive → cheap
    expect(q).toContain('DISTINCT')
    expect(q).toContain('FILTER(?sub != ?super)')
  })
  it('skips unsafe IRIs; empty when none safe', () => {
    expect(buildTypeSubclassQuery(['x> }'])).toBe('')
    expect(buildTypeSubclassQuery([`  ${RES}  `])).toContain(`<${RES}>`)
  })
})

describe('buildInverseEmbedQuery', () => {
  it('finds referrers via the inverse predicates (VALUES ?via), graph-aware', () => {
    const q = buildInverseEmbedQuery(RES, [TYPE], BOTH)
    expect(q).toContain('SELECT DISTINCT ?s ?via')
    expect(q).toContain(`VALUES ?via { <${TYPE}> }`)
    expect(q).toContain(`?s ?via <${RES}>`)
    expect(q).toContain('GRAPH ?g') // BOTH → named ∪ default-only
  })
  it('plain pattern (no GRAPH) for a default-only endpoint', () => {
    const q = buildInverseEmbedQuery(RES, [TYPE], DEFAULT)
    expect(q).toContain(`?s ?via <${RES}>`)
    expect(q).not.toContain('GRAPH')
  })
  it('empty when no safe predicates', () => {
    expect(buildInverseEmbedQuery(RES, [], BOTH)).toBe('')
    expect(buildInverseEmbedQuery(RES, ['x> }'], BOTH)).toBe('')
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
  it('list: excludes blank-node referrers (fetched with their triples separately)', () => {
    expect(buildIncomingQuery(RES, DEFAULT)).toContain('FILTER(!isBlank(?s))')
    expect(buildIncomingQuery(RES, BOTH)).toContain('FILTER(!isBlank(?s))')
  })
  it('blank referrers: inverse link + isBlank + the bnode’s own triples, capped', () => {
    const def = buildIncomingBlankNodeQuery(RES, DEFAULT)
    expect(def).toContain(`?b ?xp <${RES}>`)      // the bnode points AT the resource
    expect(def).toContain('FILTER(isBlank(?b))')
    expect(def).toContain('?b ?p ?o')             // and we pull its own properties
    expect(def).toContain('SELECT ?xp ?b ?p ?o')
    expect(def).not.toContain('GRAPH')
    expect(def).toContain('LIMIT 2000')
    expect(buildIncomingBlankNodeQuery(RES, NAMED)).toContain('SELECT ?g ?xp ?b ?p ?o')
    expect(buildIncomingBlankNodeQuery(RES, BOTH)).toContain('FILTER NOT EXISTS')
    expect(() => buildIncomingBlankNodeQuery('http://e.org/x> } DROP', BOTH)).toThrow()
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
