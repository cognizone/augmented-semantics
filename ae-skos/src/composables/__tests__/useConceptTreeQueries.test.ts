/**
 * useConceptTreeQueries Composable Tests
 *
 * Tests for SPARQL query builders for ConceptTree.
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useConceptTreeQueries } from '../useConceptTreeQueries'
import { useEndpointStore } from '../../stores'

describe('useConceptTreeQueries', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('buildExplicitTopConceptsMetadataQuery', () => {
    it('returns null when endpoint has no explicit top concept capabilities', () => {
      const endpointStore = useEndpointStore()
      const endpoint = endpointStore.addEndpoint({ name: 'Test', url: 'http://example.org/sparql' })
      endpoint.analysis = { relationships: { hasTopConceptOf: false, hasHasTopConcept: false } }
      endpointStore.selectEndpoint(endpoint.id)

      const { buildExplicitTopConceptsMetadataQuery } = useConceptTreeQueries()
      const query = buildExplicitTopConceptsMetadataQuery('http://example.org/scheme', 200, 0)

      expect(query).toBeNull()
    })

    it('builds query with topConceptOf when available', () => {
      const endpointStore = useEndpointStore()
      const endpoint = endpointStore.addEndpoint({ name: 'Test', url: 'http://example.org/sparql' })
      endpoint.analysis = { relationships: { hasTopConceptOf: true, hasHasTopConcept: false } }
      endpointStore.selectEndpoint(endpoint.id)

      const { buildExplicitTopConceptsMetadataQuery } = useConceptTreeQueries()
      const query = buildExplicitTopConceptsMetadataQuery('http://example.org/scheme', 200, 0)

      expect(query).not.toBeNull()
      expect(query).toContain('skos:topConceptOf')
      expect(query).not.toContain('skos:hasTopConcept')
    })

    it('builds query with hasTopConcept when available', () => {
      const endpointStore = useEndpointStore()
      const endpoint = endpointStore.addEndpoint({ name: 'Test', url: 'http://example.org/sparql' })
      endpoint.analysis = { relationships: { hasTopConceptOf: false, hasHasTopConcept: true } }
      endpointStore.selectEndpoint(endpoint.id)

      const { buildExplicitTopConceptsMetadataQuery } = useConceptTreeQueries()
      const query = buildExplicitTopConceptsMetadataQuery('http://example.org/scheme', 200, 0)

      expect(query).not.toBeNull()
      expect(query).toContain('skos:hasTopConcept')
      expect(query).not.toContain('skos:topConceptOf')
    })

    it('builds query with both patterns when both available', () => {
      const endpointStore = useEndpointStore()
      const endpoint = endpointStore.addEndpoint({ name: 'Test', url: 'http://example.org/sparql' })
      endpoint.analysis = { relationships: { hasTopConceptOf: true, hasHasTopConcept: true } }
      endpointStore.selectEndpoint(endpoint.id)

      const { buildExplicitTopConceptsMetadataQuery } = useConceptTreeQueries()
      const query = buildExplicitTopConceptsMetadataQuery('http://example.org/scheme', 200, 0)

      expect(query).not.toBeNull()
      expect(query).toContain('skos:topConceptOf')
      expect(query).toContain('skos:hasTopConcept')
      expect(query).toContain('UNION')
    })

    it('does not include type check (for performance)', () => {
      const endpointStore = useEndpointStore()
      const endpoint = endpointStore.addEndpoint({ name: 'Test', url: 'http://example.org/sparql' })
      endpoint.analysis = { relationships: { hasTopConceptOf: true, hasHasTopConcept: true } }
      endpointStore.selectEndpoint(endpoint.id)

      const { buildExplicitTopConceptsMetadataQuery } = useConceptTreeQueries()
      const query = buildExplicitTopConceptsMetadataQuery('http://example.org/scheme', 200, 0)

      expect(query).not.toContain('?concept a skos:Concept')
    })

    it('uses EXISTS for hasNarrower check', () => {
      const endpointStore = useEndpointStore()
      const endpoint = endpointStore.addEndpoint({ name: 'Test', url: 'http://example.org/sparql' })
      endpoint.analysis = { relationships: { hasTopConceptOf: true, hasHasTopConcept: false } }
      endpointStore.selectEndpoint(endpoint.id)

      const { buildExplicitTopConceptsMetadataQuery } = useConceptTreeQueries()
      const query = buildExplicitTopConceptsMetadataQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('EXISTS')
      expect(query).toContain('?hasNarrower')
      expect(query).not.toContain('COUNT')
    })

    it('includes pagination parameters', () => {
      const endpointStore = useEndpointStore()
      const endpoint = endpointStore.addEndpoint({ name: 'Test', url: 'http://example.org/sparql' })
      endpoint.analysis = { relationships: { hasTopConceptOf: true, hasHasTopConcept: false } }
      endpointStore.selectEndpoint(endpoint.id)

      const { buildExplicitTopConceptsMetadataQuery } = useConceptTreeQueries()
      const query = buildExplicitTopConceptsMetadataQuery('http://example.org/scheme', 100, 50)

      expect(query).toContain('LIMIT 101')
      expect(query).toContain('OFFSET 50')
    })
  })

  describe('buildInSchemeOnlyTopConceptsMetadataQuery', () => {
    it('uses inScheme pattern', () => {
      const { buildInSchemeOnlyTopConceptsMetadataQuery } = useConceptTreeQueries()
      const query = buildInSchemeOnlyTopConceptsMetadataQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('skos:inScheme')
    })

    it('includes placement exclusion filters', () => {
      const { buildInSchemeOnlyTopConceptsMetadataQuery } = useConceptTreeQueries()
      const query = buildInSchemeOnlyTopConceptsMetadataQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('FILTER NOT EXISTS { ?concept skos:broader ?x }')
      expect(query).toContain('FILTER NOT EXISTS { ?x skos:narrower ?concept }')
      expect(query).toContain('FILTER NOT EXISTS { ?concept skos:broaderTransitive ?x }')
      expect(query).toContain('FILTER NOT EXISTS { ?concept skos:narrowerTransitive ?x }')
      expect(query).toContain('FILTER NOT EXISTS { ?concept skos:topConceptOf ?x }')
      expect(query).toContain('FILTER NOT EXISTS { ?x skos:hasTopConcept ?concept }')
    })

    it('includes type check (needed for inScheme pattern)', () => {
      const { buildInSchemeOnlyTopConceptsMetadataQuery } = useConceptTreeQueries()
      const query = buildInSchemeOnlyTopConceptsMetadataQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('?concept a skos:Concept')
    })

    it('uses EXISTS for hasNarrower check', () => {
      const { buildInSchemeOnlyTopConceptsMetadataQuery } = useConceptTreeQueries()
      const query = buildInSchemeOnlyTopConceptsMetadataQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('EXISTS')
      expect(query).toContain('?hasNarrower')
      expect(query).not.toContain('COUNT')
    })

    it('includes pagination parameters', () => {
      const { buildInSchemeOnlyTopConceptsMetadataQuery } = useConceptTreeQueries()
      const query = buildInSchemeOnlyTopConceptsMetadataQuery('http://example.org/scheme', 100, 50)

      expect(query).toContain('LIMIT 101')
      expect(query).toContain('OFFSET 50')
    })
  })

  describe('buildTopConceptsMetadataQuery', () => {
    it('includes scheme URI in query', () => {
      const { buildTopConceptsMetadataQuery } = useConceptTreeQueries()
      const schemeUri = 'http://example.org/scheme/1'

      const query = buildTopConceptsMetadataQuery(schemeUri, 200, 0)

      expect(query).toContain(`<${schemeUri}>`)
    })

    it('includes pagination parameters', () => {
      const { buildTopConceptsMetadataQuery } = useConceptTreeQueries()

      const query = buildTopConceptsMetadataQuery('http://example.org/scheme', 100, 50)

      expect(query).toContain('LIMIT 101') // pageSize + 1
      expect(query).toContain('OFFSET 50')
    })

    it('includes notation', () => {
      const { buildTopConceptsMetadataQuery } = useConceptTreeQueries()

      const query = buildTopConceptsMetadataQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('skos:notation')
    })

    it('includes top concept patterns', () => {
      const { buildTopConceptsMetadataQuery } = useConceptTreeQueries()

      const query = buildTopConceptsMetadataQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('skos:topConceptOf')
      expect(query).toContain('skos:hasTopConcept')
    })

    it('includes in-scheme-only placement filters', () => {
      const { buildTopConceptsMetadataQuery } = useConceptTreeQueries()

      const query = buildTopConceptsMetadataQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('FILTER NOT EXISTS { ?concept skos:broader ?x }')
      expect(query).toContain('FILTER NOT EXISTS { ?x skos:narrower ?concept }')
      expect(query).toContain('FILTER NOT EXISTS { ?concept skos:broaderTransitive ?x }')
      expect(query).toContain('FILTER NOT EXISTS { ?concept skos:narrowerTransitive ?x }')
      expect(query).toContain('FILTER NOT EXISTS { ?concept skos:topConceptOf ?x }')
      expect(query).toContain('FILTER NOT EXISTS { ?x skos:hasTopConcept ?concept }')
    })

    it('includes hasNarrower EXISTS check', () => {
      const { buildTopConceptsMetadataQuery } = useConceptTreeQueries()

      const query = buildTopConceptsMetadataQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('EXISTS')
      expect(query).toContain('?hasNarrower')
    })

    it('includes SKOS prefixes', () => {
      const { buildTopConceptsMetadataQuery } = useConceptTreeQueries()

      const query = buildTopConceptsMetadataQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('PREFIX skos:')
    })
  })

  describe('buildChildrenMetadataQuery', () => {
    it('includes parent URI in query', () => {
      const { buildChildrenMetadataQuery } = useConceptTreeQueries()
      const parentUri = 'http://example.org/concept/1'

      const query = buildChildrenMetadataQuery(parentUri, 200, 0)

      expect(query).toContain(`<${parentUri}>`)
    })

    it('includes pagination parameters', () => {
      const { buildChildrenMetadataQuery } = useConceptTreeQueries()

      const query = buildChildrenMetadataQuery('http://example.org/concept', 100, 50)

      expect(query).toContain('LIMIT 101') // pageSize + 1
      expect(query).toContain('OFFSET 50')
    })

    it('includes notation', () => {
      const { buildChildrenMetadataQuery } = useConceptTreeQueries()

      const query = buildChildrenMetadataQuery('http://example.org/concept', 200, 0)

      expect(query).toContain('skos:notation')
    })

    it('includes broader/narrower patterns', () => {
      const { buildChildrenMetadataQuery } = useConceptTreeQueries()
      const parentUri = 'http://example.org/concept/1'

      const query = buildChildrenMetadataQuery(parentUri, 200, 0)

      expect(query).toContain('skos:broader')
      expect(query).toContain('skos:narrower')
    })

    it('includes hasNarrower EXISTS check', () => {
      const { buildChildrenMetadataQuery } = useConceptTreeQueries()

      const query = buildChildrenMetadataQuery('http://example.org/concept', 200, 0)

      expect(query).toContain('EXISTS')
      expect(query).toContain('?hasNarrower')
    })

    it('includes SKOS prefixes', () => {
      const { buildChildrenMetadataQuery } = useConceptTreeQueries()

      const query = buildChildrenMetadataQuery('http://example.org/concept', 200, 0)

      expect(query).toContain('PREFIX skos:')
    })
  })

  describe('shared query structure', () => {
    it('both queries select the expected variables', () => {
      const { buildTopConceptsMetadataQuery, buildChildrenMetadataQuery } = useConceptTreeQueries()

      const topQuery = buildTopConceptsMetadataQuery('http://example.org/scheme', 200, 0)
      const childQuery = buildChildrenMetadataQuery('http://example.org/concept', 200, 0)

      const expectedVars = ['?concept', '?notation', '?hasNarrower']
      for (const v of expectedVars) {
        expect(topQuery).toContain(v)
        expect(childQuery).toContain(v)
      }
    })
  })
})
