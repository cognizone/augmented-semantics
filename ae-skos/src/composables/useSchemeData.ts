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
        } UNION {
          <${uri}> skosxl:altLabel ?xlLabel .
          BIND("altLabel" AS ?labelType)
        } UNION {
          <${uri}> skosxl:hiddenLabel ?xlLabel .
          BIND("hiddenLabel" AS ?labelType)
        }
        ?xlLabel skosxl:literalForm ?literalForm .
        BIND(LANG(?literalForm) AS ?literalLang)
      }
    `)

    try {
      const results = await executeSparql(endpoint, query, { retries: 0 })

      // Track seen URIs per label type to avoid duplicates
      const seenPrefUris = new Set<string>()
      const seenAltUris = new Set<string>()
      const seenHiddenUris = new Set<string>()

      for (const binding of results.results.bindings) {
        const xlUri = binding.xlLabel?.value
        const labelType = binding.labelType?.value
        const literalForm = binding.literalForm?.value
        const literalLang = binding.literalLang?.value

        if (!xlUri || !literalForm || !labelType) continue

        const xlLabel = {
          uri: xlUri,
          literalForm: {
            value: literalForm,
            lang: literalLang || undefined,
          },
        }

        if (labelType === 'prefLabel') {
          if (seenPrefUris.has(xlUri)) continue
          seenPrefUris.add(xlUri)
          schemeDetails.prefLabelsXL.push(xlLabel)
        } else if (labelType === 'altLabel') {
          if (seenAltUris.has(xlUri)) continue
          seenAltUris.add(xlUri)
          schemeDetails.altLabelsXL.push(xlLabel)
        } else if (labelType === 'hiddenLabel') {
          if (seenHiddenUris.has(xlUri)) continue
          seenHiddenUris.add(xlUri)
          schemeDetails.hiddenLabelsXL.push(xlLabel)
        }
      }

      logger.debug('useSchemeData', 'Loaded XL labels', {
        prefLabelsXL: schemeDetails.prefLabelsXL.length,
        altLabelsXL: schemeDetails.altLabelsXL.length,
        hiddenLabelsXL: schemeDetails.hiddenLabelsXL.length,
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
          skos:prefLabel, skos:altLabel, skos:hiddenLabel, skos:notation,
          skos:definition, skos:scopeNote, skos:historyNote,
          skos:changeNote, skos:editorialNote, skos:note, skos:example,
          skos:hasTopConcept,
          skosxl:prefLabel, skosxl:altLabel, skosxl:hiddenLabel,
          rdfs:label, rdfs:comment, rdfs:seeAlso,
          dct:title, dct:description,
          dct:creator, dct:created, dct:modified, dct:issued,
          dct:publisher, dct:rights, dct:license, cc:license,
          owl:deprecated, owl:versionInfo
        ))
      }
    `)

    try {
      const results = await executeSparql(endpoint, query, { retries: 0 })

      const propMap = new Map<string, Map<string, { value: string; lang?: string; datatype?: string; isUri: boolean }>>()

      for (const binding of results.results.bindings) {
        const predicate = binding.predicate?.value
        const value = binding.value?.value
        const lang = binding.value?.['xml:lang']
        const datatype = binding.value?.datatype
        const isUri = binding.value?.type === 'uri'

        if (!predicate || !value) continue

        if (!propMap.has(predicate)) {
          propMap.set(predicate, new Map())
        }
        const key = `${value}|${lang || ''}|${datatype || ''}`
        if (!propMap.get(predicate)!.has(key)) {
          propMap.get(predicate)!.set(key, { value, lang, datatype, isUri })
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
          skos:prefLabel, skos:altLabel, skos:hiddenLabel, skos:notation,
          skos:definition, skos:scopeNote, skos:historyNote,
          skos:changeNote, skos:editorialNote, skos:note, skos:example,
          rdfs:label, rdfs:comment, rdfs:seeAlso,
          dct:title, dct:description, dct:creator, dct:created, dct:modified,
          dct:issued, dct:publisher, dct:rights, dct:license, cc:license,
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
        labels: [],
        notations: [],
        definitions: [],
        scopeNotes: [],
        historyNotes: [],
        changeNotes: [],
        editorialNotes: [],
        notes: [],
        examples: [],
        comments: [],
        title: [],
        description: [],
        creator: [],
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

      // Process results
      for (const binding of results.results.bindings) {
        const prop = binding.property?.value || ''
        const val = binding.value?.value || ''
        const lang = binding.value?.['xml:lang']

        if (prop.endsWith('prefLabel')) {
          schemeDetails.prefLabels.push({ value: val, lang })
        } else if (prop.endsWith('altLabel')) {
          schemeDetails.altLabels.push({ value: val, lang })
        } else if (prop.endsWith('hiddenLabel')) {
          schemeDetails.hiddenLabels.push({ value: val, lang })
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
        } else if (prop.endsWith('#note')) {
          schemeDetails.notes.push({ value: val, lang })
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
        } else if (prop.endsWith('ns#license')) {
          // cc:license (Creative Commons)
          if (!schemeDetails.ccLicense.includes(val)) {
            schemeDetails.ccLicense.push(val)
          }
        } else if (prop.endsWith('license')) {
          // dct:license (Dublin Core)
          if (!schemeDetails.license.includes(val)) {
            schemeDetails.license.push(val)
          }
        } else if (prop.endsWith('#label')) {
          // rdfs:label
          schemeDetails.labels.push({ value: val, lang })
        } else if (prop.endsWith('#comment')) {
          // rdfs:comment
          schemeDetails.comments.push({ value: val, lang })
        } else if (prop.endsWith('notation')) {
          // skos:notation
          const datatype = binding.value?.datatype
          schemeDetails.notations.push({ value: val, datatype })
        } else if (prop.endsWith('issued')) {
          // dct:issued
          schemeDetails.issued = val
        } else if (prop.endsWith('#deprecated')) {
          // owl:deprecated
          schemeDetails.deprecated = val === 'true' || val === '1'
        } else if (prop.endsWith('versionInfo')) {
          // owl:versionInfo
          schemeDetails.versionInfo = val
        } else if (prop.endsWith('#seeAlso')) {
          // rdfs:seeAlso
          if (!schemeDetails.seeAlso.includes(val)) {
            schemeDetails.seeAlso.push(val)
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
