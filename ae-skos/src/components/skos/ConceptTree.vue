<script setup lang="ts">
/**
 * ConceptTree - Hierarchical SKOS concept browser
 *
 * Displays concepts as an expandable tree with:
 * - Lazy loading of narrower concepts on expand
 * - Label resolution: prefLabel > dct:title > rdfs:label
 * - Language priority: preferred > fallback > no lang > any
 * - Notation + label display format
 * - Direct URI lookup input
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import { useConceptStore, useEndpointStore, useSchemeStore, useLanguageStore } from '../../stores'
import { logger, eventBus, executeSparql, withPrefixes } from '../../services'
import type { EventSubscription } from '../../services'
import {
  useDelayedLoading,
  useLabelResolver,
  useElapsedTime,
  useDeprecation,
  useTreePagination,
  useTreeNavigation,
  useTreeSelection,
  useCollections,
} from '../../composables'
import type { ConceptNode, CollectionNode } from '../../types'
import Tree from 'primevue/tree'
import type { TreeNode } from 'primevue/treenode'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'

// Define emitted events
const emit = defineEmits<{
  selectConcept: [uri: string]
  selectCollection: [uri: string]
}>()

const conceptStore = useConceptStore()
const endpointStore = useEndpointStore()
const schemeStore = useSchemeStore()
const languageStore = useLanguageStore()
const { shouldShowLangTag } = useLabelResolver()
const { showIndicator: showDeprecationIndicator } = useDeprecation()

// Collections composable
const {
  collections,
  loadCollectionsForScheme,
  reset: resetCollections,
  shouldShowLangTag: shouldShowCollectionLangTag,
} = useCollections()


// Delayed loading - show spinner only after 300ms to prevent flicker
const showTreeLoading = useDelayedLoading(computed(() => conceptStore.loadingTree))

// Elapsed time for tree loading (shows after 1s delay)
const treeLoadingElapsed = useElapsedTime(computed(() => conceptStore.loadingTree))

// Ref to tree wrapper for scrolling
const treeWrapperRef = ref<HTMLElement | null>(null)

// Local state
const gotoUri = ref('')

// Initialize composables with dependencies
const {
  hasMoreTopConcepts,
  loadingMoreTopConcepts,
  loadingChildren,
  error,
  orphanProgress,
  loadTopConcepts,
  loadMoreTopConcepts,
  loadChildren,
  findNode,
} = useTreePagination()

const {
  revealConceptIfNeeded,
  scrollToTop,
} = useTreeNavigation({
  treeWrapperRef,
  loadChildren,
  findNode,
})

const {
  selectedKey,
  expandedKeys,
  onNodeExpand: onConceptNodeExpand,
  onNodeCollapse,
} = useTreeSelection({
  loadChildren,
  findNode,
})

/**
 * Handle node expand - delegates to concept expand handler
 * Collections are leaf nodes (members shown in details panel)
 */
function onNodeExpand(node: TreeNode) {
  onConceptNodeExpand(node)
}

// Convert our ConceptNode[] to PrimeVue tree format
// If a scheme is selected, show it as the root with collections and top concepts as children
// Collections appear first, then concepts (but concepts load first for performance)
const treeNodes = computed((): TreeNode[] => {
  const topNodes = conceptStore.topConcepts.map(node => convertToTreeNode(node))
  const collectionNodes = collections.value.map(col => convertCollectionToTreeNode(col))

  // If a scheme is selected, wrap collections + top concepts under the scheme as root
  // Collections come first in display order, then concepts
  const scheme = schemeStore.selected
  if (scheme) {
    const schemeChildren = [...collectionNodes, ...topNodes]

    const schemeNode: TreeNode = {
      key: scheme.uri,
      label: scheme.label || scheme.uri.split('/').pop() || scheme.uri,
      data: {
        uri: scheme.uri,
        isScheme: true,
        label: scheme.label,
        showLangTag: scheme.labelLang ? shouldShowLangTag(scheme.labelLang) : false,
        lang: scheme.labelLang,
        deprecated: scheme.deprecated,
      },
      leaf: schemeChildren.length === 0,
      children: schemeChildren,
    }

    return [schemeNode]
  }

  return topNodes
})

