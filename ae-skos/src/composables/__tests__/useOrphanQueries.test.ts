/**
 * useOrphanQueries Tests
 *
 * Tests for SPARQL query builders for orphan concept detection
 * @see /spec/ae-skos/sko02-SchemeSelector.md
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { describe, it, expect } from 'vitest'
import {
  buildSingleOrphanQuery,
  buildOrphanExclusionQueries,
  buildAllConceptsQuery,
} from '../useOrphanQueries'
import type { SPARQLEndpoint } from '../../types'

// Helper to create mock endpoint with specified relationships
function mockEndpoint(relationships: Partial<Record<string, boolean>>): SPARQLEndpoint {
  return {
    id: 'test-endpoint',
    name: 'Test Endpoint',
    url: 'http://example.org/sparql',
    analysis: {
      hasSkosContent: true,
      supportsNamedGraphs: false,
      skosGraphCount: 0,
      languages: [],
      analyzedAt: new Date().toISOString(),
      relationships: {
        hasInScheme: false,
        hasTopConceptOf: false,
        hasHasTopConcept: false,
        hasBroader: false,
        hasNarrower: false,
        hasBroaderTransitive: false,
        hasNarrowerTransitive: false,
        ...relationships,
      },
    },
    createdAt: new Date().toISOString(),
    accessCount: 0,
  } as SPARQLEndpoint
}

describe('useOrphanQueries', () => {
  describe('buildSingleOrphanQuery', () => {
    it('returns null if endpoint has no analysis', () => {
      const endpoint: SPARQLEndpoint = {
        id: 'test',
        name: 'Test',
        url: 'http://example.org/sparql',
        createdAt: new Date().toISOString(),
        accessCount: 0,
      } as SPARQLEndpoint

      const query = buildSingleOrphanQuery(endpoint, 100, 0)
      expect(query).toBeNull()
    })

    it('returns null if endpoint has no relationships', () => {
      const endpoint: SPARQLEndpoint = {
        id: 'test',
        name: 'Test',
        url: 'http://example.org/sparql',
        analysis: {
          hasSkosContent: true,
          supportsNamedGraphs: false,
          skosGraphCount: 0,
          languages: [],
          analyzedAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
        accessCount: 0,
      } as SPARQLEndpoint

      const query = buildSingleOrphanQuery(endpoint, 100, 0)
      expect(query).toBeNull()
    })

    it('returns null if all relationship capabilities are false', () => {
      const endpoint = mockEndpoint({})

      const query = buildSingleOrphanQuery(endpoint, 100, 0)
      expect(query).toBeNull()
    })

    it('includes inScheme branch if hasInScheme is true', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildSingleOrphanQuery(endpoint, 100, 0)
      expect(query).not.toBeNull()
      expect(query).toContain('{ ?concept skos:inScheme ?scheme . }')
      expect(query).not.toContain('{ ?scheme skos:hasTopConcept ?concept . }')
      expect(query).not.toContain('{ ?concept skos:topConceptOf ?scheme . }')
    })

    it('includes hasTopConcept branch if hasHasTopConcept is true', () => {
      const endpoint = mockEndpoint({ hasHasTopConcept: true })

      const query = buildSingleOrphanQuery(endpoint, 100, 0)
      expect(query).not.toBeNull()
      expect(query).toContain('{ ?scheme skos:hasTopConcept ?concept . }')
      expect(query).not.toContain('{ ?concept skos:inScheme ?scheme . }')
    })

    it('includes topConceptOf branch if hasTopConceptOf is true', () => {
      const endpoint = mockEndpoint({ hasTopConceptOf: true })

      const query = buildSingleOrphanQuery(endpoint, 100, 0)
      expect(query).not.toBeNull()
      expect(query).toContain('{ ?concept skos:topConceptOf ?scheme . }')
    })

    it('includes narrowerTransitive branch if both hasHasTopConcept and hasNarrowerTransitive are true', () => {
      const endpoint = mockEndpoint({
        hasHasTopConcept: true,
        hasNarrowerTransitive: true,
      })

      const query = buildSingleOrphanQuery(endpoint, 100, 0)
      expect(query).not.toBeNull()
      expect(query).toContain('{ ?scheme skos:hasTopConcept ?top . ?top skos:narrowerTransitive ?concept . }')
    })

    it('includes narrowerTransitive branch if both hasTopConceptOf and hasNarrowerTransitive are true', () => {
      const endpoint = mockEndpoint({
        hasTopConceptOf: true,
        hasNarrowerTransitive: true,
      })

      const query = buildSingleOrphanQuery(endpoint, 100, 0)
      expect(query).not.toBeNull()
      expect(query).toContain('{ ?top skos:topConceptOf ?scheme . ?top skos:narrowerTransitive ?concept . }')
    })

    it('includes broaderTransitive branch if both hasHasTopConcept and hasBroaderTransitive are true', () => {
      const endpoint = mockEndpoint({
        hasHasTopConcept: true,
        hasBroaderTransitive: true,
      })

      const query = buildSingleOrphanQuery(endpoint, 100, 0)
      expect(query).not.toBeNull()
      expect(query).toContain('{ ?scheme skos:hasTopConcept ?top . ?concept skos:broaderTransitive ?top . }')
    })

    it('includes broaderTransitive branch if both hasTopConceptOf and hasBroaderTransitive are true', () => {
      const endpoint = mockEndpoint({
        hasTopConceptOf: true,
        hasBroaderTransitive: true,
      })

      const query = buildSingleOrphanQuery(endpoint, 100, 0)
      expect(query).not.toBeNull()
      expect(query).toContain('{ ?top skos:topConceptOf ?scheme . ?concept skos:broaderTransitive ?top . }')
    })

    it('includes narrower property path branch if both hasHasTopConcept and hasNarrower are true', () => {
      const endpoint = mockEndpoint({
        hasHasTopConcept: true,
        hasNarrower: true,
      })

      const query = buildSingleOrphanQuery(endpoint, 100, 0)
      expect(query).not.toBeNull()
      expect(query).toContain('{ ?scheme skos:hasTopConcept ?top . ?top skos:narrower+ ?concept . }')
    })

    it('includes narrower property path branch if both hasTopConceptOf and hasNarrower are true', () => {
      const endpoint = mockEndpoint({
        hasTopConceptOf: true,
        hasNarrower: true,
      })

      const query = buildSingleOrphanQuery(endpoint, 100, 0)
      expect(query).not.toBeNull()
      expect(query).toContain('{ ?top skos:topConceptOf ?scheme . ?top skos:narrower+ ?concept . }')
    })

    it('includes broader property path branch if both hasHasTopConcept and hasBroader are true', () => {
      const endpoint = mockEndpoint({
        hasHasTopConcept: true,
        hasBroader: true,
      })

      const query = buildSingleOrphanQuery(endpoint, 100, 0)
      expect(query).not.toBeNull()
      expect(query).toContain('{ ?scheme skos:hasTopConcept ?top . ?concept skos:broader+ ?top . }')
    })

    it('includes broader property path branch if both hasTopConceptOf and hasBroader are true', () => {
      const endpoint = mockEndpoint({
        hasTopConceptOf: true,
        hasBroader: true,
      })

      const query = buildSingleOrphanQuery(endpoint, 100, 0)
      expect(query).not.toBeNull()
      expect(query).toContain('{ ?top skos:topConceptOf ?scheme . ?concept skos:broader+ ?top . }')
    })

    it('combines multiple branches with UNION', () => {
      const endpoint = mockEndpoint({
        hasInScheme: true,
        hasTopConceptOf: true,
        hasHasTopConcept: true,
      })

      const query = buildSingleOrphanQuery(endpoint, 100, 0)
      expect(query).not.toBeNull()
      expect(query).toContain('UNION')
      expect(query).toContain('{ ?concept skos:inScheme ?scheme . }')
      expect(query).toContain('{ ?scheme skos:hasTopConcept ?concept . }')
      expect(query).toContain('{ ?concept skos:topConceptOf ?scheme . }')
    })

    it('builds correct FILTER NOT EXISTS pattern', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildSingleOrphanQuery(endpoint, 100, 0)
      expect(query).not.toBeNull()
      expect(query).toContain('FILTER NOT EXISTS {')
      expect(query).toContain('?concept a skos:Concept .')
    })

    it('respects pagination with LIMIT and OFFSET', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildSingleOrphanQuery(endpoint, 5000, 10000)
      expect(query).not.toBeNull()
      expect(query).toContain('LIMIT 5000')
      expect(query).toContain('OFFSET 10000')
    })

    it('generates valid SPARQL syntax with all capabilities', () => {
      const endpoint = mockEndpoint({
        hasInScheme: true,
        hasTopConceptOf: true,
        hasHasTopConcept: true,
        hasBroader: true,
        hasNarrower: true,
        hasBroaderTransitive: true,
        hasNarrowerTransitive: true,
      })

      const query = buildSingleOrphanQuery(endpoint, 100, 0)
      expect(query).not.toBeNull()
      expect(query).toContain('SELECT DISTINCT ?concept')
      expect(query).toContain('WHERE {')
      expect(query).toContain('?concept a skos:Concept .')
      expect(query).toContain('FILTER NOT EXISTS {')
      expect(query).toContain('ORDER BY ?concept')
    })
  })

  describe('buildOrphanExclusionQueries', () => {
    it('returns empty array if no relationships', () => {
      const endpoint = mockEndpoint({})

      const queries = buildOrphanExclusionQueries(endpoint, 100, 0)
      expect(queries).toEqual([])
    })

    it('returns empty array if endpoint has no analysis', () => {
      const endpoint: SPARQLEndpoint = {
        id: 'test',
        name: 'Test',
        url: 'http://example.org/sparql',
        createdAt: new Date().toISOString(),
        accessCount: 0,
      } as SPARQLEndpoint

      const queries = buildOrphanExclusionQueries(endpoint, 100, 0)
      expect(queries).toEqual([])
    })

    it('generates inScheme query if hasInScheme is true', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const queries = buildOrphanExclusionQueries(endpoint, 100, 0)
      expect(queries).toHaveLength(1)
      expect(queries[0].name).toBe('inScheme')
      expect(queries[0].query).toContain('?concept skos:inScheme ?scheme .')
    })

    it('generates hasTopConcept query if hasHasTopConcept is true', () => {
      const endpoint = mockEndpoint({ hasHasTopConcept: true })

      const queries = buildOrphanExclusionQueries(endpoint, 100, 0)
      expect(queries).toHaveLength(1)
      expect(queries[0].name).toBe('hasTopConcept')
      expect(queries[0].query).toContain('?scheme skos:hasTopConcept ?concept .')
    })

    it('generates topConceptOf query if hasTopConceptOf is true', () => {
      const endpoint = mockEndpoint({ hasTopConceptOf: true })

      const queries = buildOrphanExclusionQueries(endpoint, 100, 0)
      expect(queries).toHaveLength(1)
      expect(queries[0].name).toBe('topConceptOf')
      expect(queries[0].query).toContain('?concept skos:topConceptOf ?scheme .')
    })

    it('generates all possible queries for complete endpoint', () => {
      const endpoint = mockEndpoint({
        hasInScheme: true,
        hasTopConceptOf: true,
        hasHasTopConcept: true,
        hasBroader: true,
        hasNarrower: true,
        hasBroaderTransitive: true,
        hasNarrowerTransitive: true,
      })

      const queries = buildOrphanExclusionQueries(endpoint, 100, 0)
      expect(queries.length).toBeGreaterThan(8) // Should have many queries

      const queryNames = queries.map(q => q.name)
      expect(queryNames).toContain('inScheme')
      expect(queryNames).toContain('hasTopConcept')
      expect(queryNames).toContain('topConceptOf')
      expect(queryNames).toContain('hasTopConcept-narrowerTransitive')
      expect(queryNames).toContain('topConceptOf-narrowerTransitive')
      expect(queryNames).toContain('hasTopConcept-broaderTransitive')
      expect(queryNames).toContain('topConceptOf-broaderTransitive')
      expect(queryNames).toContain('hasTopConcept-narrower-path')
      expect(queryNames).toContain('topConceptOf-narrower-path')
      expect(queryNames).toContain('hasTopConcept-broader-path')
      expect(queryNames).toContain('topConceptOf-broader-path')
    })

    it('respects pagination parameters', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const queries = buildOrphanExclusionQueries(endpoint, 5000, 10000)
      expect(queries).toHaveLength(1)
      expect(queries[0].query).toContain('LIMIT 5000')
      expect(queries[0].query).toContain('OFFSET 10000')
    })

    it('returns array of named queries with valid SPARQL', () => {
      const endpoint = mockEndpoint({
        hasInScheme: true,
        hasTopConceptOf: true,
      })

      const queries = buildOrphanExclusionQueries(endpoint, 100, 0)
      expect(queries).toHaveLength(2)

      queries.forEach(({ name, query }) => {
        expect(name).toBeTruthy()
        expect(query).toContain('SELECT DISTINCT ?concept')
        expect(query).toContain('WHERE {')
        expect(query).toContain('?concept a skos:Concept .')
        expect(query).toContain('ORDER BY ?concept')
      })
    })

    it('skips composite queries when parent capability is missing', () => {
      const endpoint = mockEndpoint({
        hasInScheme: true,
        hasNarrowerTransitive: true, // Has transitive but not hasTopConcept
      })

      const queries = buildOrphanExclusionQueries(endpoint, 100, 0)
      const queryNames = queries.map(q => q.name)

      expect(queryNames).toContain('inScheme')
      // Should NOT contain composite queries that require hasTopConcept
      expect(queryNames).not.toContain('hasTopConcept-narrowerTransitive')
      expect(queryNames).not.toContain('topConceptOf-narrowerTransitive')
    })
  })

  describe('buildAllConceptsQuery', () => {
    it('queries for all skos:Concept instances', () => {
      const query = buildAllConceptsQuery(100, 0)

      expect(query).toContain('SELECT DISTINCT ?concept')
      expect(query).toContain('?concept a skos:Concept .')
    })

    it('applies LIMIT and OFFSET', () => {
      const query = buildAllConceptsQuery(5000, 10000)

      expect(query).toContain('LIMIT 5000')
      expect(query).toContain('OFFSET 10000')
    })

    it('orders by concept URI', () => {
      const query = buildAllConceptsQuery(100, 0)

      expect(query).toContain('ORDER BY ?concept')
    })

    it('includes PREFIX declarations', () => {
      const query = buildAllConceptsQuery(100, 0)

      expect(query).toContain('PREFIX skos:')
    })
  })
})
