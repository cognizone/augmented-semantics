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
  const { buildTopConceptsQuery, buildChildrenQuery } = useConceptTreeQueries()

  // Pagination state for top concepts
  const topConceptsOffset = ref(0)
  const hasMoreTopConcepts = ref(true)
  const loadingMoreTopConcepts = ref(false)

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
   * Load top concepts for selected scheme
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
      await eventBus.emit('tree:loading', undefined)
    } else {
      loadingMoreTopConcepts.value = true
    }
    error.value = null

    const query = buildTopConceptsQuery(scheme.uri, PAGE_SIZE, offset)

    logger.debug('ConceptTree', 'Top concepts query', { query })

    try {
      const results = await executeSparql(endpoint, query, { retries: 1 })

      // Process bindings into sorted ConceptNode[]
      const concepts = processBindings(results.results.bindings)

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
        // Emit tree:loaded for event coordination (triggers pending reveals)
        await eventBus.emit('tree:loaded', concepts)
      } else {
        conceptStore.appendTopConcepts(concepts)
      }
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
    const query = withPrefixes(`
      SELECT ?concept ?label ?labelLang ?labelType ?notation (COUNT(DISTINCT ?narrower) AS ?narrowerCount)
      WHERE {
        VALUES ?concept { ${valuesClause} }

        # Narrower count
        OPTIONAL {
          ?concept skos:narrower ?narrower .
        }

        # Label resolution
        OPTIONAL { ?concept skos:notation ?notation }
        OPTIONAL {
          {
            ?concept skos:prefLabel ?label .
            BIND("prefLabel" AS ?labelType)
          } UNION {
            ?concept skosxl:prefLabel/skosxl:literalForm ?label .
            BIND("xlPrefLabel" AS ?labelType)
          } UNION {
            ?concept dct:title ?label .
            BIND("title" AS ?labelType)
          } UNION {
            ?concept rdfs:label ?label .
            BIND("rdfsLabel" AS ?labelType)
          }
          BIND(LANG(?label) AS ?labelLang)
        }
      }
      GROUP BY ?concept ?label ?labelLang ?labelType ?notation
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
