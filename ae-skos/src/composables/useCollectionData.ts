/**
 * useCollectionData - Load SKOS Collection details
 *
 * Loads collection properties and member list for display in CollectionDetails.
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { ref, type Ref } from 'vue'
import { useEndpointStore, useSchemeStore } from '../stores'
import { executeSparql, withPrefixes, logger, resolveUris } from '../services'
import { useLabelResolver } from './useLabelResolver'
import { useOtherProperties, COLLECTION_EXCLUDED_PREDICATES } from './useOtherProperties'
import { useProgressiveLabelLoader } from './useProgressiveLabelLoader'
import { useXLLabels } from './useXLLabels'
import type { CollectionDetails, LabelValue, NotationValue, ConceptRef, LabelPredicateCapabilities } from '../types'

export function useCollectionData() {
  const endpointStore = useEndpointStore()
  const schemeStore = useSchemeStore()
  const { sortLabels } = useLabelResolver()
  const { loadOtherProperties } = useOtherProperties()
  const { loadXLLabels } = useXLLabels()

  // State
  const details = ref<CollectionDetails | null>(null)
  const members = ref<ConceptRef[]>([])
  const loading = ref(false)
  const loadingMembers = ref(false)
  const error = ref<string | null>(null)
  const resolvedPredicates: Ref<Map<string, { prefix: string; localName: string }>> = ref(new Map())

  /**
   * Build query to load collection properties
   * Supports SKOS-XL labels, dct:title, and rdfs:label for broader compatibility
   * Uses capability-aware label detection when available
   */
  function buildDetailsQuery(collectionUri: string, capabilities?: LabelPredicateCapabilities): string {
    // Build label UNION branches based on capabilities
    const labelBranches: string[] = []

    // Always include SKOS core properties (not in capabilities detection)
    labelBranches.push(`{
          <${collectionUri}> ?p ?o .
          BIND(LANG(?o) AS ?lang)
          FILTER(
            ?p = skos:prefLabel ||
            ?p = skos:altLabel ||
            ?p = skos:hiddenLabel ||
            ?p = skos:notation ||
            ?p = skos:definition ||
            ?p = skos:scopeNote ||
            ?p = skos:historyNote ||
            ?p = skos:changeNote ||
            ?p = skos:editorialNote ||
            ?p = skos:note ||
            ?p = skos:example
          )
          BIND(IF(?p = skos:prefLabel, "prefLabel", IF(?p = skos:altLabel, "altLabel", IF(?p = skos:hiddenLabel, "hiddenLabel", ""))) AS ?labelType)
        }`)

    // Add capability-aware label predicates
    if (!capabilities || Object.keys(capabilities).length === 0 || capabilities.xlPrefLabel) {
      labelBranches.push(`{
          <${collectionUri}> skosxl:prefLabel/skosxl:literalForm ?o .
          BIND(skosxl:prefLabel AS ?p)
          BIND(LANG(?o) AS ?lang)
          BIND("xlPrefLabel" AS ?labelType)
        }`)
      labelBranches.push(`{
          <${collectionUri}> skosxl:altLabel/skosxl:literalForm ?o .
          BIND(skosxl:altLabel AS ?p)
          BIND(LANG(?o) AS ?lang)
          BIND("xlAltLabel" AS ?labelType)
        }`)
      labelBranches.push(`{
          <${collectionUri}> skosxl:hiddenLabel/skosxl:literalForm ?o .
          BIND(skosxl:hiddenLabel AS ?p)
          BIND(LANG(?o) AS ?lang)
          BIND("xlHiddenLabel" AS ?labelType)
        }`)
    }

    if (!capabilities || Object.keys(capabilities).length === 0 || capabilities.dctTitle) {
      labelBranches.push(`{
          <${collectionUri}> dct:title ?o .
          BIND(dct:title AS ?p)
          BIND(LANG(?o) AS ?lang)
          BIND("dctTitle" AS ?labelType)
        }`)
    }

    if (!capabilities || Object.keys(capabilities).length === 0 || capabilities.dcTitle) {
      labelBranches.push(`{
          <${collectionUri}> dc:title ?o .
          BIND(dc:title AS ?p)
          BIND(LANG(?o) AS ?lang)
          BIND("dcTitle" AS ?labelType)
        }`)
    }

    if (!capabilities || Object.keys(capabilities).length === 0 || capabilities.rdfsLabel) {
      labelBranches.push(`{
          <${collectionUri}> rdfs:label ?o .
          BIND(rdfs:label AS ?p)
          BIND(LANG(?o) AS ?lang)
          BIND("rdfsLabel" AS ?labelType)
        }`)
    }

    // Documentation properties (always included)
    labelBranches.push(`{
          <${collectionUri}> rdfs:comment ?o .
          BIND(rdfs:comment AS ?p)
          BIND(LANG(?o) AS ?lang)
          BIND("comment" AS ?labelType)
        }`)

    labelBranches.push(`{
          <${collectionUri}> dct:description ?o .
          BIND(dct:description AS ?p)
          BIND(LANG(?o) AS ?lang)
          BIND("description" AS ?labelType)
        }`)

    return withPrefixes(`
      SELECT ?p ?o ?lang ?labelType WHERE {
        ${labelBranches.join('\n        UNION\n        ')}
      }
    `)
  }

  /**
   * Build query to load collection members metadata (no labels).
   * Labels are loaded progressively after this query.
   *
   * Fetches hasNarrower for icon display (leaf vs label) and cross-scheme indicator fields.
   * Uses EXISTS for inCurrentScheme, simple OPTIONAL for displayScheme (client takes first value).
   */
  function buildMembersMetadataQuery(
    collectionUri: string,
    currentSchemeUri: string | null
  ): string {
    return withPrefixes(`
      SELECT DISTINCT ?member ?notation ?hasNarrower ?isCollection ?inCurrentScheme ?displayScheme WHERE {
        <${collectionUri}> skos:member ?member .

        # Detect if member is a collection
        BIND(EXISTS { ?member a skos:Collection } AS ?isCollection)

        ${currentSchemeUri ? `# Boolean: is member in current scheme?
        BIND(EXISTS { ?member skos:inScheme <${currentSchemeUri}> } AS ?inCurrentScheme)` : ''}

        # Get a scheme for badge display (client takes first value found)
        OPTIONAL { ?member skos:inScheme ?displayScheme }

        OPTIONAL { ?member skos:notation ?notation }
        OPTIONAL { ?member skos:narrower ?narrowerChild }
        BIND(BOUND(?narrowerChild) AS ?hasNarrower)
      }
      ORDER BY ?member
      LIMIT 500
    `)
  }

  /**
   * Process detail bindings into CollectionDetails
   * Stores title types separately: dctTitles, dcTitles, rdfsLabels
   * XL labels are loaded separately via loadXLLabels for proper URI tracking
   */
  function processDetailsBindings(
    uri: string,
    bindings: Array<Record<string, { value: string; 'xml:lang'?: string; datatype?: string }>>
  ): CollectionDetails {
    // Group labels by type for separate storage
    const prefLabels: LabelValue[] = []
    const altLabels: LabelValue[] = []
    const hiddenLabels: LabelValue[] = []
    const dctTitles: LabelValue[] = []
    const dcTitles: LabelValue[] = []
    const rdfsLabels: LabelValue[] = []
    const comments: LabelValue[] = []
    const description: LabelValue[] = []
    const notations: NotationValue[] = []
    const definitions: LabelValue[] = []
    const scopeNotes: LabelValue[] = []
    const historyNotes: LabelValue[] = []
    const changeNotes: LabelValue[] = []
    const editorialNotes: LabelValue[] = []
    const notes: LabelValue[] = []
    const examples: LabelValue[] = []

    for (const b of bindings) {
      const predicate = b.p?.value
      const value = b.o?.value
      const lang = b.lang?.value || b.o?.['xml:lang'] || undefined
      const datatype = b.o?.datatype
      const labelType = b.labelType?.value || ''

      if (!predicate || !value) continue

      // Handle labels with type tracking - store each type separately
      // Note: XL labels (xlPrefLabel, xlAltLabel) are just merged into regular labels here
      // since they're from the property path query. Full XL label resources loaded separately.
      if (labelType === 'prefLabel' || labelType === 'xlPrefLabel') {
        prefLabels.push({ value, lang })
      } else if (labelType === 'dctTitle') {
        dctTitles.push({ value, lang })
      } else if (labelType === 'dcTitle') {
        dcTitles.push({ value, lang })
      } else if (labelType === 'rdfsLabel') {
        rdfsLabels.push({ value, lang })
      } else if (labelType === 'comment') {
        comments.push({ value, lang })
      } else if (labelType === 'description') {
        description.push({ value, lang })
      } else if (labelType === 'altLabel' || labelType === 'xlAltLabel') {
        altLabels.push({ value, lang })
      } else if (labelType === 'hiddenLabel' || labelType === 'xlHiddenLabel') {
        hiddenLabels.push({ value, lang })
      } else if (predicate.endsWith('notation')) {
        notations.push({ value, datatype })
      } else if (predicate.endsWith('definition')) {
        definitions.push({ value, lang })
      } else if (predicate.endsWith('scopeNote')) {
        scopeNotes.push({ value, lang })
      } else if (predicate.endsWith('historyNote')) {
        historyNotes.push({ value, lang })
      } else if (predicate.endsWith('changeNote')) {
        changeNotes.push({ value, lang })
      } else if (predicate.endsWith('editorialNote')) {
        editorialNotes.push({ value, lang })
      } else if (predicate.endsWith('example')) {
        examples.push({ value, lang })
      } else if (predicate.endsWith('note')) {
        notes.push({ value, lang })
      }
    }

    return {
      uri,
      prefLabels,
      altLabels,
      hiddenLabels,
      dctTitles,
      dcTitles,
      rdfsLabels,
      comments,
      description,
      definitions,
      scopeNotes,
      historyNotes,
      changeNotes,
      editorialNotes,
      notes,
      examples,
      notations,
      // XL labels initialized empty - loaded separately via loadXLLabels
      prefLabelsXL: [],
      altLabelsXL: [],
      hiddenLabelsXL: [],
      otherProperties: [],
    }
  }

  /**
   * Process member metadata bindings into ConceptRef array (without labels).
   * Labels are loaded progressively after this processing.
   * Also tracks hasNarrower for icon display and cross-scheme indicator fields.
   */
  function processMemberMetadataBindings(
    bindings: Array<Record<string, { value: string; 'xml:lang'?: string }>>
  ): ConceptRef[] {
    // Group by member URI to handle multiple bindings per member
    const memberMap = new Map<string, {
      uri: string
      notation?: string
      hasNarrower?: boolean
      isCollection?: boolean
      inCurrentScheme?: boolean
      displayScheme?: string
    }>()

    for (const b of bindings) {
      const uri = b.member?.value
      if (!uri) continue

      if (!memberMap.has(uri)) {
        memberMap.set(uri, { uri })
      }

      const entry = memberMap.get(uri)!

      if (!entry.notation && b.notation?.value) {
        entry.notation = b.notation.value
      }

      // Track hasNarrower (true if any binding shows narrower exists)
      if (b.hasNarrower?.value === 'true') {
        entry.hasNarrower = true
      }

      // Track isCollection
      if (b.isCollection?.value === 'true') {
        entry.isCollection = true
      }

      // Track inCurrentScheme (boolean from EXISTS check)
      if (b.inCurrentScheme?.value !== undefined && entry.inCurrentScheme === undefined) {
        entry.inCurrentScheme = b.inCurrentScheme.value === 'true'
      }

      // Track displayScheme (use first one found)
      if (b.displayScheme?.value && !entry.displayScheme) {
        entry.displayScheme = b.displayScheme.value
      }
    }

    // Convert to ConceptRef array (labels will be loaded progressively)
    const result: ConceptRef[] = []

    for (const entry of memberMap.values()) {
      const ref: ConceptRef = {
        uri: entry.uri,
        notation: entry.notation,
        hasNarrower: entry.hasNarrower,
        type: entry.isCollection ? 'collection' : 'concept',
      }

      // Set cross-scheme indicator fields (only for concepts, not collections)
      if (!entry.isCollection) {
        if (entry.inCurrentScheme !== undefined) {
          ref.inCurrentScheme = entry.inCurrentScheme
        }
        if (entry.displayScheme) {
          ref.displayScheme = entry.displayScheme
        }
      }

      result.push(ref)
    }

    return result
  }

  /**
   * Load collection details
   */
  async function loadDetails(collectionUri: string) {
    const endpoint = endpointStore.current
    if (!endpoint) return

    loading.value = true
    error.value = null

    logger.info('CollectionData', 'Loading collection details', { uri: collectionUri })

    try {
      // Get collection label capabilities
      const collectionCapabilities = endpoint.analysis?.labelPredicates?.collection

      // Load properties
      const propsQuery = buildDetailsQuery(collectionUri, collectionCapabilities)
      const propsResults = await executeSparql(endpoint, propsQuery, { retries: 1 })
      const collectionDetails = processDetailsBindings(
        collectionUri,
        propsResults.results.bindings as Array<Record<string, { value: string; 'xml:lang'?: string; datatype?: string }>>
      )

      logger.info('CollectionData', 'Loaded collection properties')

      // Load SKOS-XL labels (6/12 real endpoints use xlPrefLabel for collections)
      await loadXLLabels(collectionUri, collectionDetails, { source: 'useCollectionData' })

      // Load other (non-SKOS) properties
      await loadOtherProperties(collectionUri, collectionDetails, {
        excludedPredicates: COLLECTION_EXCLUDED_PREDICATES,
        resolveDatatypes: true,
        source: 'useCollectionData',
      })

      // Resolve prefixes for other properties
      if (collectionDetails.otherProperties.length > 0) {
        const predicates = collectionDetails.otherProperties.map(p => p.predicate)
        resolvedPredicates.value = await resolveUris(predicates)
      } else {
        resolvedPredicates.value = new Map()
      }

      details.value = collectionDetails

      // Load members separately
      loadMembers(collectionUri)
    } catch (e: unknown) {
      const errMsg = e && typeof e === 'object' && 'message' in e
        ? (e as { message: string }).message
        : 'Unknown error'
      logger.error('CollectionData', 'Failed to load collection details', { error: e })
      error.value = `Failed to load collection: ${errMsg}`
      details.value = null
    } finally {
      loading.value = false
    }
  }

  /**
   * Load collection members (separate from main details).
   * Uses progressive label loading for better performance with endpoints
   * that have many languages.
   */
  async function loadMembers(collectionUri: string) {
    const endpoint = endpointStore.current
    if (!endpoint) return

    loadingMembers.value = true

    try {
      const currentSchemeUri = schemeStore.selectedUri

      // Step 1: Load member metadata (without labels)
      const metadataQuery = buildMembersMetadataQuery(collectionUri, currentSchemeUri)
      const metadataResults = await executeSparql(endpoint, metadataQuery, { retries: 1 })
      members.value = processMemberMetadataBindings(
        metadataResults.results.bindings as Array<Record<string, { value: string; 'xml:lang'?: string }>>
      )

      logger.info('CollectionData', `Loaded ${members.value.length} member metadata`)

      // Step 2: Progressive label loading
      // Members can be concepts OR collections - we need to handle both types
      const conceptMembers = members.value.filter(m => m.type === 'concept')
      const collectionMembers = members.value.filter(m => m.type === 'collection')

      const { loadLabelsProgressively } = useProgressiveLabelLoader()

      // Load labels for concepts and collections in parallel
      await Promise.all([
        conceptMembers.length > 0 ? loadLabelsProgressively(
          conceptMembers.map(m => m.uri),
          'concept',
          (resolved) => {
            // Update members with resolved labels
            for (const member of members.value) {
              const label = resolved.get(member.uri)
              if (label) {
                member.label = label.value
                member.lang = label.lang
              }
            }
          }
        ) : Promise.resolve(),

        collectionMembers.length > 0 ? loadLabelsProgressively(
          collectionMembers.map(m => m.uri),
          'collection',
          (resolved) => {
            // Update members with resolved labels
            for (const member of members.value) {
              const label = resolved.get(member.uri)
              if (label) {
                member.label = label.value
                member.lang = label.lang
              }
            }
          }
        ) : Promise.resolve(),
      ])

      // Sort members by label after labels are loaded
      members.value.sort((a, b) => {
        const labelA = a.label || a.uri
        const labelB = b.label || b.uri
        return labelA.localeCompare(labelB)
      })

      logger.info('CollectionData', `Labels loaded for ${members.value.length} members`)
    } catch (e) {
      logger.error('CollectionData', 'Failed to load collection members', { error: e })
      members.value = []
    } finally {
      loadingMembers.value = false
    }
  }

  /**
   * Clear state
   */
  function reset() {
    details.value = null
    members.value = []
    loading.value = false
    loadingMembers.value = false
    error.value = null
    resolvedPredicates.value = new Map()
  }

  return {
    // State
    details,
    members,
    loading,
    loadingMembers,
    error,
    resolvedPredicates,
    // Actions
    loadDetails,
    reset,
    // Utilities (pass through from useLabelResolver)
    sortLabels,
  }
}
