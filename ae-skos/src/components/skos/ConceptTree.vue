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
import { ref, watch, computed } from 'vue'
import { useConceptStore, useEndpointStore, useSchemeStore, useLanguageStore } from '../../stores'
import { executeSparql, withPrefixes, logger } from '../../services'
import { useDelayedLoading } from '../../composables'
import type { ConceptNode } from '../../types'
import Tree from 'primevue/tree'
import type { TreeNode } from 'primevue/treenode'

type TreeExpandedKeys = Record<string, boolean>
type TreeSelectionKeys = Record<string, boolean>
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'

const conceptStore = useConceptStore()
const endpointStore = useEndpointStore()
const schemeStore = useSchemeStore()
const languageStore = useLanguageStore()

// Delayed loading - show spinner only after 300ms to prevent flicker
const showTreeLoading = useDelayedLoading(computed(() => conceptStore.loadingTree))

// Local state
const error = ref<string | null>(null)
const loadingChildren = ref<Set<string>>(new Set())
const gotoUri = ref('')

// Convert our ConceptNode[] to PrimeVue tree format
const treeNodes = computed((): TreeNode[] => {
  return conceptStore.topConcepts.map(node => convertToTreeNode(node))
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
    data: node,
    leaf: !node.hasNarrower,
    children: node.children?.map(child => convertToTreeNode(child)),
  }
}

// Selected node keys for PrimeVue Tree
const selectedKey = computed<TreeSelectionKeys | undefined>({
  get: () => {
    if (conceptStore.selectedUri) {
      return { [conceptStore.selectedUri]: true }
    }
    return undefined
  },
  set: (keys) => {
    if (keys) {
      const uri = Object.keys(keys)[0]
      if (uri) {
        selectConcept(uri)
      }
    }
  },
})

