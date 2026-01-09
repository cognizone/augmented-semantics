/**
 * useTreeNavigation - Tree navigation and reveal composable
 *
 * Handles ancestor path fetching, concept reveal, and scroll-to-node
 * functionality for the concept tree.
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */

import { nextTick, type Ref } from 'vue'
import { useConceptStore, useEndpointStore, useSchemeStore, useLanguageStore } from '../stores'
import { executeSparql, withPrefixes, logger } from '../services'
import type { ConceptNode } from '../types'

interface UseTreeNavigationOptions {
  /** Ref to the tree wrapper element for scrolling */
  treeWrapperRef: Ref<HTMLElement | null>
  /** Function to load children for a node (from useTreePagination) */
  loadChildren: (uri: string, offset?: number) => Promise<void>
  /** Function to find a node in the tree (from useTreePagination) */
  findNode: (uri: string, nodes: ConceptNode[]) => ConceptNode | null
}

export function useTreeNavigation(options: UseTreeNavigationOptions) {
  const { treeWrapperRef, loadChildren, findNode } = options

  const conceptStore = useConceptStore()
  const endpointStore = useEndpointStore()
  const schemeStore = useSchemeStore()
  const languageStore = useLanguageStore()

  /**
   * Fetch ancestor path for a concept (from root to parent)
   */
  async function fetchAncestorPath(uri: string): Promise<{ uri: string; label?: string; notation?: string }[]> {
    const endpoint = endpointStore.current
    if (!endpoint) return []

    logger.debug('ConceptTree', 'Fetching ancestor path', { concept: uri })

    // Query all ancestors with their depth (distance from concept)
    // Uses both broader and inverse narrower to support all SKOS patterns
    const query = withPrefixes(`
      SELECT DISTINCT ?ancestor ?label ?notation ?depth
      WHERE {
        <${uri}> (skos:broader|^skos:narrower)+ ?ancestor .
        {
          SELECT ?ancestor (COUNT(?mid) AS ?depth)
          WHERE {
            <${uri}> (skos:broader|^skos:narrower)+ ?mid .
            ?mid (skos:broader|^skos:narrower)* ?ancestor .
            ?ancestor (skos:broader|^skos:narrower)* ?root .
            FILTER NOT EXISTS {
              { ?root skos:broader ?parent }
              UNION
              { ?parent skos:narrower ?root }
            }
          }
          GROUP BY ?ancestor
        }
        OPTIONAL { ?ancestor skos:prefLabel ?label . FILTER(LANG(?label) = "${languageStore.preferred}" || LANG(?label) = "") }
        OPTIONAL { ?ancestor skos:notation ?notation }
      }
      ORDER BY DESC(?depth)
    `)

    try {
      const results = await executeSparql(endpoint, query, { retries: 1 })

      const ancestors: { uri: string; label?: string; notation?: string }[] = []
      const seen = new Set<string>()

      for (const b of results.results.bindings) {
        const ancestorUri = b.ancestor?.value
        if (!ancestorUri || seen.has(ancestorUri)) continue
        seen.add(ancestorUri)

        ancestors.push({
          uri: ancestorUri,
          label: b.label?.value,
          notation: b.notation?.value,
        })
      }

      logger.debug('ConceptTree', `Found ${ancestors.length} ancestors`, { ancestors: ancestors.map(a => a.uri) })
      return ancestors
    } catch (e) {
      logger.error('ConceptTree', 'Failed to fetch ancestor path', { concept: uri, error: e })
      return []
    }
  }

  /**
   * Scroll to a node in the tree
   */
  function scrollToNode(uri: string) {
    const treeWrapper = treeWrapperRef.value
    if (!treeWrapper) {
      logger.debug('ConceptTree', 'scrollToNode: no tree wrapper ref')
      return
    }

    // PrimeVue 4 Tree uses aria-selected="true" on selected li elements
    // Try multiple strategies to find the node
    const selectors = [
      // PrimeVue 4: aria-selected on the treenode li
      '[aria-selected="true"]',
      // Alternative: selected content div
      '.p-tree-node-selected',
      // Legacy: p-highlight class
      '.p-tree-node-content.p-highlight',
    ]

    let nodeElement: HTMLElement | null = null
    for (const selector of selectors) {
      nodeElement = treeWrapper.querySelector(selector) as HTMLElement | null
      if (nodeElement) {
        logger.debug('ConceptTree', 'scrollToNode: found with selector', { selector, uri })
        break
      }
    }

    if (nodeElement) {
      // Calculate position relative to the scrollable container
      const wrapperRect = treeWrapper.getBoundingClientRect()
      const nodeRect = nodeElement.getBoundingClientRect()
      const relativeTop = nodeRect.top - wrapperRect.top + treeWrapper.scrollTop
      // Scroll to center the node in the container
      const targetScroll = relativeTop - (wrapperRect.height / 2) + (nodeRect.height / 2)
      treeWrapper.scrollTo({ top: targetScroll, behavior: 'smooth' })
    } else {
      logger.debug('ConceptTree', 'scrollToNode: node not found, tried selectors', { uri, selectors })
    }
  }

  /**
   * Reveal a concept in the tree (expand ancestors and scroll to it)
   */
  async function revealConcept(uri: string) {
    logger.info('ConceptTree', 'Revealing concept in tree', { uri })

    // Fetch ancestor path
    const ancestors = await fetchAncestorPath(uri)

    // Expand each ancestor (loading children if needed)
    for (const ancestor of ancestors) {
      // Expand the ancestor node
      conceptStore.expandNode(ancestor.uri)

      // Load children if not already loaded
      const existingNode = findNode(ancestor.uri, conceptStore.topConcepts)
      if (existingNode && existingNode.hasNarrower && !existingNode.children) {
        await loadChildren(ancestor.uri)
      }
    }

    // Also expand the scheme if present
    if (schemeStore.selectedUri) {
      conceptStore.expandNode(schemeStore.selectedUri)
    }

    // Scroll to the concept after DOM updates
    // Use double nextTick + small delay to ensure PrimeVue Tree has rendered
    await nextTick()
    await nextTick()
    // Additional delay for PrimeVue animation/rendering
    await new Promise(resolve => setTimeout(resolve, 100))
    scrollToNode(uri)
  }

  /**
   * Reveal concept in tree when selected (event-driven to avoid race conditions)
   */
  async function revealConceptIfNeeded(uri: string) {
    logger.debug('ConceptTree', 'Revealing concept (event-driven)', { uri })

    // Check if concept is already in the loaded tree
    const existingNode = findNode(uri, conceptStore.topConcepts)
    if (!existingNode) {
      // Concept not in tree - expand ancestors to reveal it
      await revealConcept(uri)
    } else {
      // Concept is in tree - just scroll to it
      await nextTick()
      await new Promise(resolve => setTimeout(resolve, 50))
      scrollToNode(uri)
    }

    // Mark as revealed for coordination
    await conceptStore.markConceptRevealed(uri)
  }

  /**
   * Scroll tree to top
   */
  function scrollToTop() {
    treeWrapperRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return {
    fetchAncestorPath,
    scrollToNode,
    revealConcept,
    revealConceptIfNeeded,
    scrollToTop,
  }
}
