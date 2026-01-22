/**
 * useSchemeData - Scheme data loading composable
 *
 * Handles all SPARQL queries and data loading for concept scheme details,
 * including labels, metadata, and properties.
 *
 * @see /spec/ae-skos/sko02-SchemeSelector.md
 */
import { ref, type Ref } from 'vue'
import { useEndpointStore } from '../stores'
import { executeSparql, withPrefixes, logger, resolveUris } from '../services'
import { useXLLabels } from './useXLLabels'
import { useOtherProperties, SCHEME_EXCLUDED_PREDICATES } from './useOtherProperties'
import { SCHEME_PROPERTY_MAP, processPropertyBindings, type SparqlBinding } from '../utils/propertyProcessor'
import type { SchemeDetails } from '../types'

export function useSchemeData() {
  const endpointStore = useEndpointStore()
  const { loadXLLabels } = useXLLabels()
  const { loadOtherProperties } = useOtherProperties()

  // State
  const details: Ref<SchemeDetails | null> = ref(null)
  const loading = ref(false)
  const error: Ref<string | null> = ref(null)
  const resolvedPredicates: Ref<Map<string, { prefix: string; localName: string }>> = ref(new Map())

  /**
   * Load complete scheme details
   */
  async function loadDetails(uri: string): Promise<void> {
    const endpoint = endpointStore.current
    if (!endpoint) return

    logger.info('useSchemeData', 'Loading details', { uri })

    loading.value = true
    error.value = null

    const query = withPrefixes(`
      SELECT ?property ?value
      WHERE {
        <${uri}> ?property ?value .
        FILTER (?property IN (
          skos:prefLabel, skos:altLabel, skos:hiddenLabel, skos:notation,
          skos:definition, skos:scopeNote, skos:historyNote,
          skos:changeNote, skos:editorialNote, skos:note, skos:example,
          rdfs:label, rdfs:comment, rdfs:seeAlso,
          dc:title, dc:identifier, dct:title, dct:description, dct:creator, dct:created, dct:modified,
          dct:issued, dct:status, dct:publisher, dct:rights, dct:license, cc:license,
          owl:deprecated, owl:versionInfo
        ))
      }
    `)

    try {
      const results = await executeSparql(endpoint, query, { retries: 1 })

      const schemeDetails: SchemeDetails = {
        uri,
        prefLabels: [],
        altLabels: [],
        hiddenLabels: [],
        rdfsLabels: [],
        notations: [],
        definitions: [],
        scopeNotes: [],
        historyNotes: [],
        changeNotes: [],
        editorialNotes: [],
        notes: [],
        examples: [],
        comments: [],
        dctTitles: [],
        dcTitles: [],
        description: [],
        creator: [],
        identifier: [],
        publisher: [],
        rights: [],
        license: [],
        ccLicense: [],
        seeAlso: [],
        prefLabelsXL: [],
        altLabelsXL: [],
        hiddenLabelsXL: [],
        otherProperties: [],
      }

      // Process bindings using declarative property mapping
      processPropertyBindings(
        results.results.bindings as SparqlBinding[],
        schemeDetails,
        SCHEME_PROPERTY_MAP
      )

      // Load SKOS-XL labels
      await loadXLLabels(uri, schemeDetails, { source: 'useSchemeData' })

      // Load other (non-SKOS) properties
      await loadOtherProperties(uri, schemeDetails, {
        excludedPredicates: SCHEME_EXCLUDED_PREDICATES,
        resolveDatatypes: false,
        source: 'useSchemeData',
      })

      // Resolve prefixes for other properties
      if (schemeDetails.otherProperties.length > 0) {
        const predicates = schemeDetails.otherProperties.map(p => p.predicate)
        resolvedPredicates.value = await resolveUris(predicates)
      } else {
        resolvedPredicates.value = new Map()
      }

      logger.info('useSchemeData', 'Loaded details', {
        labels: schemeDetails.prefLabels.length,
        definitions: schemeDetails.definitions.length,
      })

      details.value = schemeDetails
    } catch (e: unknown) {
      const errMsg = e && typeof e === 'object' && 'message' in e
        ? (e as { message: string }).message
        : 'Unknown error'
      logger.error('useSchemeData', 'Failed to load details', { uri, error: e })
      error.value = `Failed to load details: ${errMsg}`
      details.value = null
    } finally {
      loading.value = false
    }
  }

  return {
    details,
    loading,
    error,
    resolvedPredicates,
    loadDetails
  }
}
