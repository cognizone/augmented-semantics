/**
 * useCollections - SKOS Collection loading composable
 *
 * Loads SKOS collections that have members belonging to the current scheme.
 * Collections are displayed at the root level of the ConceptTree.
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { ref, computed } from 'vue'
import { useEndpointStore, useLanguageStore, useSettingsStore } from '../stores'
import { executeSparql, logger, endpointHasCollections } from '../services'
import { useLabelResolver } from './useLabelResolver'
import { buildAllCollectionsQuery, buildAllOrderedCollectionsQuery, buildCollectionsStageQuery, buildChildCollectionsQuery, getCollectionQueryCapabilities, type CollectionQueryMode, type CollectionQueryStage } from './useCollectionQueries'
import type { CollectionNode, SPARQLEndpoint } from '../types'

type CollectionsMode = 'scheme' | 'collection' | 'orderedCollection'

let sharedState: ReturnType<typeof createCollectionsState> | null = null

function createCollectionsState() {
  const endpointStore = useEndpointStore()
  const languageStore = useLanguageStore()
  const settingsStore = useSettingsStore()
  const { shouldShowLangTag, selectLabelByPriority } = useLabelResolver()

  // State
  const collections = ref<CollectionNode[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const currentSchemeUri = ref<string | null>(null)
  const currentMode = ref<CollectionsMode>('scheme')
  let activeRequestId = 0
  /**
   * Process query bindings into CollectionNode array.
   * Groups by collection URI and selects best label based on type and language priority.
   */
  function processBindings(bindings: Array<Record<string, { value: string; 'xml:lang'?: string }>>): CollectionNode[] {
    // Group by collection URI, storing labels with type
    const collectionMap = new Map<string, {
      uri: string
      labels: { value: string; lang: string; type: string }[]
      notation?: string
      isNested?: boolean
      hasChildCollections?: boolean
      isOrdered?: boolean
    }>()

    for (const binding of bindings) {
      const uri = binding.collection?.value
      if (!uri) continue

      if (!collectionMap.has(uri)) {
        collectionMap.set(uri, {
          uri,
          labels: [],
          notation: binding.notation?.value,
        })
      }

      const entry = collectionMap.get(uri)!

      // Collect labels with their languages and types
      if (binding.label?.value) {
        const lang = binding.labelLang?.value || binding.label['xml:lang'] || ''
        entry.labels.push({
          value: binding.label.value,
          lang: lang || '',
          type: binding.labelType?.value || 'prefLabel',
        })
      }

      // Update notation if not set
      if (!entry.notation && binding.notation?.value) {
        entry.notation = binding.notation.value
      }

      // Handle nesting flags (boolean values come as 'true'/'false' strings)
      if (binding.hasParentCollection?.value === 'true') {
        entry.isNested = true
      }
      if (binding.hasChildCollections?.value === 'true') {
        entry.hasChildCollections = true
      }
      if (binding.isOrdered?.value === 'true') {
        entry.isOrdered = true
      }
    }

    // Convert to CollectionNode array with priority-based label selection
    const result: CollectionNode[] = []

    for (const entry of collectionMap.values()) {
      // Use centralized resolver for label selection
      const selected = selectLabelByPriority(entry.labels)

      const hasChildCollections = entry.isOrdered ? false : entry.hasChildCollections

      result.push({
        uri: entry.uri,
        label: selected?.value,
        labelLang: selected?.lang || undefined,
        notation: entry.notation,
        isNested: entry.isNested,
        hasChildCollections,
        isOrdered: entry.isOrdered,
      })
    }

    // Sort by label (or URI if no label)
    result.sort((a, b) => {
      const labelA = a.label || a.uri
      const labelB = b.label || b.uri
      return labelA.localeCompare(labelB)
    })

    return result
  }

  function mergeBindingsIntoMap(
    bindings: Array<Record<string, { value: string; 'xml:lang'?: string }>>,
    collectionMap: Map<string, {
      uri: string
      labels: { value: string; lang: string; type: string }[]
      notation?: string
      isNested?: boolean
      hasChildCollections?: boolean
      isOrdered?: boolean
    }>
  ) {
    for (const binding of bindings) {
      const uri = binding.collection?.value
      if (!uri) continue

      if (!collectionMap.has(uri)) {
        collectionMap.set(uri, {
          uri,
          labels: [],
          notation: binding.notation?.value,
        })
      }

      const entry = collectionMap.get(uri)!

      const labelValue = binding.label?.value
      if (labelValue) {
        const lang = binding.labelLang?.value || binding.label?.['xml:lang'] || ''
        const type = binding.labelType?.value || 'prefLabel'
        const exists = entry.labels.some(l =>
          l.value === labelValue &&
          l.lang === lang &&
          l.type === type
        )
        if (!exists) {
          entry.labels.push({
            value: labelValue,
            lang: lang || '',
            type,
          })
        }
      }

      if (!entry.notation && binding.notation?.value) {
        entry.notation = binding.notation.value
      }

      if (binding.hasParentCollection?.value === 'true') {
        entry.isNested = true
      }
      if (binding.hasChildCollections?.value === 'true') {
        entry.hasChildCollections = true
      }
      if (binding.isOrdered?.value === 'true') {
        entry.isOrdered = true
      }
    }
  }

  function materializeCollectionList(
    collectionMap: Map<string, {
      uri: string
      labels: { value: string; lang: string; type: string }[]
      notation?: string
      isNested?: boolean
      hasChildCollections?: boolean
      isOrdered?: boolean
    }>
  ): CollectionNode[] {
    const result: CollectionNode[] = []

    for (const entry of collectionMap.values()) {
      const selected = selectLabelByPriority(entry.labels)

      const hasChildCollections = entry.isOrdered ? false : entry.hasChildCollections

      result.push({
        uri: entry.uri,
        label: selected?.value,
        labelLang: selected?.lang || undefined,
        notation: entry.notation,
        isNested: entry.isNested,
        hasChildCollections,
        isOrdered: entry.isOrdered,
      })
    }

    result.sort((a, b) => {
      const labelA = a.label || a.uri
      const labelB = b.label || b.uri
      return labelA.localeCompare(labelB)
    })

    return result
  }

  async function runStageQuery(
    stage: CollectionQueryStage,
    endpoint: SPARQLEndpoint | null,
    schemeUri: string,
    collectionMap: Map<string, {
      uri: string
      labels: { value: string; lang: string; type: string }[]
      notation?: string
      isNested?: boolean
      hasChildCollections?: boolean
    }>,
    requestId: number
  ): Promise<void> {
    if (!endpoint) return

    const query = buildCollectionsStageQuery(endpoint, schemeUri, stage, {
      enableSchemeUriSlashFix: settingsStore.enableSchemeUriSlashFix,
    })
    if (!query) {
      logger.info('Collections', 'Stage skipped - no query generated', { stage })
      return
    }

    logger.debug('Collections', 'Running collection stage query', { stage, schemeUri })

    try {
      const results = await executeSparql(endpoint, query, { retries: 1 })
      if (requestId !== activeRequestId) return

      mergeBindingsIntoMap(
        results.results.bindings as Array<Record<string, { value: string; 'xml:lang'?: string }>>,
        collectionMap
      )

      collections.value = materializeCollectionList(collectionMap)
      logger.info('Collections', `Stage ${stage} loaded (${collections.value.length} total)`)
    } catch (e: unknown) {
      const errMsg = e && typeof e === 'object' && 'message' in e
        ? (e as { message: string }).message
        : 'Unknown error'
      logger.error('Collections', `Stage ${stage} failed`, { error: e })
      if (requestId === activeRequestId) {
        error.value = `Failed to load collections (${stage}): ${errMsg}`
      }
    }
  }

  /**
   * Load collections for the given scheme.
   * Uses capability-aware query building based on endpoint analysis.
   */
  async function loadCollectionsForScheme(schemeUri: string) {
    const endpoint = endpointStore.current
    if (!endpoint) return

    // Track current scheme for child collection queries
    currentSchemeUri.value = schemeUri
    currentMode.value = 'scheme'

    if (!endpointHasCollections(endpoint)) {
      logger.info('Collections', 'Skipping - endpoint reports no collections', { scheme: schemeUri })
      collections.value = []
      return
    }

    // Check capabilities before attempting query
    const { stages, canQuery } = getCollectionQueryCapabilities(endpoint)

    if (!canQuery) {
      logger.info('Collections', 'Skipping - no relevant capabilities', { scheme: schemeUri })
      collections.value = []
      return
    }

    loading.value = true
    error.value = null

    logger.info('Collections', 'Loading collections for scheme', {
      scheme: schemeUri,
      language: languageStore.preferred,
      stages,
    })

    const requestId = ++activeRequestId
    const collectionMap = new Map<string, {
      uri: string
      labels: { value: string; lang: string; type: string }[]
      notation?: string
      isNested?: boolean
      hasChildCollections?: boolean
      isOrdered?: boolean
    }>()

    collections.value = []

    try {
      for (const stage of stages) {
        if (requestId !== activeRequestId) return
        await runStageQuery(stage, endpoint, schemeUri, collectionMap, requestId)
      }
    } finally {
      if (requestId === activeRequestId) {
        loading.value = false
      }
    }
  }

  /**
   * Load all top-level collections (no scheme filtering).
   */
  async function loadAllCollections() {
    const endpoint = endpointStore.current
    if (!endpoint) return

    currentSchemeUri.value = null
    currentMode.value = 'collection'

    if (!endpointHasCollections(endpoint)) {
      logger.info('Collections', 'Skipping - endpoint reports no collections', { mode: 'collection' })
      collections.value = []
      return
    }

    loading.value = true
    error.value = null
    collections.value = []

    logger.info('Collections', 'Loading all root collections', {
      language: languageStore.preferred,
    })

    const requestId = ++activeRequestId
    const query = buildAllCollectionsQuery(endpoint)

    try {
      const results = await executeSparql(endpoint, query, { retries: 1 })
      if (requestId !== activeRequestId) return
      collections.value = processBindings(results.results.bindings as Array<Record<string, { value: string; 'xml:lang'?: string }>>)
      logger.info('Collections', `Loaded ${collections.value.length} root collections`)
    } catch (e: unknown) {
      const errMsg = e && typeof e === 'object' && 'message' in e
        ? (e as { message: string }).message
        : 'Unknown error'
      logger.error('Collections', 'Failed to load root collections', { error: e })
      if (requestId === activeRequestId) {
        error.value = `Failed to load collections: ${errMsg}`
      }
    } finally {
      if (requestId === activeRequestId) {
        loading.value = false
      }
    }
  }

  /**
   * Load all ordered collections (no scheme filtering, flat list).
   */
  async function loadAllOrderedCollections() {
    const endpoint = endpointStore.current
    if (!endpoint) return

    currentSchemeUri.value = null
    currentMode.value = 'orderedCollection'

    if (!endpointHasCollections(endpoint)) {
      logger.info('Collections', 'Skipping - endpoint reports no collections', { mode: 'orderedCollection' })
      collections.value = []
      return
    }

    loading.value = true
    error.value = null
    collections.value = []

    logger.info('Collections', 'Loading all ordered collections', {
      language: languageStore.preferred,
    })

    const requestId = ++activeRequestId
    const query = buildAllOrderedCollectionsQuery(endpoint)

    try {
      const results = await executeSparql(endpoint, query, { retries: 1 })
      if (requestId !== activeRequestId) return
      collections.value = processBindings(results.results.bindings as Array<Record<string, { value: string; 'xml:lang'?: string }>>)
      logger.info('Collections', `Loaded ${collections.value.length} ordered collections`)
    } catch (e: unknown) {
      const errMsg = e && typeof e === 'object' && 'message' in e
        ? (e as { message: string }).message
        : 'Unknown error'
      logger.error('Collections', 'Failed to load ordered root collections', { error: e })
      if (requestId === activeRequestId) {
        error.value = `Failed to load collections: ${errMsg}`
      }
    } finally {
      if (requestId === activeRequestId) {
        loading.value = false
      }
    }
  }

  /**
   * Top-level collections (not nested inside another collection).
   * These are shown at the root level under the scheme.
   */
  const topLevelCollections = computed(() =>
    collections.value.filter(c => !c.isNested)
  )

  /**
   * Load child collections for a parent collection.
   * Used for lazy-loading nested collections on expand.
   * Filters to only include child collections with members in the current scheme.
   */
  async function loadChildCollections(parentUri: string): Promise<CollectionNode[]> {
    const endpoint = endpointStore.current
    if (!endpoint) return []

    if (!endpointHasCollections(endpoint)) {
      logger.info('Collections', 'Skipping child collections - endpoint reports no collections', { parentUri })
      return []
    }

    const schemeUri = currentMode.value === 'scheme' ? currentSchemeUri.value : null
    if (currentMode.value === 'scheme' && !schemeUri) {
      logger.warn('Collections', 'No current scheme set, cannot load child collections')
      return []
    }

    const mode: CollectionQueryMode = currentMode.value === 'orderedCollection' ? 'ordered' : 'collection'
    const query = buildChildCollectionsQuery(parentUri, schemeUri, endpoint, mode, {
      enableSchemeUriSlashFix: settingsStore.enableSchemeUriSlashFix,
    })
    if (!query) {
      logger.info('Collections', 'No query generated for child collections - missing capabilities')
      return []
    }

    logger.debug('Collections', 'Loading child collections', { parentUri, schemeUri, mode: currentMode.value, query })

    try {
      const results = await executeSparql(endpoint, query, { retries: 1 })
      const children = processBindings(results.results.bindings as Array<Record<string, { value: string; 'xml:lang'?: string }>>)
      logger.info('Collections', `Loaded ${children.length} child collections for ${parentUri}`)
      return children
    } catch (e: unknown) {
      const errMsg = e && typeof e === 'object' && 'message' in e
        ? (e as { message: string }).message
        : 'Unknown error'
      logger.error('Collections', 'Failed to load child collections', { parentUri, error: e })
      throw new Error(`Failed to load child collections: ${errMsg}`)
    }
  }

  /**
   * Clear collections state.
   */
  function reset() {
    collections.value = []
    loading.value = false
    error.value = null
    currentSchemeUri.value = null
    currentMode.value = 'scheme'
  }

  return {
    // State
    collections,
    topLevelCollections,
    loading,
    error,
    // Actions
    loadCollectionsForScheme,
    loadAllCollections,
    loadAllOrderedCollections,
    loadChildCollections,
    reset,
    // Utilities
    shouldShowLangTag,
  }
}

export function useCollections(options?: { shared?: boolean }) {
  if (options?.shared) {
    if (!sharedState) {
      sharedState = createCollectionsState()
    }
    return sharedState
  }

  return createCollectionsState()
}
