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
import { ref, watch, computed, nextTick } from 'vue'
import { useConceptStore, useEndpointStore, useSchemeStore, useLanguageStore } from '../../stores'
import { executeSparql, withPrefixes, logger } from '../../services'
import { useDelayedLoading, useLabelResolver, useElapsedTime, useDeprecation } from '../../composables'
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
const { shouldShowLangTag, selectLabel } = useLabelResolver()
const { getDeprecationSparqlClauses, getDeprecationSelectVars, isDeprecatedFromBinding, showIndicator: showDeprecationIndicator } = useDeprecation()

/**
 * Pick the best notation from a list.
 * Prefers the smallest numeric notation for consistent sorting.
 */
function pickBestNotation(notations: string[]): string | undefined {
  if (!notations.length) return undefined
  if (notations.length === 1) return notations[0]

  // Find all numeric notations and pick the smallest
  const numericNotations = notations
    .map(n => ({ value: n, num: parseFloat(n) }))
    .filter(n => !isNaN(n.num))
    .sort((a, b) => a.num - b.num)

  if (numericNotations.length > 0 && numericNotations[0]) {
    return numericNotations[0].value
  }

  // No numeric notations, return first alphabetically
  const sorted = notations.sort()
  return sorted[0]
}

/**
 * Compare tree nodes for sorting.
 * Priority: notation (numeric if possible) > label (alphabetical)
 */
