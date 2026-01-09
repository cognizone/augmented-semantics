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
import { logger, eventBus } from '../../services'
import type { EventSubscription } from '../../services'
import {
  useDelayedLoading,
  useLabelResolver,
  useElapsedTime,
  useDeprecation,
  useTreePagination,
  useTreeNavigation,
  useTreeSelection,
} from '../../composables'
import type { ConceptNode } from '../../types'
import Tree from 'primevue/tree'
import type { TreeNode } from 'primevue/treenode'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'

const conceptStore = useConceptStore()
const endpointStore = useEndpointStore()
const schemeStore = useSchemeStore()
const languageStore = useLanguageStore()
const { shouldShowLangTag } = useLabelResolver()
const { showIndicator: showDeprecationIndicator } = useDeprecation()

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
  onNodeExpand,
  onNodeCollapse,
  selectConcept,
} = useTreeSelection({
  loadChildren,
  findNode,
})

// Convert our ConceptNode[] to PrimeVue tree format
// If a scheme is selected, show it as the root with top concepts as children
const treeNodes = computed((): TreeNode[] => {
  const topNodes = conceptStore.topConcepts.map(node => convertToTreeNode(node))

  // If a scheme is selected, wrap top concepts under the scheme as root
  // Always show the scheme node, even if it has no concepts
  const scheme = schemeStore.selected
  if (scheme) {
    return [{
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
      leaf: topNodes.length === 0,
      children: topNodes,
    }]
  }

  return topNodes
})

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

// Go to URI directly
function goToUri() {
  // Sanitize: trim whitespace and remove accidental < > from turtle/sparql copies
  const uri = gotoUri.value.trim().replace(/^<|>$/g, '')
  if (uri) {
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
    } else {
      // Treat as a concept
      selectConcept(uri)
    }
    gotoUri.value = ''
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

// Watch for scheme/endpoint changes
// Use selectedUri directly so we react immediately when scheme changes (e.g., from history)
watch(
  () => [schemeStore.selectedUri, endpointStore.current?.id] as const,
  ([newScheme, newEndpoint], oldValue) => {
    const [oldScheme, oldEndpoint] = oldValue || [null, undefined]
    if (newEndpoint && (newScheme !== oldScheme || newEndpoint !== oldEndpoint)) {
      conceptStore.reset()
      loadTopConcepts()
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
    }
  },
  { deep: true }
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
    </div>

    <!-- Error message -->
    <Message v-if="error" severity="error" :closable="true" @close="error = null">
      {{ error }}
    </Message>

    <!-- Loading state (delayed to prevent flicker) -->
    <div v-if="showTreeLoading" class="loading-container">
      <ProgressSpinner style="width: 40px; height: 40px" />
      <span>Loading concepts...{{ treeLoadingElapsed.show.value ? ` (${treeLoadingElapsed.elapsed.value}s)` : '' }}</span>
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
    <div v-else ref="treeWrapperRef" class="tree-wrapper" @scroll="onTreeScroll">
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
          <div class="tree-node" :class="{ 'scheme-node': slotProps.node.data?.isScheme, 'deprecated': slotProps.node.data?.deprecated && showDeprecationIndicator }">
            <!-- Icon based on node type -->
            <span v-if="slotProps.node.data?.isScheme" class="material-symbols-outlined node-icon icon-folder">folder</span>
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

.node-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.tree-node.deprecated {
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
</style>
