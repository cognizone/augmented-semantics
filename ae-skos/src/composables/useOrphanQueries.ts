/**
 * Orphan Concept Query Builders
 *
 * Builds conditional SPARQL queries for orphan concept detection based on
 * endpoint capabilities (relationships).
 *
 * @see /spec/ae-skos/sko02-SchemeSelector.md
 */
import type { SPARQLEndpoint } from '../types'
import { withPrefixes } from '../services'

/**
 * Build queries for orphan concept detection
 * Returns array of query builders based on endpoint capabilities
 */
export function buildOrphanExclusionQueries(
  endpoint: SPARQLEndpoint,
  pageSize: number,
  offset: number
): { name: string; query: string }[] {
  const queries: { name: string; query: string }[] = []
  const rel = endpoint.analysis?.relationships

  if (!rel) {
    return queries
  }

  // Q2: inScheme
  if (rel.hasInScheme) {
    queries.push({
      name: 'inScheme',
      query: withPrefixes(`
        SELECT DISTINCT ?concept
        WHERE {
          ?concept a skos:Concept .
          ?concept skos:inScheme ?scheme .
        }
        ORDER BY ?concept
        LIMIT ${pageSize}
        OFFSET ${offset}
      `),
    })
  }

  // Q3: hasTopConcept
  if (rel.hasHasTopConcept) {
    queries.push({
      name: 'hasTopConcept',
      query: withPrefixes(`
        SELECT DISTINCT ?concept
        WHERE {
          ?concept a skos:Concept .
          ?scheme skos:hasTopConcept ?concept .
        }
        ORDER BY ?concept
        LIMIT ${pageSize}
        OFFSET ${offset}
      `),
    })
  }

  // Q4: topConceptOf
  if (rel.hasTopConceptOf) {
    queries.push({
      name: 'topConceptOf',
      query: withPrefixes(`
        SELECT DISTINCT ?concept
        WHERE {
          ?concept a skos:Concept .
          ?concept skos:topConceptOf ?scheme .
        }
        ORDER BY ?concept
        LIMIT ${pageSize}
        OFFSET ${offset}
      `),
    })
  }

  // Q5: hasTopConcept + narrowerTransitive
  if (rel.hasHasTopConcept && rel.hasNarrowerTransitive) {
    queries.push({
      name: 'hasTopConcept-narrowerTransitive',
      query: withPrefixes(`
        SELECT DISTINCT ?concept
        WHERE {
          ?concept a skos:Concept .
          ?scheme skos:hasTopConcept ?top .
          ?top skos:narrowerTransitive ?concept .
        }
        ORDER BY ?concept
        LIMIT ${pageSize}
        OFFSET ${offset}
      `),
    })
  }

  // Q6: topConceptOf + narrowerTransitive
  if (rel.hasTopConceptOf && rel.hasNarrowerTransitive) {
    queries.push({
      name: 'topConceptOf-narrowerTransitive',
      query: withPrefixes(`
        SELECT DISTINCT ?concept
        WHERE {
          ?concept a skos:Concept .
          ?top skos:topConceptOf ?scheme .
          ?top skos:narrowerTransitive ?concept .
        }
        ORDER BY ?concept
        LIMIT ${pageSize}
        OFFSET ${offset}
      `),
    })
  }

  // Q7: hasTopConcept + broaderTransitive
  if (rel.hasHasTopConcept && rel.hasBroaderTransitive) {
    queries.push({
      name: 'hasTopConcept-broaderTransitive',
      query: withPrefixes(`
        SELECT DISTINCT ?concept
        WHERE {
          ?concept a skos:Concept .
          ?scheme skos:hasTopConcept ?top .
          ?concept skos:broaderTransitive ?top .
        }
        ORDER BY ?concept
        LIMIT ${pageSize}
        OFFSET ${offset}
      `),
    })
  }

  // Q8: topConceptOf + broaderTransitive
  if (rel.hasTopConceptOf && rel.hasBroaderTransitive) {
    queries.push({
      name: 'topConceptOf-broaderTransitive',
      query: withPrefixes(`
        SELECT DISTINCT ?concept
        WHERE {
          ?concept a skos:Concept .
          ?top skos:topConceptOf ?scheme .
          ?concept skos:broaderTransitive ?top .
        }
        ORDER BY ?concept
        LIMIT ${pageSize}
        OFFSET ${offset}
      `),
    })
  }

  // Q9: hasTopConcept + narrower (property path)
  if (rel.hasHasTopConcept && rel.hasNarrower) {
    queries.push({
      name: 'hasTopConcept-narrower-path',
      query: withPrefixes(`
        SELECT DISTINCT ?concept
        WHERE {
          ?concept a skos:Concept .
          ?scheme skos:hasTopConcept ?top .
          ?top skos:narrower+ ?concept .
        }
        ORDER BY ?concept
        LIMIT ${pageSize}
        OFFSET ${offset}
      `),
    })
  }

  // Q10: topConceptOf + narrower (property path)
  if (rel.hasTopConceptOf && rel.hasNarrower) {
    queries.push({
      name: 'topConceptOf-narrower-path',
      query: withPrefixes(`
        SELECT DISTINCT ?concept
        WHERE {
          ?concept a skos:Concept .
          ?top skos:topConceptOf ?scheme .
          ?top skos:narrower+ ?concept .
        }
        ORDER BY ?concept
        LIMIT ${pageSize}
        OFFSET ${offset}
      `),
    })
  }

  // Q11: hasTopConcept + broader (property path)
  if (rel.hasHasTopConcept && rel.hasBroader) {
    queries.push({
      name: 'hasTopConcept-broader-path',
      query: withPrefixes(`
        SELECT DISTINCT ?concept
        WHERE {
          ?concept a skos:Concept .
          ?scheme skos:hasTopConcept ?top .
          ?concept skos:broader+ ?top .
        }
        ORDER BY ?concept
        LIMIT ${pageSize}
        OFFSET ${offset}
      `),
    })
  }

  // Q12: topConceptOf + broader (property path)
  if (rel.hasTopConceptOf && rel.hasBroader) {
    queries.push({
      name: 'topConceptOf-broader-path',
      query: withPrefixes(`
        SELECT DISTINCT ?concept
        WHERE {
          ?concept a skos:Concept .
          ?top skos:topConceptOf ?scheme .
          ?concept skos:broader+ ?top .
        }
        ORDER BY ?concept
        LIMIT ${pageSize}
        OFFSET ${offset}
      `),
    })
  }

  return queries
}

