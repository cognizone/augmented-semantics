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
import { useConceptStore, useEndpointStore, useSchemeStore, useLanguageStore, useSettingsStore } from '../../stores'
import { logger, eventBus, executeSparql, withPrefixes, endpointHasCollections } from '../../services'
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
const settingsStore = useSettingsStore()
const { shouldShowLangTag } = useLabelResolver()
const { showIndicator: showDeprecationIndicator } = useDeprecation()

// Collections composable
const {
  collections,
  topLevelCollections,
  loadCollectionsForScheme,
  loadAllCollections,
  loadChildCollections,
  loading: collectionsLoading,
  error: collectionsError,
  reset: resetCollections,
  shouldShowLangTag: shouldShowCollectionLangTag,
} = useCollections({ shared: true })

const isCollectionMode = computed(() => schemeStore.rootMode === 'collection')


// Delayed loading - show spinner only after 300ms to prevent flicker
const showTreeLoading = useDelayedLoading(computed(() =>
  conceptStore.loadingTree || (isCollectionMode.value && collectionsLoading.value)
))

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
  loadTopConcepts,
  loadMoreTopConcepts,
  loadChildren,
  findNode,
} = useTreePagination()

const activeError = computed(() => isCollectionMode.value ? collectionsError.value : error.value)

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

// Track loading state for collection expansion
const loadingCollectionChildren = ref<Set<string>>(new Set())

/**
 * Handle node expand - handles both concepts and collections with child collections
 * Collections with child collections lazy-load their nested collections
 * Concept members are always shown in the details panel, not in the tree
 */
/** Check if a tree node represents a collection */
function isCollectionNode(node: TreeNode): boolean {
  return node.data?.isCollection || node.data?.type === 'collection'
}

async function onNodeExpand(node: TreeNode) {
  logger.debug('ConceptTree', 'onNodeExpand fired', {
    key: node.key,
    label: node.label,
    leaf: node.leaf,
    isCollection: isCollectionNode(node),
    hasChildCollections: node.data?.hasChildCollections,
    childrenLength: node.children?.length,
  })

  if (isCollectionNode(node) && node.data?.hasChildCollections) {
    // Load child collections for this collection
    if (!node.children?.length) {  // Only load if not already loaded
      const uri = node.data.uri as string
      loadingCollectionChildren.value.add(uri)
      try {
        const children = await loadChildCollections(uri)
        if (children.length > 0) {
          node.children = children.map(col => convertCollectionToTreeNode(col))
        } else {
          node.children = undefined
          node.leaf = true
          if (node.data) {
            node.data.hasChildCollections = false
          }
        }
      } catch (e) {
        logger.error('ConceptTree', 'Failed to load child collections', { uri, error: e })
      } finally {
        loadingCollectionChildren.value.delete(uri)
      }
    }
  } else {
    // Existing concept expand logic
    onConceptNodeExpand(node)
  }
}

// Convert our ConceptNode[] to PrimeVue tree format
// If a scheme is selected, show it as the root with collections and top concepts as children
// Collections appear first, then concepts (but concepts load first for performance)
// Only top-level collections appear at root level; nested collections load on expand
// Exception: orphan "scheme" displays items directly at root (no fake scheme wrapper)
const treeNodes = computed((): TreeNode[] => {
  const topNodes = isCollectionMode.value
    ? []
    : conceptStore.topConcepts.map(node => convertToTreeNode(node))
  const collectionNodes = topLevelCollections.value.map(col => convertCollectionToTreeNode(col))

  const scheme = schemeStore.selected

  if (isCollectionMode.value) {
    return collectionNodes
  }

  // Orphan scheme: display items directly at root level (no wrapper)
  if (schemeStore.isOrphanSchemeSelected) {
    return topNodes // orphan collections are already in topConcepts with type: 'collection'
  }

  // Regular scheme: wrap collections + top concepts under the scheme as root
  // Collections come first in display order, then concepts
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
 * Collections with child collections are expandable; others are leaf nodes
 * Concept members are always shown in the details panel, not in the tree
 */
function convertCollectionToTreeNode(col: CollectionNode): TreeNode {
  const label = col.label || col.uri.split('/').pop() || col.uri
  const displayLabel = settingsStore.showNotationInLabels
    ? (col.notation && col.label ? `${col.notation} - ${label}` : col.notation || label)
    : label

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
      hasChildCollections: col.hasChildCollections,
    },
    leaf: !col.hasChildCollections,  // Expandable if has child collections
    children: col.hasChildCollections ? [] : undefined,  // Placeholder for lazy load
  }
}

