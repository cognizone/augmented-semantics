/**
 * useConceptTreeQueries Composable Tests
 *
 * Tests for SPARQL query builders for ConceptTree.
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useConceptTreeQueries } from '../useConceptTreeQueries'

describe('useConceptTreeQueries', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
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

    it('includes narrower count aggregation', () => {
      const { buildTopConceptsQuery } = useConceptTreeQueries()

      const query = buildTopConceptsQuery('http://example.org/scheme', 200, 0)

      expect(query).toContain('COUNT(DISTINCT ?narrower)')
      expect(query).toContain('?narrowerCount')
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

    it('includes narrower count aggregation', () => {
      const { buildChildrenQuery } = useConceptTreeQueries()

      const query = buildChildrenQuery('http://example.org/concept', 200, 0)

      expect(query).toContain('COUNT(DISTINCT ?narrower)')
      expect(query).toContain('?narrowerCount')
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

      const expectedVars = ['?concept', '?label', '?labelLang', '?labelType', '?notation', '?narrowerCount']
      for (const v of expectedVars) {
        expect(topQuery).toContain(v)
        expect(childQuery).toContain(v)
      }
    })
  })
})