/**
 * Convert a CollectionNode to PrimeVue TreeNode format
 * Collections are leaf nodes - members are shown in the details panel
 */
function convertCollectionToTreeNode(col: CollectionNode): TreeNode {
  const label = col.label || col.uri.split('/').pop() || col.uri
  const displayLabel = col.notation && col.label
    ? `${col.notation} - ${label}`
    : col.notation || label

  return {
    key: col.uri,
    label: displayLabel,
    data: {
      uri: col.uri,
      isCollection: true,
      label: col.label,
      notation: col.notation,
      showLangTag: col.labelLang ? shouldShowCollectionLangTag(col.labelLang) : false,
      lang: col.labelLang,
    },
    leaf: true,  // Collections are leaf nodes (members shown in details panel)
  }
}

function convertToTreeNode(node: ConceptNode): TreeNode {
  // Display notation + label if both exist
  const label = node.label || node.uri.split('/').pop() || node.uri
  const displayLabel = node.notation && node.label
    ? `${node.notation} - ${label}`
    : node.notation || label

  return {
    key: node.uri,
    label: displayLabel,
    data: {
      ...node,
      showLangTag: node.lang ? shouldShowLangTag(node.lang) : false,
    },
    leaf: !node.hasNarrower,
    children: node.children?.map(child => convertToTreeNode(child)),
  }
}

/**
 * Handle node click - handles selection for all node types
 * The @click.stop prevents PrimeVue's default selection, so we must handle it here
 */
function onNodeClick(node: TreeNode) {
  const uri = node.data?.uri || node.key
  if (!uri) return

  if (node.data?.isCollection) {
    // Collection selection
    conceptStore.addToHistory({
      uri,
      label: node.data.label || uri,
      lang: node.data.lang,
      notation: node.data.notation,
      endpointUrl: endpointStore.current?.url,
      schemeUri: schemeStore.selectedUri || undefined,
      type: 'collection',
    })
    emit('selectCollection', uri)
  } else if (node.data?.isScheme) {
    // Scheme selection - view scheme details
    conceptStore.selectConcept(null)
    schemeStore.viewScheme(String(uri))
    conceptStore.addToHistory({
      uri: String(uri),
      label: node.data.label || String(uri),
      lang: node.data.lang,
      endpointUrl: endpointStore.current?.url,
      type: 'scheme',
    })
  } else {
    // Concept selection
    emit('selectConcept', String(uri))
  }
}

// Warning message for invalid URI
const gotoWarning = ref<string | null>(null)

// Check if a URI is a skos:Collection
async function isCollection(uri: string): Promise<boolean> {
  const endpoint = endpointStore.current
  if (!endpoint) return false

  const query = withPrefixes(`
    ASK { <${uri}> a skos:Collection }
  `)

  try {
    const results = await executeSparql(endpoint, query, { retries: 0 })
    return results.boolean === true
  } catch {
    return false
  }
}

// Check if a URI is a skos:Concept
async function isConcept(uri: string): Promise<boolean> {
  const endpoint = endpointStore.current
  if (!endpoint) return false

  const query = withPrefixes(`
    ASK { <${uri}> a skos:Concept }
  `)

  try {
    const results = await executeSparql(endpoint, query, { retries: 0 })
    return results.boolean === true
  } catch {
    return false
  }
}

