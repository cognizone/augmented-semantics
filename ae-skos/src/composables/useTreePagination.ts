/**
 * useTreePagination - Tree pagination and lazy loading composable
 *
 * Handles pagination for top concepts and children nodes,
 * including duplicate request prevention and offset tracking.
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */

import { ref } from 'vue'
import { useConceptStore, useEndpointStore, useSchemeStore, useLanguageStore, useSettingsStore, ORPHAN_SCHEME_URI } from '../stores'
import { executeSparql, logger, eventBus, withPrefixes } from '../services'
import { useConceptBindings, useConceptTreeQueries } from './index'
import { calculateOrphanConcepts, calculateOrphanConceptsFast } from './useOrphanConcepts'
import { createInitialProgress, type OrphanProgress } from './useOrphanProgress'
import { buildCapabilityAwareLabelUnionClause } from '../constants'
import type { ConceptNode } from '../types'

// Pagination config
const PAGE_SIZE = 200

export function useTreePagination() {
  const conceptStore = useConceptStore()
  const endpointStore = useEndpointStore()
  const schemeStore = useSchemeStore()
  const languageStore = useLanguageStore()
  const settingsStore = useSettingsStore()
  const { processBindings } = useConceptBindings()
  const { buildExplicitTopConceptsQuery, buildFallbackTopConceptsQuery, buildTopConceptsQuery, buildChildrenQuery } = useConceptTreeQueries()

  // Pagination state for top concepts
  const topConceptsOffset = ref(0)
  const hasMoreTopConcepts = ref(true)
  const loadingMoreTopConcepts = ref(false)
  // Track query mode for pagination: 'explicit' | 'fallback' | 'mixed'
  // - explicit: only explicit query returned results
  // - fallback: explicit was empty/unavailable, using fallback only
  // - mixed: both explicit and fallback contributed unique concepts
  const queryMode = ref<'explicit' | 'fallback' | 'mixed'>('explicit')

  // Pagination state for children (keyed by parent URI)
  const childrenPagination = ref<Map<string, { offset: number; hasMore: boolean; loading: boolean }>>(new Map())

  // Track loading children to prevent duplicate requests
  const loadingChildren = ref<Set<string>>(new Set())

  // Error state
  const error = ref<string | null>(null)

  // Orphan concepts cache
  const orphanConceptUris = ref<string[]>([])

  // Orphan progress state
  const orphanProgress = ref<OrphanProgress>(createInitialProgress())

  /**
   * Find a node by URI in the concept tree
   */
  function findNode(uri: string, nodes: ConceptNode[]): ConceptNode | null {
    for (const node of nodes) {
      if (node.uri === uri) return node
      if (node.children) {
        const found = findNode(uri, node.children)
        if (found) return found
      }
    }
    return null
  }

  /**
   * Helper to process query results and handle pagination
   */
  function processTopConceptsResults(
    concepts: ConceptNode[],
    offset: number,
    isFirstPage: boolean
  ) {
    // Check if there are more results (we fetched PAGE_SIZE + 1)
    const hasMore = concepts.length > PAGE_SIZE
    if (hasMore) {
      concepts.pop() // Remove the extra item used for detection
    }
    hasMoreTopConcepts.value = hasMore
    topConceptsOffset.value = offset

    logger.info('ConceptTree', `Loaded ${concepts.length} top concepts`, { hasMore, offset })

    if (isFirstPage) {
      conceptStore.setTopConcepts(concepts)
    } else {
      conceptStore.appendTopConcepts(concepts)
    }

    return concepts
  }

  /**
   * Load top concepts for selected scheme.
   * Uses sequential merge: runs explicit query first (fast), displays results,
   * then runs fallback query and appends any new concepts not already shown.
   */
  async function loadTopConcepts(offset = 0) {
    const endpoint = endpointStore.current
    const scheme = schemeStore.selected
    if (!endpoint) return

    // No scheme selected
    if (!scheme) {
      conceptStore.setTopConcepts([])
      return
    }

    // Handle orphan scheme
    if (scheme.uri === ORPHAN_SCHEME_URI) {
      await loadOrphanConcepts(offset)
      return
    }

    const isFirstPage = offset === 0

    logger.info('ConceptTree', 'Loading top concepts', {
      scheme: scheme?.uri || 'all',
      language: languageStore.preferred,
      offset,
      pageSize: PAGE_SIZE
    })

    if (isFirstPage) {
      conceptStore.setLoadingTree(true)
      topConceptsOffset.value = 0
      hasMoreTopConcepts.value = true
      queryMode.value = 'explicit'  // Reset query mode tracking
      await eventBus.emit('tree:loading', undefined)
    } else {
      loadingMoreTopConcepts.value = true
    }
    error.value = null

    try {
      // For pagination, use appropriate query based on first page mode
      if (!isFirstPage) {
        let query: string
        if (queryMode.value === 'mixed') {
          // Mixed mode: use combined UNION query for consistent pagination
          query = buildTopConceptsQuery(scheme.uri, PAGE_SIZE, offset)
          logger.debug('ConceptTree', 'Top concepts combined query (mixed pagination)', { query })
        } else if (queryMode.value === 'fallback') {
          query = buildFallbackTopConceptsQuery(scheme.uri, PAGE_SIZE, offset)
          logger.debug('ConceptTree', 'Top concepts fallback query (pagination)', { query })
        } else {
          // explicit mode
          const explicitQuery = buildExplicitTopConceptsQuery(scheme.uri, PAGE_SIZE, offset)
          if (!explicitQuery) {
            // Shouldn't happen, but fallback just in case
            query = buildFallbackTopConceptsQuery(scheme.uri, PAGE_SIZE, offset)
          } else {
            query = explicitQuery
          }
          logger.debug('ConceptTree', 'Top concepts explicit query (pagination)', { query })
        }
        const results = await executeSparql(endpoint, query, { retries: 1 })
        const concepts = processBindings(results.results.bindings)
        processTopConceptsResults(concepts, offset, isFirstPage)
        return
      }

      // First page: Sequential merge strategy
      // Step 1: Try explicit top concepts first (fast path)
      const explicitQuery = buildExplicitTopConceptsQuery(scheme.uri, PAGE_SIZE, offset)
      let explicitConcepts: ConceptNode[] = []

      if (explicitQuery) {
        logger.debug('ConceptTree', 'Running explicit top concepts query (fast path)', { query: explicitQuery })
        const results = await executeSparql(endpoint, explicitQuery, { retries: 1 })
        explicitConcepts = processBindings(results.results.bindings)

        if (explicitConcepts.length > 0) {
          // Show explicit results immediately
          logger.info('ConceptTree', `Found ${explicitConcepts.length} explicit top concepts (fast path)`)
          conceptStore.setTopConcepts(explicitConcepts)
          await eventBus.emit('tree:loaded', conceptStore.topConcepts)
        }
      }

      // Step 2: Run fallback query to find any additional implicit top concepts
      logger.debug('ConceptTree', 'Running fallback query to check for additional top concepts')
      const fallbackQuery = buildFallbackTopConceptsQuery(scheme.uri, PAGE_SIZE, offset)
      const fallbackResults = await executeSparql(endpoint, fallbackQuery, { retries: 1 })
      const fallbackConcepts = processBindings(fallbackResults.results.bindings)

      // Determine query mode and merge results
      const explicitUris = new Set(explicitConcepts.map(c => c.uri))
      const newFromFallback = fallbackConcepts.filter(c => !explicitUris.has(c.uri))

      if (explicitConcepts.length === 0 && fallbackConcepts.length > 0) {
        // Only fallback had results
        queryMode.value = 'fallback'
        logger.info('ConceptTree', `Using fallback only: ${fallbackConcepts.length} concepts`)
        processTopConceptsResults(fallbackConcepts, offset, isFirstPage)
        await eventBus.emit('tree:loaded', conceptStore.topConcepts)
      } else if (newFromFallback.length > 0) {
        // Mixed: both contributed unique concepts
        queryMode.value = 'mixed'
        logger.info('ConceptTree', `Mixed mode: ${explicitConcepts.length} explicit + ${newFromFallback.length} from fallback`)
        // Append new concepts from fallback
        conceptStore.appendTopConcepts(newFromFallback)
        // Update hasMore based on combined count
        const totalCount = explicitConcepts.length + newFromFallback.length
        hasMoreTopConcepts.value = totalCount > PAGE_SIZE
        if (hasMoreTopConcepts.value && totalCount > PAGE_SIZE) {
          // Remove extra if we have more than PAGE_SIZE
          // Note: This is approximate - mixed pagination may show some duplicates
        }
      } else if (explicitConcepts.length > 0) {
        // Explicit only (fallback found nothing new)
        queryMode.value = 'explicit'
        logger.info('ConceptTree', `Using explicit only: ${explicitConcepts.length} concepts`)
        // Already displayed, just update pagination state
        hasMoreTopConcepts.value = explicitConcepts.length > PAGE_SIZE
        if (hasMoreTopConcepts.value) {
          explicitConcepts.pop()
          conceptStore.setTopConcepts(explicitConcepts)
        }
      } else {
        // Both empty
        queryMode.value = 'fallback'
        logger.info('ConceptTree', 'No top concepts found')
        conceptStore.setTopConcepts([])
        hasMoreTopConcepts.value = false
        await eventBus.emit('tree:loaded', [])
      }

      topConceptsOffset.value = 0
    } catch (e: unknown) {
      const errMsg = e && typeof e === 'object' && 'message' in e
        ? (e as { message: string }).message
        : 'Unknown error'
      logger.error('ConceptTree', 'Failed to load top concepts', { error: e })
      error.value = `Failed to load concepts: ${errMsg}`
      if (isFirstPage) {
        conceptStore.setTopConcepts([])
      }
    } finally {
      conceptStore.setLoadingTree(false)
      loadingMoreTopConcepts.value = false
    }
  }

  /**
   * Load orphan concepts
   */
  async function loadOrphanConcepts(offset: number = 0) {
    const endpoint = endpointStore.current
    if (!endpoint) return

    const isFirstPage = offset === 0

    // First load: calculate orphans
    if (isFirstPage) {
      conceptStore.setLoadingTree(true)
      await eventBus.emit('tree:loading', undefined)

      // Reset progress state
      orphanProgress.value = createInitialProgress()

      const strategy = settingsStore.orphanDetectionStrategy ?? 'auto'

      try {
        if (strategy === 'slow') {
          // Explicitly use slow multi-query
          orphanConceptUris.value = await calculateOrphanConcepts(endpoint, (progress) => {
            orphanProgress.value = { ...progress }
          })
          logger.info('TreePagination', `Loaded ${orphanConceptUris.value.length} orphan URIs (slow multi-query)`)
        } else if (strategy === 'fast') {
          // Explicitly use fast single-query (may fail)
          orphanConceptUris.value = await calculateOrphanConceptsFast(endpoint, (progress) => {
            orphanProgress.value = { ...progress }
          })
          logger.info('TreePagination', `Loaded ${orphanConceptUris.value.length} orphan URIs (fast single-query)`)
        } else {
          // Auto: Try fast first, fallback to slow on error
          try {
            orphanConceptUris.value = await calculateOrphanConceptsFast(endpoint, (progress) => {
              orphanProgress.value = { ...progress }
            })
            logger.info('TreePagination', `Fast orphan detection succeeded: ${orphanConceptUris.value.length} orphans`)
          } catch (fastError) {
            logger.warn('TreePagination', 'Fast orphan detection failed, falling back to multi-query', {
              error: fastError
            })
            orphanConceptUris.value = await calculateOrphanConcepts(endpoint, (progress) => {
              orphanProgress.value = { ...progress }
            })
            logger.info('TreePagination', `Slow orphan detection succeeded: ${orphanConceptUris.value.length} orphans`)
          }
        }

        topConceptsOffset.value = 0
        hasMoreTopConcepts.value = orphanConceptUris.value.length > PAGE_SIZE
      } catch (e) {
        logger.error('TreePagination', 'Failed to calculate orphans', { error: e })
        conceptStore.setLoadingTree(false)
        return
      }
    } else {
      loadingMoreTopConcepts.value = true
    }

    // Paginate through orphan URIs and fetch labels
    const start = offset
    const end = Math.min(offset + PAGE_SIZE, orphanConceptUris.value.length)
    const pageUris = orphanConceptUris.value.slice(start, end)

    if (pageUris.length === 0) {
      conceptStore.setLoadingTree(false)
      loadingMoreTopConcepts.value = false
      return
    }

    // Build query to get labels for this page of orphan URIs
    const valuesClause = pageUris.map(uri => `<${uri}>`).join(' ')

    // Get concept label capabilities
    const conceptCapabilities = endpoint.analysis?.labelPredicates?.concept
    const labelClause = buildCapabilityAwareLabelUnionClause('?concept', conceptCapabilities)

    const query = withPrefixes(`
      SELECT ?concept ?label ?labelLang ?labelType ?notation ?hasNarrower
      WHERE {
        VALUES ?concept { ${valuesClause} }

        # Check if concept has children (EXISTS is fast - stops at first match)
        BIND(EXISTS {
          { [] skos:broader ?concept }
          UNION
          { ?concept skos:narrower [] }
        } AS ?hasNarrower)

        # Label resolution (capability-aware)
        OPTIONAL { ?concept skos:notation ?notation }
        OPTIONAL {
          ${labelClause}
        }
      }
    `)

    try {
      const results = await executeSparql(endpoint, query)
      const concepts = processBindings(results.results.bindings)

      if (isFirstPage) {
        conceptStore.setTopConcepts(concepts)
        await eventBus.emit('tree:loaded', concepts)
      } else {
        conceptStore.appendTopConcepts(concepts)
      }

      topConceptsOffset.value = end
      hasMoreTopConcepts.value = end < orphanConceptUris.value.length
    } catch (e) {
      logger.error('TreePagination', 'Failed to load orphan labels', { error: e })
    } finally {
      conceptStore.setLoadingTree(false)
      loadingMoreTopConcepts.value = false
    }
  }

  /**
   * Load more top concepts (next page)
   */
  async function loadMoreTopConcepts() {
    if (!hasMoreTopConcepts.value || loadingMoreTopConcepts.value) return
    const nextOffset = topConceptsOffset.value + PAGE_SIZE
    await loadTopConcepts(nextOffset)
  }

  /**
   * Load children for a node
   */
  async function loadChildren(uri: string, offset = 0) {
    const endpoint = endpointStore.current
    if (!endpoint) return

    const isFirstPage = offset === 0

    // Prevent duplicate requests
    if (isFirstPage && loadingChildren.value.has(uri)) return
    const pagination = childrenPagination.value.get(uri)
    if (!isFirstPage && pagination?.loading) return

    if (isFirstPage) {
      loadingChildren.value.add(uri)
      childrenPagination.value.set(uri, { offset: 0, hasMore: true, loading: true })
    } else if (pagination) {
      pagination.loading = true
    }

    logger.debug('ConceptTree', 'Loading children', { parent: uri, offset, pageSize: PAGE_SIZE })

    const query = buildChildrenQuery(uri, PAGE_SIZE, offset)

    try {
      const results = await executeSparql(endpoint, query, { retries: 1 })

      // Process bindings into sorted ConceptNode[]
      const children = processBindings(results.results.bindings)

      // Check if there are more results
      const hasMore = children.length > PAGE_SIZE
      if (hasMore) {
        children.pop()
      }

      // Update pagination state
      childrenPagination.value.set(uri, { offset, hasMore, loading: false })

      logger.debug('ConceptTree', `Loaded ${children.length} children for ${uri}`, { hasMore, offset })

      if (isFirstPage) {
        conceptStore.updateNodeChildren(uri, children)
      } else {
        // Append to existing children
        const node = findNode(uri, conceptStore.topConcepts)
        if (node?.children) {
          node.children = [...node.children, ...children]
        }
      }
    } catch (e) {
      logger.error('ConceptTree', 'Failed to load children', { parent: uri, error: e })
    } finally {
      loadingChildren.value.delete(uri)
      const pag = childrenPagination.value.get(uri)
      if (pag) pag.loading = false
    }
  }

  /**
   * Reset pagination state (call when scheme changes)
   */
  function resetPagination() {
    topConceptsOffset.value = 0
    hasMoreTopConcepts.value = true
    loadingMoreTopConcepts.value = false
    queryMode.value = 'explicit'
    childrenPagination.value.clear()
    loadingChildren.value.clear()
    error.value = null
  }

  return {
    // State
    topConceptsOffset,
    hasMoreTopConcepts,
    loadingMoreTopConcepts,
    childrenPagination,
    loadingChildren,
    error,
    orphanProgress,
    // Functions
    loadTopConcepts,
    loadMoreTopConcepts,
    loadChildren,
    findNode,
    resetPagination,
  }
}
