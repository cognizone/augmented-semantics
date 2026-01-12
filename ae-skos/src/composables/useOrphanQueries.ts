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
 * @returns SPARQL query string, or null if capabilities are missing
 *
 * @see /spec/ae-skos/sko02-SchemeSelector.md
 */
export function buildSingleOrphanQuery(
  endpoint: SPARQLEndpoint,
  pageSize: number,
  offset: number
): string | null {
  const rel = endpoint.analysis?.relationships

  if (!rel) {
    return null
  }

  // Build UNION branches based on endpoint capabilities
  const unionBranches: string[] = []

  // Branch 1: inScheme
  if (rel.hasInScheme) {
    unionBranches.push('{ ?concept skos:inScheme ?scheme . }')
  }

  // Branch 2: hasTopConcept
  if (rel.hasHasTopConcept) {
    unionBranches.push('{ ?scheme skos:hasTopConcept ?concept . }')
  }

  // Branch 3: topConceptOf
  if (rel.hasTopConceptOf) {
    unionBranches.push('{ ?concept skos:topConceptOf ?scheme . }')
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

  // If no branches, cannot detect orphans
  if (unionBranches.length === 0) {
    return null
  }

  // Build FILTER NOT EXISTS with UNION branches
  const filterPattern = unionBranches.join('\n        UNION\n        ')

  return withPrefixes(`
    SELECT DISTINCT ?concept
    WHERE {
      ?concept a skos:Concept .

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
