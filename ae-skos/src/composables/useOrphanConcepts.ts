/**
 * Orphan Concept Calculation
 *
 * Fetches all concepts and excluded concepts (using multiple conditional queries),
 * then performs client-side set subtraction to find orphan concepts.
 *
 * @see /spec/ae-skos/sko02-SchemeSelector.md
 */
import type { SPARQLEndpoint } from '../types'
import { executeSparql } from '../services'
import { buildAllConceptsQuery, buildOrphanExclusionQueries, buildSingleOrphanQuery, buildOrphanCollectionsQuery } from './useOrphanQueries'
import { logger } from '../services'
import type { ProgressCallback, QueryResult } from './useOrphanProgress'

const PAGE_SIZE = 5000

/**
 * Fetch all concepts with pagination
 */
async function fetchAllConcepts(
  endpoint: SPARQLEndpoint,
  onProgress?: ProgressCallback
): Promise<Set<string>> {
  const allConcepts = new Set<string>()
  let offset = 0
  let hasMore = true

  // Get total count from endpoint capabilities (already analyzed!)
  const totalCount = endpoint.analysis?.totalConcepts ?? 0

  logger.info('OrphanConcepts', 'Fetching all concepts...', {
    totalExpected: totalCount
  })

  // Report phase start with total
  onProgress?.({
    phase: 'fetching-all',
    totalConcepts: totalCount,
    fetchedConcepts: 0,
    remainingCandidates: totalCount,
    completedQueries: [],
    skippedQueries: [],
    currentQueryName: null,
  })

  while (hasMore) {
    const query = buildAllConceptsQuery(PAGE_SIZE + 1, offset)
    const results = await executeSparql(endpoint, query)
    const uris = results.results.bindings.map(b => b.concept?.value).filter(Boolean) as string[]

    // +1 detection pattern
    hasMore = uris.length > PAGE_SIZE
    if (hasMore) {
      uris.pop() // Remove detection item
    }

    uris.forEach(uri => allConcepts.add(uri))
    offset += PAGE_SIZE

    // Report progress after each batch
    onProgress?.({
      phase: 'fetching-all',
      totalConcepts: totalCount,
      fetchedConcepts: allConcepts.size,
      remainingCandidates: totalCount,
      completedQueries: [],
      skippedQueries: [],
      currentQueryName: null,
    })

    logger.debug('OrphanConcepts', `Fetched ${allConcepts.size} / ${totalCount} concepts`, {
      batchSize: uris.length,
      hasMore,
    })
  }

  logger.info('OrphanConcepts', `Total concepts fetched: ${allConcepts.size}`)

  // Report phase complete
  onProgress?.({
    phase: 'fetching-all',
    totalConcepts: allConcepts.size,
    fetchedConcepts: allConcepts.size,
    remainingCandidates: allConcepts.size,
    completedQueries: [],
    skippedQueries: [],
    currentQueryName: null,
  })

  return allConcepts
}

/**
 * Fetch concepts to exclude with pagination for a single query
 */
async function fetchExcludedConceptsForQuery(
  endpoint: SPARQLEndpoint,
  queryName: string,
  queryBuilder: (pageSize: number, offset: number) => string
): Promise<Set<string>> {
  const excluded = new Set<string>()
  let offset = 0
  let hasMore = true

  logger.debug('OrphanConcepts', `Fetching excluded concepts: ${queryName}`)

  while (hasMore) {
    const query = queryBuilder(PAGE_SIZE + 1, offset)
    const results = await executeSparql(endpoint, query)
    const uris = results.results.bindings.map(b => b.concept?.value).filter(Boolean) as string[]

    hasMore = uris.length > PAGE_SIZE
    if (hasMore) {
      uris.pop()
    }

    uris.forEach(uri => excluded.add(uri))
    offset += PAGE_SIZE
  }

  logger.info('OrphanConcepts', `Excluded from ${queryName}: ${excluded.size}`)
  return excluded
}

/**
 * Calculate orphan concepts
 */
