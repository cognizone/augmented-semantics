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
import { buildSchemeValuesClause } from '../utils/schemeUri'

export type CollectionQueryStage = 'inScheme' | 'topConcept' | 'transitive' | 'path'
export type CollectionQueryMode = 'collection' | 'ordered'
export interface SchemeFixOptions {
  enableSchemeUriSlashFix?: boolean
}

const COLLECTION_MEMBER_PATH = 'skos:member|skos:memberList/rdf:rest*/rdf:first'

/**
 * Get capabilities for collection queries.
 * Returns which stages can be used and whether querying is possible.
 */
export function getCollectionQueryCapabilities(
  endpoint: SPARQLEndpoint
): { stages: CollectionQueryStage[]; canQuery: boolean } {
  const rel = endpoint.analysis?.relationships

  if (!rel) {
    return { stages: [], canQuery: false }
  }

  const stages: CollectionQueryStage[] = []

  // Direct membership stages
  if (rel.hasInScheme) {
    stages.push('inScheme')
  }

  const hasTopCapability = rel.hasTopConceptOf || rel.hasHasTopConcept
  if (hasTopCapability) {
    stages.push('topConcept')
  }

  // Hierarchical stage (prefer transitive over property path)
  const hasTransitive = rel.hasBroaderTransitive || rel.hasNarrowerTransitive
  const hasPath = rel.hasBroader || rel.hasNarrower

  if (hasTopCapability && hasTransitive) {
    stages.push('transitive')
  } else if (hasTopCapability && hasPath) {
    stages.push('path')
  }

  return {
    stages,
    canQuery: stages.length > 0,
  }
}

function buildTopConceptPatterns(
  schemeTerm: string,
  rel: NonNullable<SPARQLEndpoint['analysis']>['relationships']
): string[] {
  if (!rel) return []

  const patterns: string[] = []

  if (rel.hasTopConceptOf) {
    patterns.push(`?top skos:topConceptOf ${schemeTerm} .`)
  }
  if (rel.hasHasTopConcept) {
    patterns.push(`${schemeTerm} skos:hasTopConcept ?top .`)
  }

  return patterns
}

function buildMemberSchemeBranches(
  memberVar: string,
  schemeTerm: string,
  rel: NonNullable<SPARQLEndpoint['analysis']>['relationships'],
  options?: { includeHierarchy?: boolean }
): string[] {
  if (!rel) return []

  const branches: string[] = []

  if (rel.hasInScheme) {
    branches.push(`{ ${memberVar} skos:inScheme ${schemeTerm} . }`)
  }
  if (rel.hasTopConceptOf) {
    branches.push(`{ ${memberVar} skos:topConceptOf ${schemeTerm} . }`)
  }
  if (rel.hasHasTopConcept) {
    branches.push(`{ ${schemeTerm} skos:hasTopConcept ${memberVar} . }`)
  }

  const includeHierarchy = options?.includeHierarchy !== false
  const topPatterns = includeHierarchy ? buildTopConceptPatterns(schemeTerm, rel) : []
  const hasTopCapability = topPatterns.length > 0

  if (hasTopCapability) {
    if (rel.hasBroaderTransitive || rel.hasNarrowerTransitive) {
      if (rel.hasBroaderTransitive) {
        for (const topPattern of topPatterns) {
          branches.push(`{ ${memberVar} skos:broaderTransitive ?top . ${topPattern} }`)
        }
      }
      if (rel.hasNarrowerTransitive) {
        for (const topPattern of topPatterns) {
          branches.push(`{ ?top skos:narrowerTransitive ${memberVar} . ${topPattern} }`)
        }
      }
    } else if (rel.hasBroader || rel.hasNarrower) {
      if (rel.hasBroader) {
        for (const topPattern of topPatterns) {
          branches.push(`{ ${memberVar} skos:broader+ ?top . ${topPattern} }`)
        }
      }
      if (rel.hasNarrower) {
        for (const topPattern of topPatterns) {
          branches.push(`{ ?top skos:narrower+ ${memberVar} . ${topPattern} }`)
        }
      }
    }
  }

  return branches
}