// Go to URI directly
async function goToUri() {
  // Sanitize: trim whitespace and remove accidental < > from turtle/sparql copies
  const uri = gotoUri.value.trim().replace(/^<|>$/g, '')
  if (uri) {
    // Clear any previous warning
    gotoWarning.value = null

    // Check if this URI is a known scheme
    const scheme = schemeStore.schemes.find(s => s.uri === uri)
    if (scheme) {
      // Select the scheme in the dropdown (triggers tree loading via watcher)
      schemeStore.selectScheme(uri)
      // Clear concept selection and show scheme details on the right
      conceptStore.selectConcept(null)
      schemeStore.viewScheme(uri)
      // Add to history
      conceptStore.addToHistory({
        uri: scheme.uri,
        label: scheme.label || scheme.uri,
        lang: scheme.labelLang,
        endpointUrl: endpointStore.current?.url,
        type: 'scheme',
      })
      gotoUri.value = ''
    } else if (await isCollection(uri)) {
      // It's a collection - emit to parent for collection handling
      emit('selectCollection', uri)
      gotoUri.value = ''
    } else if (await isConcept(uri)) {
      // It's a concept - emit to parent for unified handling
      emit('selectConcept', uri)
      gotoUri.value = ''
    } else {
      // URI not found as scheme, collection, or concept
      gotoWarning.value = 'URI not found as a scheme, collection, or concept'
      logger.warn('ConceptTree', 'Invalid goto URI', { uri })
      // Auto-clear warning after 3 seconds
      setTimeout(() => {
        gotoWarning.value = null
      }, 3000)
    }
  }
}

// Infinite scroll handler - load more when near bottom
function onTreeScroll(event: Event) {
  const el = event.target as HTMLElement
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100

  if (nearBottom && hasMoreTopConcepts.value && !loadingMoreTopConcepts.value && !conceptStore.loadingTree) {
    loadMoreTopConcepts()
  }
}

// Orphan progress helpers
function getPhaseLabel(phase: string, currentQueryName: string | null): string {
  // Detect if using single-query approach
  const isSingleQuery = currentQueryName === 'single-query-orphan-detection'

  switch (phase) {
    case 'fetching-all': return 'Phase 1/3: Fetching Concepts'
    case 'running-exclusions':
      return isSingleQuery
        ? 'Executing Single Query'
        : 'Phase 2/3: Running Exclusion Queries'
    case 'calculating': return 'Phase 3/3: Calculating Orphans'
    case 'complete': return 'Complete'
    default: return 'Loading...'
  }
}

function formatQueryName(name: string): string {
  return name
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' → ')
}

// Watch for scheme/endpoint changes
// Use selectedUri directly so we react immediately when scheme changes (e.g., from history)
watch(
  () => [schemeStore.selectedUri, endpointStore.current?.id] as const,
  ([newScheme, newEndpoint], oldValue) => {
    const [oldScheme, oldEndpoint] = oldValue || [null, undefined]
    if (newEndpoint && (newScheme !== oldScheme || newEndpoint !== oldEndpoint)) {
      conceptStore.reset()
      resetCollections()
      loadTopConcepts()

      // Load collections for the selected scheme (async, doesn't block tree)
      if (newScheme && !schemeStore.isOrphanSchemeSelected) {
        loadCollectionsForScheme(newScheme)
      }
    }
  },
  { immediate: true }
)

// Reload when language changes
watch(
  () => languageStore.preferred,
  () => {
    if (endpointStore.current && schemeStore.selected) {
      // Clear cached children so they reload with new language labels
      conceptStore.clearAllChildren()
      loadTopConcepts()

      // Reload collections with new language
      if (!schemeStore.isOrphanSchemeSelected) {
        loadCollectionsForScheme(schemeStore.selected.uri)
      }
    }
  },
  { deep: true }
)

// Watch for collections loading to handle pending collection reveal (cross-scheme navigation)
watch(
  () => collections.value.length,
  async (len) => {
    if (len > 0 && conceptStore.pendingRevealCollectionUri) {
      const uri = conceptStore.pendingRevealCollectionUri
      logger.debug('ConceptTree', 'Collections loaded, revealing pending collection', { uri })
      conceptStore.clearPendingRevealCollection()
      await conceptStore.selectCollectionWithEvent(uri)
    }
  }
)

