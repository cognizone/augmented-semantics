/**
 * useTreeSelection - Tree selection and expansion composable
 *
 * Handles bidirectional sync between PrimeVue Tree and Pinia store
 * for selection and expansion state.
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */

import { computed } from 'vue'
import { useConceptStore, useEndpointStore, useSchemeStore } from '../stores'
import { logger } from '../services'
import type { ConceptNode } from '../types'
import type { TreeNode } from 'primevue/treenode'

type TreeExpandedKeys = Record<string, boolean>
type TreeSelectionKeys = Record<string, boolean>

interface UseTreeSelectionOptions {
  /** Function to load children for a node (from useTreePagination) */
  loadChildren: (uri: string, offset?: number) => Promise<void>
  /** Function to find a node in the tree (from useTreePagination) */
  findNode: (uri: string, nodes: ConceptNode[]) => ConceptNode | null
}

export function useTreeSelection(options: UseTreeSelectionOptions) {
  const { loadChildren, findNode } = options

  const conceptStore = useConceptStore()
  const endpointStore = useEndpointStore()
  const schemeStore = useSchemeStore()

  /**
   * Selected node keys for PrimeVue Tree (bidirectional computed)
   */
  const selectedKey = computed<TreeSelectionKeys | undefined>({
    get: () => {
      // Show scheme as selected when viewing scheme details
      if (schemeStore.viewingSchemeUri) {
        return { [schemeStore.viewingSchemeUri]: true }
      }
      // Show collection as selected when selected
      if (conceptStore.selectedCollectionUri) {
        return { [conceptStore.selectedCollectionUri]: true }
      }
      if (conceptStore.selectedUri) {
        return { [conceptStore.selectedUri]: true }
      }
      return undefined
    },
    set: (keys) => {
      if (keys) {
        // Collection mode uses explicit click handling; ignore Tree's selectionKeys updates.
        if (schemeStore.rootMode === 'collection') {
          return
        }
        const uri = Object.keys(keys)[0]
        if (uri) {
          if (conceptStore.selectedCollectionUri === uri) {
            return
          }
          // Scheme nodes must be recognized by selectedUri because schemes load async.
          if (schemeStore.rootMode === 'scheme' && schemeStore.selectedUri === uri) {
            conceptStore.selectConcept(null) // Clear concept selection when viewing scheme
            schemeStore.viewScheme(uri)
            // Add to history
            conceptStore.addToHistory({
              uri,
              label: schemeStore.selected?.label || uri,
              lang: schemeStore.selected?.labelLang,
              endpointUrl: endpointStore.current?.url,
              type: 'scheme',
            })
          } else {
            selectConcept(uri)
          }
        }
      }
    },
  })

  /**
   * Expanded keys for PrimeVue Tree (bidirectional computed)
   */
  const expandedKeys = computed<TreeExpandedKeys>({
    get: () => {
      const keys: TreeExpandedKeys = {}
      // Auto-expand the scheme node if present
      const scheme = schemeStore.selected
      if (scheme) {
        keys[scheme.uri] = true
      }
      conceptStore.expanded.forEach(uri => {
        keys[uri] = true
      })
      return keys
    },
    set: (keys) => {
      // Sync expanded state
      const newExpanded = new Set(Object.keys(keys || {}))
      conceptStore.expanded.forEach(uri => {
        if (!newExpanded.has(uri)) {
          conceptStore.collapseNode(uri)
        }
      })
      newExpanded.forEach(uri => {
        if (!conceptStore.expanded.has(uri)) {
          conceptStore.expandNode(uri)
        }
      })
    },
  })

  /**
   * Handle node expand
   */
  function onNodeExpand(node: TreeNode) {
    const conceptNode = node.data as ConceptNode | undefined
    const isSchemeNode = Boolean((node.data as { isScheme?: boolean } | undefined)?.isScheme)
    const isCollectionNode = Boolean((node.data as { isCollection?: boolean; type?: string } | undefined)?.isCollection)
      || (node.data as { type?: string } | undefined)?.type === 'collection'
    const isConceptNode = !isSchemeNode && !isCollectionNode
    const needsChildren = !conceptNode?.children || conceptNode.children.length === 0

    logger.debug('useTreeSelection', 'onNodeExpand called', {
      key: node.key,
      label: node.label,
      isSchemeNode,
      isCollectionNode,
      isConceptNode,
      hasNarrower: conceptNode?.hasNarrower,
      childrenLength: conceptNode?.children?.length,
      needsChildren,
      willLoadChildren: isConceptNode && conceptNode?.hasNarrower && needsChildren && node.key,
    })

    if (isConceptNode && conceptNode?.hasNarrower && needsChildren && node.key) {
      loadChildren(String(node.key))
    }
    if (node.key) {
      conceptStore.expandNode(String(node.key))
    }
  }

  /**
   * Handle node collapse
   */
  function onNodeCollapse(node: TreeNode) {
    if (node.key) {
      conceptStore.collapseNode(String(node.key))
    }
  }

  /**
   * Handle node select
   */
  async function selectConcept(uri: string) {
    schemeStore.viewScheme(null) // Clear scheme viewing when selecting a concept
    await conceptStore.selectConceptWithEvent(uri)

    // Find node for history (includes notation and lang)
    const node = findNode(uri, conceptStore.topConcepts)
    if (node) {
      conceptStore.addToHistory({
        uri,
        label: node.label || uri,
        notation: node.notation,
        lang: node.lang,
        endpointUrl: endpointStore.current?.url,
        schemeUri: schemeStore.selectedUri || undefined,
        hasNarrower: node.hasNarrower,
      })
    }
  }

  return {
    selectedKey,
    expandedKeys,
    onNodeExpand,
    onNodeCollapse,
    selectConcept,
  }
}