// Expanded keys for PrimeVue Tree
const expandedKeys = computed<TreeExpandedKeys>({
  get: () => {
    const keys: TreeExpandedKeys = {}
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
async function loadTopConcepts() {
  const endpoint = endpointStore.current
  const scheme = schemeStore.selected
  if (!endpoint) return

  // Require a scheme to be selected
  if (!scheme) {
    conceptStore.setTopConcepts([])
    return
  }

  logger.info('ConceptTree', 'Loading top concepts', {
    scheme: scheme?.uri || 'all',
    language: languageStore.preferred
  })

  conceptStore.setLoadingTree(true)
  error.value = null

  const schemeFilter = scheme
    ? `?concept skos:inScheme <${scheme.uri}> .`
    : ''

  // Query gets all label types and notation - we pick best one in code
  const query = withPrefixes(`
    SELECT DISTINCT ?concept ?label ?labelLang ?labelType ?notation (COUNT(DISTINCT ?narrower) AS ?narrowerCount)
    WHERE {
      ?concept a skos:Concept .
      ${schemeFilter}
      FILTER NOT EXISTS { ?concept skos:broader ?broader }
      OPTIONAL { ?concept skos:notation ?notation }
      OPTIONAL {
        {
          ?concept skos:prefLabel ?label .
          BIND("prefLabel" AS ?labelType)
        } UNION {
          ?concept dct:title ?label .
          BIND("title" AS ?labelType)
        } UNION {
          ?concept rdfs:label ?label .
          BIND("rdfsLabel" AS ?labelType)
        }
        BIND(LANG(?label) AS ?labelLang)
      }
      OPTIONAL { ?narrower skos:broader ?concept }
    }
    GROUP BY ?concept ?label ?labelLang ?labelType ?notation
    ORDER BY ?concept ?label
    LIMIT 2000
  `)

  logger.debug('ConceptTree', 'Top concepts query', { query })

  try {
    const results = await executeSparql(endpoint, query, { retries: 1 })

    // Group by concept URI and pick best label
    const conceptMap = new Map<string, {
      labels: { value: string; lang: string; type: string }[]
      notation?: string
      hasNarrower: boolean
    }>()

    for (const b of results.results.bindings) {
      const uri = b.concept?.value
      if (!uri) continue

      if (!conceptMap.has(uri)) {
        conceptMap.set(uri, {
          labels: [],
          hasNarrower: parseInt(b.narrowerCount?.value || '0', 10) > 0
        })
      }

      const entry = conceptMap.get(uri)!

      // Store notation (first one wins)
      if (b.notation?.value && !entry.notation) {
        entry.notation = b.notation.value
      }

      if (b.label?.value) {
        entry.labels.push({
          value: b.label.value,
          lang: b.labelLang?.value || '',
          type: b.labelType?.value || 'prefLabel'
        })
      }
    }

    // Convert to ConceptNode[] with best label selection
    const concepts: ConceptNode[] = Array.from(conceptMap.entries()).map(([uri, data]) => {
      // Pick best label: prefLabel > title > rdfsLabel, with language priority
      const labelPriority = ['prefLabel', 'title', 'rdfsLabel']
      let bestLabel: string | undefined

      for (const labelType of labelPriority) {
        const labelsOfType = data.labels.filter(l => l.type === labelType)
        if (!labelsOfType.length) continue

        const preferred = labelsOfType.find(l => l.lang === languageStore.preferred)
        const fallback = labelsOfType.find(l => l.lang === languageStore.fallback)
        const noLang = labelsOfType.find(l => l.lang === '')
        const any = labelsOfType[0]

        bestLabel = preferred?.value || fallback?.value || noLang?.value || any?.value
        if (bestLabel) break
      }

      return {
        uri,
        label: bestLabel,
        notation: data.notation,
        hasNarrower: data.hasNarrower,
        expanded: false,
      }
    })

    // Sort by label
    concepts.sort((a, b) => (a.label || a.uri).localeCompare(b.label || b.uri))

    logger.info('ConceptTree', `Loaded ${concepts.length} top concepts`)
    conceptStore.setTopConcepts(concepts)
  } catch (e: unknown) {
    const errMsg = e && typeof e === 'object' && 'message' in e
      ? (e as { message: string }).message
      : 'Unknown error'
    logger.error('ConceptTree', 'Failed to load top concepts', { error: e })
    error.value = `Failed to load concepts: ${errMsg}`
    conceptStore.setTopConcepts([])
  } finally {
    conceptStore.setLoadingTree(false)
  }
}

// Load children for a node
async function loadChildren(uri: string) {
  const endpoint = endpointStore.current
  if (!endpoint) return

  if (loadingChildren.value.has(uri)) return
  loadingChildren.value.add(uri)

  logger.debug('ConceptTree', 'Loading children', { parent: uri })

  const query = withPrefixes(`
    SELECT DISTINCT ?concept ?label ?labelLang ?labelType ?notation (COUNT(DISTINCT ?narrower) AS ?narrowerCount)
    WHERE {
      ?concept skos:broader <${uri}> .
      OPTIONAL { ?concept skos:notation ?notation }
      OPTIONAL {
        {
          ?concept skos:prefLabel ?label .
          BIND("prefLabel" AS ?labelType)
        } UNION {
          ?concept dct:title ?label .
          BIND("title" AS ?labelType)
        } UNION {
          ?concept rdfs:label ?label .
          BIND("rdfsLabel" AS ?labelType)
        }
        BIND(LANG(?label) AS ?labelLang)
      }
      OPTIONAL { ?narrower skos:broader ?concept }
    }
    GROUP BY ?concept ?label ?labelLang ?labelType ?notation
    ORDER BY ?concept ?label
    LIMIT 1000
  `)

  try {
    const results = await executeSparql(endpoint, query, { retries: 1 })

    // Group by concept URI and pick best label
    const conceptMap = new Map<string, {
      labels: { value: string; lang: string; type: string }[]
      notation?: string
      hasNarrower: boolean
    }>()

    for (const b of results.results.bindings) {
      const conceptUri = b.concept?.value
      if (!conceptUri) continue

      if (!conceptMap.has(conceptUri)) {
        conceptMap.set(conceptUri, {
          labels: [],
          hasNarrower: parseInt(b.narrowerCount?.value || '0', 10) > 0
        })
      }

      const entry = conceptMap.get(conceptUri)!

      // Store notation (first one wins)
      if (b.notation?.value && !entry.notation) {
        entry.notation = b.notation.value
      }

      if (b.label?.value) {
        entry.labels.push({
          value: b.label.value,
          lang: b.labelLang?.value || '',
          type: b.labelType?.value || 'prefLabel'
        })
      }
    }

    // Convert to ConceptNode[] with best label selection
    const children: ConceptNode[] = Array.from(conceptMap.entries()).map(([conceptUri, data]) => {
      // Pick best label: prefLabel > title > rdfsLabel, with language priority
      const labelPriority = ['prefLabel', 'title', 'rdfsLabel']
      let bestLabel: string | undefined

      for (const labelType of labelPriority) {
        const labelsOfType = data.labels.filter(l => l.type === labelType)
        if (!labelsOfType.length) continue

        const preferred = labelsOfType.find(l => l.lang === languageStore.preferred)
        const fallback = labelsOfType.find(l => l.lang === languageStore.fallback)
        const noLang = labelsOfType.find(l => l.lang === '')
        const any = labelsOfType[0]

        bestLabel = preferred?.value || fallback?.value || noLang?.value || any?.value
        if (bestLabel) break
      }

      return {
        uri: conceptUri,
        label: bestLabel,
        notation: data.notation,
        hasNarrower: data.hasNarrower,
        expanded: false,
      }
    })

    // Sort by label
    children.sort((a, b) => (a.label || a.uri).localeCompare(b.label || b.uri))

    logger.debug('ConceptTree', `Loaded ${children.length} children for ${uri}`)
    conceptStore.updateNodeChildren(uri, children)
  } catch (e) {
    logger.error('ConceptTree', 'Failed to load children', { parent: uri, error: e })
  } finally {
    loadingChildren.value.delete(uri)
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
function selectConcept(uri: string) {
  conceptStore.selectConcept(uri)

  // Find label for history
  const node = findNode(uri, conceptStore.topConcepts)
  if (node) {
    conceptStore.addToHistory({ uri, label: node.label || uri })
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
  const uri = gotoUri.value.trim()
  if (uri) {
    selectConcept(uri)
    gotoUri.value = ''
  }
}

// Watch for scheme/endpoint changes
// Use selected?.uri (not selectedUri) so we react when schemes finish loading
watch(
  () => [schemeStore.selected?.uri, endpointStore.current?.id] as const,
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
      loadTopConcepts()
    }
  }
)
</script>

<template>
  <div class="concept-tree">
    <!-- Go to URI input -->
    <div class="goto-uri">
      <span class="p-input-icon-left">
        <i class="pi pi-link"></i>
        <InputText
          v-model="gotoUri"
          placeholder="Go to URI..."
          class="goto-input"
          @keyup.enter="goToUri"
        />
      </span>
      <Button
        icon="pi pi-arrow-right"
        severity="secondary"
        text
        :disabled="!gotoUri.trim()"
        @click="goToUri"
      />
    </div>

    <!-- Error message -->
    <Message v-if="error" severity="error" :closable="true" @close="error = null">
      {{ error }}
    </Message>

    <!-- Loading state (delayed to prevent flicker) -->
    <div v-if="showTreeLoading" class="loading-container">
      <ProgressSpinner style="width: 40px; height: 40px" />
      <span>Loading concepts...</span>
    </div>

    <!-- Empty state -->
    <div v-else-if="!conceptStore.loadingTree && !conceptStore.topConcepts.length && !error" class="empty-state">
      <i class="pi pi-folder-open"></i>
      <p>No concepts found</p>
      <small v-if="!schemeStore.selected">Select a concept scheme to browse</small>
      <small v-else>This scheme has no top-level concepts</small>
    </div>

    <!-- Tree -->
    <Tree
      v-else
      v-model:selectionKeys="selectedKey"
      v-model:expandedKeys="expandedKeys"
      :value="treeNodes"
      selectionMode="single"
      class="concept-tree-component"
      @node-expand="onNodeExpand"
      @node-collapse="onNodeCollapse"
    >
      <template #default="slotProps">
        <div class="tree-node">
          <span class="node-label">{{ slotProps.node.label }}</span>
          <ProgressSpinner
            v-if="loadingChildren.has(slotProps.node.key)"
            style="width: 16px; height: 16px"
          />
        </div>
      </template>
    </Tree>
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
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem;
  border-bottom: 1px solid var(--p-surface-200);
}

.goto-input {
  width: 100%;
  font-size: 0.875rem;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 2rem;
  color: var(--p-text-muted-color);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem;
  text-align: center;
  color: var(--p-text-muted-color);
}

.empty-state i {
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

.concept-tree-component {
  flex: 1;
  overflow: auto;
  padding: 0.5rem;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.node-label {
  flex: 1;
}

:deep(.p-tree-node-content) {
  padding: 0.25rem 0.5rem;
}

:deep(.p-tree-node-content:hover) {
  background: var(--p-surface-100);
}

:deep(.p-tree-node-content.p-highlight) {
  background: var(--p-primary-100);
  color: var(--p-primary-700);
}
</style>
