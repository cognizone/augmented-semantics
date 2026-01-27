/**
 * useConceptSelection - Unified concept selection with cross-scheme support
 *
 * Handles concept selection for both:
 * - Related concept clicks (scheme unknown, needs discovery)
 * - History navigation (scheme known upfront)
 *
 * Key principle: Always switch scheme BEFORE selecting concept to avoid
 * race conditions with tree loading.
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { nextTick } from 'vue'
import { useEndpointStore, useSchemeStore, useConceptStore, useUIStore } from '../stores'
import { executeSparql, withPrefixes, logger } from '../services'

export type SelectConceptOptions = {
  preserveCollection?: boolean
}

export function useConceptSelection() {
  const endpointStore = useEndpointStore()
  const schemeStore = useSchemeStore()
  const conceptStore = useConceptStore()
  const uiStore = useUIStore()

  /**
   * Query for concept's scheme by traversing up the hierarchy to find a top concept.
   * Returns the scheme URI if found, null otherwise.
   */
  async function findSchemeForConcept(conceptUri: string): Promise<string | null> {
    const endpoint = endpointStore.current
    if (!endpoint) return null

    // Query to find scheme by traversing up broader/narrower to top concept
    const query = withPrefixes(`
      SELECT ?scheme WHERE {
        {
          # Direct: concept has inScheme
          <${conceptUri}> skos:inScheme ?scheme .
        } UNION {
          # Direct: concept is a top concept
          ?scheme skos:hasTopConcept <${conceptUri}> .
        } UNION {
          <${conceptUri}> skos:topConceptOf ?scheme .
        } UNION {
          # Traverse up via broader or inverse narrower
          <${conceptUri}> (skos:broader|^skos:narrower)+ ?ancestor .
          {
            ?scheme skos:hasTopConcept ?ancestor .
          } UNION {
            ?ancestor skos:topConceptOf ?scheme .
          }
        }
      }
      LIMIT 1
    `)

    try {
      const results = await executeSparql(endpoint, query, { retries: 0 })
      const schemeUri = results.results.bindings[0]?.scheme?.value
      if (schemeUri) {
        logger.debug('useConceptSelection', 'Found scheme for concept', {
          concept: conceptUri,
          scheme: schemeUri
        })
        return schemeUri
      }
    } catch (e) {
      logger.debug('useConceptSelection', 'Failed to find scheme for concept', { error: e })
    }

    return null
  }

  /**
   * Select a concept, handling cross-scheme navigation properly.
   *
   * @param conceptUri - The concept URI to select
   * @param schemeUri - Optional scheme URI (will be discovered if not provided)
   * @param endpointUrl - Optional endpoint URL (for history navigation)
   * @param options - Optional selection flags
   */
  async function selectConceptWithScheme(
    conceptUri: string,
    schemeUri?: string | null,
    endpointUrl?: string,
    options?: SelectConceptOptions
  ): Promise<void> {
    if (!conceptUri) {
      conceptStore.selectConcept(null)
      return
    }

    logger.info('useConceptSelection', 'Selecting concept', {
      concept: conceptUri,
      scheme: schemeUri,
      endpoint: endpointUrl
    })

    // 1. Switch endpoint if needed
    if (endpointUrl && endpointUrl !== endpointStore.current?.url) {
      const endpoint = endpointStore.endpoints.find(e => e.url === endpointUrl)
      if (endpoint) {
        endpointStore.selectEndpoint(endpoint.id)
        await nextTick()
      }
    }

    // Collection mode skips scheme discovery/switching
    if (schemeStore.rootMode === 'collection') {
      schemeStore.viewScheme(null)
      if (!options?.preserveCollection) {
        conceptStore.selectCollection(null)
      }
      await conceptStore.selectConceptWithEvent(conceptUri)
      uiStore.setSidebarTab('browse')
      return
    }

    // 2. If scheme not provided, try to discover it
    if (!schemeUri) {
      schemeUri = await findSchemeForConcept(conceptUri)
    }

    // 3. Switch scheme if needed (BEFORE selecting concept)
    if (schemeUri && schemeUri !== schemeStore.selectedUri) {
      // Validate scheme exists in available schemes
      const validScheme = schemeStore.schemes.some(s => s.uri === schemeUri)
      if (validScheme) {
        logger.info('useConceptSelection', 'Switching scheme before concept selection', {
          from: schemeStore.selectedUri,
          to: schemeUri
        })
        // Set pending reveal so tree knows to reveal after loading
        conceptStore.requestReveal(conceptUri)
        schemeStore.selectScheme(schemeUri)
        await nextTick()
      }
    }

    // 4. Clear scheme viewing and select concept (and clear any collection selection)
    schemeStore.viewScheme(null)
    conceptStore.selectCollection(null)
    await conceptStore.selectConceptWithEvent(conceptUri)

    // 5. Switch to browse tab
    uiStore.setSidebarTab('browse')
  }

  /**
   * Select a collection, handling cross-scheme navigation properly.
   *
   * @param collectionUri - The collection URI to select
   * @param schemeUri - Optional scheme URI (required for cross-scheme navigation)
   * @param endpointUrl - Optional endpoint URL (for history navigation)
   */
  async function selectCollectionWithScheme(
    collectionUri: string,
    schemeUri?: string | null,
    endpointUrl?: string
  ): Promise<void> {
    if (!collectionUri) {
      conceptStore.selectCollection(null)
      return
    }

    logger.info('useConceptSelection', 'Selecting collection', {
      collection: collectionUri,
      scheme: schemeUri,
      endpoint: endpointUrl
    })

    // 1. Switch endpoint if needed
    if (endpointUrl && endpointUrl !== endpointStore.current?.url) {
      const endpoint = endpointStore.endpoints.find(e => e.url === endpointUrl)
      if (endpoint) {
        endpointStore.selectEndpoint(endpoint.id)
        await nextTick()
      }
    }

    if (schemeStore.rootMode === 'collection') {
      schemeStore.viewScheme(null)
      await conceptStore.selectCollectionWithEvent(collectionUri)
      uiStore.setSidebarTab('browse')
      return
    }

    // 2. Switch scheme if needed (BEFORE selecting collection)
    if (schemeUri && schemeUri !== schemeStore.selectedUri) {
      // Validate scheme exists in available schemes
      const validScheme = schemeStore.schemes.some(s => s.uri === schemeUri)
      if (validScheme) {
        logger.info('useConceptSelection', 'Switching scheme before collection selection', {
          from: schemeStore.selectedUri,
          to: schemeUri
        })
        // Set pending reveal so tree knows to reveal after loading
        conceptStore.requestRevealCollection(collectionUri)
        schemeStore.selectScheme(schemeUri)
        await nextTick()
      }
    }

    // 3. Clear scheme viewing and select collection
    schemeStore.viewScheme(null)
    await conceptStore.selectCollectionWithEvent(collectionUri)

    // 4. Switch to browse tab
    uiStore.setSidebarTab('browse')
  }

  return {
    findSchemeForConcept,
    selectConceptWithScheme,
    selectCollectionWithScheme
  }
}