/**
 * Build a single FILTER NOT EXISTS query for orphan detection.
 * Only includes UNION branches for properties that exist in endpoint capabilities.
 *
 * This is much faster than running multiple exclusion queries, but requires
 * a SPARQL endpoint with good FILTER NOT EXISTS optimization.
 *
 * @param endpoint - SPARQL endpoint with relationship analysis
 * @param pageSize - Number of results per page
 * @param offset - Pagination offset
 * @param options - Optional query tuning (e.g., prefilter direct scheme links)
 * @returns SPARQL query string, or null if capabilities are missing
 *
 * @see /spec/ae-skos/sko02-SchemeSelector.md
 */
export function buildSingleOrphanQuery(
  endpoint: SPARQLEndpoint,
  pageSize: number,
  offset: number,
  options?: {
    prefilterDirectLinks?: boolean
  }
): string | null {
  const rel = endpoint.analysis?.relationships

  if (!rel) {
    return null
  }

  const prefilterDirectLinks = options?.prefilterDirectLinks ?? false

  // Build UNION branches based on endpoint capabilities
  const unionBranches: string[] = []

  // Branch 1: inScheme
  if (rel.hasInScheme) {
    if (!prefilterDirectLinks) {
      unionBranches.push('{ ?concept skos:inScheme ?scheme . }')
    }
  }

  // Branch 2: hasTopConcept
  if (rel.hasHasTopConcept) {
    if (!prefilterDirectLinks) {
      unionBranches.push('{ ?scheme skos:hasTopConcept ?concept . }')
    }
  }

  // Branch 3: topConceptOf
  if (rel.hasTopConceptOf) {
    if (!prefilterDirectLinks) {
      unionBranches.push('{ ?concept skos:topConceptOf ?scheme . }')
    }
  }

  // Branch 4: hasTopConcept + narrowerTransitive
  if (rel.hasHasTopConcept && rel.hasNarrowerTransitive) {
    unionBranches.push('{ ?scheme skos:hasTopConcept ?top . ?top skos:narrowerTransitive ?concept . }')
  }

  // Branch 5: topConceptOf + narrowerTransitive
  if (rel.hasTopConceptOf && rel.hasNarrowerTransitive) {
    unionBranches.push('{ ?top skos:topConceptOf ?scheme . ?top skos:narrowerTransitive ?concept . }')
  }

  // Branch 6: hasTopConcept + broaderTransitive
  if (rel.hasHasTopConcept && rel.hasBroaderTransitive) {
    unionBranches.push('{ ?scheme skos:hasTopConcept ?top . ?concept skos:broaderTransitive ?top . }')
  }

  // Branch 7: topConceptOf + broaderTransitive
  if (rel.hasTopConceptOf && rel.hasBroaderTransitive) {
    unionBranches.push('{ ?top skos:topConceptOf ?scheme . ?concept skos:broaderTransitive ?top . }')
  }

  // Branch 8: hasTopConcept + narrower (property path)
  if (rel.hasHasTopConcept && rel.hasNarrower) {
    unionBranches.push('{ ?scheme skos:hasTopConcept ?top . ?top skos:narrower+ ?concept . }')
  }

  // Branch 9: topConceptOf + narrower (property path)
  if (rel.hasTopConceptOf && rel.hasNarrower) {
    unionBranches.push('{ ?top skos:topConceptOf ?scheme . ?top skos:narrower+ ?concept . }')
  }

  // Branch 10: hasTopConcept + broader (property path)
  if (rel.hasHasTopConcept && rel.hasBroader) {
    unionBranches.push('{ ?scheme skos:hasTopConcept ?top . ?concept skos:broader+ ?top . }')
  }

  // Branch 11: topConceptOf + broader (property path)
  if (rel.hasTopConceptOf && rel.hasBroader) {
    unionBranches.push('{ ?top skos:topConceptOf ?scheme . ?concept skos:broader+ ?top . }')
  }

  const candidateFilters: string[] = []
  if (prefilterDirectLinks) {
    if (rel.hasInScheme) {
      candidateFilters.push('FILTER NOT EXISTS { ?concept skos:inScheme ?scheme . }')
    }
    if (rel.hasTopConceptOf) {
      candidateFilters.push('FILTER NOT EXISTS { ?concept skos:topConceptOf ?scheme . }')
    }
    if (rel.hasHasTopConcept) {
      candidateFilters.push('FILTER NOT EXISTS { ?scheme skos:hasTopConcept ?concept . }')
    }
  }

  const candidatePattern = candidateFilters.length > 0
    ? `
      {
        SELECT DISTINCT ?concept
        WHERE {
          ?concept a skos:Concept .
          ${candidateFilters.join('\n          ')}
        }
      }
    `
    : `
      ?concept a skos:Concept .
    `

  // If no branches beyond direct links, return candidate set (or null if no filters)
  if (unionBranches.length === 0) {
    if (candidateFilters.length === 0) {
      return null
    }
    return withPrefixes(`
      SELECT DISTINCT ?concept
      WHERE {
        ${candidatePattern}
      }
      ORDER BY ?concept
      LIMIT ${pageSize}
      OFFSET ${offset}
    `)
  }

  // Build FILTER NOT EXISTS with UNION branches
  const filterPattern = unionBranches.join('\n        UNION\n        ')

  return withPrefixes(`
    SELECT DISTINCT ?concept
    WHERE {
      ${candidatePattern}

      FILTER NOT EXISTS {
        ${filterPattern}
      }
    }
    ORDER BY ?concept
    LIMIT ${pageSize}
    OFFSET ${offset}
  `)
}

