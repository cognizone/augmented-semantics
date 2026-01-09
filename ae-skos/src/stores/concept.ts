/**
 * Concept Store - SKOS concept state management
 *
 * Manages:
 * - Concept tree (top concepts, expanded nodes, children)
 * - Selected concept and details
 * - Breadcrumb navigation path
 * - Search query and results
 * - Recently viewed history (persisted to localStorage)
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 * @see /spec/ae-skos/sko05-SearchBox.md
 * @see /spec/common/com02-StateManagement.md
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ConceptNode, ConceptRef, ConceptDetails, SearchResult, SearchSettings, HistoryEntry } from '../types'
import { eventBus, logger } from '../services'

const HISTORY_STORAGE_KEY = 'ae-skos-history'
const MAX_HISTORY = 50

export const useConceptStore = defineStore('concept', () => {
  // State - Tree
  const topConcepts = ref<ConceptNode[]>([])
  const expanded = ref<Set<string>>(new Set())

  // State - Selection
  const selectedUri = ref<string | null>(null)
  const details = ref<ConceptDetails | null>(null)
  const breadcrumb = ref<ConceptRef[]>([])

  // State - Search
  const searchQuery = ref('')
  const searchResults = ref<SearchResult[]>([])
  const searchSettings = ref<SearchSettings>({
    searchIn: {
      prefLabel: true,
      altLabel: true,
      definition: false,
      notation: false,
    },
    caseSensitive: false,
    wholeWord: false,
  })

  // State - History
  const history = ref<HistoryEntry[]>([])

  // State - Loading
  const loadingTree = ref(false)
  const loadingDetails = ref(false)
  const loadingSearch = ref(false)

  // State - UI triggers
  const shouldScrollToTop = ref(false)

  // State - Event coordination
  const pendingRevealUri = ref<string | null>(null)

  // Getters
  const hasSelection = computed(() => selectedUri.value !== null)

  const isExpanded = computed(() => (uri: string) => expanded.value.has(uri))

  const recentHistory = computed(() => history.value.slice(0, MAX_HISTORY))

  // Actions - Tree
  function setTopConcepts(concepts: ConceptNode[]) {
    topConcepts.value = concepts
  }

  function appendTopConcepts(concepts: ConceptNode[]) {
    topConcepts.value = [...topConcepts.value, ...concepts]
  }

  function expandNode(uri: string) {
    expanded.value.add(uri)
  }

  function collapseNode(uri: string) {
    expanded.value.delete(uri)
  }

  function toggleNode(uri: string) {
    if (expanded.value.has(uri)) {
      collapseNode(uri)
    } else {
      expandNode(uri)
    }
  }

  function updateNodeChildren(uri: string, children: ConceptNode[]) {
    // Recursive function to find and update node
    function updateInList(nodes: ConceptNode[]): boolean {
      for (const node of nodes) {
        if (node.uri === uri) {
          node.children = children
          return true
        }
        if (node.children && updateInList(node.children)) {
          return true
        }
      }
      return false
    }
    updateInList(topConcepts.value)
  }

  // Actions - Selection
  function selectConcept(uri: string | null) {
    selectedUri.value = uri
  }

  /**
   * Select concept with event coordination.
   * Emits concept:selecting then concept:selected for other components to react.
   */
  async function selectConceptWithEvent(uri: string | null) {
    if (uri) {
      await eventBus.emit('concept:selecting', uri)
    }
    selectedUri.value = uri
    await eventBus.emit('concept:selected', uri)
  }

  /**
   * Request reveal of a concept in the tree.
   * Called when concept is selected while tree is still loading.
   */
  function requestReveal(uri: string) {
    pendingRevealUri.value = uri
  }

  /**
   * Mark concept as revealed in the tree.
   * Clears pending reveal and emits concept:revealed.
   */
  async function markConceptRevealed(uri: string) {
    pendingRevealUri.value = null
    await eventBus.emit('concept:revealed', uri)
  }

  /**
   * Clear pending reveal request.
   */
  function clearPendingReveal() {
    pendingRevealUri.value = null
  }

  function setDetails(newDetails: ConceptDetails | null) {
    details.value = newDetails
  }

  function setBreadcrumb(path: ConceptRef[]) {
    breadcrumb.value = path
  }

  // Actions - Search
  function setSearchQuery(query: string) {
    searchQuery.value = query
  }

  function setSearchResults(results: SearchResult[]) {
    searchResults.value = results
  }

  function updateSearchSettings(settings: Partial<SearchSettings>) {
    searchSettings.value = { ...searchSettings.value, ...settings }
  }

  function clearSearch() {
    searchQuery.value = ''
    searchResults.value = []
  }

  // Actions - History
  function loadHistoryFromStorage() {
    try {
      const stored = localStorage.getItem(HISTORY_STORAGE_KEY)
      if (stored) {
        history.value = JSON.parse(stored)
      }
    } catch (e) {
      logger.error('ConceptStore', 'Failed to load history from storage', { error: e })
    }
  }

  function saveHistoryToStorage() {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.value))
    } catch (e) {
      logger.error('ConceptStore', 'Failed to save history to storage', { error: e })
    }
  }

  function addToHistory(entry: Omit<HistoryEntry, 'accessedAt'>) {
    // Remove if already exists
    history.value = history.value.filter(h => h.uri !== entry.uri)

    // Add to front
    history.value.unshift({
      ...entry,
      accessedAt: new Date().toISOString(),
    })

    // Trim to max
    if (history.value.length > MAX_HISTORY) {
      history.value = history.value.slice(0, MAX_HISTORY)
    }

    saveHistoryToStorage()
  }

  function clearHistory() {
    history.value = []
    saveHistoryToStorage()
  }

  // Actions - Loading
  function setLoadingTree(loading: boolean) {
    loadingTree.value = loading
  }

  function setLoadingDetails(loading: boolean) {
    loadingDetails.value = loading
  }

  function setLoadingSearch(loading: boolean) {
    loadingSearch.value = loading
  }

  // Actions - UI triggers
  function scrollTreeToTop() {
    shouldScrollToTop.value = true
  }

  function resetScrollToTop() {
    shouldScrollToTop.value = false
  }

  // Actions - Reset
  function reset() {
    topConcepts.value = []
    expanded.value = new Set()
    selectedUri.value = null
    details.value = null
    breadcrumb.value = []
    searchQuery.value = ''
    searchResults.value = []
  }

  /**
   * Clear all cached children from tree nodes.
   * Called when language changes to force reload with new labels.
   * Keeps expanded state intact so tree structure is preserved.
   */
  function clearAllChildren() {
    function clearChildren(nodes: ConceptNode[]) {
      for (const node of nodes) {
        if (node.children) {
          clearChildren(node.children)
          node.children = undefined
        }
      }
    }
    clearChildren(topConcepts.value)
    // Don't clear expanded - keep tree structure intact when language changes
  }

  // Initialize
  loadHistoryFromStorage()

  return {
    // State
    topConcepts,
    expanded,
    selectedUri,
    details,
    breadcrumb,
    searchQuery,
    searchResults,
    searchSettings,
    history,
    loadingTree,
    loadingDetails,
    loadingSearch,
    pendingRevealUri,
    // Getters
    hasSelection,
    isExpanded,
    recentHistory,
    // Actions
    setTopConcepts,
    appendTopConcepts,
    expandNode,
    collapseNode,
    toggleNode,
    updateNodeChildren,
    selectConcept,
    selectConceptWithEvent,
    requestReveal,
    markConceptRevealed,
    clearPendingReveal,
    setDetails,
    setBreadcrumb,
    setSearchQuery,
    setSearchResults,
    updateSearchSettings,
    clearSearch,
    addToHistory,
    clearHistory,
    setLoadingTree,
    setLoadingDetails,
    setLoadingSearch,
    scrollTreeToTop,
    resetScrollToTop,
    shouldScrollToTop,
    reset,
    clearAllChildren,
  }
})
