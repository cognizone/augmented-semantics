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
import { executeSparql, withPrefixes, logger } from '../services'
import { useLabelResolver } from './useLabelResolver'
import type { CollectionNode } from '../types'

export function useCollections() {
  const endpointStore = useEndpointStore()
  const languageStore = useLanguageStore()
  const { shouldShowLangTag } = useLabelResolver()

  // State
  const collections = ref<CollectionNode[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Build query to find collections with members in the given scheme.
   * Uses UNION pattern to match concepts via various relationship paths.
   */
  function buildCollectionsQuery(schemeUri: string): string {
    return withPrefixes(`
      SELECT DISTINCT ?collection ?label ?labelLang ?labelType ?notation WHERE {
        ?collection a skos:Collection .
        ?collection skos:member ?concept .

        # Concept belongs to scheme via various paths
        {
          ?concept skos:inScheme <${schemeUri}> .
        } UNION {
          ?concept skos:topConceptOf <${schemeUri}> .
        } UNION {
          <${schemeUri}> skos:hasTopConcept ?concept .
        } UNION {
          ?concept skos:broader+ ?top .
          { ?top skos:topConceptOf <${schemeUri}> } UNION { <${schemeUri}> skos:hasTopConcept ?top }
        }

        # Label resolution with priority tracking
        OPTIONAL {
          {
            ?collection skos:prefLabel ?label .
            BIND("prefLabel" AS ?labelType)
          } UNION {
            ?collection skosxl:prefLabel/skosxl:literalForm ?label .
            BIND("xlPrefLabel" AS ?labelType)
          } UNION {
            ?collection dct:title ?label .
            BIND("title" AS ?labelType)
          } UNION {
            ?collection dc:title ?label .
            BIND("dcTitle" AS ?labelType)
          } UNION {
            ?collection rdfs:label ?label .
            BIND("rdfsLabel" AS ?labelType)
          }
          BIND(LANG(?label) AS ?labelLang)
        }

        # Notation
        OPTIONAL { ?collection skos:notation ?notation }
      }
      ORDER BY ?collection
    `)
  }

  /**
   * Helper to select best label based on language priorities.
   * Matches the pattern used in ConceptBreadcrumb.vue for schemes.
   */
  function selectBestLabelByLanguage(
    labels: { value: string; lang: string; type: string }[]
  ): { value: string; lang: string } | undefined {
    if (!labels.length) return undefined

    // 1. Try preferred language
    const preferred = labels.find(l => l.lang === languageStore.preferred)
    if (preferred) return preferred

    // 2. Try endpoint's language priorities in order
    const priorities = endpointStore.current?.languagePriorities || []
    for (const lang of priorities) {
      const match = labels.find(l => l.lang === lang)
      if (match) return match
    }

    // 3. Try labels without language tag
    const noLang = labels.find(l => !l.lang || l.lang === '')
    if (noLang) return noLang

    // 4. Return first available
    return labels[0]
  }

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
    const labelPriority = ['prefLabel', 'xlPrefLabel', 'title', 'dcTitle', 'rdfsLabel']

    for (const entry of collectionMap.values()) {
      let bestLabel: string | undefined
      let bestLabelLang: string | undefined

      // Try label types in priority order
      for (const labelType of labelPriority) {
        const labelsOfType = entry.labels.filter(l => l.type === labelType)
        if (!labelsOfType.length) continue

        const selected = selectBestLabelByLanguage(labelsOfType)
        if (selected) {
          bestLabel = selected.value
          bestLabelLang = selected.lang || undefined
          break
        }
      }

      result.push({
        uri: entry.uri,
        label: bestLabel,
        labelLang: bestLabelLang,
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
   */
  async function loadCollectionsForScheme(schemeUri: string) {
    const endpoint = endpointStore.current
    if (!endpoint) return

    loading.value = true
    error.value = null

    logger.info('Collections', 'Loading collections for scheme', {
      scheme: schemeUri,
      language: languageStore.preferred,
    })

    const query = buildCollectionsQuery(schemeUri)
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
