/**
 * Collection Query Builders
 *
 * Builds conditional SPARQL queries for collection loading based on
 * endpoint capabilities (relationships and label predicates).
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import type { SPARQLEndpoint } from '../types'
import { withPrefixes } from '../services'
import { buildCapabilityAwareLabelUnionClause } from '../constants'

/**
 * Get capabilities for collection queries.
 * Returns which branches can be used and whether querying is possible.
 */
export function getCollectionQueryCapabilities(
  endpoint: SPARQLEndpoint
): { branches: string[]; canQuery: boolean } {
  const rel = endpoint.analysis?.relationships

  if (!rel) {
    return { branches: [], canQuery: false }
  }

  const branches: string[] = []

  // Direct membership branches
  if (rel.hasInScheme) {
    branches.push('inScheme')
  }
  if (rel.hasTopConceptOf) {
    branches.push('topConceptOf')
  }
  if (rel.hasHasTopConcept) {
    branches.push('hasTopConcept')
  }

  // Hierarchical branches - prefer transitive over property path
  const hasTopCapability = rel.hasTopConceptOf || rel.hasHasTopConcept

  if (hasTopCapability && rel.hasBroaderTransitive) {
    branches.push('broaderTransitive')
  } else if (hasTopCapability && rel.hasBroader) {
    branches.push('broader-path')
  }

  return {
    branches,
    canQuery: branches.length > 0,
  }
}

/**
 * Build SPARQL query for finding collections with members in a scheme.
 * Dynamically builds query based on endpoint capabilities.
 *
 * @param endpoint - SPARQL endpoint with relationship analysis
 * @param schemeUri - URI of the scheme to find collections for
 * @returns SPARQL query string, or null if capabilities are missing
 */
export function buildCollectionsQuery(
  endpoint: SPARQLEndpoint,
  schemeUri: string
): string | null {
  const rel = endpoint.analysis?.relationships

  if (!rel) {
    return null
  }

  // Build membership UNION branches based on endpoint capabilities
  const membershipBranches: string[] = []

  // Branch 1: inScheme
  if (rel.hasInScheme) {
    membershipBranches.push(`{ ?concept skos:inScheme <${schemeUri}> . }`)
  }

  // Branch 2: topConceptOf
  if (rel.hasTopConceptOf) {
    membershipBranches.push(`{ ?concept skos:topConceptOf <${schemeUri}> . }`)
  }

  // Branch 3: hasTopConcept
  if (rel.hasHasTopConcept) {
    membershipBranches.push(`{ <${schemeUri}> skos:hasTopConcept ?concept . }`)
  }

  // Hierarchical branches - need top concept capability
  // Note: Nested UNIONs cause issues on some SPARQL engines, so we flatten into separate branches
  const hasTopCapability = rel.hasTopConceptOf || rel.hasHasTopConcept

  if (hasTopCapability) {
    // Prefer broaderTransitive over broader+ property path (faster)
    const broaderPredicate = rel.hasBroaderTransitive ? 'skos:broaderTransitive' : (rel.hasBroader ? 'skos:broader+' : null)

    if (broaderPredicate) {
      // Add separate branch for each top concept pattern to avoid nested UNION issues
      if (rel.hasTopConceptOf) {
        membershipBranches.push(`{ ?concept ${broaderPredicate} ?top . ?top skos:topConceptOf <${schemeUri}> . }`)
      }
      if (rel.hasHasTopConcept) {
        membershipBranches.push(`{ ?concept ${broaderPredicate} ?top . <${schemeUri}> skos:hasTopConcept ?top . }`)
      }
    }
  }

  // If no branches, cannot query
  if (membershipBranches.length === 0) {
    return null
  }

  // Build UNION pattern
  const unionPattern = membershipBranches.join('\n        UNION\n        ')

  // Get collection label capabilities
  const collectionCapabilities = endpoint.analysis?.labelPredicates?.collection
  const labelClause = buildCapabilityAwareLabelUnionClause('?collection', collectionCapabilities)

  return withPrefixes(`
    SELECT DISTINCT ?collection ?label ?labelLang ?labelType ?notation
           ?hasParentCollection ?hasChildCollections WHERE {
      ?collection a skos:Collection .
      ?collection skos:member ?concept .

      # Concept belongs to scheme via capability-detected paths
      ${unionPattern}

      # Detect if nested (has parent collection)
      BIND(EXISTS {
        ?parentCol a skos:Collection .
        ?parentCol skos:member ?collection .
      } AS ?hasParentCollection)

      # Detect if has children (has child collections)
      BIND(EXISTS {
        ?collection skos:member ?childCol .
        ?childCol a skos:Collection .
      } AS ?hasChildCollections)

      # Label resolution with priority tracking (capability-aware)
      OPTIONAL {
        ${labelClause}
      }

      # Notation
      OPTIONAL { ?collection skos:notation ?notation }
    }
    ORDER BY ?collection
  `)
}

