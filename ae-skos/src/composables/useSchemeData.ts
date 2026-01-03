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
import type { SchemeDetails } from '../types'

export function useSchemeData() {
  const endpointStore = useEndpointStore()

  // State
  const details: Ref<SchemeDetails | null> = ref(null)
  const loading = ref(false)
  const error: Ref<string | null> = ref(null)
  const resolvedPredicates: Ref<Map<string, { prefix: string; localName: string }>> = ref(new Map())

  /**
   * Load SKOS-XL extended labels
   */
  async function loadXLLabels(uri: string, schemeDetails: SchemeDetails): Promise<void> {
    const endpoint = endpointStore.current
    if (!endpoint) return

    const query = withPrefixes(`
      SELECT ?xlLabel ?labelType ?literalForm ?literalLang
      WHERE {
        {
          <${uri}> skosxl:prefLabel ?xlLabel .
          BIND("prefLabel" AS ?labelType)
        }
        ?xlLabel skosxl:literalForm ?literalForm .
        BIND(LANG(?literalForm) AS ?literalLang)
      }
    `)

    try {
      const results = await executeSparql(endpoint, query, { retries: 0 })

      const seenXLUris = new Set<string>()

      for (const binding of results.results.bindings) {
        const xlUri = binding.xlLabel?.value
        const literalForm = binding.literalForm?.value
        const literalLang = binding.literalLang?.value

        if (!xlUri || !literalForm) continue
        if (seenXLUris.has(xlUri)) continue
        seenXLUris.add(xlUri)

        schemeDetails.prefLabelsXL.push({
          uri: xlUri,
          literalForm: {
            value: literalForm,
            lang: literalLang || undefined,
          },
        })
      }

      logger.debug('useSchemeData', 'Loaded XL labels', {
        prefLabelsXL: schemeDetails.prefLabelsXL.length,
      })
    } catch (e) {
      logger.debug('useSchemeData', 'SKOS-XL labels not available or query failed', { error: e })
    }
  }

  /**
   * Load other (non-SKOS) properties
   */
  async function loadOtherProperties(uri: string, schemeDetails: SchemeDetails): Promise<void> {
    const endpoint = endpointStore.current
    if (!endpoint) return

    // Query for properties not explicitly displayed in dedicated sections
    const query = withPrefixes(`
      SELECT ?predicate ?value
      WHERE {
        <${uri}> ?predicate ?value .
        FILTER (?predicate NOT IN (
          rdf:type,
          skos:prefLabel, skos:altLabel,
          skos:definition, skos:scopeNote, skos:historyNote,
          skos:changeNote, skos:editorialNote, skos:example,
          skos:hasTopConcept,
          skosxl:prefLabel,
          dct:title, dct:description,
          dct:creator, dct:created, dct:modified,
          dct:publisher, dct:rights, dct:license
        ))
      }
    `)

    try {
      const results = await executeSparql(endpoint, query, { retries: 0 })

      const propMap = new Map<string, Map<string, { value: string; lang?: string; isUri: boolean }>>()

      for (const binding of results.results.bindings) {
        const predicate = binding.predicate?.value
        const value = binding.value?.value
        const lang = binding.value?.['xml:lang']
        const isUri = binding.value?.type === 'uri'

        if (!predicate || !value) continue

        if (!propMap.has(predicate)) {
          propMap.set(predicate, new Map())
        }
        const key = `${value}|${lang || ''}`
        if (!propMap.get(predicate)!.has(key)) {
          propMap.get(predicate)!.set(key, { value, lang, isUri })
        }
      }

      schemeDetails.otherProperties = Array.from(propMap.entries()).map(([predicate, valuesMap]) => ({
        predicate,
        values: Array.from(valuesMap.values()),
      }))

      logger.debug('useSchemeData', 'Loaded other properties', {
        count: schemeDetails.otherProperties.length,
      })
    } catch (e) {
      logger.debug('useSchemeData', 'Failed to load other properties', { error: e })
    }
  }

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
          skos:prefLabel, skos:altLabel,
          skos:definition, skos:scopeNote, skos:historyNote,
          skos:changeNote, skos:editorialNote, skos:example,
          dct:title, dct:description, dct:creator, dct:created, dct:modified,
          dct:publisher, dct:rights, dct:license,
          rdfs:label
        ))
      }
    `)

    try {
      const results = await executeSparql(endpoint, query, { retries: 1 })

      const schemeDetails: SchemeDetails = {
        uri,
        prefLabels: [],
        altLabels: [],
        definitions: [],
        scopeNotes: [],
        historyNotes: [],
        changeNotes: [],
        editorialNotes: [],
        examples: [],
        title: [],
        description: [],
        creator: [],
        publisher: [],
        rights: [],
        license: [],
        prefLabelsXL: [],
        otherProperties: [],
      }

      // Process results
      for (const binding of results.results.bindings) {
        const prop = binding.property?.value || ''
        const val = binding.value?.value || ''
        const lang = binding.value?.['xml:lang']

        if (prop.endsWith('prefLabel')) {
          schemeDetails.prefLabels.push({ value: val, lang })
        } else if (prop.endsWith('#label') || prop.endsWith('/label')) {
          schemeDetails.prefLabels.push({ value: val, lang })
        } else if (prop.endsWith('altLabel')) {
          schemeDetails.altLabels.push({ value: val, lang })
        } else if (prop.endsWith('definition')) {
          schemeDetails.definitions.push({ value: val, lang })
        } else if (prop.endsWith('scopeNote')) {
          schemeDetails.scopeNotes.push({ value: val, lang })
        } else if (prop.endsWith('historyNote')) {
          schemeDetails.historyNotes.push({ value: val, lang })
        } else if (prop.endsWith('changeNote')) {
          schemeDetails.changeNotes.push({ value: val, lang })
        } else if (prop.endsWith('editorialNote')) {
          schemeDetails.editorialNotes.push({ value: val, lang })
        } else if (prop.endsWith('example')) {
          schemeDetails.examples.push({ value: val, lang })
        } else if (prop.endsWith('title')) {
          schemeDetails.title.push({ value: val, lang })
        } else if (prop.endsWith('description')) {
          schemeDetails.description.push({ value: val, lang })
        } else if (prop.endsWith('creator')) {
          if (!schemeDetails.creator.includes(val)) {
            schemeDetails.creator.push(val)
          }
        } else if (prop.endsWith('created')) {
          schemeDetails.created = val
        } else if (prop.endsWith('modified')) {
          schemeDetails.modified = val
        } else if (prop.endsWith('publisher')) {
          if (!schemeDetails.publisher.includes(val)) {
            schemeDetails.publisher.push(val)
          }
        } else if (prop.endsWith('rights')) {
          if (!schemeDetails.rights.includes(val)) {
            schemeDetails.rights.push(val)
          }
        } else if (prop.endsWith('license')) {
          if (!schemeDetails.license.includes(val)) {
            schemeDetails.license.push(val)
          }
        }
      }

      // Load SKOS-XL labels
      await loadXLLabels(uri, schemeDetails)

      // Load other (non-SKOS) properties
      await loadOtherProperties(uri, schemeDetails)

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