// Event subscriptions for cleanup
const eventSubscriptions: EventSubscription[] = []

// Setup event-driven reveal logic (replaces watchers that had race conditions)
onMounted(() => {
  // When a concept is selected, reveal it in the tree
  eventSubscriptions.push(
    eventBus.on('concept:selected', async (uri) => {
      if (!uri) return

      // If tree is still loading, store the request for later
      if (conceptStore.loadingTree) {
        logger.debug('ConceptTree', 'Tree loading, storing pending reveal', { uri })
        conceptStore.requestReveal(uri)
        return
      }

      // Tree is ready - reveal immediately
      await revealConceptIfNeeded(uri)
    })
  )

  // When a collection is selected, it's at root level - no expansion needed
  // The selectedKey computed handles highlighting via selectedCollectionUri
  eventSubscriptions.push(
    eventBus.on('collection:selected', async (uri) => {
      if (!uri) return
      logger.debug('ConceptTree', 'Collection selected', { uri })
      // Collections are at root level, no expansion needed
      // Tree highlighting handled by selectedKey computed
    })
  )

  // When tree finishes loading, check for pending reveal
  eventSubscriptions.push(
    eventBus.on('tree:loaded', async () => {
      const pending = conceptStore.pendingRevealUri
      if (pending) {
        logger.debug('ConceptTree', 'Tree loaded, revealing pending concept', { uri: pending })
        await revealConceptIfNeeded(pending)
      }
    })
  )
})

// Cleanup subscriptions
onUnmounted(() => {
  eventSubscriptions.forEach(sub => sub.unsubscribe())
})

// Watch for scroll-to-top trigger (from home button in breadcrumb)
watch(
  () => conceptStore.shouldScrollToTop,
  (should) => {
    if (should) {
      scrollToTop()
      conceptStore.resetScrollToTop()
    }
  }
)
</script>