/**
 * Build query for all concepts (Q1)
 */
export function buildAllConceptsQuery(pageSize: number, offset: number): string {
  return withPrefixes(`
    SELECT DISTINCT ?concept
    WHERE {
      ?concept a skos:Concept .
    }
    ORDER BY ?concept
    LIMIT ${pageSize}
    OFFSET ${offset}
  `)
}

/**
 * Build a single FILTER NOT EXISTS query for orphan collection detection.
 * An orphan collection is a collection where NONE of its members have a
 * hierarchical path to any scheme (via inScheme, topConceptOf, broaderTransitive, etc.)
 *
 * Uses the same membership UNION pattern as buildCollectionsQuery but inverted
 * with FILTER NOT EXISTS.
 *
 * @param endpoint - SPARQL endpoint with relationship analysis
 * @param pageSize - Number of results per page
 * @param offset - Pagination offset
 * @returns SPARQL query string, or null if capabilities are missing
 *
 * @see /spec/ae-skos/sko08-OrphanDetection.md
 */
export function buildOrphanCollectionsQuery(
  endpoint: SPARQLEndpoint,
  pageSize: number,
  offset: number
): string | null {
  const rel = endpoint.analysis?.relationships

  if (!rel) {
    return null
  }

  // Build membership UNION branches based on endpoint capabilities
  // (same pattern as buildCollectionsQuery)
  const membershipBranches: string[] = []

  // Branch 1: inScheme
  if (rel.hasInScheme) {
    membershipBranches.push('{ ?concept skos:inScheme ?scheme . }')
  }

  // Branch 2: topConceptOf
  if (rel.hasTopConceptOf) {
    membershipBranches.push('{ ?concept skos:topConceptOf ?scheme . }')
  }

  // Branch 3: hasTopConcept
  if (rel.hasHasTopConcept) {
    membershipBranches.push('{ ?scheme skos:hasTopConcept ?concept . }')
  }

  // Hierarchical branches - need top concept capability
  const hasTopCapability = rel.hasTopConceptOf || rel.hasHasTopConcept

  if (hasTopCapability) {
    // Prefer broaderTransitive over broader+ property path (faster)
    if (rel.hasBroaderTransitive) {
      // For each top concept relation type, add the transitive path
      if (rel.hasTopConceptOf) {
        membershipBranches.push('{ ?concept skos:broaderTransitive ?top . ?top skos:topConceptOf ?scheme . }')
      }
      if (rel.hasHasTopConcept) {
        membershipBranches.push('{ ?concept skos:broaderTransitive ?top . ?scheme skos:hasTopConcept ?top . }')
      }
    } else if (rel.hasBroader) {
      // Fallback to broader+ property path
      if (rel.hasTopConceptOf) {
        membershipBranches.push('{ ?concept skos:broader+ ?top . ?top skos:topConceptOf ?scheme . }')
      }
      if (rel.hasHasTopConcept) {
        membershipBranches.push('{ ?concept skos:broader+ ?top . ?scheme skos:hasTopConcept ?top . }')
      }
    }
  }

  // If no branches, cannot detect orphans
  if (membershipBranches.length === 0) {
    return null
  }

  // Build UNION pattern for membership test
  const unionPattern = membershipBranches.join('\n          UNION\n          ')

  return withPrefixes(`
    SELECT DISTINCT ?collection
    WHERE {
      ?collection a skos:Collection .

      # Orphan = no member has a path to any scheme
      FILTER NOT EXISTS {
        ?collection skos:member ?concept .
        ${unionPattern}
      }
    }
    ORDER BY ?collection
    LIMIT ${pageSize}
    OFFSET ${offset}
  `)
}
