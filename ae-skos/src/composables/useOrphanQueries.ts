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
