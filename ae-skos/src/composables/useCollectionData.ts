/**
 * useCollectionData - Load SKOS Collection details
 *
 * Loads collection properties and member list for display in CollectionDetails.
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { ref, type Ref } from 'vue'
import { useEndpointStore } from '../stores'
import { executeSparql, withPrefixes, logger, resolveUris } from '../services'
import { useLabelResolver } from './useLabelResolver'
import { useOtherProperties, COLLECTION_EXCLUDED_PREDICATES } from './useOtherProperties'
import { LABEL_PRIORITY } from '../constants'
import type { CollectionDetails, LabelValue, NotationValue, ConceptRef } from '../types'

export function useCollectionData() {
  const endpointStore = useEndpointStore()
  const { selectLabel, sortLabels } = useLabelResolver()
  const { loadOtherProperties } = useOtherProperties()

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
   */
  function buildDetailsQuery(collectionUri: string): string {
    return withPrefixes(`
      SELECT ?p ?o ?lang ?labelType WHERE {
        {
          <${collectionUri}> ?p ?o .
          BIND(LANG(?o) AS ?lang)
          FILTER(
            ?p = skos:prefLabel ||
            ?p = skos:altLabel ||
            ?p = skos:notation ||
            ?p = skos:definition ||
            ?p = skos:scopeNote ||
            ?p = skos:note
          )
          BIND(IF(?p = skos:prefLabel, "prefLabel", IF(?p = skos:altLabel, "altLabel", "")) AS ?labelType)
        }
        UNION
        {
          <${collectionUri}> skosxl:prefLabel/skosxl:literalForm ?o .
          BIND(skosxl:prefLabel AS ?p)
          BIND(LANG(?o) AS ?lang)
          BIND("xlPrefLabel" AS ?labelType)
        }
        UNION
        {
          <${collectionUri}> skosxl:altLabel/skosxl:literalForm ?o .
          BIND(skosxl:altLabel AS ?p)
          BIND(LANG(?o) AS ?lang)
          BIND("xlAltLabel" AS ?labelType)
        }
        UNION
        {
          <${collectionUri}> dct:title ?o .
          BIND(dct:title AS ?p)
          BIND(LANG(?o) AS ?lang)
          BIND("dctTitle" AS ?labelType)
        }
        UNION
        {
          <${collectionUri}> dc:title ?o .
          BIND(dc:title AS ?p)
          BIND(LANG(?o) AS ?lang)
          BIND("dcTitle" AS ?labelType)
        }
        UNION
        {
          <${collectionUri}> rdfs:label ?o .
          BIND(rdfs:label AS ?p)
          BIND(LANG(?o) AS ?lang)
          BIND("rdfsLabel" AS ?labelType)
        }
      }
    `)
  }

  /**
   * Build query to load collection members
   * Supports SKOS-XL labels, dct:title, dc:title, and rdfs:label for broader compatibility
   * Also fetches hasNarrower for icon display (leaf vs label)
   */
  function buildMembersQuery(collectionUri: string): string {
    return withPrefixes(`
      SELECT DISTINCT ?member ?label ?labelLang ?labelType ?notation ?hasNarrower WHERE {
        <${collectionUri}> skos:member ?member .

        OPTIONAL {
          {
            ?member skos:prefLabel ?label .
            BIND("prefLabel" AS ?labelType)
          } UNION {
            ?member skosxl:prefLabel/skosxl:literalForm ?label .
            BIND("xlPrefLabel" AS ?labelType)
          } UNION {
            ?member dct:title ?label .
            BIND("dctTitle" AS ?labelType)
          } UNION {
            ?member dc:title ?label .
            BIND("dcTitle" AS ?labelType)
          } UNION {
            ?member rdfs:label ?label .
            BIND("rdfsLabel" AS ?labelType)
          }
          BIND(LANG(?label) AS ?labelLang)
        }
        OPTIONAL { ?member skos:notation ?notation }
        OPTIONAL { ?member skos:narrower ?narrowerChild }
        BIND(BOUND(?narrowerChild) AS ?hasNarrower)
      }
      ORDER BY ?member
      LIMIT 500
    `)
  }

  /**
   * Helper: select all labels of the highest-priority type that has labels
   */
  function selectLabelsByPriority(
    labels: { value: string; lang?: string; type: string }[],
    priority: readonly string[] = LABEL_PRIORITY
  ): LabelValue[] {
    for (const type of priority) {
      const ofType = labels.filter(l => l.type === type)
      if (ofType.length > 0) {
        return ofType.map(l => ({ value: l.value, lang: l.lang }))
      }
    }
    return []
  }

  /**
   * Process detail bindings into CollectionDetails
   * Stores title types separately: dctTitles, dcTitles, rdfsLabels
   */
  function processDetailsBindings(
    uri: string,
    bindings: Array<Record<string, { value: string; 'xml:lang'?: string; datatype?: string }>>
  ): CollectionDetails {
    // Group labels by type for separate storage
    const prefLabels: LabelValue[] = []
    const altLabels: LabelValue[] = []
    const dctTitles: LabelValue[] = []
    const dcTitles: LabelValue[] = []
    const rdfsLabels: LabelValue[] = []
    const notations: NotationValue[] = []
    const definitions: LabelValue[] = []
    const scopeNotes: LabelValue[] = []
    const notes: LabelValue[] = []

    for (const b of bindings) {
      const predicate = b.p?.value
      const value = b.o?.value
      const lang = b.lang?.value || b.o?.['xml:lang'] || undefined
      const datatype = b.o?.datatype
      const labelType = b.labelType?.value || ''

      if (!predicate || !value) continue

      // Handle labels with type tracking - store each type separately
      if (labelType === 'prefLabel' || labelType === 'xlPrefLabel') {
        prefLabels.push({ value, lang })
      } else if (labelType === 'dctTitle') {
        dctTitles.push({ value, lang })
      } else if (labelType === 'dcTitle') {
        dcTitles.push({ value, lang })
      } else if (labelType === 'rdfsLabel') {
        rdfsLabels.push({ value, lang })
      } else if (labelType === 'altLabel' || labelType === 'xlAltLabel') {
        altLabels.push({ value, lang })
      } else if (predicate.endsWith('notation')) {
        notations.push({ value, datatype })
      } else if (predicate.endsWith('definition')) {
        definitions.push({ value, lang })
      } else if (predicate.endsWith('scopeNote')) {
        scopeNotes.push({ value, lang })
      } else if (predicate.endsWith('note')) {
        notes.push({ value, lang })
      }
    }

    return {
      uri,
      prefLabels,
      altLabels,
      dctTitles,
      dcTitles,
      rdfsLabels,
      definitions,
      scopeNotes,
      notes,
      notations,
      otherProperties: [],
    }
  }

  /**
   * Process member bindings into ConceptRef array
   * Uses priority-based label selection: prefLabel > xlPrefLabel > title > rdfsLabel
   * Also tracks hasNarrower for icon display
   */
  function processMemberBindings(
    bindings: Array<Record<string, { value: string; 'xml:lang'?: string }>>
  ): ConceptRef[] {
    // Group by member URI to handle multiple labels with type tracking
    const memberMap = new Map<string, {
      uri: string
      labels: { value: string; lang?: string; type: string }[]
      notation?: string
      hasNarrower?: boolean
    }>()

    for (const b of bindings) {
      const uri = b.member?.value
      if (!uri) continue

      if (!memberMap.has(uri)) {
        memberMap.set(uri, {
          uri,
          labels: [],
          notation: b.notation?.value,
        })
      }

      const entry = memberMap.get(uri)!

      if (b.label?.value) {
        const lang = b.labelLang?.value || b.label['xml:lang'] || undefined
        const type = b.labelType?.value || 'prefLabel'
        entry.labels.push({ value: b.label.value, lang, type })
      }

      if (!entry.notation && b.notation?.value) {
        entry.notation = b.notation.value
      }

      // Track hasNarrower (true if any binding shows narrower exists)
      if (b.hasNarrower?.value === 'true') {
        entry.hasNarrower = true
      }
    }

    // Convert with priority-based label selection
    const result: ConceptRef[] = []

    for (const entry of memberMap.values()) {
      let bestLabel: LabelValue | undefined

      for (const type of LABEL_PRIORITY) {
        const labelsOfType = entry.labels.filter(l => l.type === type)
        if (labelsOfType.length > 0) {
          bestLabel = selectLabel(labelsOfType.map(l => ({ value: l.value, lang: l.lang })))
          break
        }
      }

      result.push({
        uri: entry.uri,
        label: bestLabel?.value,
        notation: entry.notation,
        lang: bestLabel?.lang,
        hasNarrower: entry.hasNarrower,
      })
    }

    // Sort by label
    result.sort((a, b) => {
      const labelA = a.label || a.uri
      const labelB = b.label || b.uri
      return labelA.localeCompare(labelB)
    })

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
      // Load properties
      const propsQuery = buildDetailsQuery(collectionUri)
      const propsResults = await executeSparql(endpoint, propsQuery, { retries: 1 })
      const collectionDetails = processDetailsBindings(
        collectionUri,
        propsResults.results.bindings as Array<Record<string, { value: string; 'xml:lang'?: string; datatype?: string }>>
      )

      logger.info('CollectionData', 'Loaded collection properties')

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
   * Load collection members (separate from main details)
   */
  async function loadMembers(collectionUri: string) {
    const endpoint = endpointStore.current
    if (!endpoint) return

    loadingMembers.value = true

    try {
      const query = buildMembersQuery(collectionUri)
      const results = await executeSparql(endpoint, query, { retries: 1 })
      members.value = processMemberBindings(
        results.results.bindings as Array<Record<string, { value: string; 'xml:lang'?: string }>>
      )

      // Update member count in details
      if (details.value) {
        details.value.memberCount = members.value.length
      }

      logger.info('CollectionData', `Loaded ${members.value.length} members`)
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
