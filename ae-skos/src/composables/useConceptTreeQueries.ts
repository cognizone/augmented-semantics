/**
 * useConceptTreeQueries - SPARQL query builders for ConceptTree
 *
 * Centralizes query construction for top concepts and children,
 * eliminating duplication and enabling testability.
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { withPrefixes } from '../services'
import { useDeprecation } from './useDeprecation'

/**
 * Shared label resolution clause used by both queries.
 * Priority: prefLabel > xlPrefLabel > dct:title > dc:title > rdfs:label
 */
function buildLabelClause(): string {
  return `
      OPTIONAL { ?concept skos:notation ?notation }
      OPTIONAL {
        {
          ?concept skos:prefLabel ?label .
          BIND("prefLabel" AS ?labelType)
        } UNION {
          ?concept skosxl:prefLabel/skosxl:literalForm ?label .
          BIND("xlPrefLabel" AS ?labelType)
        } UNION {
          ?concept dct:title ?label .
          BIND("title" AS ?labelType)
        } UNION {
          ?concept dc:title ?label .
          BIND("dcTitle" AS ?labelType)
        } UNION {
          ?concept rdfs:label ?label .
          BIND("rdfsLabel" AS ?labelType)
        }
        BIND(LANG(?label) AS ?labelLang)
      }`
}

export function useConceptTreeQueries() {
  const { getDeprecationSparqlClauses, getDeprecationSelectVars } = useDeprecation()

  /**
   * Build query for top concepts of a scheme.
   * Finds concepts via topConceptOf, hasTopConcept, or no-broader fallback.
   */
  function buildTopConceptsQuery(schemeUri: string, pageSize: number, offset: number): string {
    const deprecationSelectVars = getDeprecationSelectVars()
    const deprecationClauses = getDeprecationSparqlClauses('?concept')

    return withPrefixes(`
    SELECT ?concept ?label ?labelLang ?labelType ?notation ?narrowerCount ${deprecationSelectVars}
    WHERE {
      {
        # Subquery to get paginated distinct concepts with narrower count
        SELECT DISTINCT ?concept (COUNT(DISTINCT ?narrower) AS ?narrowerCount) ${deprecationSelectVars}
        WHERE {
          {
            # Explicit top concept via topConceptOf or hasTopConcept (no inScheme required)
            ?concept a skos:Concept .
            { ?concept skos:topConceptOf <${schemeUri}> }
            UNION
            { <${schemeUri}> skos:hasTopConcept ?concept }
          }
          UNION
          {
            # Fallback: concepts with no broader relationship (neither direction)
            ?concept a skos:Concept .
            ?concept skos:inScheme <${schemeUri}> .
            FILTER NOT EXISTS { ?concept skos:broader ?broader }
            FILTER NOT EXISTS { ?parent skos:narrower ?concept }
          }
          OPTIONAL {
            { ?narrower skos:broader ?concept }
            UNION
            { ?concept skos:narrower ?narrower }
          }
          ${deprecationClauses}
        }
        GROUP BY ?concept ${deprecationSelectVars}
        ORDER BY ?concept
        LIMIT ${pageSize + 1}
        OFFSET ${offset}
      }
      # Get labels and notations for the paginated concepts
      ${buildLabelClause()}
    }
  `)
  }

  /**
   * Build query for children of a concept.
   * Finds children via broader or narrower (inverse).
   */
  function buildChildrenQuery(parentUri: string, pageSize: number, offset: number): string {
    const deprecationSelectVars = getDeprecationSelectVars()
    const deprecationClauses = getDeprecationSparqlClauses('?concept')

    return withPrefixes(`
    SELECT ?concept ?label ?labelLang ?labelType ?notation ?narrowerCount ${deprecationSelectVars}
    WHERE {
      {
        # Subquery to get paginated distinct children with narrower count
        SELECT DISTINCT ?concept (COUNT(DISTINCT ?narrower) AS ?narrowerCount) ${deprecationSelectVars}
        WHERE {
          # Find children via broader or narrower (inverse)
          { ?concept skos:broader <${parentUri}> }
          UNION
          { <${parentUri}> skos:narrower ?concept }
          OPTIONAL {
            { ?narrower skos:broader ?concept }
            UNION
            { ?concept skos:narrower ?narrower }
          }
          ${deprecationClauses}
        }
        GROUP BY ?concept ${deprecationSelectVars}
        ORDER BY ?concept
        LIMIT ${pageSize + 1}
        OFFSET ${offset}
      }
      # Get labels and notations for the paginated concepts
      ${buildLabelClause()}
    }
  `)
  }

  return {
    buildTopConceptsQuery,
    buildChildrenQuery,
  }
}