<template>
  <div class="concept-tree">
    <!-- Go to URI input -->
    <div class="goto-uri">
      <div class="goto-input-wrapper">
        <input
          v-model="gotoUri"
          type="text"
          placeholder="Go to URI..."
          class="ae-input"
          @keyup.enter="goToUri"
          @input="gotoWarning = null"
        />
        <button
          class="goto-btn"
          :disabled="!gotoUri.trim()"
          aria-label="Go to URI"
          @click="goToUri"
        >
          <span class="material-symbols-outlined icon-sm">arrow_forward</span>
        </button>
      </div>
      <Message v-if="gotoWarning" severity="warn" :closable="false" class="goto-warning">
        {{ gotoWarning }}
      </Message>
    </div>

    <!-- Error message -->
    <Message v-if="error" severity="error" :closable="true" @close="error = null">
      {{ error }}
    </Message>

    <!-- Loading state (delayed to prevent flicker) -->
    <div v-if="showTreeLoading" class="loading-container">
      <ProgressSpinner style="width: 40px; height: 40px" />

      <!-- Simple loading for non-orphan schemes -->
      <template v-if="!schemeStore.isOrphanSchemeSelected">
        <span>Loading concepts...{{ treeLoadingElapsed.show.value ? ` (${treeLoadingElapsed.elapsed.value}s)` : '' }}</span>
      </template>

      <!-- Detailed orphan progress -->
      <template v-else>
        <div class="orphan-progress">
          <div class="progress-header">
            <span class="progress-phase">{{ getPhaseLabel(orphanProgress.phase, orphanProgress.currentQueryName) }}</span>
            <span v-if="treeLoadingElapsed.show.value" class="progress-time">({{ treeLoadingElapsed.elapsed.value }}s)</span>
          </div>

          <!-- Phase 1: Fetching all concepts -->
          <div v-if="orphanProgress.phase === 'fetching-all'" class="progress-detail">
            <div v-if="orphanProgress.totalConcepts > 0" class="progress-counts">
              <span class="count-label">Fetching:</span>
              <span class="count-value">
                {{ orphanProgress.fetchedConcepts.toLocaleString() }} / {{ orphanProgress.totalConcepts.toLocaleString() }} concepts
                ({{ Math.round((orphanProgress.fetchedConcepts / orphanProgress.totalConcepts) * 100) }}%)
              </span>
            </div>
            <div v-else class="progress-counts">
              <span class="count-label">Fetching all SKOS concepts...</span>
            </div>

            <!-- Progress bar -->
            <div v-if="orphanProgress.totalConcepts > 0 && orphanProgress.fetchedConcepts > 0" class="progress-bar">
              <div
                class="progress-bar-fill"
                :style="{ width: `${(orphanProgress.fetchedConcepts / orphanProgress.totalConcepts) * 100}%` }"
              ></div>
            </div>
          </div>

          <!-- Phase 2: Running exclusions -->
          <div v-else-if="orphanProgress.phase === 'running-exclusions'" class="progress-detail">
            <!-- Single-query approach shows different stats -->
            <template v-if="orphanProgress.currentQueryName === 'single-query-orphan-detection'">
              <div class="progress-counts">
                <span class="count-label">All concepts in endpoint:</span>
                <span class="count-value">{{ orphanProgress.totalConcepts.toLocaleString() }}</span>
              </div>
              <div class="progress-counts">
                <span class="count-label">Orphans found:</span>
                <span class="count-value">{{ orphanProgress.remainingCandidates.toLocaleString() }}</span>
              </div>
              <div class="progress-current">
                Fetching orphan concepts with optimized single query...
              </div>
            </template>

            <!-- Multi-query approach shows elimination stats -->
            <template v-else>
              <div class="progress-counts">
                <span class="count-label">Starting:</span>
                <span class="count-value">{{ orphanProgress.totalConcepts.toLocaleString() }} concepts</span>
              </div>
              <div class="progress-counts">
                <span class="count-label">Remaining:</span>
                <span class="count-value">{{ orphanProgress.remainingCandidates.toLocaleString() }} candidates</span>
              </div>

              <!-- Current query -->
              <div v-if="orphanProgress.currentQueryName" class="progress-current">
                Running: {{ formatQueryName(orphanProgress.currentQueryName) }}
              </div>
            </template>

            <!-- Completed queries (expandable) -->
            <details v-if="orphanProgress.completedQueries.length > 0" class="progress-queries">
              <summary>{{ orphanProgress.completedQueries.length }} queries completed</summary>
              <ul class="query-list">
                <li v-for="q in orphanProgress.completedQueries" :key="q.name" class="query-item">
                  <span class="query-name">{{ formatQueryName(q.name) }}</span>
                  <span class="query-stats">
                    <span class="query-excluded">-{{ q.excludedCount.toLocaleString() }}</span>
                    <span class="query-separator">|</span>
                    <span class="query-cumulative">{{ q.cumulativeExcluded.toLocaleString() }} removed</span>
                    <span class="query-separator">|</span>
                    <span class="query-remaining">{{ q.remainingAfter.toLocaleString() }} left</span>
                  </span>
                </li>
              </ul>
            </details>

            <!-- Skipped queries (expandable) -->
            <details v-if="orphanProgress.skippedQueries.length > 0" class="progress-queries">
              <summary class="skipped-summary">{{ orphanProgress.skippedQueries.length }} queries skipped</summary>
              <ul class="query-list">
                <li v-for="name in orphanProgress.skippedQueries" :key="name" class="query-item skipped-item">
                  <span class="query-name">{{ formatQueryName(name) }}</span>
                  <span class="query-skipped">skipped</span>
                </li>
              </ul>
            </details>
          </div>

          <!-- Phase 3: Calculating -->
          <div v-else-if="orphanProgress.phase === 'calculating'" class="progress-detail">
            Performing final calculation...
          </div>
        </div>
      </template>
    </div>

    <!-- Empty state (only when no treeNodes - scheme or concepts) -->
    <div v-else-if="!conceptStore.loadingTree && !treeNodes.length && !error" class="empty-state">
      <span class="material-symbols-outlined empty-icon">folder_open</span>
      <p>No concepts found</p>
      <small v-if="!schemeStore.selected">Select a concept scheme to browse</small>
      <small v-else-if="schemeStore.isOrphanSchemeSelected">Orphan concepts will appear here</small>
      <small v-else>This scheme has no top-level concepts</small>
    </div>

    <!-- Tree -->
    <template v-if="!conceptStore.loadingTree && treeNodes.length > 0">
      <!-- Orphan calculation summary (after loading completes) -->
      <div v-if="schemeStore.isOrphanSchemeSelected && orphanProgress.phase === 'complete'" class="orphan-summary">
        <details>
          <summary class="summary-header">
            <span class="material-symbols-outlined summary-icon">info</span>
            <span>Orphan Calculation: {{ orphanProgress.remainingCandidates.toLocaleString() }} orphans found from {{ orphanProgress.totalConcepts.toLocaleString() }} concepts</span>
          </summary>
          <div class="summary-content">
            <div class="summary-stats">
              <div class="stat-item">
                <span class="stat-label">Total Concepts:</span>
                <span class="stat-value">{{ orphanProgress.totalConcepts.toLocaleString() }}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Excluded:</span>
                <span class="stat-value">{{ (orphanProgress.totalConcepts - orphanProgress.remainingCandidates).toLocaleString() }}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Orphans:</span>
                <span class="stat-value">{{ orphanProgress.remainingCandidates.toLocaleString() }}</span>
              </div>
            </div>

            <div v-if="orphanProgress.completedQueries.length > 0" class="summary-queries">
              <h4 class="queries-title">Exclusion Queries ({{ orphanProgress.completedQueries.length }})</h4>
              <ul class="query-list">
                <li v-for="q in orphanProgress.completedQueries" :key="q.name" class="query-item">
                  <span class="query-name">{{ formatQueryName(q.name) }}</span>
                  <span class="query-stats">
                    <span class="query-excluded">-{{ q.excludedCount.toLocaleString() }}</span>
                    <span class="query-separator">|</span>
                    <span class="query-cumulative">{{ q.cumulativeExcluded.toLocaleString() }} removed</span>
                    <span class="query-separator">|</span>
                    <span class="query-remaining">{{ q.remainingAfter.toLocaleString() }} left</span>
                  </span>
                </li>
              </ul>
            </div>

            <div v-if="orphanProgress.skippedQueries.length > 0" class="summary-queries">
              <h4 class="queries-title">Skipped Queries ({{ orphanProgress.skippedQueries.length }})</h4>
              <ul class="query-list">
                <li v-for="name in orphanProgress.skippedQueries" :key="name" class="query-item skipped-item">
                  <span class="query-name">{{ formatQueryName(name) }}</span>
                  <span class="query-skipped">skipped (0 candidates)</span>
                </li>
              </ul>
            </div>
          </div>
        </details>
      </div>

      <div ref="treeWrapperRef" class="tree-wrapper" @scroll="onTreeScroll">
      <Tree
        v-model:selectionKeys="selectedKey"
        v-model:expandedKeys="expandedKeys"
        :value="treeNodes"
        selectionMode="single"
        class="concept-tree-component"
        @node-expand="onNodeExpand"
        @node-collapse="onNodeCollapse"
      >
        <template #default="slotProps">
          <div
            class="tree-node"
            :class="{
              'scheme-node': slotProps.node.data?.isScheme,
              'collection-node': slotProps.node.data?.isCollection,
              'deprecated': slotProps.node.data?.deprecated && showDeprecationIndicator
            }"
            @click.stop="onNodeClick(slotProps.node)"
          >
            <!-- Icon based on node type -->
            <span v-if="slotProps.node.data?.isScheme" class="material-symbols-outlined node-icon icon-folder">folder</span>
            <span v-else-if="slotProps.node.data?.isCollection" class="material-symbols-outlined node-icon icon-collection">collections_bookmark</span>
            <span v-else-if="slotProps.node.data?.hasNarrower" class="material-symbols-outlined node-icon icon-label">label</span>
            <span v-else class="material-symbols-outlined node-icon icon-leaf">circle</span>
            <span class="node-label">
              {{ slotProps.node.label }}
              <span v-if="slotProps.node.data?.showLangTag" class="lang-tag">
                {{ slotProps.node.data.lang }}
              </span>
              <span v-if="slotProps.node.data?.deprecated && showDeprecationIndicator" class="deprecated-badge">deprecated</span>
            </span>
            <ProgressSpinner
              v-if="loadingChildren.has(slotProps.node.key)"
              style="width: 16px; height: 16px"
            />
          </div>
        </template>
      </Tree>

      <!-- Load more indicator (auto-triggered by scroll) -->
      <div v-if="loadingMoreTopConcepts" class="load-more-indicator">
        <ProgressSpinner style="width: 20px; height: 20px" />
        <span>Loading more...</span>
      </div>
    </div>

      <!-- Bottom toolbar -->
      <div class="tree-toolbar">
        <button class="toolbar-btn" aria-label="Expand all" title="Expand all">
          <span class="material-symbols-outlined">unfold_more</span>
        </button>
        <button class="toolbar-btn" aria-label="Refresh" title="Refresh" @click="loadTopConcepts(0)">
          <span class="material-symbols-outlined">refresh</span>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.concept-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.goto-uri {
  padding: 0.75rem;
  border-bottom: 1px solid var(--ae-border-color);
}

