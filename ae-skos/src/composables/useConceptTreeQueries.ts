/**
 * useConceptTreeQueries - SPARQL query builders for ConceptTree
 *
 * Centralizes query construction for top concepts and children,
 * splitting concept discovery (metadata) from label fetching.
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { withPrefixes } from '../services'
import { useEndpointStore, useSettingsStore } from '../stores'
import { useDeprecation } from './useDeprecation'
import { buildSchemeValuesClause } from '../utils/schemeUri'

export function useConceptTreeQueries() {
  const endpointStore = useEndpointStore()
  const settingsStore = useSettingsStore()
  const { getDeprecationSparqlClauses, getDeprecationSelectVars } = useDeprecation()

  /**
   * Build SPARQL clause to check if a concept has narrower concepts.
   *
   * @returns SPARQL BIND clause that sets ?hasNarrower boolean
   */
  function buildHasNarrowerClause(): string {
    return `
      BIND(EXISTS {
        { [] skos:broader ?concept }
        UNION
        { ?concept skos:narrower [] }
      } AS ?hasNarrower)`
  }

  /**
   * Build metadata query for explicit top concepts (fast path).
   * Returns concept URIs + notation + hasNarrower (no labels).
   * Returns null if endpoint has no explicit top concept capabilities.
   *
   * @param schemeUri - The scheme URI to query top concepts for
   * @param pageSize - Number of concepts per page (query fetches pageSize + 1 for hasMore)
   * @param offset - Number of concepts to skip for pagination
   * @returns SPARQL SELECT query string, or null if no explicit top concept relationships exist
   */
  function buildExplicitTopConceptsMetadataQuery(schemeUri: string, pageSize: number, offset: number): string | null {
    const rel = endpointStore.current?.analysis?.relationships
    if (!rel?.hasTopConceptOf && !rel?.hasHasTopConcept) {
      return null
    }

    const deprecationSelectVars = getDeprecationSelectVars()
    const deprecationClauses = getDeprecationSparqlClauses('?concept')
    const schemeValues = buildSchemeValuesClause(
      schemeUri,
      endpointStore.current?.analysis,
      settingsStore.enableSchemeUriSlashFix,
      'scheme'
    )
    const { schemeTerm, valuesClause } = schemeValues

    const branches: string[] = []
    if (rel.hasTopConceptOf) {
      branches.push(`{ ?concept skos:topConceptOf ${schemeTerm} }`)
    }
    if (rel.hasHasTopConcept) {
      branches.push(`{ ${schemeTerm} skos:hasTopConcept ?concept }`)
    }

    return withPrefixes(`
    SELECT ?concept ?notation ?hasNarrower ${deprecationSelectVars}
    WHERE {
      {
        SELECT DISTINCT ?concept ${deprecationSelectVars}
        WHERE {
          ${valuesClause}
          ${branches.join('\n          UNION\n          ')}
          ${deprecationClauses}
        }
        ORDER BY ?concept
        LIMIT ${pageSize + 1}
        OFFSET ${offset}
      }
      OPTIONAL { ?concept skos:notation ?notation }
      ${buildHasNarrowerClause()}
    }
  `)
  }

  /**
   * Build metadata query for in-scheme-only concepts (special case).
   * Returns concepts in the scheme with no placement relationships.
   *
   * @param schemeUri - The scheme URI to query concepts for
   * @param pageSize - Number of concepts per page (query fetches pageSize + 1 for hasMore)
   * @param offset - Number of concepts to skip for pagination
   * @returns SPARQL SELECT query string for orphan-like concepts with only inScheme
   */
  function buildInSchemeOnlyTopConceptsMetadataQuery(schemeUri: string, pageSize: number, offset: number): string {
    const deprecationSelectVars = getDeprecationSelectVars()
    const deprecationClauses = getDeprecationSparqlClauses('?concept')
    const schemeValues = buildSchemeValuesClause(
      schemeUri,
      endpointStore.current?.analysis,
      settingsStore.enableSchemeUriSlashFix,
      'scheme'
    )
    const { schemeTerm, valuesClause } = schemeValues

    return withPrefixes(`
    SELECT ?concept ?notation ?hasNarrower ${deprecationSelectVars}
    WHERE {
      {
        SELECT DISTINCT ?concept ${deprecationSelectVars}
        WHERE {
          ${valuesClause}
          ?concept a skos:Concept .
          ?concept skos:inScheme ${schemeTerm} .
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
      ${buildHasNarrowerClause()}
    }
  `)
  }

  /**
   * Build combined metadata query for top concepts (explicit + in-scheme-only).
   * Used for mixed pagination.
   *
   * @param schemeUri - The scheme URI to query top concepts for
   * @param pageSize - Number of concepts per page (query fetches pageSize + 1 for hasMore)
   * @param offset - Number of concepts to skip for pagination
   * @returns SPARQL SELECT query string with isInSchemeOnly flag to distinguish types
   */
  function buildTopConceptsMetadataQuery(schemeUri: string, pageSize: number, offset: number): string {
    const deprecationSelectVars = getDeprecationSelectVars()
    const deprecationClauses = getDeprecationSparqlClauses('?concept')
    const schemeValues = buildSchemeValuesClause(
      schemeUri,
      endpointStore.current?.analysis,
      settingsStore.enableSchemeUriSlashFix,
      'scheme'
    )
    const { schemeTerm, valuesClause } = schemeValues

    return withPrefixes(`
    SELECT ?concept ?notation ?hasNarrower ?isInSchemeOnly ${deprecationSelectVars}
    WHERE {
      {
        SELECT DISTINCT ?concept ?isInSchemeOnly ${deprecationSelectVars}
        WHERE {
          ${valuesClause}
          {
            { ?concept skos:topConceptOf ${schemeTerm} }
            UNION
            { ${schemeTerm} skos:hasTopConcept ?concept }
            BIND(false AS ?isInSchemeOnly)
          }
          UNION
          {
            ?concept a skos:Concept .
            ?concept skos:inScheme ${schemeTerm} .
            FILTER NOT EXISTS { ?concept skos:broader ?x }
            FILTER NOT EXISTS { ?x skos:narrower ?concept }
            FILTER NOT EXISTS { ?concept skos:broaderTransitive ?x }
            FILTER NOT EXISTS { ?concept skos:narrowerTransitive ?x }
            FILTER NOT EXISTS { ?concept skos:topConceptOf ?x }
            FILTER NOT EXISTS { ?x skos:hasTopConcept ?concept }
            BIND(true AS ?isInSchemeOnly)
          }
          ${deprecationClauses}
        }
        ORDER BY ?concept
        LIMIT ${pageSize + 1}
        OFFSET ${offset}
      }
      OPTIONAL { ?concept skos:notation ?notation }
      ${buildHasNarrowerClause()}
    }
  `)
  }

  /**
   * Build metadata query for children of a concept.
   * Returns concept URIs + notation + hasNarrower (no labels).
   *
   * @param parentUri - The parent concept URI to query children for
   * @param pageSize - Number of concepts per page (query fetches pageSize + 1 for hasMore)
   * @param offset - Number of concepts to skip for pagination
   * @returns SPARQL SELECT query string for narrower concepts of the parent
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
      ${buildHasNarrowerClause()}
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
