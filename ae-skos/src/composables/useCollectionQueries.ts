/**
 * Collection Query Builders
 *
 * Builds conditional SPARQL queries for collection loading based on
 * endpoint capabilities (relationships).
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import type { SPARQLEndpoint } from '../types'
import { withPrefixes } from '../services'

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
  const hasTopCapability = rel.hasTopConceptOf || rel.hasHasTopConcept

  if (hasTopCapability) {
    // Build inner top concept branches
    const topBranches: string[] = []
    if (rel.hasTopConceptOf) {
      topBranches.push(`{ ?top skos:topConceptOf <${schemeUri}> . }`)
    }
    if (rel.hasHasTopConcept) {
      topBranches.push(`{ <${schemeUri}> skos:hasTopConcept ?top . }`)
    }
    const topPattern = topBranches.join(' UNION ')

    // Prefer broaderTransitive over broader+ property path (faster)
    if (rel.hasBroaderTransitive) {
      membershipBranches.push(`{ ?concept skos:broaderTransitive ?top . ${topPattern} }`)
    } else if (rel.hasBroader) {
      // Fallback to broader+ property path (slower)
      membershipBranches.push(`{ ?concept skos:broader+ ?top . ${topPattern} }`)
    }
  }

  // If no branches, cannot query
  if (membershipBranches.length === 0) {
    return null
  }

  // Build UNION pattern
  const unionPattern = membershipBranches.join('\n        UNION\n        ')

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

      # Label resolution with priority tracking
      OPTIONAL {
        {
          ?collection skos:prefLabel ?label .
          BIND("prefLabel" AS ?labelType)
        } UNION {
          ?collection skosxl:prefLabel/skosxl:literalForm ?label .
          BIND("xlPrefLabel" AS ?labelType)
        } UNION {
          ?collection dct:title ?label .
          BIND("dctTitle" AS ?labelType)
        } UNION {
          ?collection dc:title ?label .
          BIND("dcTitle" AS ?labelType)
        } UNION {
          ?collection rdfs:label ?label .
          BIND("rdfsLabel" AS ?labelType)
        }
        BIND(LANG(?label) AS ?labelLang)
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
 *
 * @param parentUri - URI of the parent collection
 * @returns SPARQL query string
 */
export function buildChildCollectionsQuery(parentUri: string): string {
  return withPrefixes(`
    SELECT DISTINCT ?collection ?label ?labelLang ?labelType ?notation
           ?hasChildCollections WHERE {
      <${parentUri}> skos:member ?collection .
      ?collection a skos:Collection .

      # Detect if has children (for recursive expandability)
      BIND(EXISTS {
        ?collection skos:member ?childCol .
        ?childCol a skos:Collection .
      } AS ?hasChildCollections)

      # Label resolution with priority tracking
      OPTIONAL {
        {
          ?collection skos:prefLabel ?label .
          BIND("prefLabel" AS ?labelType)
        } UNION {
          ?collection skosxl:prefLabel/skosxl:literalForm ?label .
          BIND("xlPrefLabel" AS ?labelType)
        } UNION {
          ?collection dct:title ?label .
          BIND("dctTitle" AS ?labelType)
        } UNION {
          ?collection dc:title ?label .
          BIND("dcTitle" AS ?labelType)
        } UNION {
          ?collection rdfs:label ?label .
          BIND("rdfsLabel" AS ?labelType)
        }
        BIND(LANG(?label) AS ?labelLang)
      }

      # Notation
      OPTIONAL { ?collection skos:notation ?notation }
    }
    ORDER BY ?collection
  `)
}
