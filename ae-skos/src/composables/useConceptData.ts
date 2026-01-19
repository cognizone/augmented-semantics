/**
 * useConceptData - Concept data loading composable
 *
 * Handles all SPARQL queries and data loading for concept details,
 * including labels, properties, relations, and metadata.
 *
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import { ref, type Ref } from 'vue'
import { useEndpointStore, useSchemeStore, useConceptStore } from '../stores'
import { executeSparql, withPrefixes, logger, resolveUris, formatQualifiedName } from '../services'
import { useDeprecation } from './useDeprecation'
import { useXLLabels } from './useXLLabels'
import { useOtherProperties, CONCEPT_EXCLUDED_PREDICATES } from './useOtherProperties'
import { useLabelResolver } from './useLabelResolver'
import { LABEL_PREDICATES } from '../constants'
import type { ConceptDetails } from '../types'

export function useConceptData() {
  const endpointStore = useEndpointStore()
  const schemeStore = useSchemeStore()
  const { isDeprecatedFromProperties } = useDeprecation()
  const { loadXLLabels } = useXLLabels()
  const { loadOtherProperties } = useOtherProperties()
  const { selectLabelByPriority } = useLabelResolver()

  // State
  const details: Ref<ConceptDetails | null> = ref(null)
  const loading = ref(false)
  const error: Ref<string | null> = ref(null)
  const resolvedPredicates: Ref<Map<string, { prefix: string; localName: string }>> = ref(new Map())

  /**
   * Load collections that contain this concept (inverse of skos:member)
   */
  async function loadCollections(uri: string, conceptDetails: ConceptDetails): Promise<void> {
    const endpoint = endpointStore.current
    if (!endpoint) return

    const query = withPrefixes(`
      SELECT DISTINCT ?collection
      WHERE {
        ?collection skos:member <${uri}> .
      }
    `)

    try {
      const results = await executeSparql(endpoint, query, { retries: 0 })

      for (const binding of results.results.bindings) {
        const collectionUri = binding.collection?.value
        if (collectionUri && !conceptDetails.collections.some(c => c.uri === collectionUri)) {
          conceptDetails.collections.push({ uri: collectionUri, type: 'collection' })
        }
      }

      logger.debug('useConceptData', 'Loaded collections', {
        uri,
        count: conceptDetails.collections.length
      })
    } catch (e) {
      logger.warn('useConceptData', 'Failed to load collections', { uri, error: e })
    }
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
      ...conceptDetails.inScheme,
      ...conceptDetails.collections
    ]

    if (!allRefs.length) return

    const uris = allRefs.map(r => `<${r.uri}>`).join(' ')

    /// Fetch notation, prefLabel (incl. XL), altLabel, hiddenLabel, dc/dct:title (for schemes), and hasNarrower
    const query = withPrefixes(`
      SELECT ?concept ?notation ?label ?labelLang ?labelType ?hasNarrower
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
            BIND("dctTitle" AS ?labelType)
          } UNION {
            ?concept dc:title ?label .
            BIND("dcTitle" AS ?labelType)
          } UNION {
            ?concept rdfs:label ?label .
            BIND("rdfsLabel" AS ?labelType)
          }
          BIND(LANG(?label) AS ?labelLang)
        }
        OPTIONAL { ?concept skos:narrower ?narrowerChild }
        BIND(BOUND(?narrowerChild) AS ?hasNarrower)
      }
    `)

    try {
      const results = await executeSparql(endpoint, query, { retries: 0 })

      // Group by concept URI
      const conceptData = new Map<string, {
        notation?: string
        labels: { value: string; lang: string; type: string }[]
        hasNarrower?: boolean
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

        // Track hasNarrower (true if any binding shows narrower exists)
        if (b.hasNarrower?.value === 'true') {
          data.hasNarrower = true
        }
      }

      // Update refs with best label and notation
      allRefs.forEach(ref => {
        const data = conceptData.get(ref.uri)
        if (!data) return

        ref.notation = data.notation

        // Pick best label using centralized resolver (uses LABEL_PRIORITY internally)
        const selected = selectLabelByPriority(data.labels)
        if (selected) {
          ref.label = selected.value
          ref.lang = selected.lang || undefined
        }

        // Set hasNarrower for concept icons (only for concept refs, not schemes/collections)
        if (data.hasNarrower !== undefined && ref.type !== 'scheme' && ref.type !== 'collection') {
          ref.hasNarrower = data.hasNarrower
        }
      })
    } catch (e) {
      logger.warn('useConceptData', 'Failed to load related labels', { error: e })
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
          rdfs:label, dct:title, dc:title,
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
        dctTitles: [],
        dcTitles: [],
        rdfsLabels: [],
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
        collections: [],
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
        } else if (prop === LABEL_PREDICATES.rdfsLabel.uri) {
          // rdfs:label - stored separately for display
          conceptDetails.rdfsLabels.push({ value: val, lang })
        } else if (prop === LABEL_PREDICATES.dctTitle.uri) {
          // dct:title (Dublin Core Terms)
          conceptDetails.dctTitles.push({ value: val, lang })
        } else if (prop === LABEL_PREDICATES.dcTitle.uri) {
          // dc:title (Dublin Core Elements)
          conceptDetails.dcTitles.push({ value: val, lang })
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

      // Load collections that contain this concept
      await loadCollections(uri, conceptDetails)

      // Load labels for related concepts and collections
      await loadRelatedLabels(conceptDetails)

      // Load SKOS-XL extended labels
      await loadXLLabels(uri, conceptDetails, { source: 'useConceptData' })

      // Load other (non-SKOS) properties
      await loadOtherProperties(uri, conceptDetails, {
        excludedPredicates: CONCEPT_EXCLUDED_PREDICATES,
        resolveDatatypes: true,
        source: 'useConceptData',
      })

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
        narrower: conceptDetails.narrower.length,
        collections: conceptDetails.collections.length
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