.goto-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

/* Extra right padding for go button */
.goto-input-wrapper .ae-input {
  padding-right: 2rem;
}

.goto-btn {
  position: absolute;
  right: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--ae-text-secondary);
  transition: color 0.15s;
}

.goto-btn:hover:not(:disabled) {
  color: var(--ae-text-primary);
}

.goto-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.goto-warning {
  margin-top: 0.5rem;
  font-size: 0.75rem;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 2rem;
  color: var(--ae-text-secondary);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem;
  text-align: center;
  color: var(--ae-text-secondary);
}

.empty-icon {
  font-size: 2rem;
  opacity: 0.5;
}

.empty-state p {
  margin: 0;
  font-weight: 500;
}

.empty-state small {
  font-size: 0.75rem;
}

.tree-wrapper {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  padding: 0.5rem;
}

.concept-tree-component {
  flex: 1;
  min-height: 0;
}

.load-more-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem;
  color: var(--ae-text-secondary);
  font-size: 0.875rem;
}

.tree-toolbar {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem;
  border-top: 1px solid var(--ae-border-color);
}

.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--ae-text-secondary);
  transition: background-color 0.15s, color 0.15s;
}

.toolbar-btn:hover {
  background: var(--ae-bg-hover);
  color: var(--ae-text-primary);
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.875rem;
}

