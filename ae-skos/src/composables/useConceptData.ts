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
import { useProgressiveLabelLoader } from './useProgressiveLabelLoader'
import { LABEL_PREDICATES } from '../constants'
import type { ConceptDetails, ConceptRef, SkosResourceType } from '../types'

export function useConceptData() {
  const endpointStore = useEndpointStore()
  const schemeStore = useSchemeStore()
  const { isDeprecatedFromProperties, isDeprecatedFromBinding, getDeprecationSparqlClauses, getDeprecationSelectVars } = useDeprecation()
  const { loadXLLabels } = useXLLabels()
  const { loadOtherProperties } = useOtherProperties()

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
   * Load labels for a specific set of concept refs using progressive loading.
   * First loads metadata (notation, hasNarrower, etc.), then progressively loads labels.
   *
   * @param refs - The concept refs to load labels for
   * @param propertyName - Optional property name for logging
   * @param resourceType - The resource type for capability-aware label loading (default: 'concept')
   * @param options.skipSchemeCheck - Skip cross-scheme queries (for narrower concepts which are always same-scheme)
   * @see /spec/ae-skos/sko04-ConceptDetails.md - Progressive label loading
   */
  async function loadLabelsForRefs(
    refs: ConceptRef[],
    propertyName?: string,
    resourceType: SkosResourceType = 'concept',
    options?: { skipSchemeCheck?: boolean }
  ): Promise<void> {
    if (!refs.length) return

    const endpoint = endpointStore.current
    if (!endpoint) return

    const startTime = performance.now()
    const uris = refs.map(r => `<${r.uri}>`).join(' ')
    const currentSchemeUri = schemeStore.selectedUri

    // Get deprecation SPARQL clauses based on enabled rules
    const deprecationSelectVars = getDeprecationSelectVars()
    const deprecationOptionalClauses = getDeprecationSparqlClauses('?concept')

    // Skip scheme checking for narrower concepts (they're always same-scheme by SKOS semantics)
    const includeSchemeCheck = !options?.skipSchemeCheck && currentSchemeUri

    // Step 1: Load metadata (notation, hasNarrower, optionally inCurrentScheme/displayScheme, deprecation) - no labels
    // This query returns one row per concept (efficient, no label explosion)
    const metadataQuery = withPrefixes(`
      SELECT ?concept ?notation ?hasNarrower${includeSchemeCheck ? ' ?inCurrentScheme ?displayScheme' : ''}${deprecationSelectVars ? ' ' + deprecationSelectVars : ''}
      WHERE {
        VALUES ?concept { ${uris} }
        OPTIONAL { ?concept skos:notation ?notation }
        ${includeSchemeCheck ? `BIND(EXISTS { ?concept skos:inScheme <${currentSchemeUri}> } AS ?inCurrentScheme)` : ''}
        ${includeSchemeCheck ? 'OPTIONAL { ?concept skos:inScheme ?displayScheme }' : ''}
        OPTIONAL { ?concept skos:narrower ?narrowerChild }
        BIND(BOUND(?narrowerChild) AS ?hasNarrower)
        ${deprecationOptionalClauses}
      }
    `)

    try {
      const metadataResults = await executeSparql(endpoint, metadataQuery, { retries: 0 })

      // Process metadata
      const conceptData = new Map<string, {
        notation?: string
        hasNarrower?: boolean
        inCurrentScheme?: boolean
        displayScheme?: string
        deprecated?: boolean
      }>()

      for (const b of metadataResults.results.bindings) {
        const uri = b.concept?.value
        if (!uri) continue

        if (!conceptData.has(uri)) {
          conceptData.set(uri, {})
        }

        const data = conceptData.get(uri)!

        if (b.notation?.value && !data.notation) {
          data.notation = b.notation.value
        }

        // Track hasNarrower (true if any binding shows narrower exists)
        if (b.hasNarrower?.value === 'true') {
          data.hasNarrower = true
        }

        // Track inCurrentScheme (boolean from EXISTS check)
        if (b.inCurrentScheme?.value !== undefined && data.inCurrentScheme === undefined) {
          data.inCurrentScheme = b.inCurrentScheme.value === 'true'
        }

        // Track displayScheme (use first one found)
        if (b.displayScheme?.value && !data.displayScheme) {
          data.displayScheme = b.displayScheme.value
        }

        // Track deprecated status (true if any binding indicates deprecated)
        if (!data.deprecated) {
          data.deprecated = isDeprecatedFromBinding(b)
        }
      }

      // Update refs with metadata
      refs.forEach(ref => {
        const data = conceptData.get(ref.uri)
        if (!data) return

        ref.notation = data.notation

        // Set hasNarrower for concept icons (only for concept refs, not schemes/collections)
        if (data.hasNarrower !== undefined && ref.type !== 'scheme' && ref.type !== 'collection') {
          ref.hasNarrower = data.hasNarrower
        }

        // Set cross-scheme indicator fields (only for concept refs, not schemes/collections)
        if (ref.type !== 'scheme' && ref.type !== 'collection') {
          if (data.inCurrentScheme !== undefined) {
            ref.inCurrentScheme = data.inCurrentScheme
          }
          if (data.displayScheme) {
            ref.displayScheme = data.displayScheme
          }
        }

        // Set deprecated status
        if (data.deprecated !== undefined) {
          ref.deprecated = data.deprecated
        }
      })

      const metadataElapsed = performance.now() - startTime
      logger.debug('useConceptData', `Metadata loaded for ${propertyName || 'refs'}`, {
        count: refs.length,
        elapsed: `${metadataElapsed.toFixed(0)}ms`
      })

      // Step 2: Progressive label loading
      const { loadLabelsProgressively } = useProgressiveLabelLoader()
      await loadLabelsProgressively(
        refs.map(r => r.uri),
        resourceType,
        (resolved) => {
          // Update refs with resolved labels reactively
          for (const ref of refs) {
            const label = resolved.get(ref.uri)
            if (label) {
              ref.label = label.value
              ref.lang = label.lang
            }
          }
        }
      )

      // Sort refs after labels are loaded
      if (options?.skipSchemeCheck) {
        // Simple sort for narrower: notation first, then by label
        // No scheme-based grouping since narrower is always same-scheme
        refs.sort((a, b) => {
          // Sort by notation (numeric-aware for codes like p2, p10)
          if (a.notation && b.notation) {
            return a.notation.localeCompare(b.notation, undefined, { numeric: true })
          }
          // Items with notation come before items without
          if (a.notation && !b.notation) return -1
          if (!a.notation && b.notation) return 1

          // Finally sort by label (fall back to URI fragment for display)
          const aLabel = a.label || a.uri.split(/[#/]/).pop() || a.uri
          const bLabel = b.label || b.uri.split(/[#/]/).pop() || b.uri
          return aLabel.localeCompare(bLabel)
        })
      } else {
        // Full sort with scheme grouping for broader/related
        // Sort: current scheme first, then by scheme, then by notation, then by label
        refs.sort((a, b) => {
          // Current scheme items first (treat undefined as external)
          const aInCurrent = a.inCurrentScheme ?? (a.type === 'scheme' || a.type === 'collection')
          const bInCurrent = b.inCurrentScheme ?? (b.type === 'scheme' || b.type === 'collection')
          if (aInCurrent !== bInCurrent) {
            return aInCurrent ? -1 : 1
          }

          // Group by display scheme (for external items)
          const aScheme = a.displayScheme || ''
          const bScheme = b.displayScheme || ''
          if (aScheme !== bScheme) {
            return aScheme.localeCompare(bScheme)
          }

          // Sort by notation (numeric-aware for codes like p2, p10)
          if (a.notation && b.notation) {
            return a.notation.localeCompare(b.notation, undefined, { numeric: true })
          }
          // Items with notation come before items without
          if (a.notation && !b.notation) return -1
          if (!a.notation && b.notation) return 1

          // Finally sort by label (fall back to URI fragment for display)
          const aLabel = a.label || a.uri.split(/[#/]/).pop() || a.uri
          const bLabel = b.label || b.uri.split(/[#/]/).pop() || b.uri
          return aLabel.localeCompare(bLabel)
        })
      }

      const totalElapsed = performance.now() - startTime
      logger.debug('useConceptData', `Labels loaded for ${propertyName || 'refs'}`, {
        count: refs.length,
        totalElapsed: `${totalElapsed.toFixed(0)}ms`
      })
    } catch (e) {
      logger.warn('useConceptData', `Failed to load labels for ${propertyName || 'refs'}`, { error: e })
    }
  }

  /**
   * Load complete concept details
   */
  async function loadDetails(uri: string): Promise<void> {
    const endpoint = endpointStore.current
    if (!endpoint) return

    const startTime = performance.now()
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
          dc:identifier, dct:created, dct:modified, dct:issued, dct:status,
          dct:creator, dct:publisher, dct:rights, dct:license, cc:license,
          owl:versionInfo, rdfs:seeAlso,
          rdfs:comment, dct:description
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
        comments: [],
        description: [],
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
        } else if (prop.endsWith('comment')) {
          // rdfs:comment
          conceptDetails.comments.push({ value: val, lang })
        } else if (prop.endsWith('description')) {
          // dct:description
          conceptDetails.description.push({ value: val, lang })
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
        } else if (prop.endsWith('issued')) {
          if (!conceptDetails.issued) {
            conceptDetails.issued = val
          }
        } else if (prop.endsWith('versionInfo')) {
          if (!conceptDetails.versionInfo) {
            conceptDetails.versionInfo = val
          }
        } else if (prop.endsWith('creator')) {
          if (!conceptDetails.creator.includes(val)) {
            conceptDetails.creator.push(val)
          }
        } else if (prop.endsWith('publisher')) {
          if (!conceptDetails.publisher.includes(val)) {
            conceptDetails.publisher.push(val)
          }
        } else if (prop.endsWith('rights')) {
          if (!conceptDetails.rights.includes(val)) {
            conceptDetails.rights.push(val)
          }
        } else if (prop.endsWith('ns#license')) {
          // cc:license (Creative Commons)
          if (!conceptDetails.ccLicense.includes(val)) {
            conceptDetails.ccLicense.push(val)
          }
        } else if (prop.endsWith('license')) {
          // dct:license (Dublin Core)
          if (!conceptDetails.license.includes(val)) {
            conceptDetails.license.push(val)
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

      const mainQueryTime = performance.now() - startTime
      logger.info('useConceptData', `Main query complete in ${mainQueryTime.toFixed(0)}ms - rendering immediately`, {
        labels: conceptDetails.prefLabels.length,
        broader: conceptDetails.broader.length,
        narrower: conceptDetails.narrower.length
      })

      // Render immediately with URI fragments as temporary labels
      // UI will update progressively as async operations complete
      details.value = conceptDetails
      loading.value = false

      // Fire async updates - UI will update progressively as each completes
      // Don't await - these run in background and update reactively
      // IMPORTANT: Use details.value (reactive proxy) not conceptDetails (plain object)
      // so Vue detects nested property changes
      const reactiveDetails = details.value!

      // Load labels per property type, smallest first for fastest feedback
      // These run in parallel but smaller queries return faster
      // Typical sizes: broader (1-3), inScheme (1-2), related (0-10), narrower (1-100+)
      // Pass resource type for capability-aware label loading
      Promise.all([
        loadLabelsForRefs(reactiveDetails.broader, 'broader', 'concept'),
        loadLabelsForRefs(reactiveDetails.inScheme, 'inScheme', 'scheme'),
        loadLabelsForRefs(reactiveDetails.related, 'related', 'concept'),
        loadLabelsForRefs(reactiveDetails.narrower, 'narrower', 'concept', { skipSchemeCheck: true }),  // largest, loads last; no scheme check since narrower is always same-scheme
        // Collections are discovered first, then labels loaded
        loadCollections(uri, reactiveDetails).then(() =>
          loadLabelsForRefs(reactiveDetails.collections, 'collections', 'collection')
        ),
        loadXLLabels(uri, reactiveDetails, { source: 'useConceptData' }),
        loadOtherProperties(uri, reactiveDetails, {
          excludedPredicates: CONCEPT_EXCLUDED_PREDICATES,
          resolveDatatypes: true,
          source: 'useConceptData',
        }).then(async () => {
          // These depend on otherProperties being loaded
          reactiveDetails.deprecated = isDeprecatedFromProperties(reactiveDetails.otherProperties)

          if (reactiveDetails.otherProperties.length > 0) {
            const predicates = reactiveDetails.otherProperties.map(p => p.predicate)
            resolvedPredicates.value = await resolveUris(predicates)
          } else {
            resolvedPredicates.value = new Map()
          }

          // Resolve datatypes for notations
          const notationDatatypes = reactiveDetails.notations
            .map(n => n.datatype)
            .filter((d): d is string => !!d)
          if (notationDatatypes.length > 0) {
            const datatypeMap = await resolveUris(notationDatatypes)
            reactiveDetails.notations.forEach(n => {
              if (n.datatype) {
                const resolved = datatypeMap.get(n.datatype)
                if (resolved) {
                  n.datatype = formatQualifiedName(resolved)
                }
              }
            })
          }
        }),
      ]).then(() => {
        const totalTime = performance.now() - startTime
        logger.info('useConceptData', `All async loads complete in ${totalTime.toFixed(0)}ms (${(totalTime - mainQueryTime).toFixed(0)}ms after render)`, {
          collections: reactiveDetails.collections.length,
          otherProperties: reactiveDetails.otherProperties.length
        })
      })
    } catch (e: unknown) {
      const errMsg = e && typeof e === 'object' && 'message' in e
        ? (e as { message: string }).message
        : 'Unknown error'
      logger.error('useConceptData', 'Failed to load details', { uri, error: e })
      error.value = `Failed to load details: ${errMsg}`
      details.value = null
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