export async function calculateOrphanConcepts(
  endpoint: SPARQLEndpoint,
  onProgress?: ProgressCallback
): Promise<string[]> {
  // Step 1: Fetch all concepts
  const allConcepts = await fetchAllConcepts(endpoint, onProgress)

  // Step 2: Build exclusion queries
  const exclusionQueryBuilders = buildOrphanExclusionQueries(endpoint, PAGE_SIZE, 0)

  logger.info('OrphanConcepts', `Running ${exclusionQueryBuilders.length} exclusion queries`)

  // Step 3: Fetch excluded concepts (all queries)
  const excludedConcepts = new Set<string>()
  const completedQueries: QueryResult[] = []
  const skippedQueries: string[] = []

  // Report phase start
  onProgress?.({
    phase: 'running-exclusions',
    totalConcepts: allConcepts.size,
    fetchedConcepts: allConcepts.size,
    remainingCandidates: allConcepts.size,
    completedQueries: [],
    skippedQueries: [],
    currentQueryName: null,
  })

  for (const { name, query: _ } of exclusionQueryBuilders) {
    const currentRemaining = allConcepts.size - excludedConcepts.size

    // Skip query if no candidates remain
    if (currentRemaining === 0) {
      skippedQueries.push(name)
      logger.info('OrphanConcepts', `Query "${name}" skipped (no remaining candidates)`)
      continue
    }

    const startTime = Date.now()

    // Report current query
    onProgress?.({
      phase: 'running-exclusions',
      totalConcepts: allConcepts.size,
      fetchedConcepts: allConcepts.size,
      remainingCandidates: currentRemaining,
      completedQueries: [...completedQueries],
      skippedQueries: [...skippedQueries],
      currentQueryName: name,
    })

    // Create a query builder function that matches the signature
    const queryBuilder = (pageSize: number, offset: number) => {
      const queries = buildOrphanExclusionQueries(endpoint, pageSize, offset)
      return queries.find(q => q.name === name)?.query ?? ''
    }

    const excluded = await fetchExcludedConceptsForQuery(endpoint, name, queryBuilder)

    // Add to excluded set
    excluded.forEach(uri => excludedConcepts.add(uri))

    const queryDuration = Date.now() - startTime
    const newRemainingCount = allConcepts.size - excludedConcepts.size

    // Add completed query
    completedQueries.push({
      name,
      excludedCount: excluded.size,
      cumulativeExcluded: excludedConcepts.size,
      remainingAfter: newRemainingCount,
      duration: queryDuration,
    })

    // Enhanced logging: show impact of this exclusion query
    const percentage = allConcepts.size > 0
      ? ((excluded.size / allConcepts.size) * 100).toFixed(1)
      : '0.0'
    const sample = Array.from(excluded).slice(0, 3)

    logger.info('OrphanConcepts', `Query "${name}" excluded ${excluded.size} concepts (${percentage}%)`, {
      excludedCount: excluded.size,
      totalConcepts: allConcepts.size,
      percentage: `${percentage}%`,
      sampleUris: sample
    })

    // Report progress after query
    onProgress?.({
      phase: 'running-exclusions',
      totalConcepts: allConcepts.size,
      fetchedConcepts: allConcepts.size,
      remainingCandidates: newRemainingCount,
      completedQueries: [...completedQueries],
      skippedQueries: [...skippedQueries],
      currentQueryName: null,
    })
  }

  // Step 4: Set subtraction
  onProgress?.({
    phase: 'calculating',
    totalConcepts: allConcepts.size,
    fetchedConcepts: allConcepts.size,
    remainingCandidates: allConcepts.size - excludedConcepts.size,
    completedQueries: [...completedQueries],
    skippedQueries: [...skippedQueries],
    currentQueryName: null,
  })

  const orphanUris: string[] = []
  for (const uri of allConcepts) {
    if (!excludedConcepts.has(uri)) {
      orphanUris.push(uri)
    }
  }

  logger.info('OrphanConcepts', `Orphan concepts found: ${orphanUris.length}`, {
    total: allConcepts.size,
    excluded: excludedConcepts.size,
    orphans: orphanUris.length,
  })

  // Report completion
  onProgress?.({
    phase: 'complete',
    totalConcepts: allConcepts.size,
    fetchedConcepts: allConcepts.size,
    remainingCandidates: orphanUris.length,
    completedQueries: [...completedQueries],
    skippedQueries: [...skippedQueries],
    currentQueryName: null,
  })

  return orphanUris.sort()
}

/**
 * Calculate orphan concepts using a single FILTER NOT EXISTS query.
 * Much faster than multi-query approach but requires modern SPARQL endpoint.
 *
 * This uses a single paginated query with FILTER NOT EXISTS to find orphans.
 * The query only includes UNION branches for properties that exist in the endpoint.
 *
 * @param endpoint - SPARQL endpoint with analysis
 * @param onProgress - Optional progress callback
 * @returns Array of orphan concept URIs
 * @throws Error if query cannot be built (missing capabilities)
 *
 * @see /spec/ae-skos/sko02-SchemeSelector.md
 */