/**
 * Build SPARQL query for loading child collections of a parent collection.
 * Used for lazy-loading nested collections on expand.
 * Filters to only include child collections with members in the current scheme.
 *
 * @param parentUri - URI of the parent collection
 * @param schemeUri - URI of the current scheme (for filtering)
 * @param endpoint - Endpoint to get capabilities from
 * @returns SPARQL query string, or null if capabilities are missing
 */
export function buildChildCollectionsQuery(
  parentUri: string,
  schemeUri: string,
  endpoint: SPARQLEndpoint
): string | null {
  const rel = endpoint.analysis?.relationships

  if (!rel) {
    return null
  }

  // Build membership UNION branches based on endpoint capabilities
  const membershipBranches: string[] = []

  if (rel.hasInScheme) {
    membershipBranches.push(`{ ?member skos:inScheme <${schemeUri}> . }`)
  }
  if (rel.hasTopConceptOf) {
    membershipBranches.push(`{ ?member skos:topConceptOf <${schemeUri}> . }`)
  }
  if (rel.hasHasTopConcept) {
    membershipBranches.push(`{ <${schemeUri}> skos:hasTopConcept ?member . }`)
  }

  // Hierarchical branches - flatten to avoid nested UNION issues
  const hasTopCapability = rel.hasTopConceptOf || rel.hasHasTopConcept
  if (hasTopCapability) {
    const broaderPredicate = rel.hasBroaderTransitive ? 'skos:broaderTransitive' : (rel.hasBroader ? 'skos:broader+' : null)

    if (broaderPredicate) {
      if (rel.hasTopConceptOf) {
        membershipBranches.push(`{ ?member ${broaderPredicate} ?top . ?top skos:topConceptOf <${schemeUri}> . }`)
      }
      if (rel.hasHasTopConcept) {
        membershipBranches.push(`{ ?member ${broaderPredicate} ?top . <${schemeUri}> skos:hasTopConcept ?top . }`)
      }
    }
  }

  if (membershipBranches.length === 0) {
    return null
  }

  const unionPattern = membershipBranches.join('\n        UNION\n        ')

  // Get collection label capabilities
  const collectionCapabilities = endpoint.analysis?.labelPredicates?.collection
  const labelClause = buildCapabilityAwareLabelUnionClause('?collection', collectionCapabilities)

  return withPrefixes(`
    SELECT DISTINCT ?collection ?label ?labelLang ?labelType ?notation
           ?hasChildCollections WHERE {
      <${parentUri}> skos:member ?collection .
      ?collection a skos:Collection .

      # Child collection must have members in current scheme
      ?collection skos:member ?member .
      ${unionPattern}

      # Detect if has children (for recursive expandability)
      BIND(EXISTS {
        ?collection skos:member ?childCol .
        ?childCol a skos:Collection .
      } AS ?hasChildCollections)

      # Label resolution with priority tracking (capability-aware)
      OPTIONAL {
        ${labelClause}
      }

      # Notation
      OPTIONAL { ?collection skos:notation ?notation }
    }
    ORDER BY ?collection
  `)
}
