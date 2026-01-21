/**
 * useCollectionQueries Tests
 *
 * Tests for capability-aware SPARQL query builders for collection loading
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { describe, it, expect } from 'vitest'
import {
  buildCollectionsQuery,
  buildChildCollectionsQuery,
  getCollectionQueryCapabilities,
} from '../useCollectionQueries'
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

const testScheme = 'http://example.org/scheme/test'

describe('useCollectionQueries', () => {
  describe('buildCollectionsQuery', () => {
    it('returns null if endpoint has no analysis', () => {
      const endpoint: SPARQLEndpoint = {
        id: 'test',
        name: 'Test',
        url: 'http://example.org/sparql',
        createdAt: new Date().toISOString(),
        accessCount: 0,
      } as SPARQLEndpoint

      const query = buildCollectionsQuery(endpoint, testScheme)
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

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).toBeNull()
    })

    it('returns null if all relationship capabilities are false', () => {
      const endpoint = mockEndpoint({})

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).toBeNull()
    })

    it('includes inScheme branch if hasInScheme is true', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      expect(query).toContain(`{ ?concept skos:inScheme <${testScheme}> . }`)
    })

    it('includes topConceptOf branch if hasTopConceptOf is true', () => {
      const endpoint = mockEndpoint({ hasTopConceptOf: true })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      expect(query).toContain(`{ ?concept skos:topConceptOf <${testScheme}> . }`)
    })

    it('includes hasTopConcept branch if hasHasTopConcept is true', () => {
      const endpoint = mockEndpoint({ hasHasTopConcept: true })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      expect(query).toContain(`{ <${testScheme}> skos:hasTopConcept ?concept . }`)
    })

    it('prefers broaderTransitive over broader+ when available', () => {
      const endpoint = mockEndpoint({
        hasTopConceptOf: true,
        hasBroaderTransitive: true,
        hasBroader: true, // Both available
      })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      expect(query).toContain('skos:broaderTransitive')
      expect(query).not.toContain('skos:broader+')
    })

    it('uses broader+ when broaderTransitive is not available', () => {
      const endpoint = mockEndpoint({
        hasTopConceptOf: true,
        hasBroaderTransitive: false,
        hasBroader: true,
      })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      expect(query).toContain('skos:broader+')
      expect(query).not.toContain('skos:broaderTransitive')
    })

    it('skips hierarchical branch if no top concept capability', () => {
      const endpoint = mockEndpoint({
        hasInScheme: true,
        hasBroaderTransitive: true, // Has transitive but no top concept
        hasTopConceptOf: false,
        hasHasTopConcept: false,
      })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      expect(query).toContain('skos:inScheme')
      expect(query).not.toContain('skos:broaderTransitive')
      expect(query).not.toContain('skos:broader+')
    })

    it('includes broaderTransitive with topConceptOf when both available', () => {
      const endpoint = mockEndpoint({
        hasTopConceptOf: true,
        hasBroaderTransitive: true,
      })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      expect(query).toContain('skos:broaderTransitive')
      expect(query).toContain('?top skos:topConceptOf')
    })

    it('includes broaderTransitive with hasTopConcept when both available', () => {
      const endpoint = mockEndpoint({
        hasHasTopConcept: true,
        hasBroaderTransitive: true,
      })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      expect(query).toContain('skos:broaderTransitive')
      expect(query).toContain('skos:hasTopConcept ?top')
    })

    it('combines both top concept patterns when both available', () => {
      const endpoint = mockEndpoint({
        hasTopConceptOf: true,
        hasHasTopConcept: true,
        hasBroaderTransitive: true,
      })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      // Should have inner UNION for top concept patterns
      expect(query).toContain('?top skos:topConceptOf')
      expect(query).toContain('skos:hasTopConcept ?top')
    })

    it('combines multiple direct branches with UNION', () => {
      const endpoint = mockEndpoint({
        hasInScheme: true,
        hasTopConceptOf: true,
        hasHasTopConcept: true,
      })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      expect(query).toContain('UNION')
      expect(query).toContain(`{ ?concept skos:inScheme <${testScheme}> . }`)
      expect(query).toContain(`{ ?concept skos:topConceptOf <${testScheme}> . }`)
      expect(query).toContain(`{ <${testScheme}> skos:hasTopConcept ?concept . }`)
    })

    it('includes collection and member patterns', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      expect(query).toContain('?collection a skos:Collection .')
      expect(query).toContain('?collection skos:member ?concept .')
    })

    it('includes label resolution patterns', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      expect(query).toContain('skos:prefLabel')
      expect(query).toContain('skosxl:prefLabel')
      expect(query).toContain('dct:title')
      expect(query).toContain('rdfs:label')
    })

    it('includes notation pattern', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      expect(query).toContain('skos:notation')
    })

    it('includes PREFIX declarations', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      expect(query).toContain('PREFIX skos:')
    })

    it('orders by collection', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      expect(query).toContain('ORDER BY ?collection')
    })

    it('generates valid SPARQL syntax with all capabilities', () => {
      const endpoint = mockEndpoint({
        hasInScheme: true,
        hasTopConceptOf: true,
        hasHasTopConcept: true,
        hasBroader: true,
        hasBroaderTransitive: true,
      })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      expect(query).toContain('SELECT DISTINCT ?collection')
      expect(query).toContain('WHERE {')
      expect(query).toContain('?collection a skos:Collection .')
    })
  })

  describe('getCollectionQueryCapabilities', () => {
    it('returns canQuery false if endpoint has no analysis', () => {
      const endpoint: SPARQLEndpoint = {
        id: 'test',
        name: 'Test',
        url: 'http://example.org/sparql',
        createdAt: new Date().toISOString(),
        accessCount: 0,
      } as SPARQLEndpoint

      const result = getCollectionQueryCapabilities(endpoint)
      expect(result.canQuery).toBe(false)
      expect(result.branches).toEqual([])
    })

    it('returns canQuery false if all relationships are false', () => {
      const endpoint = mockEndpoint({})

      const result = getCollectionQueryCapabilities(endpoint)
      expect(result.canQuery).toBe(false)
      expect(result.branches).toEqual([])
    })

    it('reports inScheme branch when hasInScheme is true', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const result = getCollectionQueryCapabilities(endpoint)
      expect(result.canQuery).toBe(true)
      expect(result.branches).toContain('inScheme')
    })

    it('reports topConceptOf branch when hasTopConceptOf is true', () => {
      const endpoint = mockEndpoint({ hasTopConceptOf: true })

      const result = getCollectionQueryCapabilities(endpoint)
      expect(result.canQuery).toBe(true)
      expect(result.branches).toContain('topConceptOf')
    })

    it('reports hasTopConcept branch when hasHasTopConcept is true', () => {
      const endpoint = mockEndpoint({ hasHasTopConcept: true })

      const result = getCollectionQueryCapabilities(endpoint)
      expect(result.canQuery).toBe(true)
      expect(result.branches).toContain('hasTopConcept')
    })

    it('reports broaderTransitive branch when available with top capability', () => {
      const endpoint = mockEndpoint({
        hasTopConceptOf: true,
        hasBroaderTransitive: true,
      })

      const result = getCollectionQueryCapabilities(endpoint)
      expect(result.canQuery).toBe(true)
      expect(result.branches).toContain('broaderTransitive')
      expect(result.branches).not.toContain('broader-path')
    })

    it('reports broader-path branch when transitive not available', () => {
      const endpoint = mockEndpoint({
        hasTopConceptOf: true,
        hasBroader: true,
        hasBroaderTransitive: false,
      })

      const result = getCollectionQueryCapabilities(endpoint)
      expect(result.canQuery).toBe(true)
      expect(result.branches).toContain('broader-path')
      expect(result.branches).not.toContain('broaderTransitive')
    })

    it('does not report hierarchical branches without top capability', () => {
      const endpoint = mockEndpoint({
        hasBroaderTransitive: true,
        hasBroader: true,
        hasTopConceptOf: false,
        hasHasTopConcept: false,
      })

      const result = getCollectionQueryCapabilities(endpoint)
      expect(result.canQuery).toBe(false)
      expect(result.branches).not.toContain('broaderTransitive')
      expect(result.branches).not.toContain('broader-path')
    })

    it('reports all relevant branches for complete endpoint', () => {
      const endpoint = mockEndpoint({
        hasInScheme: true,
        hasTopConceptOf: true,
        hasHasTopConcept: true,
        hasBroaderTransitive: true,
      })

      const result = getCollectionQueryCapabilities(endpoint)
      expect(result.canQuery).toBe(true)
      expect(result.branches).toContain('inScheme')
      expect(result.branches).toContain('topConceptOf')
      expect(result.branches).toContain('hasTopConcept')
      expect(result.branches).toContain('broaderTransitive')
    })
  })

  describe('nested collection detection in buildCollectionsQuery', () => {
    it('includes hasParentCollection binding', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      expect(query).toContain('?hasParentCollection')
      expect(query).toContain('AS ?hasParentCollection')
    })

    it('includes hasChildCollections binding', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      expect(query).toContain('?hasChildCollections')
      expect(query).toContain('AS ?hasChildCollections')
    })

    it('uses EXISTS pattern for hasParentCollection detection', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      expect(query).toContain('BIND(EXISTS {')
      expect(query).toContain('?parentCol a skos:Collection')
      expect(query).toContain('?parentCol skos:member ?collection')
    })

    it('uses EXISTS pattern for hasChildCollections detection', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildCollectionsQuery(endpoint, testScheme)
      expect(query).not.toBeNull()
      expect(query).toContain('?collection skos:member ?childCol')
      expect(query).toContain('?childCol a skos:Collection')
    })
  })

  describe('buildChildCollectionsQuery', () => {
    const testParentUri = 'http://example.org/collection/parent'

    it('returns null if endpoint has no analysis', () => {
      const endpoint: SPARQLEndpoint = {
        id: 'test',
        name: 'Test',
        url: 'http://example.org/sparql',
        createdAt: new Date().toISOString(),
        accessCount: 0,
      } as SPARQLEndpoint

      const query = buildChildCollectionsQuery(testParentUri, testScheme, endpoint)
      expect(query).toBeNull()
    })

    it('returns null if all relationship capabilities are false', () => {
      const endpoint = mockEndpoint({})

      const query = buildChildCollectionsQuery(testParentUri, testScheme, endpoint)
      expect(query).toBeNull()
    })

    it('generates valid SPARQL query with scheme filtering', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildChildCollectionsQuery(testParentUri, testScheme, endpoint)
      expect(query).not.toBeNull()
      expect(query).toContain('SELECT DISTINCT ?collection')
      expect(query).toContain('WHERE {')
      expect(query).toContain(`<${testParentUri}> skos:member ?collection`)
      expect(query).toContain('?collection a skos:Collection')
    })

    it('filters child collections by scheme membership', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildChildCollectionsQuery(testParentUri, testScheme, endpoint)
      expect(query).not.toBeNull()
      expect(query).toContain('?collection skos:member ?member')
      expect(query).toContain(`?member skos:inScheme <${testScheme}>`)
    })

    it('includes topConceptOf branch for scheme filtering when available', () => {
      const endpoint = mockEndpoint({ hasTopConceptOf: true })

      const query = buildChildCollectionsQuery(testParentUri, testScheme, endpoint)
      expect(query).not.toBeNull()
      expect(query).toContain(`?member skos:topConceptOf <${testScheme}>`)
    })

    it('includes hasTopConcept branch for scheme filtering when available', () => {
      const endpoint = mockEndpoint({ hasHasTopConcept: true })

      const query = buildChildCollectionsQuery(testParentUri, testScheme, endpoint)
      expect(query).not.toBeNull()
      expect(query).toContain(`<${testScheme}> skos:hasTopConcept ?member`)
    })

    it('includes hierarchical branches for scheme filtering', () => {
      const endpoint = mockEndpoint({
        hasTopConceptOf: true,
        hasBroaderTransitive: true,
      })

      const query = buildChildCollectionsQuery(testParentUri, testScheme, endpoint)
      expect(query).not.toBeNull()
      expect(query).toContain('?member skos:broaderTransitive ?top')
    })

    it('includes hasChildCollections for recursive expandability', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildChildCollectionsQuery(testParentUri, testScheme, endpoint)
      expect(query).not.toBeNull()
      expect(query).toContain('?hasChildCollections')
      expect(query).toContain('AS ?hasChildCollections')
      expect(query).toContain('BIND(EXISTS {')
    })

    it('does not include hasParentCollection (not needed for children)', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildChildCollectionsQuery(testParentUri, testScheme, endpoint)
      expect(query).not.toBeNull()
      expect(query).not.toContain('?hasParentCollection')
    })

    it('includes label resolution patterns', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildChildCollectionsQuery(testParentUri, testScheme, endpoint)
      expect(query).not.toBeNull()
      expect(query).toContain('skos:prefLabel')
      expect(query).toContain('skosxl:prefLabel')
      expect(query).toContain('dct:title')
      expect(query).toContain('rdfs:label')
    })

    it('includes notation pattern', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildChildCollectionsQuery(testParentUri, testScheme, endpoint)
      expect(query).not.toBeNull()
      expect(query).toContain('skos:notation')
    })

    it('includes PREFIX declarations', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildChildCollectionsQuery(testParentUri, testScheme, endpoint)
      expect(query).not.toBeNull()
      expect(query).toContain('PREFIX skos:')
    })

    it('orders by collection', () => {
      const endpoint = mockEndpoint({ hasInScheme: true })

      const query = buildChildCollectionsQuery(testParentUri, testScheme, endpoint)
      expect(query).not.toBeNull()
      expect(query).toContain('ORDER BY ?collection')
    })
  })
})
