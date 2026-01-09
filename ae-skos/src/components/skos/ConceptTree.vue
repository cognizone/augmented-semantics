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
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useConceptStore, useEndpointStore, useSchemeStore, useLanguageStore } from '../../stores'
import { executeSparql, withPrefixes, logger, eventBus } from '../../services'
import type { EventSubscription } from '../../services'
import { useDelayedLoading, useLabelResolver, useElapsedTime, useDeprecation, useConceptBindings, useConceptTreeQueries } from '../../composables'
import type { ConceptNode } from '../../types'
import Tree from 'primevue/tree'
import type { TreeNode } from 'primevue/treenode'

type TreeExpandedKeys = Record<string, boolean>
type TreeSelectionKeys = Record<string, boolean>
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'

const conceptStore = useConceptStore()
const endpointStore = useEndpointStore()
const schemeStore = useSchemeStore()
const languageStore = useLanguageStore()
const { shouldShowLangTag } = useLabelResolver()
const { showIndicator: showDeprecationIndicator } = useDeprecation()
const { processBindings } = useConceptBindings()
const { buildTopConceptsQuery, buildChildrenQuery } = useConceptTreeQueries()

// Delayed loading - show spinner only after 300ms to prevent flicker
const showTreeLoading = useDelayedLoading(computed(() => conceptStore.loadingTree))

// Elapsed time for tree loading (shows after 1s delay)
const treeLoadingElapsed = useElapsedTime(computed(() => conceptStore.loadingTree))

// Pagination config
const PAGE_SIZE = 200

// Pagination state for top concepts
const topConceptsOffset = ref(0)
const hasMoreTopConcepts = ref(true)
const loadingMoreTopConcepts = ref(false)

// Pagination state for children (keyed by parent URI)
const childrenPagination = ref<Map<string, { offset: number; hasMore: boolean; loading: boolean }>>(new Map())

// Local state
const error = ref<string | null>(null)
const loadingChildren = ref<Set<string>>(new Set())
const gotoUri = ref('')

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

// Selected node keys for PrimeVue Tree
const selectedKey = computed<TreeSelectionKeys | undefined>({
  get: () => {
    // Show scheme as selected when viewing scheme details
    if (schemeStore.viewingSchemeUri) {
      return { [schemeStore.viewingSchemeUri]: true }
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

// Expanded keys for PrimeVue Tree
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

// Load top concepts for selected scheme
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

// Load more top concepts (next page)
async function loadMoreTopConcepts() {
  if (!hasMoreTopConcepts.value || loadingMoreTopConcepts.value) return
  const nextOffset = topConceptsOffset.value + PAGE_SIZE
  await loadTopConcepts(nextOffset)
}

// Load children for a node
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

// Handle node expand
function onNodeExpand(node: TreeNode) {
  const conceptNode = node.data as ConceptNode | undefined
  if (conceptNode?.hasNarrower && !conceptNode.children && node.key) {
    loadChildren(String(node.key))
  }
  if (node.key) {
    conceptStore.expandNode(String(node.key))
  }
}

// Handle node collapse
function onNodeCollapse(node: TreeNode) {
  if (node.key) {
    conceptStore.collapseNode(String(node.key))
  }
}

// Handle node select
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

// Find node by URI in tree
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

// Fetch ancestor path for a concept (from root to parent)
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

// Reveal a concept in the tree (expand ancestors and scroll to it)
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
  await nextTick()
  scrollToNode(uri)
}

// Scroll to a node in the tree
function scrollToNode(uri: string) {
  const treeWrapper = document.querySelector('.tree-wrapper')
  if (!treeWrapper) {
    logger.debug('ConceptTree', 'scrollToNode: no tree wrapper found')
    return
  }

  // Strategy 1: Find by data-p-key attribute (PrimeVue's node identifier)
  let nodeElement = treeWrapper.querySelector(`[data-p-key="${CSS.escape(uri)}"]`)

  // Strategy 2: Find the currently highlighted node (fallback)
  if (!nodeElement) {
    nodeElement = treeWrapper.querySelector('.p-tree-node-content.p-highlight')
  }

  if (nodeElement) {
    logger.debug('ConceptTree', 'scrollToNode: scrolling to node', { uri })
    nodeElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
  } else {
    logger.debug('ConceptTree', 'scrollToNode: node not found', { uri })
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

// Reveal concept in tree when selected (event-driven to avoid race conditions)
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
    scrollToNode(uri)
  }

  // Mark as revealed for coordination
  await conceptStore.markConceptRevealed(uri)
}

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
      const wrapper = document.querySelector('.tree-wrapper')
      wrapper?.scrollTo({ top: 0, behavior: 'smooth' })
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
      <small v-else>This scheme has no top-level concepts</small>
    </div>

    <!-- Tree -->
    <div v-else class="tree-wrapper" @scroll="onTreeScroll">
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