function convertToTreeNode(node: ConceptNode): TreeNode {
  // Display notation + label if both exist
  const label = node.label || node.uri.split('/').pop() || node.uri
  const displayLabel = settingsStore.showNotationInLabels
    ? (node.notation && node.label ? `${node.notation} - ${label}` : node.notation || label)
    : label

  return {
    key: node.uri,
    label: displayLabel,
    data: {
      ...node,
      showLangTag: node.lang ? shouldShowLangTag(node.lang) : false,
    },
    leaf: !node.hasNarrower,
    children: node.children?.map(child => convertToTreeNode(child))
      ?? (node.hasNarrower ? [] : undefined),
  }
}

/**
 * Handle node click - handles selection for all node types
 * The @click.stop prevents PrimeVue's default selection, so we must handle it here
 */
function onNodeClick(node: TreeNode) {
  const uri = node.data?.uri || node.key
  if (!uri) return

  if (isCollectionNode(node)) {
    // Collection selection
    conceptStore.addToHistory({
      uri,
      label: node.data.label || uri,
      lang: node.data.lang,
      notation: node.data.notation,
      endpointUrl: endpointStore.current?.url,
      schemeUri: isCollectionMode.value ? undefined : schemeStore.selectedUri || undefined,
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
  if (!endpointHasCollections(endpoint)) {
    return false
  }

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
    if (scheme && !isCollectionMode.value) {
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
      gotoWarning.value = isCollectionMode.value
        ? 'URI not found as a collection or concept (scheme mode is disabled)'
        : 'URI not found as a scheme, collection, or concept'
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

  if (!isCollectionMode.value && nearBottom && hasMoreTopConcepts.value && !loadingMoreTopConcepts.value && !conceptStore.loadingTree) {
    loadMoreTopConcepts()
  }
}

// Watch for scheme/endpoint changes
// Use selectedUri directly so we react immediately when scheme changes (e.g., from history)
watch(
  () => [schemeStore.rootMode, schemeStore.selectedUri, endpointStore.current?.id] as const,
  ([rootMode, newScheme, newEndpoint], oldValue) => {
    const [oldMode, oldScheme, oldEndpoint] = oldValue || ['scheme', null, undefined]
    if (newEndpoint && (rootMode !== oldMode || newScheme !== oldScheme || newEndpoint !== oldEndpoint)) {
      conceptStore.reset()
      resetCollections()

      if (rootMode === 'collection') {
        loadAllCollections()
        return
      }

      loadTopConcepts()

      // Load collections for the selected scheme (async, doesn't block tree)
      if (newScheme && !schemeStore.isOrphanSchemeSelected) {
        loadCollectionsForScheme(newScheme)
      }
    }
  },
  { immediate: true }
)

// If schemes load after selectedUri is set, selected may become available later.
// Ensure tree loads once the selected scheme object is ready.
watch(
  () => schemeStore.selected?.uri,
  (newScheme, oldScheme) => {
    if (!newScheme || newScheme === oldScheme) return
    if (isCollectionMode.value || !endpointStore.current) return

    loadTopConcepts()
    if (!schemeStore.isOrphanSchemeSelected) {
      loadCollectionsForScheme(newScheme)
    }
  }
)

// Reload when language changes
watch(
  () => languageStore.preferred,
  () => {
    if (endpointStore.current && isCollectionMode.value) {
      loadAllCollections()
      return
    }

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

// Reload when scheme URI fix setting changes
watch(
  () => settingsStore.enableSchemeUriSlashFix,
  () => {
    if (!endpointStore.current) return
    if (isCollectionMode.value) return
    conceptStore.clearAllChildren()
    loadTopConcepts()

    if (schemeStore.selected && !schemeStore.isOrphanSchemeSelected) {
      loadCollectionsForScheme(schemeStore.selected.uri)
    }
  }
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
    <Message
      v-if="activeError"
      severity="error"
      :closable="true"
      @close="isCollectionMode ? (collectionsError = null) : (error = null)"
    >
      {{ activeError }}
    </Message>

    <!-- Loading state (delayed to prevent flicker) -->
    <div v-if="showTreeLoading" class="loading-container">
      <ProgressSpinner style="width: 40px; height: 40px" />

      <template v-if="isCollectionMode">
        <span>Loading collections...{{ treeLoadingElapsed.show.value ? ` (${treeLoadingElapsed.elapsed.value}s)` : '' }}</span>
      </template>
      <template v-else-if="!schemeStore.isOrphanSchemeSelected">
        <span>Loading concepts...{{ treeLoadingElapsed.show.value ? ` (${treeLoadingElapsed.elapsed.value}s)` : '' }}</span>
      </template>
      <template v-else>
        <span>Loading orphans...{{ treeLoadingElapsed.show.value ? ` (${treeLoadingElapsed.elapsed.value}s)` : '' }}</span>
      </template>
    </div>

    <!-- Empty state (only when no treeNodes - scheme or concepts) -->
    <div
      v-else-if="!conceptStore.loadingTree && (!isCollectionMode || !collectionsLoading) && !treeNodes.length && !activeError"
      class="empty-state"
    >
      <span class="material-symbols-outlined empty-icon">folder_open</span>
      <p>{{ isCollectionMode ? 'No collections found' : 'No concepts found' }}</p>
      <small v-if="isCollectionMode">This endpoint has no top-level collections</small>
      <small v-else-if="!schemeStore.selected">Select a concept scheme to browse</small>
      <small v-else-if="schemeStore.isOrphanSchemeSelected">Orphan concepts will appear here</small>
      <small v-else>This scheme has no top-level concepts</small>
    </div>

    <!-- Tree -->
    <template v-if="!conceptStore.loadingTree && treeNodes.length > 0">
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
              'collection-node': isCollectionNode(slotProps.node),
              'deprecated': slotProps.node.data?.deprecated && showDeprecationIndicator
            }"
            @click.stop="onNodeClick(slotProps.node)"
          >
            <!-- Icon based on node type -->
            <span v-if="slotProps.node.data?.isScheme" class="material-symbols-outlined node-icon icon-folder">folder</span>
            <span v-else-if="isCollectionNode(slotProps.node)" class="material-symbols-outlined node-icon icon-collection">collections_bookmark</span>
            <span v-else-if="!slotProps.node.leaf" class="material-symbols-outlined node-icon icon-label">label</span>
            <span v-else class="material-symbols-outlined node-icon icon-leaf">circle</span>
            <span class="node-label">
              {{ slotProps.node.label }}
              <span v-if="slotProps.node.data?.showLangTag" class="lang-tag">
                {{ slotProps.node.data.lang }}
              </span>
              <span v-if="slotProps.node.data?.deprecated && showDeprecationIndicator" class="deprecated-badge">deprecated</span>
            </span>
            <ProgressSpinner
              v-if="loadingChildren.has(slotProps.node.key) || loadingCollectionChildren.has(slotProps.node.key)"
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
        <button
          class="toolbar-btn"
          aria-label="Refresh"
          title="Refresh"
          @click="isCollectionMode ? loadAllCollections() : loadTopConcepts(0)"
        >
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


.queries-title {
  margin: 0 0 0.5rem 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--ae-text-primary);
}
</style>