.tree-node.scheme-node {
  font-weight: 600;
}

.tree-node.collection-node {
  font-weight: 500;
}

.icon-collection {
  color: var(--ae-icon-collection, #8b5cf6);
}

.node-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.tree-node.deprecated .node-label {
  opacity: 0.6;
}

.node-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* PrimeVue Tree overrides */
:deep(.p-tree) {
  background: transparent;
  padding: 0;
  font-family: inherit;
}

:deep(.p-tree-root) {
  overflow: visible;
}

:deep(.p-tree-node) {
  padding: 0;
}

:deep(.p-tree-node-children) {
  padding-left: 1rem;
  margin-left: 0.5rem;
  border-left: 1px solid var(--ae-border-color);
}

:deep(.p-tree-node-content) {
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  transition: background-color 0.1s;
}

:deep(.p-tree-node-content:hover) {
  background: var(--ae-bg-hover);
}

:deep(.p-tree-node-content.p-highlight) {
  background: var(--ae-bg-hover);
  border: 1px solid var(--ae-border-color);
}

:deep(.p-tree-node-content.p-highlight .node-label) {
  font-weight: 500;
  color: var(--ae-text-primary);
}

/* Toggle button styling */
:deep(.p-tree-node-toggle-button) {
  width: 20px;
  height: 20px;
  margin-right: 0;
  color: var(--ae-text-secondary);
}

:deep(.p-tree-node-toggle-button:hover) {
  background: transparent;
  color: var(--ae-text-primary);
}

:deep(.p-tree-node-toggle-button .p-icon) {
  width: 14px;
  height: 14px;
}

/* Orphan progress UI */
.orphan-progress {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  text-align: left;
  max-width: 400px;
}

.progress-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
}