function compareNodes(a: ConceptNode, b: ConceptNode): number {
  const aNotation = a.notation
  const bNotation = b.notation

  // If both have notation, try numeric sort
  if (aNotation && bNotation) {
    const aNum = parseFloat(aNotation)
    const bNum = parseFloat(bNotation)

    // Both are valid numbers → numeric sort
    if (!isNaN(aNum) && !isNaN(bNum)) {
      return aNum - bNum
    }

    // Otherwise → string comparison on notation
    return aNotation.localeCompare(bNotation)
  }

  // One has notation, one doesn't → notation first
  if (aNotation) return -1
  if (bNotation) return 1

  // Neither has notation → sort by label
  return (a.label || a.uri).localeCompare(b.label || b.uri)
}

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
          schemeStore.viewScheme(uri)
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
  } else {
    loadingMoreTopConcepts.value = true
  }
  error.value = null

  // Query gets all label types (including SKOS-XL) and notation - we pick best one in code
  // Top concepts are found via: topConceptOf, hasTopConcept (inverse), or no broader (fallback)
  // Use subquery to paginate by DISTINCT concepts, not by label rows
  const deprecationSelectVars = getDeprecationSelectVars()
  const deprecationClauses = getDeprecationSparqlClauses('?concept')

  const query = withPrefixes(`
    SELECT ?concept ?label ?labelLang ?labelType ?notation ?narrowerCount ${deprecationSelectVars}
    WHERE {
      {
        # Subquery to get paginated distinct concepts with narrower count
        SELECT DISTINCT ?concept (COUNT(DISTINCT ?narrower) AS ?narrowerCount) ${deprecationSelectVars}
        WHERE {
          {
            # Explicit top concept via topConceptOf or hasTopConcept
            ?concept a skos:Concept .
            ?concept skos:inScheme <${scheme.uri}> .
            { ?concept skos:topConceptOf <${scheme.uri}> }
            UNION
            { <${scheme.uri}> skos:hasTopConcept ?concept }
          }
          UNION
          {
            # Fallback: concepts with no broader relationship (neither direction)
            ?concept a skos:Concept .
            ?concept skos:inScheme <${scheme.uri}> .
            FILTER NOT EXISTS { ?concept skos:broader ?broader }
            FILTER NOT EXISTS { ?parent skos:narrower ?concept }
          }
          OPTIONAL {
            { ?narrower skos:broader ?concept }
            UNION
            { ?concept skos:narrower ?narrower }
          }
          ${deprecationClauses}
        }
        GROUP BY ?concept ${deprecationSelectVars}
        ORDER BY ?concept
        LIMIT ${PAGE_SIZE + 1}
        OFFSET ${offset}
      }
      # Get labels and notations for the paginated concepts
      OPTIONAL { ?concept skos:notation ?notation }
      OPTIONAL {
        {
          ?concept skos:prefLabel ?label .
          BIND("prefLabel" AS ?labelType)
        } UNION {
          ?concept skosxl:prefLabel/skosxl:literalForm ?label .
          BIND("xlPrefLabel" AS ?labelType)
        } UNION {
          ?concept dct:title ?label .
          BIND("title" AS ?labelType)
        } UNION {
          ?concept rdfs:label ?label .
          BIND("rdfsLabel" AS ?labelType)
        }
        BIND(LANG(?label) AS ?labelLang)
      }
    }
  `)

  logger.debug('ConceptTree', 'Top concepts query', { query })

  try {
    const results = await executeSparql(endpoint, query, { retries: 1 })

    // Group by concept URI and pick best label
    const conceptMap = new Map<string, {
      labels: { value: string; lang: string; type: string }[]
      notations: string[]
      hasNarrower: boolean
      deprecated: boolean
    }>()

    for (const b of results.results.bindings) {
      const uri = b.concept?.value
      if (!uri) continue

      if (!conceptMap.has(uri)) {
        conceptMap.set(uri, {
          labels: [],
          notations: [],
          hasNarrower: parseInt(b.narrowerCount?.value || '0', 10) > 0,
          deprecated: isDeprecatedFromBinding(b),
        })
      }

      const entry = conceptMap.get(uri)!

      // Collect all notations (we'll pick the best one later)
      if (b.notation?.value && !entry.notations.includes(b.notation.value)) {
        entry.notations.push(b.notation.value)
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
      // Pick best label: prefLabel > xlPrefLabel > title > rdfsLabel, with language priority
      const labelPriority = ['prefLabel', 'xlPrefLabel', 'title', 'rdfsLabel']
      let bestLabel: string | undefined
      let bestLabelLang: string | undefined

      for (const labelType of labelPriority) {
        const labelsOfType = data.labels.filter(l => l.type === labelType)
        if (!labelsOfType.length) continue

        const selected = selectLabel(labelsOfType)
        if (selected) {
          bestLabel = selected.value
          bestLabelLang = selected.lang || undefined
          break
        }
      }

      return {
        uri,
        label: bestLabel,
        lang: bestLabelLang,
        notation: pickBestNotation(data.notations),
        hasNarrower: data.hasNarrower,
        expanded: false,
        deprecated: data.deprecated,
      }
    })

    // Sort by notation (numeric if possible) then label
    concepts.sort(compareNodes)

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

  // Use subquery to paginate by DISTINCT concepts, not by label rows
  const deprecationSelectVarsChild = getDeprecationSelectVars()
  const deprecationClausesChild = getDeprecationSparqlClauses('?concept')

  const query = withPrefixes(`
    SELECT ?concept ?label ?labelLang ?labelType ?notation ?narrowerCount ${deprecationSelectVarsChild}
    WHERE {
      {
        # Subquery to get paginated distinct children with narrower count
        SELECT DISTINCT ?concept (COUNT(DISTINCT ?narrower) AS ?narrowerCount) ${deprecationSelectVarsChild}
        WHERE {
          # Find children via broader or narrower (inverse)
          { ?concept skos:broader <${uri}> }
          UNION
          { <${uri}> skos:narrower ?concept }
          OPTIONAL {
            { ?narrower skos:broader ?concept }
            UNION
            { ?concept skos:narrower ?narrower }
          }
          ${deprecationClausesChild}
        }
        GROUP BY ?concept ${deprecationSelectVarsChild}
        ORDER BY ?concept
        LIMIT ${PAGE_SIZE + 1}
        OFFSET ${offset}
      }
      # Get labels and notations for the paginated concepts
      OPTIONAL { ?concept skos:notation ?notation }
      OPTIONAL {
        {
          ?concept skos:prefLabel ?label .
          BIND("prefLabel" AS ?labelType)
        } UNION {
          ?concept skosxl:prefLabel/skosxl:literalForm ?label .
          BIND("xlPrefLabel" AS ?labelType)
        } UNION {
          ?concept dct:title ?label .
          BIND("title" AS ?labelType)
        } UNION {
          ?concept rdfs:label ?label .
          BIND("rdfsLabel" AS ?labelType)
        }
        BIND(LANG(?label) AS ?labelLang)
      }
    }
  `)

  try {
    const results = await executeSparql(endpoint, query, { retries: 1 })

    // Group by concept URI and pick best label
    const conceptMapChild = new Map<string, {
      labels: { value: string; lang: string; type: string }[]
      notations: string[]
      hasNarrower: boolean
      deprecated: boolean
    }>()

    for (const b of results.results.bindings) {
      const conceptUri = b.concept?.value
      if (!conceptUri) continue

      if (!conceptMapChild.has(conceptUri)) {
        conceptMapChild.set(conceptUri, {
          labels: [],
          notations: [],
          hasNarrower: parseInt(b.narrowerCount?.value || '0', 10) > 0,
          deprecated: isDeprecatedFromBinding(b),
        })
      }

      const entry = conceptMapChild.get(conceptUri)!

      // Collect all notations (we'll pick the best one later)
      if (b.notation?.value && !entry.notations.includes(b.notation.value)) {
        entry.notations.push(b.notation.value)
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
    const children: ConceptNode[] = Array.from(conceptMapChild.entries()).map(([conceptUri, data]) => {
      // Pick best label: prefLabel > xlPrefLabel > title > rdfsLabel, with language priority
      const labelPriority = ['prefLabel', 'xlPrefLabel', 'title', 'rdfsLabel']
      let bestLabel: string | undefined
      let bestLabelLang: string | undefined

      for (const labelType of labelPriority) {
        const labelsOfType = data.labels.filter(l => l.type === labelType)
        if (!labelsOfType.length) continue

        const selected = selectLabel(labelsOfType)
        if (selected) {
          bestLabel = selected.value
          bestLabelLang = selected.lang || undefined
          break
        }
      }

      return {
        uri: conceptUri,
        label: bestLabel,
        lang: bestLabelLang,
        notation: pickBestNotation(data.notations),
        hasNarrower: data.hasNarrower,
        expanded: false,
        deprecated: data.deprecated,
      }
    })

    // Sort by notation (numeric if possible) then label
    children.sort(compareNodes)

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
function selectConcept(uri: string) {
  schemeStore.viewScheme(null) // Clear scheme viewing when selecting a concept
  conceptStore.selectConcept(uri)

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
  const uri = gotoUri.value.trim()
  if (uri) {
    selectConcept(uri)
    gotoUri.value = ''
  }
}

// Fetch ancestor path for a concept (from root to parent)
async function fetchAncestorPath(uri: string): Promise<{ uri: string; label?: string; notation?: string }[]> {
  const endpoint = endpointStore.current
  if (!endpoint) return []

  logger.debug('ConceptTree', 'Fetching ancestor path', { concept: uri })

  // Query all ancestors with their depth (distance from concept)
  const query = withPrefixes(`
    SELECT DISTINCT ?ancestor ?label ?notation ?depth
    WHERE {
      <${uri}> skos:broader+ ?ancestor .
      {
        SELECT ?ancestor (COUNT(?mid) AS ?depth)
        WHERE {
          <${uri}> skos:broader+ ?mid .
          ?mid skos:broader* ?ancestor .
          ?ancestor skos:broader* ?root .
          FILTER NOT EXISTS { ?root skos:broader ?parent }
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
  // Find the tree node element by its key
  const treeWrapper = document.querySelector('.tree-wrapper')
  if (!treeWrapper) return

  // PrimeVue Tree uses data-p-key attribute for node identification
  const nodeElement = treeWrapper.querySelector(`[data-pc-section="nodechildren"] [data-p-key="${CSS.escape(uri)}"]`) ||
                      treeWrapper.querySelector(`[data-pc-section="nodetogglebutton"]`)?.closest(`[data-p-key="${CSS.escape(uri)}"]`)

  // Alternative: find by checking the node content
  if (!nodeElement) {
    // Try to find by traversing the tree
    const allNodes = treeWrapper.querySelectorAll('.p-tree-node')
    for (const node of allNodes) {
      const nodeContent = node as HTMLElement
      // Check if this node's key matches (stored in data attribute or component data)
      if (nodeContent.getAttribute('data-p-key') === uri) {
        nodeContent.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
    }
  }

  if (nodeElement) {
    (nodeElement as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
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

// Reveal concept in tree when selected from history/search/URL
// (only if not already visible in the tree)
async function tryRevealSelectedConcept() {
  const uri = conceptStore.selectedUri
  if (!uri || conceptStore.loadingTree) return

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
}

// Watch for concept selection changes
watch(
  () => conceptStore.selectedUri,
  () => tryRevealSelectedConcept()
)

// Also trigger reveal when tree finishes loading (handles race condition with history nav)
watch(
  () => conceptStore.loadingTree,
  (loading, wasLoading) => {
    // When loading finishes, try to reveal the selected concept
    if (wasLoading && !loading && conceptStore.selectedUri) {
      tryRevealSelectedConcept()
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
              <span v-if="slotProps.node.data?.deprecated && showDeprecationIndicator && !slotProps.node.data?.isScheme" class="deprecated-badge">deprecated</span>
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

.deprecated-badge {
  font-size: 0.625rem;
  font-weight: 600;
  background: color-mix(in srgb, var(--ae-status-warning) 20%, transparent);
  color: var(--ae-status-warning);
  padding: 0.05rem 0.3rem;
  border-radius: 3px;
  margin-left: 0.25rem;
  flex-shrink: 0;
  text-transform: lowercase;
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
