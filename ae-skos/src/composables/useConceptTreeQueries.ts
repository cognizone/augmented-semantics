/**
 * useConceptTreeQueries - SPARQL query builders for ConceptTree
 *
 * Centralizes query construction for top concepts and children,
 * eliminating duplication and enabling testability.
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { withPrefixes } from '../services'
import { useEndpointStore } from '../stores'
import { useDeprecation } from './useDeprecation'
import { buildCapabilityAwareOptionalLabelClause } from '../constants'

export function useConceptTreeQueries() {
  const endpointStore = useEndpointStore()
  const { getDeprecationSparqlClauses, getDeprecationSelectVars } = useDeprecation()

  /**
   * Shared label resolution clause used by both queries.
   * Priority: prefLabel > xlPrefLabel > dct:title > dc:title > rdfs:label
   *
   * Uses capability-aware label clause when endpoint has detected capabilities.
   * Note: Tree queries fetch all languages and let client-side code pick the best match.
   * This ensures labels are always shown even when preferred language isn't available.
   */
  function buildLabelClause(): string {
    const capabilities = endpointStore.current?.analysis?.labelPredicates?.concept

    return `
      OPTIONAL { ?concept skos:notation ?notation }
      ${buildCapabilityAwareOptionalLabelClause('?concept', capabilities)}`
  }

  /**
   * Build query for explicit top concepts (fast path).
   * Uses topConceptOf and/or hasTopConcept based on detected capabilities.
   * Returns null if endpoint has no explicit top concept capabilities.
   */
  function buildExplicitTopConceptsQuery(schemeUri: string, pageSize: number, offset: number): string | null {
    const rel = endpointStore.current?.analysis?.relationships
    if (!rel?.hasTopConceptOf && !rel?.hasHasTopConcept) {
      return null  // No explicit top concept capabilities
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
    SELECT ?concept ?label ?labelLang ?labelType ?notation ?hasNarrower ${deprecationSelectVars}
    WHERE {
      {
        # Subquery to get paginated distinct concepts
        SELECT DISTINCT ?concept ?hasNarrower ${deprecationSelectVars}
        WHERE {
          # Explicit top concept via topConceptOf or hasTopConcept
          # Note: No type check needed - these predicates imply skos:Concept
          ${branches.join('\n          UNION\n          ')}
          # Check if concept has children (EXISTS is fast - stops at first match)
          BIND(EXISTS {
            { [] skos:broader ?concept }
            UNION
            { ?concept skos:narrower [] }
          } AS ?hasNarrower)
          ${deprecationClauses}
        }
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
   * Build fallback query for concepts with no broader (slow path).
   * Used when explicit top concepts query returns empty or is unavailable.
   */
  function buildFallbackTopConceptsQuery(schemeUri: string, pageSize: number, offset: number): string {
    const deprecationSelectVars = getDeprecationSelectVars()
    const deprecationClauses = getDeprecationSparqlClauses('?concept')

    return withPrefixes(`
    SELECT ?concept ?label ?labelLang ?labelType ?notation ?hasNarrower ${deprecationSelectVars}
    WHERE {
      {
        # Subquery to get paginated distinct concepts
        SELECT DISTINCT ?concept ?hasNarrower ${deprecationSelectVars}
        WHERE {
          # Fallback: concepts with no broader relationship (neither direction)
          ?concept a skos:Concept .
          ?concept skos:inScheme <${schemeUri}> .
          FILTER NOT EXISTS { ?concept skos:broader ?broader }
          FILTER NOT EXISTS { ?parent skos:narrower ?concept }
          # Check if concept has children (EXISTS is fast - stops at first match)
          BIND(EXISTS {
            { [] skos:broader ?concept }
            UNION
            { ?concept skos:narrower [] }
          } AS ?hasNarrower)
          ${deprecationClauses}
        }
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
   * Build query for top concepts of a scheme.
   * @deprecated Use buildExplicitTopConceptsQuery and buildFallbackTopConceptsQuery instead
   */
  function buildTopConceptsQuery(schemeUri: string, pageSize: number, offset: number): string {
    const deprecationSelectVars = getDeprecationSelectVars()
    const deprecationClauses = getDeprecationSparqlClauses('?concept')

    return withPrefixes(`
    SELECT ?concept ?label ?labelLang ?labelType ?notation ?hasNarrower ${deprecationSelectVars}
    WHERE {
      {
        # Subquery to get paginated distinct concepts
        SELECT DISTINCT ?concept ?hasNarrower ${deprecationSelectVars}
        WHERE {
          {
            # Explicit top concept via topConceptOf or hasTopConcept (no inScheme required)
            # Note: No type check needed - these predicates imply skos:Concept
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
          # Check if concept has children (EXISTS is fast - stops at first match)
          BIND(EXISTS {
            { [] skos:broader ?concept }
            UNION
            { ?concept skos:narrower [] }
          } AS ?hasNarrower)
          ${deprecationClauses}
        }
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
    SELECT ?concept ?label ?labelLang ?labelType ?notation ?hasNarrower ${deprecationSelectVars}
    WHERE {
      {
        # Subquery to get paginated distinct children
        SELECT DISTINCT ?concept ?hasNarrower ${deprecationSelectVars}
        WHERE {
          # Find children via broader or narrower (inverse)
          # Note: No type check needed - these predicates imply skos:Concept
          { ?concept skos:broader <${parentUri}> }
          UNION
          { <${parentUri}> skos:narrower ?concept }
          # Check if concept has children (EXISTS is fast - stops at first match)
          BIND(EXISTS {
            { [] skos:broader ?concept }
            UNION
            { ?concept skos:narrower [] }
          } AS ?hasNarrower)
          ${deprecationClauses}
        }
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
    buildExplicitTopConceptsQuery,
    buildFallbackTopConceptsQuery,
    buildChildrenQuery,
  }
}
