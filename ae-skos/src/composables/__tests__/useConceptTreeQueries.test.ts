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

  describe('buildExplicitTopConceptsQuery', () => {
    it('returns null when endpoint has no explicit top concept capabilities', () => {
      const endpointStore = useEndpointStore()
      const endpoint = endpointStore.addEndpoint({ name: 'Test', url: 'http://example.org/sparql' })
      endpoint.analysis = { relationships: { hasTopConceptOf: false, hasHasTopConcept: false } }
      endpointStore.selectEndpoint(endpoint.id)

      const { buildExplicitTopConceptsQuery } = useConceptTreeQueries()
      const query = buildExplicitTopConceptsQuery('http://example.org/scheme', 200, 0)

      expect(query).toBeNull()
    })

    it('builds query with topConceptOf when available', () => {
      const endpointStore = useEndpointStore()
      const endpoint = endpointStore.addEndpoint({ name: 'Test', url: 'http://example.org/sparql' })
      endpoint.analysis = { relationships: { hasTopConceptOf: true, hasHasTopConcept: false } }
      endpointStore.selectEndpoint(endpoint.id)

      const { buildExplicitTopConceptsQuery } = useConceptTreeQueries()
      const query = buildExplicitTopConceptsQuery('http://example.org/scheme', 200, 0)

      expect(query).not.toBeNull()
      expect(query).toContain('skos:topConceptOf')
      expect(query).not.toContain('skos:hasTopConcept')
    })

    it('builds query with hasTopConcept when available', () => {
      const endpointStore = useEndpointStore()
      const endpoint = endpointStore.addEndpoint({ name: 'Test', url: 'http://example.org/sparql' })
      endpoint.analysis = { relationships: { hasTopConceptOf: false, hasHasTopConcept: true } }
      endpointStore.selectEndpoint(endpoint.id)

      const { buildExplicitTopConceptsQuery } = useConceptTreeQueries()
      const query = buildExplicitTopConceptsQuery('http://example.org/scheme', 200, 0)

      expect(query).not.toBeNull()
      expect(query).toContain('skos:hasTopConcept')
      expect(query).not.toContain('skos:topConceptOf')
    })

    it('builds query with both patterns when both available', () => {
      const endpointStore = useEndpointStore()
      const endpoint = endpointStore.addEndpoint({ name: 'Test', url: 'http://example.org/sparql' })
      endpoint.analysis = { relationships: { hasTopConceptOf: true, hasHasTopConcept: true } }
      endpointStore.selectEndpoint(endpoint.id)

      const { buildExplicitTopConceptsQuery } = useConceptTreeQueries()
      const query = buildExplicitTopConceptsQuery('http://example.org/scheme', 200, 0)

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

      const { buildExplicitTopConceptsQuery } = useConceptTreeQueries()
      const query = buildExplicitTopConceptsQuery('http://example.org/scheme', 200, 0)

      expect(query).not.toContain('?concept a skos:Concept')
    })

    it('uses EXISTS for hasNarrower check', () => {
      const endpointStore = useEndpointStore()
      const endpoint = endpointStore.addEndpoint({ name: 'Test', url: 'http://example.org/sparql' })
      endpoint.analysis = { relationships: { hasTopConceptOf: true, hasHasTopConcept: false } }
      endpointStore.selectEndpoint(endpoint.id)

      const { buildExplicitTopConceptsQuery } = useConceptTreeQueries()
      const query = buildExplicitTopConceptsQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('EXISTS')
      expect(query).toContain('?hasNarrower')
      expect(query).not.toContain('COUNT')
    })

    it('includes pagination parameters', () => {
      const endpointStore = useEndpointStore()
      const endpoint = endpointStore.addEndpoint({ name: 'Test', url: 'http://example.org/sparql' })
      endpoint.analysis = { relationships: { hasTopConceptOf: true, hasHasTopConcept: false } }
      endpointStore.selectEndpoint(endpoint.id)

      const { buildExplicitTopConceptsQuery } = useConceptTreeQueries()
      const query = buildExplicitTopConceptsQuery('http://example.org/scheme', 100, 50)

      expect(query).toContain('LIMIT 101')
      expect(query).toContain('OFFSET 50')
    })
  })

  describe('buildFallbackTopConceptsQuery', () => {
    it('uses inScheme pattern', () => {
      const { buildFallbackTopConceptsQuery } = useConceptTreeQueries()
      const query = buildFallbackTopConceptsQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('skos:inScheme')
    })

    it('includes FILTER NOT EXISTS for broader', () => {
      const { buildFallbackTopConceptsQuery } = useConceptTreeQueries()
      const query = buildFallbackTopConceptsQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('FILTER NOT EXISTS { ?concept skos:broader ?broader }')
      expect(query).toContain('FILTER NOT EXISTS { ?parent skos:narrower ?concept }')
    })

    it('includes type check (needed for inScheme pattern)', () => {
      const { buildFallbackTopConceptsQuery } = useConceptTreeQueries()
      const query = buildFallbackTopConceptsQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('?concept a skos:Concept')
    })

    it('uses EXISTS for hasNarrower check', () => {
      const { buildFallbackTopConceptsQuery } = useConceptTreeQueries()
      const query = buildFallbackTopConceptsQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('EXISTS')
      expect(query).toContain('?hasNarrower')
      expect(query).not.toContain('COUNT')
    })

    it('includes pagination parameters', () => {
      const { buildFallbackTopConceptsQuery } = useConceptTreeQueries()
      const query = buildFallbackTopConceptsQuery('http://example.org/scheme', 100, 50)

      expect(query).toContain('LIMIT 101')
      expect(query).toContain('OFFSET 50')
    })
  })

  describe('buildTopConceptsQuery', () => {
    it('includes scheme URI in query', () => {
      const { buildTopConceptsQuery } = useConceptTreeQueries()
      const schemeUri = 'http://example.org/scheme/1'

      const query = buildTopConceptsQuery(schemeUri, 200, 0)

      expect(query).toContain(`<${schemeUri}>`)
    })

    it('includes pagination parameters', () => {
      const { buildTopConceptsQuery } = useConceptTreeQueries()

      const query = buildTopConceptsQuery('http://example.org/scheme', 100, 50)

      expect(query).toContain('LIMIT 101') // pageSize + 1
      expect(query).toContain('OFFSET 50')
    })

    it('includes label resolution patterns', () => {
      const { buildTopConceptsQuery } = useConceptTreeQueries()

      const query = buildTopConceptsQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('skos:prefLabel')
      expect(query).toContain('skosxl:prefLabel')
      expect(query).toContain('dct:title')
      expect(query).toContain('rdfs:label')
    })

    it('includes notation', () => {
      const { buildTopConceptsQuery } = useConceptTreeQueries()

      const query = buildTopConceptsQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('skos:notation')
    })

    it('includes top concept patterns', () => {
      const { buildTopConceptsQuery } = useConceptTreeQueries()

      const query = buildTopConceptsQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('skos:topConceptOf')
      expect(query).toContain('skos:hasTopConcept')
    })

    it('includes fallback for concepts with no broader', () => {
      const { buildTopConceptsQuery } = useConceptTreeQueries()

      const query = buildTopConceptsQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('FILTER NOT EXISTS { ?concept skos:broader ?broader }')
    })

    it('includes hasNarrower EXISTS check', () => {
      const { buildTopConceptsQuery } = useConceptTreeQueries()

      const query = buildTopConceptsQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('EXISTS')
      expect(query).toContain('?hasNarrower')
    })

    it('includes SKOS prefixes', () => {
      const { buildTopConceptsQuery } = useConceptTreeQueries()

      const query = buildTopConceptsQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('PREFIX skos:')
    })
  })

  describe('buildChildrenQuery', () => {
    it('includes parent URI in query', () => {
      const { buildChildrenQuery } = useConceptTreeQueries()
      const parentUri = 'http://example.org/concept/1'

      const query = buildChildrenQuery(parentUri, 200, 0)

      expect(query).toContain(`<${parentUri}>`)
    })

    it('includes pagination parameters', () => {
      const { buildChildrenQuery } = useConceptTreeQueries()

      const query = buildChildrenQuery('http://example.org/concept', 100, 50)

      expect(query).toContain('LIMIT 101') // pageSize + 1
      expect(query).toContain('OFFSET 50')
    })

    it('includes label resolution patterns', () => {
      const { buildChildrenQuery } = useConceptTreeQueries()

      const query = buildChildrenQuery('http://example.org/concept', 200, 0)

      expect(query).toContain('skos:prefLabel')
      expect(query).toContain('skosxl:prefLabel')
      expect(query).toContain('dct:title')
      expect(query).toContain('rdfs:label')
    })

    it('includes broader/narrower patterns', () => {
      const { buildChildrenQuery } = useConceptTreeQueries()
      const parentUri = 'http://example.org/concept/1'

      const query = buildChildrenQuery(parentUri, 200, 0)

      expect(query).toContain('skos:broader')
      expect(query).toContain('skos:narrower')
    })

    it('includes hasNarrower EXISTS check', () => {
      const { buildChildrenQuery } = useConceptTreeQueries()

      const query = buildChildrenQuery('http://example.org/concept', 200, 0)

      expect(query).toContain('EXISTS')
      expect(query).toContain('?hasNarrower')
    })

    it('includes SKOS prefixes', () => {
      const { buildChildrenQuery } = useConceptTreeQueries()

      const query = buildChildrenQuery('http://example.org/concept', 200, 0)

      expect(query).toContain('PREFIX skos:')
    })
  })

  describe('shared query structure', () => {
    it('both queries have same label resolution structure', () => {
      const { buildTopConceptsQuery, buildChildrenQuery } = useConceptTreeQueries()

      const topQuery = buildTopConceptsQuery('http://example.org/scheme', 200, 0)
      const childQuery = buildChildrenQuery('http://example.org/concept', 200, 0)

      // Both should have identical label type binding patterns
      const labelPattern = 'BIND("prefLabel" AS ?labelType)'
      expect(topQuery).toContain(labelPattern)
      expect(childQuery).toContain(labelPattern)

      const xlPattern = 'BIND("xlPrefLabel" AS ?labelType)'
      expect(topQuery).toContain(xlPattern)
      expect(childQuery).toContain(xlPattern)
    })

    it('both queries select same variables', () => {
      const { buildTopConceptsQuery, buildChildrenQuery } = useConceptTreeQueries()

      const topQuery = buildTopConceptsQuery('http://example.org/scheme', 200, 0)
      const childQuery = buildChildrenQuery('http://example.org/concept', 200, 0)

      const expectedVars = ['?concept', '?label', '?labelLang', '?labelType', '?notation', '?hasNarrower']
      for (const v of expectedVars) {
        expect(topQuery).toContain(v)
        expect(childQuery).toContain(v)
      }
    })
  })
})
