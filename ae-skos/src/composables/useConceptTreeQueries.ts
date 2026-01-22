/**
 * useConceptTreeQueries - SPARQL query builders for ConceptTree
 *
 * Centralizes query construction for top concepts and children,
 * splitting concept discovery (metadata) from label fetching.
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { withPrefixes } from '../services'
import { useEndpointStore } from '../stores'
import { useDeprecation } from './useDeprecation'

export function useConceptTreeQueries() {
  const endpointStore = useEndpointStore()
  const { getDeprecationSparqlClauses, getDeprecationSelectVars } = useDeprecation()

  /**
   * Build metadata query for explicit top concepts (fast path).
   * Returns concept URIs + notation + hasNarrower (no labels).
   * Returns null if endpoint has no explicit top concept capabilities.
   */
  function buildExplicitTopConceptsMetadataQuery(schemeUri: string, pageSize: number, offset: number): string | null {
    const rel = endpointStore.current?.analysis?.relationships
    if (!rel?.hasTopConceptOf && !rel?.hasHasTopConcept) {
      return null
    }

    const deprecationSelectVars = getDeprecationSelectVars()
    const deprecationClauses = getDeprecationSparqlClauses('?concept')

    const branches: string[] = []
    if (rel.hasTopConceptOf) {
      branches.push(`{ ?concept skos:topConceptOf <${schemeUri}> }`)
    }
    if (rel.hasHasTopConcept) {
      branches.push(`{ <${schemeUri}> skos:hasTopConcept ?concept }`)
    }

    return withPrefixes(`
    SELECT ?concept ?notation ?hasNarrower ${deprecationSelectVars}
    WHERE {
      {
        SELECT DISTINCT ?concept ${deprecationSelectVars}
        WHERE {
          ${branches.join('\n          UNION\n          ')}
          ${deprecationClauses}
        }
        ORDER BY ?concept
        LIMIT ${pageSize + 1}
        OFFSET ${offset}
      }
      OPTIONAL { ?concept skos:notation ?notation }
      BIND(EXISTS {
        { [] skos:broader ?concept }
        UNION
        { ?concept skos:narrower [] }
      } AS ?hasNarrower)
    }
  `)
  }

  /**
   * Build metadata query for in-scheme-only concepts (special case).
   * Returns concepts in the scheme with no placement relationships.
   */
  function buildInSchemeOnlyTopConceptsMetadataQuery(schemeUri: string, pageSize: number, offset: number): string {
    const deprecationSelectVars = getDeprecationSelectVars()
    const deprecationClauses = getDeprecationSparqlClauses('?concept')

    return withPrefixes(`
    SELECT ?concept ?notation ?hasNarrower ${deprecationSelectVars}
    WHERE {
      {
        SELECT DISTINCT ?concept ${deprecationSelectVars}
        WHERE {
          ?concept a skos:Concept .
          ?concept skos:inScheme <${schemeUri}> .
          FILTER NOT EXISTS { ?concept skos:broader ?x }
          FILTER NOT EXISTS { ?x skos:narrower ?concept }
          FILTER NOT EXISTS { ?concept skos:broaderTransitive ?x }
          FILTER NOT EXISTS { ?concept skos:narrowerTransitive ?x }
          FILTER NOT EXISTS { ?concept skos:topConceptOf ?x }
          FILTER NOT EXISTS { ?x skos:hasTopConcept ?concept }
          ${deprecationClauses}
        }
        ORDER BY ?concept
        LIMIT ${pageSize + 1}
        OFFSET ${offset}
      }
      OPTIONAL { ?concept skos:notation ?notation }
      BIND(EXISTS {
        { [] skos:broader ?concept }
        UNION
        { ?concept skos:narrower [] }
      } AS ?hasNarrower)
    }
  `)
  }

  /**
   * Build combined metadata query for top concepts (explicit + in-scheme-only).
   * Used for mixed pagination.
   */
  function buildTopConceptsMetadataQuery(schemeUri: string, pageSize: number, offset: number): string {
    const deprecationSelectVars = getDeprecationSelectVars()
    const deprecationClauses = getDeprecationSparqlClauses('?concept')

    return withPrefixes(`
    SELECT ?concept ?notation ?hasNarrower ${deprecationSelectVars}
    WHERE {
      {
        SELECT DISTINCT ?concept ${deprecationSelectVars}
        WHERE {
          {
            { ?concept skos:topConceptOf <${schemeUri}> }
            UNION
            { <${schemeUri}> skos:hasTopConcept ?concept }
          }
          UNION
          {
            ?concept a skos:Concept .
            ?concept skos:inScheme <${schemeUri}> .
            FILTER NOT EXISTS { ?concept skos:broader ?x }
            FILTER NOT EXISTS { ?x skos:narrower ?concept }
            FILTER NOT EXISTS { ?concept skos:broaderTransitive ?x }
            FILTER NOT EXISTS { ?concept skos:narrowerTransitive ?x }
            FILTER NOT EXISTS { ?concept skos:topConceptOf ?x }
            FILTER NOT EXISTS { ?x skos:hasTopConcept ?concept }
          }
          ${deprecationClauses}
        }
        ORDER BY ?concept
        LIMIT ${pageSize + 1}
        OFFSET ${offset}
      }
      OPTIONAL { ?concept skos:notation ?notation }
      BIND(EXISTS {
        { [] skos:broader ?concept }
        UNION
        { ?concept skos:narrower [] }
      } AS ?hasNarrower)
    }
  `)
  }

  /**
   * Build metadata query for children of a concept.
   * Returns concept URIs + notation + hasNarrower (no labels).
   */
  function buildChildrenMetadataQuery(parentUri: string, pageSize: number, offset: number): string {
    const deprecationSelectVars = getDeprecationSelectVars()
    const deprecationClauses = getDeprecationSparqlClauses('?concept')

    return withPrefixes(`
    SELECT ?concept ?notation ?hasNarrower ${deprecationSelectVars}
    WHERE {
      {
        SELECT DISTINCT ?concept ${deprecationSelectVars}
        WHERE {
          { ?concept skos:broader <${parentUri}> }
          UNION
          { <${parentUri}> skos:narrower ?concept }
          ${deprecationClauses}
        }
        ORDER BY ?concept
        LIMIT ${pageSize + 1}
        OFFSET ${offset}
      }
      OPTIONAL { ?concept skos:notation ?notation }
      BIND(EXISTS {
        { [] skos:broader ?concept }
        UNION
        { ?concept skos:narrower [] }
      } AS ?hasNarrower)
    }
  `)
  }

  return {
    buildTopConceptsMetadataQuery,
    buildExplicitTopConceptsMetadataQuery,
    buildInSchemeOnlyTopConceptsMetadataQuery,
    buildChildrenMetadataQuery,
  }
}
