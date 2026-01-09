/**
 * useConceptData - Concept data loading composable
 *
 * Handles all SPARQL queries and data loading for concept details,
 * including labels, properties, relations, and metadata.
 *
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import { ref, type Ref } from 'vue'
import { useEndpointStore, useLanguageStore, useSchemeStore, useConceptStore } from '../stores'
import { executeSparql, withPrefixes, logger, resolveUris, formatQualifiedName } from '../services'
import { useDeprecation } from './useDeprecation'
import type { ConceptDetails } from '../types'

export function useConceptData() {
  const endpointStore = useEndpointStore()
  const languageStore = useLanguageStore()
  const schemeStore = useSchemeStore()
  const { isDeprecatedFromProperties } = useDeprecation()

  // State
  const details: Ref<ConceptDetails | null> = ref(null)
  const loading = ref(false)
  const error: Ref<string | null> = ref(null)
  const resolvedPredicates: Ref<Map<string, { prefix: string; localName: string }>> = ref(new Map())

  /**
   * Select best label from an array based on language priorities
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
   * Load labels for related concepts and schemes
   */
  async function loadRelatedLabels(conceptDetails: ConceptDetails): Promise<void> {
    const endpoint = endpointStore.current
    if (!endpoint) return

    const allRefs = [
      ...conceptDetails.broader,
      ...conceptDetails.narrower,
      ...conceptDetails.related,
      ...conceptDetails.inScheme
    ]

    if (!allRefs.length) return

    const uris = allRefs.map(r => `<${r.uri}>`).join(' ')

    // Fetch notation, prefLabel (incl. XL), altLabel, hiddenLabel, and dct:title (for schemes)
    const query = withPrefixes(`
      SELECT ?concept ?notation ?label ?labelLang ?labelType
      WHERE {
        VALUES ?concept { ${uris} }
        OPTIONAL { ?concept skos:notation ?notation }
        OPTIONAL {
          {
            ?concept skos:prefLabel ?label .
            BIND("prefLabel" AS ?labelType)
          } UNION {
            ?concept skosxl:prefLabel/skosxl:literalForm ?label .
            BIND("xlPrefLabel" AS ?labelType)
          } UNION {
            ?concept skos:altLabel ?label .
            BIND("altLabel" AS ?labelType)
          } UNION {
            ?concept skos:hiddenLabel ?label .
            BIND("hiddenLabel" AS ?labelType)
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
      const results = await executeSparql(endpoint, query, { retries: 0 })

      // Group by concept URI
      const conceptData = new Map<string, {
        notation?: string
        labels: { value: string; lang: string; type: string }[]
      }>()

      for (const b of results.results.bindings) {
        const uri = b.concept?.value
        if (!uri) continue

        if (!conceptData.has(uri)) {
          conceptData.set(uri, { labels: [] })
        }

        const data = conceptData.get(uri)!

        if (b.notation?.value && !data.notation) {
          data.notation = b.notation.value
        }

        if (b.label?.value) {
          data.labels.push({
            value: b.label.value,
            lang: b.labelLang?.value || '',
            type: b.labelType?.value || 'prefLabel'
          })
        }
      }

      // Update refs with best label and notation
      allRefs.forEach(ref => {
        const data = conceptData.get(ref.uri)
        if (!data) return

        ref.notation = data.notation

        // Pick best label: prefLabel > xlPrefLabel > title > rdfsLabel, etc.
        const labelPriority = ['prefLabel', 'xlPrefLabel', 'title', 'rdfsLabel', 'altLabel', 'hiddenLabel']
        let bestLabel: string | undefined
        let bestLang: string | undefined

        for (const labelType of labelPriority) {
          const labelsOfType = data.labels.filter(l => l.type === labelType)
          if (!labelsOfType.length) continue

          const selected = selectBestLabelByLanguage(labelsOfType)
          if (selected) {
            bestLabel = selected.value
            bestLang = selected.lang || undefined
            break
          }
        }

        if (bestLabel) {
          ref.label = bestLabel
          ref.lang = bestLang
        }
      })
    } catch (e) {
      logger.warn('useConceptData', 'Failed to load related labels', { error: e })
    }
  }

  /**
   * Load SKOS-XL extended labels
   */
  async function loadXLLabels(uri: string, conceptDetails: ConceptDetails): Promise<void> {
    const endpoint = endpointStore.current
    if (!endpoint) return

    // Query for XL labels
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

      // Track seen URIs to deduplicate
      const seenXLUris = new Set<string>()

      for (const binding of results.results.bindings) {
        const xlUri = binding.xlLabel?.value
        const labelType = binding.labelType?.value
        const literalForm = binding.literalForm?.value
        const literalLang = binding.literalLang?.value

        if (!xlUri || !literalForm) continue

        // Deduplicate by XL label URI
        if (seenXLUris.has(xlUri)) continue
        seenXLUris.add(xlUri)

        const xlLabel = {
          uri: xlUri,
          literalForm: {
            value: literalForm,
            lang: literalLang || undefined,
          },
        }

        if (labelType === 'prefLabel') {
          conceptDetails.prefLabelsXL.push(xlLabel)
        } else if (labelType === 'altLabel') {
          conceptDetails.altLabelsXL.push(xlLabel)
        } else if (labelType === 'hiddenLabel') {
          conceptDetails.hiddenLabelsXL.push(xlLabel)
        }
      }

      logger.debug('useConceptData', 'Loaded XL labels', {
        prefLabelsXL: conceptDetails.prefLabelsXL.length,
        altLabelsXL: conceptDetails.altLabelsXL.length,
        hiddenLabelsXL: conceptDetails.hiddenLabelsXL.length,
      })
    } catch (e) {
      // SKOS-XL may not be supported by all endpoints, silently skip
      logger.debug('useConceptData', 'SKOS-XL labels not available or query failed', { error: e })
    }
  }

  /**
   * Load other (non-SKOS) properties
   */
  async function loadOtherProperties(uri: string, conceptDetails: ConceptDetails): Promise<void> {
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
          skos:broader, skos:narrower, skos:related,
          skos:inScheme, skos:exactMatch, skos:closeMatch,
          skos:broadMatch, skos:narrowMatch, skos:relatedMatch,
          skosxl:prefLabel, skosxl:altLabel, skosxl:hiddenLabel,
          dc:identifier, dct:created, dct:modified, dct:status, rdfs:seeAlso
        ))
      }
    `)

    try {
      const results = await executeSparql(endpoint, query, { retries: 0 })

      // Collect all datatypes for resolution
      const datatypeUris = new Set<string>()

      // Group by predicate with deduplication
      const propMap = new Map<string, Map<string, { value: string; lang?: string; datatype?: string; isUri: boolean }>>()

      for (const binding of results.results.bindings) {
        const predicate = binding.predicate?.value
        const value = binding.value?.value
        const lang = binding.value?.['xml:lang']
        const datatype = binding.value?.datatype
        const isUri = binding.value?.type === 'uri'

        if (!predicate || !value) continue

        if (datatype) {
          datatypeUris.add(datatype)
        }

        if (!propMap.has(predicate)) {
          propMap.set(predicate, new Map())
        }
        // Deduplicate by value+lang combination
        const key = `${value}|${lang || ''}`
        if (!propMap.get(predicate)!.has(key)) {
          propMap.get(predicate)!.set(key, { value, lang, datatype, isUri })
        }
      }

      // Resolve datatype URIs to short forms
      const datatypeMap = datatypeUris.size > 0
        ? await resolveUris(Array.from(datatypeUris))
        : new Map()

      // Convert to OtherProperty array with resolved datatypes
      conceptDetails.otherProperties = Array.from(propMap.entries()).map(([predicate, valuesMap]) => ({
        predicate,
        values: Array.from(valuesMap.values()).map(v => {
          if (v.datatype) {
            const resolved = datatypeMap.get(v.datatype)
            if (resolved) {
              v.datatype = formatQualifiedName(resolved)
            }
          }
          return v
        }),
      }))

      logger.debug('useConceptData', 'Loaded other properties', {
        count: conceptDetails.otherProperties.length,
      })
    } catch (e) {
      // Silently skip if query fails
      logger.debug('useConceptData', 'Failed to load other properties', { error: e })
    }
  }

  /**
   * Load complete concept details
   */
  async function loadDetails(uri: string): Promise<void> {
    const endpoint = endpointStore.current
    if (!endpoint) return

    logger.info('useConceptData', 'Loading details', { uri })

    loading.value = true
    error.value = null

    const query = withPrefixes(`
      SELECT ?property ?value
      WHERE {
        <${uri}> ?property ?value .
        FILTER (?property IN (
          rdf:type,
          skos:prefLabel, skos:altLabel, skos:hiddenLabel,
          rdfs:label, dct:title,
          skos:definition, skos:scopeNote, skos:historyNote,
          skos:changeNote, skos:editorialNote, skos:note, skos:example,
          skos:notation, skos:broader, skos:narrower, skos:related,
          skos:inScheme, skos:exactMatch, skos:closeMatch,
          skos:broadMatch, skos:narrowMatch, skos:relatedMatch,
          dc:identifier, dct:created, dct:modified, dct:status, rdfs:seeAlso
        ))
      }
    `)

    try {
      const results = await executeSparql(endpoint, query, { retries: 1 })

      const conceptDetails: ConceptDetails = {
        uri,
        prefLabels: [],
        altLabels: [],
        hiddenLabels: [],
        definitions: [],
        scopeNotes: [],
        historyNotes: [],
        changeNotes: [],
        editorialNotes: [],
        notes: [],
        examples: [],
        notations: [],
        broader: [],
        narrower: [],
        related: [],
        inScheme: [],
        exactMatch: [],
        closeMatch: [],
        broadMatch: [],
        narrowMatch: [],
        relatedMatch: [],
        identifier: [],
        seeAlso: [],
        prefLabelsXL: [],
        altLabelsXL: [],
        hiddenLabelsXL: [],
        otherProperties: [],
      }

      // Collect rdf:type values to detect ConceptScheme
      const types: string[] = []

      // Process results
      for (const binding of results.results.bindings) {
        const prop = binding.property?.value || ''
        const val = binding.value?.value || ''
        const lang = binding.value?.['xml:lang']

        // Collect types for later checking
        if (prop === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type') {
          types.push(val)
          continue
        }

        if (prop.endsWith('prefLabel')) {
          conceptDetails.prefLabels.push({ value: val, lang })
        } else if (prop.endsWith('#label') || prop.endsWith('/label')) {
          // rdfs:label - treat as fallback prefLabel
          conceptDetails.prefLabels.push({ value: val, lang })
        } else if (prop.endsWith('title')) {
          // dct:title - treat as fallback prefLabel
          conceptDetails.prefLabels.push({ value: val, lang })
        } else if (prop.endsWith('altLabel')) {
          conceptDetails.altLabels.push({ value: val, lang })
        } else if (prop.endsWith('hiddenLabel')) {
          conceptDetails.hiddenLabels.push({ value: val, lang })
        } else if (prop.endsWith('definition')) {
          conceptDetails.definitions.push({ value: val, lang })
        } else if (prop.endsWith('scopeNote')) {
          conceptDetails.scopeNotes.push({ value: val, lang })
        } else if (prop.endsWith('historyNote')) {
          conceptDetails.historyNotes.push({ value: val, lang })
        } else if (prop.endsWith('changeNote')) {
          conceptDetails.changeNotes.push({ value: val, lang })
        } else if (prop.endsWith('editorialNote')) {
          conceptDetails.editorialNotes.push({ value: val, lang })
        } else if (prop.endsWith('#note')) {
          conceptDetails.notes.push({ value: val, lang })
        } else if (prop.endsWith('example')) {
          conceptDetails.examples.push({ value: val, lang })
        } else if (prop.endsWith('notation')) {
          const datatype = binding.value?.datatype
          if (!conceptDetails.notations.some(n => n.value === val)) {
            conceptDetails.notations.push({ value: val, datatype })
          }
        } else if (prop.endsWith('broader')) {
          if (!conceptDetails.broader.some(r => r.uri === val)) {
            conceptDetails.broader.push({ uri: val })
          }
        } else if (prop.endsWith('narrower')) {
          if (!conceptDetails.narrower.some(r => r.uri === val)) {
            conceptDetails.narrower.push({ uri: val })
          }
        } else if (prop.endsWith('related')) {
          if (!conceptDetails.related.some(r => r.uri === val)) {
            conceptDetails.related.push({ uri: val })
          }
        } else if (prop.endsWith('inScheme')) {
          if (!conceptDetails.inScheme.some(r => r.uri === val)) {
            conceptDetails.inScheme.push({ uri: val })
          }
        } else if (prop.endsWith('exactMatch')) {
          if (!conceptDetails.exactMatch.includes(val)) {
            conceptDetails.exactMatch.push(val)
          }
        } else if (prop.endsWith('closeMatch')) {
          if (!conceptDetails.closeMatch.includes(val)) {
            conceptDetails.closeMatch.push(val)
          }
        } else if (prop.endsWith('broadMatch')) {
          if (!conceptDetails.broadMatch.includes(val)) {
            conceptDetails.broadMatch.push(val)
          }
        } else if (prop.endsWith('narrowMatch')) {
          if (!conceptDetails.narrowMatch.includes(val)) {
            conceptDetails.narrowMatch.push(val)
          }
        } else if (prop.endsWith('relatedMatch')) {
          if (!conceptDetails.relatedMatch.includes(val)) {
            conceptDetails.relatedMatch.push(val)
          }
        } else if (prop.endsWith('identifier')) {
          if (!conceptDetails.identifier.includes(val)) {
            conceptDetails.identifier.push(val)
          }
        } else if (prop.endsWith('created')) {
          if (!conceptDetails.created) {
            conceptDetails.created = val
          }
        } else if (prop.endsWith('modified')) {
          if (!conceptDetails.modified) {
            conceptDetails.modified = val
          }
        } else if (prop.endsWith('status')) {
          if (!conceptDetails.status) {
            // Extract fragment if it's a URI
            conceptDetails.status = val.includes('/') ? val.split('/').pop() || val : val
          }
        } else if (prop.endsWith('seeAlso')) {
          if (!conceptDetails.seeAlso.includes(val)) {
            conceptDetails.seeAlso.push(val)
          }
        }
      }

      // Check if this is actually a ConceptScheme - redirect to scheme viewing if so
      if (types.includes('http://www.w3.org/2004/02/skos/core#ConceptScheme')) {
        logger.info('useConceptData', 'URI is a ConceptScheme, redirecting to scheme view', { uri })
        loading.value = false
        const conceptStore = useConceptStore()
        schemeStore.viewScheme(uri)
        conceptStore.selectConcept(null)
        return
      }

      // Load labels for related concepts
      await loadRelatedLabels(conceptDetails)

      // Load SKOS-XL extended labels
      await loadXLLabels(uri, conceptDetails)

      // Load other (non-SKOS) properties
      await loadOtherProperties(uri, conceptDetails)

      // Check deprecation status from loaded properties
      conceptDetails.deprecated = isDeprecatedFromProperties(conceptDetails.otherProperties)

      // Resolve prefixes for other properties
      if (conceptDetails.otherProperties.length > 0) {
        const predicates = conceptDetails.otherProperties.map(p => p.predicate)
        resolvedPredicates.value = await resolveUris(predicates)
      } else {
        resolvedPredicates.value = new Map()
      }

      // Resolve datatypes for notations
      const notationDatatypes = conceptDetails.notations
        .map(n => n.datatype)
        .filter((d): d is string => !!d)
      if (notationDatatypes.length > 0) {
        const datatypeMap = await resolveUris(notationDatatypes)
        conceptDetails.notations.forEach(n => {
          if (n.datatype) {
            const resolved = datatypeMap.get(n.datatype)
            if (resolved) {
              n.datatype = formatQualifiedName(resolved)
            }
          }
        })
      }

      logger.info('useConceptData', 'Loaded details', {
        labels: conceptDetails.prefLabels.length,
        broader: conceptDetails.broader.length,
        narrower: conceptDetails.narrower.length
      })

      details.value = conceptDetails
    } catch (e: unknown) {
      const errMsg = e && typeof e === 'object' && 'message' in e
        ? (e as { message: string }).message
        : 'Unknown error'
      logger.error('useConceptData', 'Failed to load details', { uri, error: e })
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
