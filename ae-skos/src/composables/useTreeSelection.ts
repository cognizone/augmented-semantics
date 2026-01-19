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
        const uri = Object.keys(keys)[0]
        if (uri) {
          // Check if this is the scheme node
          const scheme = schemeStore.selected
          if (scheme && uri === scheme.uri) {
            conceptStore.selectConcept(null) // Clear concept selection when viewing scheme
            schemeStore.viewScheme(uri)
            // Add to history
            conceptStore.addToHistory({
              uri: scheme.uri,
              label: scheme.label || scheme.uri,
              lang: scheme.labelLang,
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
    if (conceptNode?.hasNarrower && !conceptNode.children && node.key) {
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