function buildStageFilterClause(
  stage: CollectionQueryStage,
  endpoint: SPARQLEndpoint,
  schemeTerm: string
): string | null {
  const rel = endpoint.analysis?.relationships
  if (!rel) return null

  if (stage === 'inScheme') {
    if (!rel.hasInScheme) return null
    return `FILTER EXISTS {
      ?collection skos:member ?concept .
      ?concept skos:inScheme ${schemeTerm} .
    }`
  }

  if (stage === 'topConcept') {
    if (!rel.hasTopConceptOf && !rel.hasHasTopConcept) return null
    const patterns: string[] = []
    if (rel.hasTopConceptOf) {
      patterns.push(`{ ?concept skos:topConceptOf ${schemeTerm} . }`)
    }
    if (rel.hasHasTopConcept) {
      patterns.push(`{ ${schemeTerm} skos:hasTopConcept ?concept . }`)
    }
    if (patterns.length === 0) return null
    const union = patterns.join(' UNION ')
    return `FILTER EXISTS {
      ?collection skos:member ?concept .
      ${union}
    }`
  }

  const topPatterns = buildTopConceptPatterns(schemeTerm, rel)
  if (topPatterns.length === 0) return null

  if (stage === 'transitive') {
    const patterns: string[] = []
    if (rel.hasBroaderTransitive) {
      for (const topPattern of topPatterns) {
        patterns.push(`{
          ?collection skos:member ?concept .
          ?concept skos:broaderTransitive ?top .
          ${topPattern}
        }`)
      }
    }
    if (rel.hasNarrowerTransitive) {
      for (const topPattern of topPatterns) {
        patterns.push(`{
          ?collection skos:member ?concept .
          ?top skos:narrowerTransitive ?concept .
          ${topPattern}
        }`)
      }
    }
    if (patterns.length === 0) return null
    const union = patterns.join(' UNION ')
    return `FILTER EXISTS {
      ${union}
    }`
  }

  if (stage === 'path') {
    const patterns: string[] = []
    if (rel.hasBroader) {
      for (const topPattern of topPatterns) {
        patterns.push(`{
          ?collection skos:member ?concept .
          ?concept skos:broader+ ?top .
          ${topPattern}
        }`)
      }
    }
    if (rel.hasNarrower) {
      for (const topPattern of topPatterns) {
        patterns.push(`{
          ?collection skos:member ?concept .
          ?top skos:narrower+ ?concept .
          ${topPattern}
        }`)
      }
    }
    if (patterns.length === 0) return null
    const union = patterns.join(' UNION ')
    return `FILTER EXISTS {
      ${union}
    }`
  }

  return null
}

/**
 * Build a staged SPARQL query for finding collections in a scheme.
 * Uses a FILTER EXISTS membership clause for early short-circuiting.
 */
