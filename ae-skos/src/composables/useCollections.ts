/**
 * useCollections - SKOS Collection loading composable
 *
 * Loads SKOS collections that have members belonging to the current scheme.
 * Collections are displayed at the root level of the ConceptTree.
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { ref } from 'vue'
import { useEndpointStore, useLanguageStore } from '../stores'
import { executeSparql, logger } from '../services'
import { useLabelResolver } from './useLabelResolver'
import { buildCollectionsQuery, getCollectionQueryCapabilities } from './useCollectionQueries'
import type { CollectionNode } from '../types'

export function useCollections() {
  const endpointStore = useEndpointStore()
  const languageStore = useLanguageStore()
  const { shouldShowLangTag, selectLabelByPriority } = useLabelResolver()

  // State
  const collections = ref<CollectionNode[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

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
    }

    // Convert to CollectionNode array with priority-based label selection
    const result: CollectionNode[] = []

    for (const entry of collectionMap.values()) {
      // Use centralized resolver for label selection
      const selected = selectLabelByPriority(entry.labels)

      result.push({
        uri: entry.uri,
        label: selected?.value,
        labelLang: selected?.lang || undefined,
        notation: entry.notation,
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

  /**
   * Load collections for the given scheme.
   * Uses capability-aware query building based on endpoint analysis.
   */
  async function loadCollectionsForScheme(schemeUri: string) {
    const endpoint = endpointStore.current
    if (!endpoint) return

    // Check capabilities before attempting query
    const { branches, canQuery } = getCollectionQueryCapabilities(endpoint)

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
      branches,
    })

    const query = buildCollectionsQuery(endpoint, schemeUri)
    if (!query) {
      logger.info('Collections', 'No query generated - missing capabilities')
      collections.value = []
      loading.value = false
      return
    }

    logger.debug('Collections', 'Collections query', { query })

    try {
      const results = await executeSparql(endpoint, query, { retries: 1 })
      const parsed = processBindings(results.results.bindings as Array<Record<string, { value: string; 'xml:lang'?: string }>>)

      logger.info('Collections', `Loaded ${parsed.length} collections`)
      collections.value = parsed
    } catch (e: unknown) {
      const errMsg = e && typeof e === 'object' && 'message' in e
        ? (e as { message: string }).message
        : 'Unknown error'
      logger.error('Collections', 'Failed to load collections', { error: e })
      error.value = `Failed to load collections: ${errMsg}`
      collections.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * Clear collections state.
   */
  function reset() {
    collections.value = []
    loading.value = false
    error.value = null
  }

  return {
    // State
    collections,
    loading,
    error,
    // Actions
    loadCollectionsForScheme,
    reset,
    // Utilities
    shouldShowLangTag,
  }
}
