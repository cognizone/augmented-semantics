/**
 * useTreePagination - Tree pagination and lazy loading composable
 *
 * Handles pagination for top concepts and children nodes,
 * including duplicate request prevention and offset tracking.
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */

import { ref } from 'vue'
import { useConceptStore, useEndpointStore, useSchemeStore, useLanguageStore } from '../stores'
import { executeSparql, logger, eventBus } from '../services'
import { useConceptBindings, useConceptTreeQueries } from './index'
import type { ConceptNode } from '../types'

// Pagination config
const PAGE_SIZE = 200

export function useTreePagination() {
  const conceptStore = useConceptStore()
  const endpointStore = useEndpointStore()
  const schemeStore = useSchemeStore()
  const languageStore = useLanguageStore()
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

    // Require a scheme to be selected
    if (!scheme) {
      conceptStore.setTopConcepts([])
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
    // Functions
    loadTopConcepts,
    loadMoreTopConcepts,
    loadChildren,
    findNode,
    resetPagination,
  }
}