export function buildCollectionsStageQuery(
  endpoint: SPARQLEndpoint,
  schemeUri: string,
  stage: CollectionQueryStage,
  options?: SchemeFixOptions
): string | null {
  const rel = endpoint.analysis?.relationships
  if (!rel) return null

  const { schemeTerm, valuesClause } = buildSchemeValuesClause(
    schemeUri,
    endpoint.analysis,
    !!options?.enableSchemeUriSlashFix,
    'scheme'
  )

  const filterClause = buildStageFilterClause(stage, endpoint, schemeTerm)
  if (!filterClause) return null

  const childMembershipBranches = buildMemberSchemeBranches('?member', schemeTerm, rel, { includeHierarchy: true })
  const childMembershipPattern = childMembershipBranches.length > 0
    ? childMembershipBranches.join('\n        UNION\n        ')
    : null

  const collectionCapabilities = endpoint.analysis?.labelPredicates?.collection
  const labelClause = buildCapabilityAwareLabelUnionClause('?collection', collectionCapabilities)

  return withPrefixes(`
    SELECT DISTINCT ?collection ?label ?labelLang ?labelType ?notation
           ?hasParentCollection ?hasChildCollections WHERE {
      ${valuesClause}
      ?collection a skos:Collection .
      ${filterClause}

      # Detect if nested (has parent collection)
      BIND(EXISTS {
        ?parentCol a skos:Collection .
        ?parentCol skos:member ?collection .
      } AS ?hasParentCollection)

      # Detect if has children (has child collections)
      ${childMembershipPattern ? `BIND(EXISTS {
        ?collection skos:member ?childCol .
        ?childCol a skos:Collection .
        ?childCol skos:member ?member .
        ${childMembershipPattern}
      } AS ?hasChildCollections)` : 'BIND(false AS ?hasChildCollections)'}

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
 * Build SPARQL query for finding collections with members in a scheme.
 * Dynamically builds query based on endpoint capabilities.
 *
 * @param endpoint - SPARQL endpoint with relationship analysis
 * @param schemeUri - URI of the scheme to find collections for
 * @returns SPARQL query string, or null if capabilities are missing
 */
export function buildCollectionsQuery(
  endpoint: SPARQLEndpoint,
  schemeUri: string,
  options?: SchemeFixOptions
): string | null {
  const rel = endpoint.analysis?.relationships

  if (!rel) {
    return null
  }

  const { schemeTerm, valuesClause } = buildSchemeValuesClause(
    schemeUri,
    endpoint.analysis,
    !!options?.enableSchemeUriSlashFix,
    'scheme'
  )

  // Build membership UNION branches based on endpoint capabilities
  const membershipBranches: string[] = []

  // Branch 1: inScheme
  if (rel.hasInScheme) {
    membershipBranches.push(`{ ?concept skos:inScheme ${schemeTerm} . }`)
  }

  // Branch 2: topConceptOf
  if (rel.hasTopConceptOf) {
    membershipBranches.push(`{ ?concept skos:topConceptOf ${schemeTerm} . }`)
  }

  // Branch 3: hasTopConcept
  if (rel.hasHasTopConcept) {
    membershipBranches.push(`{ ${schemeTerm} skos:hasTopConcept ?concept . }`)
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
        membershipBranches.push(`{ ?concept ${broaderPredicate} ?top . ?top skos:topConceptOf ${schemeTerm} . }`)
      }
      if (rel.hasHasTopConcept) {
        membershipBranches.push(`{ ?concept ${broaderPredicate} ?top . ${schemeTerm} skos:hasTopConcept ?top . }`)
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
           ?hasParentCollection ?hasChildCollections ?isOrdered WHERE {
      ${valuesClause}
      ?collection a skos:Collection .
      ?collection skos:member ?concept .

      # Concept belongs to scheme via capability-detected paths
      ${unionPattern}

      # Detect if nested (has parent collection)
      BIND(EXISTS {
        ?parentCol a skos:Collection .
        ?parentCol ${COLLECTION_MEMBER_PATH} ?collection .
      } AS ?hasParentCollection)

      # Detect if has children (has child collections)
      BIND(EXISTS {
        ?collection ${COLLECTION_MEMBER_PATH} ?childCol .
        ?childCol a skos:Collection .
      } AS ?hasChildCollections)

      # OrderedCollection marker (for icon/display)
      BIND(EXISTS { ?collection a skos:OrderedCollection . } AS ?isOrdered)

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
 * Build SPARQL query for loading all root collections (no scheme filtering).
 * Filters out nested collections so only top-level collections appear.
 */
export function buildAllCollectionsQuery(
  endpoint: SPARQLEndpoint
): string {
  const collectionCapabilities = endpoint.analysis?.labelPredicates?.collection
  const labelClause = buildCapabilityAwareLabelUnionClause('?collection', collectionCapabilities)

  return withPrefixes(`
    SELECT DISTINCT ?collection ?label ?labelLang ?labelType ?notation
           ?hasParentCollection ?hasChildCollections ?isOrdered WHERE {
      ?collection a skos:Collection .

      # Only top-level collections (no parent collection)
      FILTER NOT EXISTS {
        ?parentCol a skos:Collection .
        ?parentCol ${COLLECTION_MEMBER_PATH} ?collection .
      }

      # Detect if nested (kept for consistent bindings; always false here)
      BIND(EXISTS {
        ?parentCol a skos:Collection .
        ?parentCol ${COLLECTION_MEMBER_PATH} ?collection .
      } AS ?hasParentCollection)

      # Detect if has children (has child collections)
      BIND(EXISTS {
        ?collection ${COLLECTION_MEMBER_PATH} ?childCol .
        ?childCol a skos:Collection .
      } AS ?hasChildCollections)

      # OrderedCollection marker (for icon/display)
      BIND(EXISTS { ?collection a skos:OrderedCollection . } AS ?isOrdered)

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
 * Build SPARQL query for loading all root ordered collections (no scheme filtering).
 * Filters out ordered collections nested inside other ordered collections.
 */
export function buildAllOrderedCollectionsQuery(
  endpoint: SPARQLEndpoint
): string {
  const collectionCapabilities = endpoint.analysis?.labelPredicates?.collection
  const labelClause = buildCapabilityAwareLabelUnionClause('?collection', collectionCapabilities)

  return withPrefixes(`
    SELECT DISTINCT ?collection ?label ?labelLang ?labelType ?notation
           ?hasParentCollection ?hasChildCollections ?isOrdered WHERE {
      ?collection a skos:OrderedCollection .

      # Only top-level ordered collections (no ordered parent collection)
      FILTER NOT EXISTS {
        ?parentCol a skos:OrderedCollection .
        ?parentCol ${COLLECTION_MEMBER_PATH} ?collection .
      }

      # Detect if nested (kept for consistent bindings; always false here)
      BIND(EXISTS {
        ?parentCol a skos:OrderedCollection .
        ?parentCol ${COLLECTION_MEMBER_PATH} ?collection .
      } AS ?hasParentCollection)

      # Detect if has ordered child collections
      BIND(EXISTS {
        ?collection ${COLLECTION_MEMBER_PATH} ?childCol .
        ?childCol a skos:OrderedCollection .
      } AS ?hasChildCollections)

      # OrderedCollection marker (for icon/display)
      BIND(true AS ?isOrdered)

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
  schemeUri: string | null,
  endpoint: SPARQLEndpoint,
  mode: CollectionQueryMode = 'collection',
  options?: SchemeFixOptions
): string | null {
  if (!schemeUri) {
    const collectionCapabilities = endpoint.analysis?.labelPredicates?.collection
    const labelClause = buildCapabilityAwareLabelUnionClause('?collection', collectionCapabilities)
    const typePattern = mode === 'ordered'
      ? '?collection a skos:OrderedCollection .'
      : '?collection a skos:Collection .'

    return withPrefixes(`
      SELECT DISTINCT ?collection ?label ?labelLang ?labelType ?notation
             ?hasParentCollection ?hasChildCollections ?isOrdered WHERE {
        <${parentUri}> ${COLLECTION_MEMBER_PATH} ?collection .
        ${typePattern}

        # Child collections are nested by definition
        BIND(true AS ?hasParentCollection)

        # Detect if has children (for recursive expandability)
        BIND(EXISTS {
          ?collection ${COLLECTION_MEMBER_PATH} ?childCol .
          ?childCol a ${mode === 'ordered' ? 'skos:OrderedCollection' : 'skos:Collection'} .
        } AS ?hasChildCollections)

        # OrderedCollection marker (for icon/display)
        BIND(${mode === 'ordered' ? 'true' : 'EXISTS { ?collection a skos:OrderedCollection . }'} AS ?isOrdered)

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

  const rel = endpoint.analysis?.relationships

  if (!rel) {
    return null
  }

  const { schemeTerm, valuesClause } = buildSchemeValuesClause(
    schemeUri,
    endpoint.analysis,
    !!options?.enableSchemeUriSlashFix,
    'scheme'
  )

  const membershipBranches = buildMemberSchemeBranches('?member', schemeTerm, rel, { includeHierarchy: true })
  if (membershipBranches.length === 0) {
    return null
  }

  const unionPattern = membershipBranches.join('\n        UNION\n        ')

  // Get collection label capabilities
  const collectionCapabilities = endpoint.analysis?.labelPredicates?.collection
  const labelClause = buildCapabilityAwareLabelUnionClause('?collection', collectionCapabilities)

  return withPrefixes(`
    SELECT DISTINCT ?collection ?label ?labelLang ?labelType ?notation
           ?hasChildCollections ?isOrdered WHERE {
      ${valuesClause}
      <${parentUri}> ${COLLECTION_MEMBER_PATH} ?collection .
      ${mode === 'ordered' ? '?collection a skos:OrderedCollection .' : '?collection a skos:Collection .'}

      # Child collection must have members in current scheme
      ?collection skos:member ?member .
      ${unionPattern}

      # Detect if has children (for recursive expandability)
      BIND(EXISTS {
        ?collection ${COLLECTION_MEMBER_PATH} ?childCol .
        ?childCol a ${mode === 'ordered' ? 'skos:OrderedCollection' : 'skos:Collection'} .
      } AS ?hasChildCollections)

      # OrderedCollection marker (for icon/display)
      BIND(${mode === 'ordered' ? 'true' : 'EXISTS { ?collection a skos:OrderedCollection . }'} AS ?isOrdered)

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
