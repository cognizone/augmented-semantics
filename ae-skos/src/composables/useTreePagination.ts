/**
 * useTreePagination - Tree pagination and lazy loading composable
 *
 * Handles pagination for top concepts and children nodes,
 * including duplicate request prevention and offset tracking.
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */

import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useConceptStore, useEndpointStore, useSchemeStore, useLanguageStore, useSettingsStore, ORPHAN_SCHEME_URI } from '../stores'
import { executeSparql, logger, eventBus, withPrefixes } from '../services'
import { useConceptTreeQueries, useLabelResolver } from './index'
import { calculateOrphanConcepts, calculateOrphanConceptsFast, calculateOrphanCollections } from './useOrphanConcepts'
import { createInitialProgress } from './useOrphanProgress'
import { buildCapabilityAwareLabelUnionClause, CONCEPT_LABEL_PRIORITY } from '../constants'
import { useDeprecation } from './useDeprecation'
import { pickBestNotation, compareNodes } from '../utils/concept-tree'
import type { ConceptNode, SPARQLEndpoint } from '../types'

// Pagination config
const PAGE_SIZE = 200

export function useTreePagination() {
  const conceptStore = useConceptStore()
  const endpointStore = useEndpointStore()
  const schemeStore = useSchemeStore()
  const languageStore = useLanguageStore()
  const settingsStore = useSettingsStore()
  const { isDeprecatedFromBinding } = useDeprecation()
  const { selectLabelByPriority } = useLabelResolver()
  const {
    buildExplicitTopConceptsMetadataQuery,
    buildInSchemeOnlyTopConceptsMetadataQuery,
    buildTopConceptsMetadataQuery,
    buildChildrenMetadataQuery,
  } = useConceptTreeQueries()

  const compareNodesWithSettings = (a: ConceptNode, b: ConceptNode) =>
    compareNodes(a, b, { useNotation: settingsStore.showNotationInLabels })

  // Pagination state for top concepts
  const topConceptsOffset = ref(0)
  const hasMoreTopConcepts = ref(true)
  const loadingMoreTopConcepts = ref(false)
  // Track query mode for pagination: 'explicit' | 'inscheme' | 'mixed'
  // - explicit: only explicit query returned results
  // - inscheme: explicit was empty/unavailable, using in-scheme-only only
  // - mixed: both explicit and in-scheme-only contributed unique concepts
  const queryMode = ref<'explicit' | 'inscheme' | 'mixed'>('explicit')

  // Pagination state for children (keyed by parent URI)
  const childrenPagination = ref<Map<string, { offset: number; hasMore: boolean; loading: boolean }>>(new Map())

  // Track loading children to prevent duplicate requests
  const loadingChildren = ref<Set<string>>(new Set())

  // Error state
  const error = ref<string | null>(null)

  // Orphan concepts cache
  const orphanConceptUris = ref<string[]>([])

  // Orphan collections cache
  const orphanCollectionUris = ref<string[]>([])

  // Orphan progress state (shared via store)
  const { orphanProgress } = storeToRefs(conceptStore)

  /**
   * Find a node by URI in the concept tree
   */
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

  /**
   * Helper to process query results and handle pagination
   */
  function processTopConceptsResults(
    concepts: ConceptNode[],
    offset: number,
    isFirstPage: boolean
  ) {
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

    return concepts
  }

  /**
   * Process metadata bindings into ConceptNode[] (no labels).
   * Groups by concept URI, aggregates notations, and parses hasNarrower/deprecated flags.
   */
  function processMetadataBindings(
    bindings: Array<Record<string, { value: string; type: string }>>
  ): ConceptNode[] {
    const conceptMap = new Map<string, {
      notations: string[]
      hasNarrower: boolean
      deprecated: boolean
    }>()

    for (const b of bindings) {
      const uri = b.concept?.value
      if (!uri) continue

      if (!conceptMap.has(uri)) {
        conceptMap.set(uri, {
          notations: [],
          hasNarrower: false,
          deprecated: isDeprecatedFromBinding(b),
        })
      }

      const entry = conceptMap.get(uri)!

      if (b.notation?.value && !entry.notations.includes(b.notation.value)) {
        entry.notations.push(b.notation.value)
      }

      const hasNarrowerVal = b.hasNarrower?.value
      if (hasNarrowerVal === 'true' || hasNarrowerVal === '1') {
        entry.hasNarrower = true
      }

      if (!entry.deprecated) {
        entry.deprecated = isDeprecatedFromBinding(b)
      }
    }

    return Array.from(conceptMap.entries()).map(([uri, data]) => ({
      uri,
      label: undefined,
      lang: undefined,
      notation: pickBestNotation(data.notations),
      hasNarrower: data.hasNarrower,
      expanded: false,
      deprecated: data.deprecated,
    }))
  }

  /**
   * Process bindings that already include labels.
   * Uses centralized label priority and language selection.
   */
  function processLabelBindings(
    bindings: Array<Record<string, { value: string; type: string; 'xml:lang'?: string }>>
  ): ConceptNode[] {
    const conceptMap = new Map<string, {
      labels: { value: string; lang: string; type: string }[]
      notations: string[]
      hasNarrower: boolean
      deprecated: boolean
    }>()

    for (const b of bindings) {
      const uri = b.concept?.value
      if (!uri) continue

      if (!conceptMap.has(uri)) {
        conceptMap.set(uri, {
          labels: [],
          notations: [],
          hasNarrower: false,
          deprecated: isDeprecatedFromBinding(b),
        })
      }

      const entry = conceptMap.get(uri)!

      if (b.notation?.value && !entry.notations.includes(b.notation.value)) {
        entry.notations.push(b.notation.value)
      }

      const hasNarrowerVal = b.hasNarrower?.value
      if (hasNarrowerVal === 'true' || hasNarrowerVal === '1') {
        entry.hasNarrower = true
      }

      if (!entry.deprecated) {
        entry.deprecated = isDeprecatedFromBinding(b)
      }

      if (b.label?.value) {
        entry.labels.push({
          value: b.label.value,
          lang: b.labelLang?.value || b.label?.['xml:lang'] || '',
          type: b.labelType?.value || 'prefLabel',
        })
      }
    }

    const nodes: ConceptNode[] = []

    for (const [uri, data] of conceptMap.entries()) {
      const selected = selectLabelByPriority(data.labels, CONCEPT_LABEL_PRIORITY)
      nodes.push({
        uri,
        label: selected?.value,
        lang: selected?.lang || undefined,
        notation: pickBestNotation(data.notations),
        hasNarrower: data.hasNarrower,
        expanded: false,
        deprecated: data.deprecated,
      })
    }

    nodes.sort(compareNodesWithSettings)
    return nodes
  }

  /**
   * Load labels for the given nodes and apply language/priority selection.
   */
  async function loadLabelsForNodes(nodes: ConceptNode[]): Promise<void> {
    const endpoint = endpointStore.current
    if (!endpoint || nodes.length === 0) return

    const capabilities = endpoint.analysis?.labelPredicates?.concept
    const valuesClause = nodes.map(n => `<${n.uri}>`).join(' ')
    const labelClause = buildCapabilityAwareLabelUnionClause('?concept', capabilities)

    const query = withPrefixes(`
      SELECT ?concept ?label ?labelLang ?labelType
      WHERE {
        VALUES ?concept { ${valuesClause} }
        OPTIONAL {
          ${labelClause}
        }
      }
    `)

    try {
      const results = await executeSparql(endpoint, query, { retries: 0 })
      const labelsByUri = new Map<string, { value: string; lang: string; type: string }[]>()

      for (const b of results.results.bindings) {
        const uri = b.concept?.value
        const labelValue = b.label?.value
        if (!uri || !labelValue) continue

        if (!labelsByUri.has(uri)) {
          labelsByUri.set(uri, [])
        }

        labelsByUri.get(uri)!.push({
          value: labelValue,
          lang: b.labelLang?.value || b.label?.['xml:lang'] || '',
          type: b.labelType?.value || 'prefLabel',
        })
      }

      for (const node of nodes) {
        const labels = labelsByUri.get(node.uri) || []
        const selected = selectLabelByPriority(labels, CONCEPT_LABEL_PRIORITY)
        if (selected) {
          node.label = selected.value
          node.lang = selected.lang || undefined
        }
      }
    } catch (e) {
      logger.warn('ConceptTree', 'Failed to load labels for nodes', { error: e })
    }
  }

  /**
   * Load top concepts for selected scheme.
   * Uses sequential merge: runs explicit query first (fast), displays results,
   * then runs in-scheme-only query and appends any new concepts not already shown.
   */
  async function loadTopConcepts(offset = 0) {
    const endpoint = endpointStore.current
    const scheme = schemeStore.selected
    if (!endpoint) return

    // No scheme selected
    if (!scheme) {
      conceptStore.setTopConcepts([])
      return
    }

    // Handle orphan scheme
    if (scheme.uri === ORPHAN_SCHEME_URI) {
      await loadOrphanConcepts(offset)
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
      queryMode.value = 'explicit'  // Reset query mode tracking
      await eventBus.emit('tree:loading', undefined)
    } else {
      loadingMoreTopConcepts.value = true
    }
    error.value = null

    try {
      // For pagination, use appropriate metadata query based on first page mode
      if (!isFirstPage) {
        let query: string
        if (queryMode.value === 'mixed') {
          // Mixed mode: use combined query for consistent pagination
          query = buildTopConceptsMetadataQuery(scheme.uri, PAGE_SIZE, offset)
          logger.debug('ConceptTree', 'Top concepts combined metadata query (mixed pagination)', { query })
        } else if (queryMode.value === 'inscheme') {
          query = buildInSchemeOnlyTopConceptsMetadataQuery(scheme.uri, PAGE_SIZE, offset)
          logger.debug('ConceptTree', 'Top concepts in-scheme-only metadata query (pagination)', { query })
        } else {
          // explicit mode
          const explicitQuery = buildExplicitTopConceptsMetadataQuery(scheme.uri, PAGE_SIZE, offset)
          if (!explicitQuery) {
            // Shouldn't happen, but fallback just in case
            query = buildInSchemeOnlyTopConceptsMetadataQuery(scheme.uri, PAGE_SIZE, offset)
          } else {
            query = explicitQuery
          }
          logger.debug('ConceptTree', 'Top concepts explicit metadata query (pagination)', { query })
        }
        const results = await executeSparql(endpoint, query, { retries: 1 })
        const concepts = processMetadataBindings(results.results.bindings)
        await loadLabelsForNodes(concepts)
        concepts.sort(compareNodesWithSettings)
        processTopConceptsResults(concepts, offset, isFirstPage)
        return
      }

      // First page: Sequential merge strategy
      // Step 1: Try explicit top concepts first (fast path)
      const explicitQuery = buildExplicitTopConceptsMetadataQuery(scheme.uri, PAGE_SIZE, offset)
      let explicitConcepts: ConceptNode[] = []

      if (explicitQuery) {
        logger.debug('ConceptTree', 'Running explicit top concepts metadata query (fast path)', { query: explicitQuery })
        const results = await executeSparql(endpoint, explicitQuery, { retries: 1 })
        explicitConcepts = processMetadataBindings(results.results.bindings)
        await loadLabelsForNodes(explicitConcepts)
        explicitConcepts.sort(compareNodesWithSettings)

        if (explicitConcepts.length > 0) {
          // Show explicit results immediately
          logger.info('ConceptTree', `Found ${explicitConcepts.length} explicit top concepts (fast path)`)
          conceptStore.setTopConcepts(explicitConcepts)
          await eventBus.emit('tree:loaded', conceptStore.topConcepts)
        }
      }

      // Step 2: Run in-scheme-only query to find unplaced concepts
      logger.debug('ConceptTree', 'Running in-scheme-only query to check for unplaced concepts')
      const inschemeQuery = buildInSchemeOnlyTopConceptsMetadataQuery(scheme.uri, PAGE_SIZE, offset)
      const inschemeResults = await executeSparql(endpoint, inschemeQuery, { retries: 1 })
      const inschemeConcepts = processMetadataBindings(inschemeResults.results.bindings)
      await loadLabelsForNodes(inschemeConcepts)
      inschemeConcepts.sort(compareNodesWithSettings)

      // Determine query mode and merge results
      const explicitUris = new Set(explicitConcepts.map(c => c.uri))
      const newFromInScheme = inschemeConcepts.filter(c => !explicitUris.has(c.uri))

      if (explicitConcepts.length === 0 && inschemeConcepts.length > 0) {
        // Only in-scheme-only had results
        queryMode.value = 'inscheme'
        logger.info('ConceptTree', `Using in-scheme-only: ${inschemeConcepts.length} concepts`)
        processTopConceptsResults(inschemeConcepts, offset, isFirstPage)
        await eventBus.emit('tree:loaded', conceptStore.topConcepts)
      } else if (newFromInScheme.length > 0) {
        // Mixed: both contributed unique concepts
        queryMode.value = 'mixed'
        logger.info('ConceptTree', `Mixed mode: ${explicitConcepts.length} explicit + ${newFromInScheme.length} in-scheme-only`)
        // Append new concepts from in-scheme-only
        conceptStore.appendTopConcepts(newFromInScheme)
        // Update hasMore based on combined count
        const totalCount = explicitConcepts.length + newFromInScheme.length
        hasMoreTopConcepts.value = totalCount > PAGE_SIZE
        if (hasMoreTopConcepts.value && totalCount > PAGE_SIZE) {
          // Remove extra if we have more than PAGE_SIZE
          // Note: This is approximate - mixed pagination may show some duplicates
        }
      } else if (explicitConcepts.length > 0) {
        // Explicit only (in-scheme-only found nothing new)
        queryMode.value = 'explicit'
        logger.info('ConceptTree', `Using explicit only: ${explicitConcepts.length} concepts`)
        // Already displayed, just update pagination state
        hasMoreTopConcepts.value = explicitConcepts.length > PAGE_SIZE
        if (hasMoreTopConcepts.value) {
          explicitConcepts.pop()
          conceptStore.setTopConcepts(explicitConcepts)
        }
      } else {
        // Both empty
        queryMode.value = 'inscheme'
        logger.info('ConceptTree', 'No top concepts found')
        conceptStore.setTopConcepts([])
        hasMoreTopConcepts.value = false
        await eventBus.emit('tree:loaded', [])
      }

      topConceptsOffset.value = 0
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

  /**
   * Load orphan concepts and collections.
   * Concepts are displayed immediately, collections are prepended once detected.
   *
   * Flow (first page):
   * 1. Calculate orphan concepts → display immediately
   * 2. Calculate orphan collections → prepend to top
   */
  async function loadOrphanConcepts(offset: number = 0) {
    const endpoint = endpointStore.current
    if (!endpoint) return

    const isFirstPage = offset === 0

    // First load: calculate orphans (both concepts and collections)
    if (isFirstPage) {
      conceptStore.setLoadingTree(true)
      await eventBus.emit('tree:loading', undefined)

      // Reset progress state and caches
      orphanProgress.value = createInitialProgress()
      orphanCollectionUris.value = []
      orphanConceptUris.value = []

      const strategy = settingsStore.orphanDetectionStrategy ?? 'auto'
      const usePrefilter = settingsStore.orphanFastPrefilter

      try {
        // Step 1: Calculate orphan concepts
        if (strategy === 'slow') {
          orphanConceptUris.value = await calculateOrphanConcepts(endpoint, (progress) => {
            orphanProgress.value = { ...progress, orphanCollections: 0, collectionsPhase: 'idle' }
          })
          logger.info('TreePagination', `Loaded ${orphanConceptUris.value.length} orphan concepts (slow multi-query)`)
        } else if (strategy === 'fast') {
          orphanConceptUris.value = await calculateOrphanConceptsFast(endpoint, (progress) => {
            orphanProgress.value = { ...progress, orphanCollections: 0, collectionsPhase: 'idle' }
          }, { prefilterDirectLinks: usePrefilter })
          logger.info('TreePagination', `Loaded ${orphanConceptUris.value.length} orphan concepts (fast single-query)`)
        } else {
          // Auto: Try fast first, fallback to slow on error
          try {
            orphanConceptUris.value = await calculateOrphanConceptsFast(endpoint, (progress) => {
              orphanProgress.value = { ...progress, orphanCollections: 0, collectionsPhase: 'idle' }
            }, { prefilterDirectLinks: usePrefilter })
            logger.info('TreePagination', `Fast orphan detection succeeded: ${orphanConceptUris.value.length} orphan concepts`)
          } catch (fastError) {
            logger.warn('TreePagination', 'Fast orphan detection failed, falling back to multi-query', { error: fastError })
            orphanConceptUris.value = await calculateOrphanConcepts(endpoint, (progress) => {
              orphanProgress.value = { ...progress, orphanCollections: 0, collectionsPhase: 'idle' }
            })
            logger.info('TreePagination', `Slow orphan detection succeeded: ${orphanConceptUris.value.length} orphan concepts`)
          }
        }

        // Step 1b: Display concepts immediately (fast)
        const conceptPageUris = orphanConceptUris.value.slice(0, PAGE_SIZE)
        const conceptNodes = await fetchOrphanConceptNodes(endpoint, conceptPageUris)
        conceptStore.setTopConcepts(conceptNodes)
        await eventBus.emit('tree:loaded', conceptNodes)
        topConceptsOffset.value = conceptPageUris.length
        hasMoreTopConcepts.value = conceptPageUris.length < orphanConceptUris.value.length
        conceptStore.setLoadingTree(false)
        loadingMoreTopConcepts.value = false

        // Step 2: Calculate orphan collections (after concepts are shown)
        orphanProgress.value = {
          ...orphanProgress.value,
          phase: 'detecting-collections',
          collectionsPhase: 'running',
        }

        orphanCollectionUris.value = await calculateOrphanCollections(endpoint, (phase, found) => {
          orphanProgress.value = {
            ...orphanProgress.value,
            orphanCollections: found,
            collectionsPhase: phase === 'complete' ? 'complete' : 'running',
          }
        })

        logger.info('TreePagination', `Loaded ${orphanCollectionUris.value.length} orphan collections`)

        // Update progress to complete
        orphanProgress.value = {
          ...orphanProgress.value,
          phase: 'complete',
          collectionsPhase: 'complete',
          orphanCollections: orphanCollectionUris.value.length,
        }

        const collectionNodes = await fetchOrphanCollectionNodes(endpoint, orphanCollectionUris.value)
        if (collectionNodes.length > 0) {
          const loadedConceptCount = conceptStore.topConcepts.filter(node => node.type !== 'collection').length
          conceptStore.setTopConcepts([...collectionNodes, ...conceptStore.topConcepts])
          topConceptsOffset.value = orphanCollectionUris.value.length + loadedConceptCount
        }

        const loadedConceptCount = conceptStore.topConcepts.filter(node => node.type !== 'collection').length
        hasMoreTopConcepts.value = loadedConceptCount < orphanConceptUris.value.length
        return
      } catch (e) {
        logger.error('TreePagination', 'Failed to calculate orphans', { error: e })
        conceptStore.setLoadingTree(false)
        loadingMoreTopConcepts.value = false
        return
      }
    } else {
      loadingMoreTopConcepts.value = true
    }

    // Paginate through orphan URIs (collections first, then concepts)
    // Build a combined list for pagination purposes
    const combinedOrphanUris = [...orphanCollectionUris.value, ...orphanConceptUris.value]

    const start = offset
    const end = Math.min(offset + PAGE_SIZE, combinedOrphanUris.length)
    const pageUris = combinedOrphanUris.slice(start, end)

    if (pageUris.length === 0) {
      conceptStore.setLoadingTree(false)
      loadingMoreTopConcepts.value = false
      return
    }

    // Split the page URIs into collections and concepts
    const collectionUrisSet = new Set(orphanCollectionUris.value)
    const pageCollectionUris = pageUris.filter(uri => collectionUrisSet.has(uri))
    const pageConceptUris = pageUris.filter(uri => !collectionUrisSet.has(uri))

    const results: ConceptNode[] = []

    if (pageCollectionUris.length > 0) {
      const collections = await fetchOrphanCollectionNodes(endpoint, pageCollectionUris)
      results.push(...collections)
    }

    if (pageConceptUris.length > 0) {
      const concepts = await fetchOrphanConceptNodes(endpoint, pageConceptUris)
      results.push(...concepts)
    }

    if (isFirstPage) {
      conceptStore.setTopConcepts(results)
      await eventBus.emit('tree:loaded', results)
    } else {
      conceptStore.appendTopConcepts(results)
    }

    topConceptsOffset.value = end
    hasMoreTopConcepts.value = end < combinedOrphanUris.length

    conceptStore.setLoadingTree(false)
    loadingMoreTopConcepts.value = false
  }

  /**
   * Process collection bindings from SPARQL results into ConceptNode format
   * (Collections are displayed as nodes with type: 'collection')
   */
  function processCollectionBindings(bindings: Array<Record<string, { value: string; type: string; 'xml:lang'?: string }>>): ConceptNode[] {
    // Group by collection URI to handle multiple label rows
    const collectionMap = new Map<string, {
      uri: string
      labels: { value: string; lang: string; type: string }[]
      notation?: string
      hasNarrower: boolean
    }>()

    for (const binding of bindings) {
      const uri = binding.collection?.value
      if (!uri) continue

      if (!collectionMap.has(uri)) {
        collectionMap.set(uri, {
          uri,
          labels: [],
          notation: binding.notation?.value,
          hasNarrower: binding.hasChildCollections?.value === 'true',
        })
      }

      const entry = collectionMap.get(uri)!

      if (!entry.notation && binding.notation?.value) {
        entry.notation = binding.notation.value
      }

      if (binding.label?.value) {
        entry.labels.push({
          value: binding.label.value,
          lang: binding.labelLang?.value || binding.label?.['xml:lang'] || '',
          type: binding.labelType?.value || 'prefLabel',
        })
      }
    }

    return Array.from(collectionMap.values()).map(entry => {
      const selected = selectLabelByPriority(entry.labels)
      return {
        uri: entry.uri,
        label: selected?.value,
        lang: selected?.lang || undefined,
        notation: entry.notation,
        hasNarrower: entry.hasNarrower,
        type: 'collection',
        expanded: false,
      }
    })
  }

  async function fetchOrphanCollectionNodes(endpoint: SPARQLEndpoint, collectionUris: string[]): Promise<ConceptNode[]> {
    if (collectionUris.length === 0) return []

    const collectionCapabilities = endpoint.analysis?.labelPredicates?.collection
    const collectionLabelClause = buildCapabilityAwareLabelUnionClause('?collection', collectionCapabilities)

    const collectionValuesClause = collectionUris.map(uri => `<${uri}>`).join(' ')
    const collectionQuery = withPrefixes(`
      SELECT ?collection ?label ?labelLang ?labelType ?notation ?hasChildCollections
      WHERE {
        VALUES ?collection { ${collectionValuesClause} }

        # Check if has child collections
        BIND(EXISTS {
          ?collection skos:member ?childCol .
          ?childCol a skos:Collection .
        } AS ?hasChildCollections)

        # Label resolution (capability-aware)
        OPTIONAL { ?collection skos:notation ?notation }
        OPTIONAL {
          ${collectionLabelClause}
        }
      }
    `)

    try {
      const collectionResults = await executeSparql(endpoint, collectionQuery)
      return processCollectionBindings(collectionResults.results.bindings)
    } catch (e) {
      logger.error('TreePagination', 'Failed to load orphan collection labels', { error: e })
      return []
    }
  }

  async function fetchOrphanConceptNodes(endpoint: SPARQLEndpoint, conceptUris: string[]): Promise<ConceptNode[]> {
    if (conceptUris.length === 0) return []

    const conceptCapabilities = endpoint.analysis?.labelPredicates?.concept
    const conceptLabelClause = buildCapabilityAwareLabelUnionClause('?concept', conceptCapabilities)

    const conceptValuesClause = conceptUris.map(uri => `<${uri}>`).join(' ')
    const conceptQuery = withPrefixes(`
      SELECT ?concept ?label ?labelLang ?labelType ?notation ?hasNarrower
      WHERE {
        VALUES ?concept { ${conceptValuesClause} }

        # Check if concept has children (EXISTS is fast - stops at first match)
        BIND(EXISTS {
          { [] skos:broader ?concept }
          UNION
          { ?concept skos:narrower [] }
        } AS ?hasNarrower)

        # Label resolution (capability-aware)
        OPTIONAL { ?concept skos:notation ?notation }
        OPTIONAL {
          ${conceptLabelClause}
        }
      }
    `)

    try {
      const conceptResults = await executeSparql(endpoint, conceptQuery)
      return processLabelBindings(conceptResults.results.bindings)
    } catch (e) {
      logger.error('TreePagination', 'Failed to load orphan concept labels', { error: e })
      return []
    }
  }

  /**
   * Load more top concepts (next page)
   */
  async function loadMoreTopConcepts() {
    if (!hasMoreTopConcepts.value || loadingMoreTopConcepts.value) return
    const nextOffset = topConceptsOffset.value + PAGE_SIZE
    await loadTopConcepts(nextOffset)
  }

  /**
   * Load children for a node
   */
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

    const query = buildChildrenMetadataQuery(uri, PAGE_SIZE, offset)

    try {
      const results = await executeSparql(endpoint, query, { retries: 1 })

      // Process metadata bindings, then enrich with labels
      const children = processMetadataBindings(results.results.bindings)
      await loadLabelsForNodes(children)
      children.sort(compareNodesWithSettings)

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

  /**
   * Reset pagination state (call when scheme changes)
   */
  function resetPagination() {
    topConceptsOffset.value = 0
    hasMoreTopConcepts.value = true
    loadingMoreTopConcepts.value = false
    queryMode.value = 'explicit'
    childrenPagination.value.clear()
    loadingChildren.value.clear()
    error.value = null
  }

  return {
    // State
    topConceptsOffset,
    hasMoreTopConcepts,
    loadingMoreTopConcepts,
    childrenPagination,
    loadingChildren,
    error,
    // Functions
    loadTopConcepts,
    loadMoreTopConcepts,
    loadChildren,
    findNode,
    resetPagination,
  }
}