export async function calculateOrphanConceptsFast(
  endpoint: SPARQLEndpoint,
  onProgress?: ProgressCallback
): Promise<string[]> {
  logger.info('OrphanConcepts', 'Starting fast single-query orphan detection')

  // Validate query can be built
  const testQuery = buildSingleOrphanQuery(endpoint, 1, 0)
  if (!testQuery) {
    throw new Error('Cannot build single orphan query: endpoint analysis missing or no relationships available')
  }

  const totalConcepts = endpoint.analysis?.totalConcepts ?? 0
  const orphanUris: string[] = []
  let offset = 0
  let hasMore = true

  // Report initial progress
  onProgress?.({
    phase: 'running-exclusions',
    totalConcepts,
    fetchedConcepts: 0,
    remainingCandidates: 0,
    completedQueries: [],
    skippedQueries: [],
    currentQueryName: 'single-query-orphan-detection',
  })

  const startTime = Date.now()

  // Paginated execution
  while (hasMore) {
    const query = buildSingleOrphanQuery(endpoint, PAGE_SIZE + 1, offset)
    if (!query) {
      throw new Error('Failed to build orphan query')
    }

    const results = await executeSparql(endpoint, query)
    const uris = results.results.bindings
      .map(b => b.concept?.value)
      .filter(Boolean) as string[]

    // +1 detection pattern
    hasMore = uris.length > PAGE_SIZE
    if (hasMore) {
      uris.pop()
    }

    orphanUris.push(...uris)
    offset += PAGE_SIZE

    // Report progress after each batch
    onProgress?.({
      phase: 'running-exclusions',
      totalConcepts,
      fetchedConcepts: orphanUris.length,
      remainingCandidates: orphanUris.length,
      completedQueries: [],
      skippedQueries: [],
      currentQueryName: 'single-query-orphan-detection',
    })

    logger.debug('OrphanConcepts', `Fetched ${orphanUris.length} orphans so far`, {
      batchSize: uris.length,
      hasMore,
    })
  }

  const duration = Date.now() - startTime

  logger.info('OrphanConcepts', `Fast orphan detection complete: ${orphanUris.length} orphans found`, {
    orphanCount: orphanUris.length,
    totalConcepts,
    duration: `${(duration / 1000).toFixed(1)}s`,
  })

  // Report completion
  onProgress?.({
    phase: 'complete',
    totalConcepts,
    fetchedConcepts: orphanUris.length,
    remainingCandidates: orphanUris.length,
    completedQueries: [{
      name: 'single-query-orphan-detection',
      excludedCount: totalConcepts - orphanUris.length,
      cumulativeExcluded: totalConcepts - orphanUris.length,
      remainingAfter: orphanUris.length,
      duration,
    }],
    skippedQueries: [],
    currentQueryName: null,
  })

  return orphanUris.sort()
}

/**
 * Calculate orphan collections using a FILTER NOT EXISTS query.
 * An orphan collection is one where NONE of its members have a path to any scheme.
 *
 * @param endpoint - SPARQL endpoint with analysis
 * @param onProgress - Optional progress callback for collection detection
 * @returns Array of orphan collection URIs
 * @throws Error if query cannot be built (missing capabilities)
 *
 * @see /spec/ae-skos/sko08-OrphanDetection.md
 */
export async function calculateOrphanCollections(
  endpoint: SPARQLEndpoint,
  onProgress?: (phase: 'running' | 'complete', found: number) => void
): Promise<string[]> {
  logger.info('OrphanCollections', 'Starting orphan collection detection')

  // Validate query can be built
  const testQuery = buildOrphanCollectionsQuery(endpoint, 1, 0)
  if (!testQuery) {
    logger.warn('OrphanCollections', 'Cannot build orphan collection query: endpoint analysis missing or no relationships available')
    return []
  }

  const orphanUris: string[] = []
  let offset = 0
  let hasMore = true

  onProgress?.('running', 0)

  const startTime = Date.now()

  // Paginated execution
  while (hasMore) {
    const query = buildOrphanCollectionsQuery(endpoint, PAGE_SIZE + 1, offset)
    if (!query) {
      throw new Error('Failed to build orphan collection query')
    }

    const results = await executeSparql(endpoint, query)
    const uris = results.results.bindings
      .map(b => b.collection?.value)
      .filter(Boolean) as string[]

    // +1 detection pattern
    hasMore = uris.length > PAGE_SIZE
    if (hasMore) {
      uris.pop()
    }

    orphanUris.push(...uris)
    offset += PAGE_SIZE

    onProgress?.('running', orphanUris.length)

    logger.debug('OrphanCollections', `Fetched ${orphanUris.length} orphan collections so far`, {
      batchSize: uris.length,
      hasMore,
    })
  }

  const duration = Date.now() - startTime

  logger.info('OrphanCollections', `Orphan collection detection complete: ${orphanUris.length} orphan collections found`, {
    collectionCount: orphanUris.length,
    duration: `${(duration / 1000).toFixed(1)}s`,
  })

  onProgress?.('complete', orphanUris.length)

  return orphanUris.sort()
}