.progress-phase {
  color: var(--ae-text-primary);
}

.progress-time {
  color: var(--ae-text-secondary);
  font-size: 0.875rem;
}

.progress-detail {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--ae-text-secondary);
}

.progress-counts {
  display: flex;
  gap: 0.5rem;
}

.count-label {
  min-width: 70px;
  color: var(--ae-text-secondary);
}

.count-value {
  font-weight: 500;
  color: var(--ae-text-primary);
}

.progress-current {
  padding: 0.5rem;
  background: var(--ae-bg-secondary);
  border-radius: 4px;
  font-style: italic;
}

.progress-queries {
  margin-top: 0.5rem;
}

.progress-queries summary {
  cursor: pointer;
  padding: 0.25rem 0;
  color: var(--ae-accent);
  font-weight: 500;
  user-select: none;
}

.progress-queries summary:hover {
  text-decoration: underline;
}

.query-list {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0 0 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.query-item {
  display: flex;
  justify-content: space-between;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  background: var(--ae-bg-secondary);
  border-radius: 3px;
}

.query-name {
  color: var(--ae-text-secondary);
}

.query-stats {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.query-excluded {
  color: var(--ae-accent);
  font-weight: 600;
}

.query-separator {
  color: var(--ae-text-muted);
}

.query-cumulative {
  color: var(--ae-text-secondary);
  font-weight: 500;
}

.query-remaining {
  color: var(--ae-text-muted);
}

.progress-bar {
  width: 100%;
  height: 4px;
  background: var(--ae-bg-secondary);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 0.5rem;
}

.progress-bar-fill {
  height: 100%;
  background: var(--ae-accent);
  transition: width 0.3s ease;
}

.skipped-summary {
  color: var(--ae-text-secondary) !important;
  font-style: italic;
}

.skipped-item {
  opacity: 0.6;
}

.query-skipped {
  color: var(--ae-text-secondary);
  font-style: italic;
  font-size: 0.7rem;
}

/* Orphan summary (after completion) */
.orphan-summary {
  margin: 0.75rem;
  padding: 0.75rem;
  background: var(--ae-bg-secondary);
  border: 1px solid var(--ae-border-color);
  border-radius: 4px;
}

.summary-header {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
  color: var(--ae-text-primary);
  user-select: none;
  padding: 0.25rem 0;
}

.summary-header:hover {
  color: var(--ae-accent);
}

.summary-icon {
  font-size: 1.25rem;
  color: var(--ae-accent);
}

.summary-content {
  margin-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.summary-stats {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.stat-label {
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stat-value {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--ae-text-primary);
}

.summary-queries {
  padding-top: 1rem;
  border-top: 1px solid var(--ae-border-color);
}

.queries-title {
  margin: 0 0 0.5rem 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--ae-text-primary);
}
</style>
