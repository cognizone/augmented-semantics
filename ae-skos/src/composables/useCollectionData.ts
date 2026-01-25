/**
 * useCollectionData - Load SKOS Collection details
 *
 * Loads collection properties and member list for display in CollectionDetails.
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { ref, type Ref } from 'vue'
import { useEndpointStore, useSchemeStore, useSettingsStore } from '../stores'
import { executeSparql, withPrefixes, logger, resolveUris, endpointHasCollections } from '../services'
import { useLabelResolver } from './useLabelResolver'
import { useOtherProperties, COLLECTION_EXCLUDED_PREDICATES } from './useOtherProperties'
import { useProgressiveLabelLoader } from './useProgressiveLabelLoader'
import { useXLLabels } from './useXLLabels'
import { PRED } from '../constants'
import { getUriFragment } from '../utils/displayUtils'
import type { CollectionDetails, LabelValue, NotationValue, ConceptRef, LabelPredicateCapabilities, EndpointAnalysis } from '../types'

export function useCollectionData() {
  const endpointStore = useEndpointStore()
  const schemeStore = useSchemeStore()
  const settingsStore = useSettingsStore()
  const { sortLabels } = useLabelResolver()
  const { loadOtherProperties } = useOtherProperties()
  const { loadXLLabels } = useXLLabels()

  // State
  const details = ref<CollectionDetails | null>(null)
  const members = ref<ConceptRef[]>([])
  const loading = ref(false)
  const loadingMembers = ref(false)
  const loadingMemberLabels = ref(false)
  const membersLoaded = ref(false)
  const labelsResolvedCount = ref(0)
  const hierarchyLoading = ref(false)
  const schemeLoading = ref(false)
  const memberCount = ref<number | null>(null)
  const error = ref<string | null>(null)
  const resolvedPredicates: Ref<Map<string, { prefix: string; localName: string }>> = ref(new Map())
  const memberUriSet = new Set<string>()
  let detailsRequestId = 0
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

    labelBranches.push(`{
          <${collectionUri}> skos:inScheme ?o .
          BIND(skos:inScheme AS ?p)
          BIND("inScheme" AS ?labelType)
        }`)

    // Metadata predicates (always included)
    labelBranches.push(`{
          <${collectionUri}> owl:deprecated ?o .
          BIND(owl:deprecated AS ?p)
          BIND("deprecated" AS ?labelType)
        }`)

    labelBranches.push(`{
          <${collectionUri}> dct:created ?o .
          BIND(dct:created AS ?p)
          BIND("created" AS ?labelType)
        }`)

    labelBranches.push(`{
          <${collectionUri}> dct:modified ?o .
          BIND(dct:modified AS ?p)
          BIND("modified" AS ?labelType)
        }`)

    labelBranches.push(`{
          <${collectionUri}> dct:issued ?o .
          BIND(dct:issued AS ?p)
          BIND("issued" AS ?labelType)
        }`)

    labelBranches.push(`{
          <${collectionUri}> owl:versionInfo ?o .
          BIND(owl:versionInfo AS ?p)
          BIND("versionInfo" AS ?labelType)
        }`)

    labelBranches.push(`{
          <${collectionUri}> dct:status ?o .
          BIND(dct:status AS ?p)
          BIND("status" AS ?labelType)
        }`)

    labelBranches.push(`{
          <${collectionUri}> dc:identifier ?o .
          BIND(dc:identifier AS ?p)
          BIND("identifier" AS ?labelType)
        }`)

    labelBranches.push(`{
          <${collectionUri}> dct:creator ?o .
          BIND(dct:creator AS ?p)
          BIND("creator" AS ?labelType)
        }`)

    labelBranches.push(`{
          <${collectionUri}> dct:publisher ?o .
          BIND(dct:publisher AS ?p)
          BIND("publisher" AS ?labelType)
        }`)

    labelBranches.push(`{
          <${collectionUri}> dct:rights ?o .
          BIND(dct:rights AS ?p)
          BIND("rights" AS ?labelType)
        }`)

    labelBranches.push(`{
          <${collectionUri}> dct:license ?o .
          BIND(dct:license AS ?p)
          BIND("license" AS ?labelType)
        }`)

    labelBranches.push(`{
          <${collectionUri}> cc:license ?o .
          BIND(cc:license AS ?p)
          BIND("ccLicense" AS ?labelType)
        }`)

    labelBranches.push(`{
          <${collectionUri}> rdfs:seeAlso ?o .
          BIND(rdfs:seeAlso AS ?p)
          BIND("seeAlso" AS ?labelType)
        }`)

    return withPrefixes(`
      SELECT ?p ?o ?lang ?labelType WHERE {
        ${labelBranches.join('\n        UNION\n        ')}
      }
    `)
  }

  /**
   * Build query to load concept members (fast, no expensive metadata).
   */
  function buildConceptMembersBaseQuery(collectionUri: string): string {
    return withPrefixes(`
      SELECT DISTINCT ?member ?notation ?isCollection WHERE {
        <${collectionUri}> skos:member ?member .
        ?member a skos:Concept .
        BIND(false AS ?isCollection)
        OPTIONAL { ?member skos:notation ?notation }
      }
      ORDER BY ?member
    `)
  }

  /**
   * Build query to load collection members (fast, no expensive metadata).
   */
  function buildCollectionMembersBaseQuery(collectionUri: string): string {
    return withPrefixes(`
      SELECT DISTINCT ?member ?notation ?isCollection WHERE {
        <${collectionUri}> skos:member ?member .
        BIND(EXISTS {
          { ?member a skos:Collection }
          UNION
          { ?member skos:member ?child }
        } AS ?isCollection)
        FILTER(?isCollection = true)
        OPTIONAL { ?member skos:notation ?notation }
      }
      ORDER BY ?member
    `)
  }

  function buildMemberSchemeQuery(
    memberUris: string[],
    schemeUri: string,
    relationships?: EndpointAnalysis['relationships']
  ): string | null {
    if (!relationships || memberUris.length === 0) return null

    const patterns: string[] = []

    if (relationships.hasInScheme) {
      patterns.push(`{ ?member skos:inScheme <${schemeUri}> . }`)
    }
    if (relationships.hasTopConceptOf) {
      patterns.push(`{ ?member skos:topConceptOf <${schemeUri}> . }`)
    }
    if (relationships.hasHasTopConcept) {
      patterns.push(`{ <${schemeUri}> skos:hasTopConcept ?member . }`)
    }

    const topPatterns: string[] = []
    if (relationships.hasTopConceptOf) {
      topPatterns.push(`?top skos:topConceptOf <${schemeUri}> .`)
    }
    if (relationships.hasHasTopConcept) {
      topPatterns.push(`<${schemeUri}> skos:hasTopConcept ?top .`)
    }

    const hasTransitive = relationships.hasBroaderTransitive || relationships.hasNarrowerTransitive
    if (topPatterns.length > 0) {
      if (hasTransitive) {
        if (relationships.hasBroaderTransitive) {
          for (const topPattern of topPatterns) {
            patterns.push(`{ ?member skos:broaderTransitive ?top . ${topPattern} }`)
          }
        }
        if (relationships.hasNarrowerTransitive) {
          for (const topPattern of topPatterns) {
            patterns.push(`{ ?top skos:narrowerTransitive ?member . ${topPattern} }`)
          }
        }
      } else {
        if (relationships.hasBroader) {
          for (const topPattern of topPatterns) {
            patterns.push(`{ ?member skos:broader+ ?top . ${topPattern} }`)
          }
        }
        if (relationships.hasNarrower) {
          for (const topPattern of topPatterns) {
            patterns.push(`{ ?top skos:narrower+ ?member . ${topPattern} }`)
          }
        }
      }
    }

    if (patterns.length === 0) return null

    const valuesClause = memberUris.map(uri => `<${uri}>`).join(' ')
    return withPrefixes(`
      SELECT ?member ?inCurrentScheme ?displayScheme WHERE {
        VALUES ?member { ${valuesClause} }
        BIND(EXISTS {
          ${patterns.join('\n          UNION\n          ')}
        } AS ?inCurrentScheme)
        OPTIONAL {
          SELECT ?member (SAMPLE(?scheme) AS ?displayScheme)
          WHERE { ?member skos:inScheme ?scheme }
          GROUP BY ?member
        }
      }
    `)
  }

  function buildMemberNarrowerQuery(memberUris: string[]): string {
    const valuesClause = memberUris.map(uri => `<${uri}>`).join(' ')
    return withPrefixes(`
      SELECT ?member ?hasNarrower WHERE {
        VALUES ?member { ${valuesClause} }
        BIND(EXISTS {
          { ?narrowerChild skos:broader ?member }
          UNION
          { ?member skos:narrower ?narrowerChild }
        } AS ?hasNarrower)
      }
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
    // Metadata fields
    let deprecated: boolean | undefined
    let created: { value: string; datatype?: string } | undefined
    let modified: { value: string; datatype?: string } | undefined
    let issued: { value: string; datatype?: string } | undefined
    let versionInfo: { value: string; datatype?: string } | undefined
    let status: string | undefined
    const identifier: string[] = []
    const creator: string[] = []
    const publisher: string[] = []
    const rights: string[] = []
    const license: string[] = []
    const ccLicense: string[] = []
    const seeAlso: string[] = []
    const inScheme: ConceptRef[] = []

    function pushLabel(target: LabelValue[], value: string, lang?: string, datatype?: string) {
      if (datatype) {
        target.push({ value, lang, datatype })
      } else {
        target.push({ value, lang })
      }
    }

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
        pushLabel(prefLabels, value, lang, datatype)
      } else if (labelType === 'dctTitle') {
        pushLabel(dctTitles, value, lang, datatype)
      } else if (labelType === 'dcTitle') {
        pushLabel(dcTitles, value, lang, datatype)
      } else if (labelType === 'rdfsLabel') {
        pushLabel(rdfsLabels, value, lang, datatype)
      } else if (labelType === 'comment') {
        pushLabel(comments, value, lang, datatype)
      } else if (labelType === 'description') {
        pushLabel(description, value, lang, datatype)
      } else if (labelType === 'altLabel' || labelType === 'xlAltLabel') {
        pushLabel(altLabels, value, lang, datatype)
      } else if (labelType === 'hiddenLabel' || labelType === 'xlHiddenLabel') {
        pushLabel(hiddenLabels, value, lang, datatype)
      } else if (predicate === PRED.notation) {
        notations.push({ value, datatype })
      } else if (predicate === PRED.definition) {
        pushLabel(definitions, value, lang, datatype)
      } else if (predicate === PRED.scopeNote) {
        pushLabel(scopeNotes, value, lang, datatype)
      } else if (predicate === PRED.historyNote) {
        pushLabel(historyNotes, value, lang, datatype)
      } else if (predicate === PRED.changeNote) {
        pushLabel(changeNotes, value, lang, datatype)
      } else if (predicate === PRED.editorialNote) {
        pushLabel(editorialNotes, value, lang, datatype)
      } else if (predicate === PRED.example) {
        pushLabel(examples, value, lang, datatype)
      } else if (predicate === PRED.note) {
        pushLabel(notes, value, lang, datatype)
      } else if (predicate === PRED.inScheme) {
        if (!inScheme.some(ref => ref.uri === value)) {
          inScheme.push({ uri: value, type: 'scheme' })
        }
      } else if (labelType === 'deprecated') {
        deprecated = value === 'true' || value === '1'
      } else if (labelType === 'created') {
        if (!created) created = { value, datatype }
      } else if (labelType === 'modified') {
        if (!modified) modified = { value, datatype }
      } else if (labelType === 'issued') {
        if (!issued) issued = { value, datatype }
      } else if (labelType === 'versionInfo') {
        if (!versionInfo) versionInfo = { value, datatype }
      } else if (labelType === 'status') {
        if (!status) {
          // Extract fragment if it's a URI
          status = value.includes('/') ? value.split('/').pop() || value : value
        }
      } else if (labelType === 'identifier') {
        if (!identifier.includes(value)) identifier.push(value)
      } else if (labelType === 'creator') {
        if (!creator.includes(value)) creator.push(value)
      } else if (labelType === 'publisher') {
        if (!publisher.includes(value)) publisher.push(value)
      } else if (labelType === 'rights') {
        if (!rights.includes(value)) rights.push(value)
      } else if (labelType === 'license') {
        if (!license.includes(value)) license.push(value)
      } else if (labelType === 'ccLicense') {
        if (!ccLicense.includes(value)) ccLicense.push(value)
      } else if (labelType === 'seeAlso') {
        if (!seeAlso.includes(value)) seeAlso.push(value)
      }
    }

    return {
      uri,
      deprecated,
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
      inScheme,
      // Metadata
      identifier,
      created,
      modified,
      issued,
      versionInfo,
      status,
      creator,
      publisher,
      rights,
      license,
      ccLicense,
      seeAlso,
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

  function sortMembersStable(entries: ConceptRef[]) {
    entries.sort((a, b) => {
      const groupA = a.type === 'collection' ? 0 : 1
      const groupB = b.type === 'collection' ? 0 : 1
      if (groupA !== groupB) return groupA - groupB

      const keyA = (settingsStore.showNotationInLabels ? (a.notation || getUriFragment(a.uri) || a.uri) : (getUriFragment(a.uri) || a.uri)).toLowerCase()
      const keyB = (settingsStore.showNotationInLabels ? (b.notation || getUriFragment(b.uri) || b.uri) : (getUriFragment(b.uri) || b.uri)).toLowerCase()
      return keyA.localeCompare(keyB)
    })
  }

  function updateMembersByUri(
    updates: Map<string, Partial<ConceptRef>>
  ) {
    for (const member of members.value) {
      const update = updates.get(member.uri)
      if (update) {
        Object.assign(member, update)
      }
    }
  }

  /**
   * Load collection details
   */
  async function loadDetails(collectionUri: string) {
    const endpoint = endpointStore.current
    if (!endpoint) return
    const endpointId = endpoint.id
    const requestId = ++detailsRequestId
    const isCurrentRequest = () =>
      requestId === detailsRequestId && endpointStore.current?.id === endpointId

    if (!endpointHasCollections(endpoint)) {
      logger.info('CollectionData', 'Skipping - endpoint reports no collections', { uri: collectionUri })
      if (isCurrentRequest()) {
        error.value = 'Endpoint reports no collections'
        details.value = null
      }
      return
    }

    loading.value = true
    error.value = null

    logger.info('CollectionData', 'Loading collection details', { uri: collectionUri })

    try {
      // Get collection label capabilities
      const collectionCapabilities = endpoint.analysis?.labelPredicates?.collection

      // Load properties
      const propsQuery = buildDetailsQuery(collectionUri, collectionCapabilities)
      const propsResults = await executeSparql(endpoint, propsQuery, { retries: 1 })
      if (!isCurrentRequest()) {
        return
      }
      const collectionDetails = processDetailsBindings(
        collectionUri,
        propsResults.results.bindings as Array<Record<string, { value: string; 'xml:lang'?: string; datatype?: string }>>
      )

      logger.info('CollectionData', 'Loaded collection properties')

      // Load SKOS-XL labels (6/12 real endpoints use xlPrefLabel for collections)
      await loadXLLabels(collectionUri, collectionDetails, { source: 'useCollectionData' })
      if (!isCurrentRequest()) {
        return
      }

      if (collectionDetails.inScheme.length > 0) {
        const { loadLabelsProgressively } = useProgressiveLabelLoader()
        await loadLabelsProgressively(
          collectionDetails.inScheme.map(ref => ref.uri),
          'scheme',
          (resolved) => {
            collectionDetails.inScheme.forEach(ref => {
              const label = resolved.get(ref.uri)
              if (label) {
                ref.label = label.value
                ref.lang = label.lang
              }
            })
          }
        )
        if (!isCurrentRequest()) {
          return
        }
      }

      // Load other (non-SKOS) properties
      await loadOtherProperties(collectionUri, collectionDetails, {
        excludedPredicates: COLLECTION_EXCLUDED_PREDICATES,
        resolveDatatypes: true,
        source: 'useCollectionData',
      })
      if (!isCurrentRequest()) {
        return
      }

      // Resolve prefixes for other properties
      if (collectionDetails.otherProperties.length > 0) {
        const predicates = collectionDetails.otherProperties.map(p => p.predicate)
        resolvedPredicates.value = await resolveUris(predicates)
      } else {
        resolvedPredicates.value = new Map()
      }
      if (!isCurrentRequest()) {
        return
      }

      details.value = collectionDetails

      // Load members separately
      loadMembers(collectionUri, requestId, endpointId)
    } catch (e: unknown) {
      if (!isCurrentRequest()) {
        return
      }
      const errMsg = e && typeof e === 'object' && 'message' in e
        ? (e as { message: string }).message
        : 'Unknown error'
      logger.error('CollectionData', 'Failed to load collection details', { error: e })
      error.value = `Failed to load collection: ${errMsg}`
      details.value = null
    } finally {
      if (isCurrentRequest()) {
        loading.value = false
      }
    }
  }

  /**
   * Load collection members (separate from main details).
   * Uses progressive label loading for better performance with endpoints
   * that have many languages.
   */
  async function loadMembers(collectionUri: string, requestId: number, endpointId: string) {
    const endpoint = endpointStore.current
    if (!endpoint) return
    const isCurrentRequest = () =>
      requestId === detailsRequestId && endpointStore.current?.id === endpointId

    if (!endpointHasCollections(endpoint)) {
      logger.info('CollectionData', 'Skipping members - endpoint reports no collections', { uri: collectionUri })
      if (isCurrentRequest()) {
        members.value = []
        memberCount.value = 0
        membersLoaded.value = true
        loadingMembers.value = false
        loadingMemberLabels.value = false
        hierarchyLoading.value = false
        schemeLoading.value = false
      }
      return
    }

    loadingMembers.value = true
    membersLoaded.value = false
    labelsResolvedCount.value = 0
    hierarchyLoading.value = false
    schemeLoading.value = false

    try {
      const currentSchemeUri = schemeStore.selectedUri

      const countQuery = withPrefixes(`
        SELECT (COUNT(DISTINCT ?member) AS ?count)
        WHERE { <${collectionUri}> skos:member ?member }
      `)
      try {
        const countResults = await executeSparql(endpoint, countQuery, { retries: 1 })
        if (!isCurrentRequest()) {
          return
        }
        const countValue = countResults.results.bindings[0]?.count?.value
        memberCount.value = countValue ? parseInt(countValue, 10) : null
      } catch (e) {
        logger.warn('CollectionData', 'Failed to load member count', { error: e })
        memberCount.value = null
      }

      // Step 1: Load collection members (no paging)
      const collectionMembersQuery = buildCollectionMembersBaseQuery(collectionUri)
      const collectionResults = await executeSparql(endpoint, collectionMembersQuery, { retries: 1 })
      if (!isCurrentRequest()) {
        return
      }
      const collectionMemberRefs = processMemberMetadataBindings(
        collectionResults.results.bindings as Array<Record<string, { value: string; 'xml:lang'?: string }>>
      )

      // Step 2: Load concept members (fast)
      const metadataQuery = buildConceptMembersBaseQuery(collectionUri)
      const metadataResults = await executeSparql(endpoint, metadataQuery, { retries: 1 })
      if (!isCurrentRequest()) {
        return
      }
      const pageMembers = processMemberMetadataBindings(
        metadataResults.results.bindings as Array<Record<string, { value: string; 'xml:lang'?: string }>>
      )

      if (!isCurrentRequest()) {
        return
      }

      const combinedMembers = [...collectionMemberRefs, ...pageMembers]

      const newMembers = combinedMembers.filter(member => {
        if (memberUriSet.has(member.uri)) return false
        memberUriSet.add(member.uri)
        return true
      })

      members.value = newMembers

      sortMembersStable(members.value)
      membersLoaded.value = true

      logger.info('CollectionData', `Loaded ${pageMembers.length} member metadata`)

      // Step 2: Progressive label loading
      // Members can be concepts OR collections - we need to handle both types
      const conceptMembers = newMembers.filter(m => m.type === 'concept')
      const collectionMembers = newMembers.filter(m => m.type === 'collection')

      loadingMembers.value = false
      loadingMemberLabels.value = true

      const { loadLabelsProgressively } = useProgressiveLabelLoader()

      // Load labels for concepts and collections in parallel
      await Promise.all([
        conceptMembers.length > 0 ? loadLabelsProgressively(
          conceptMembers.map(m => m.uri),
          'concept',
          (resolved) => {
            if (!isCurrentRequest()) return
            labelsResolvedCount.value = resolved.size
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
            if (!isCurrentRequest()) return
            labelsResolvedCount.value = Math.max(labelsResolvedCount.value, resolved.size)
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
      loadingMemberLabels.value = false

      // Step 3: Enrich concepts with hierarchy and scheme info (async, non-blocking)
      const conceptUris = conceptMembers.map(m => m.uri)

      if (conceptUris.length > 0) {
        try {
          hierarchyLoading.value = true
          const narrowerQuery = buildMemberNarrowerQuery(conceptUris)
          const narrowerResults = await executeSparql(endpoint, narrowerQuery, { retries: 1 })
          if (!isCurrentRequest()) {
            return
          }
          const updates = new Map<string, Partial<ConceptRef>>()
          for (const b of narrowerResults.results.bindings) {
            const uri = b.member?.value
            if (!uri) continue
            updates.set(uri, {
              hasNarrower: b.hasNarrower?.value === 'true',
            })
          }
          updateMembersByUri(updates)
        } catch (e) {
          logger.warn('CollectionData', 'Failed to load member hierarchy info', { error: e })
        } finally {
          hierarchyLoading.value = false
        }

        if (currentSchemeUri) {
          try {
            schemeLoading.value = true
            const schemeQuery = buildMemberSchemeQuery(conceptUris, currentSchemeUri, endpoint.analysis?.relationships)
            if (!schemeQuery) {
              schemeLoading.value = false
              return
            }
            const schemeResults = await executeSparql(endpoint, schemeQuery, { retries: 1 })
            if (!isCurrentRequest()) {
              return
            }
            const updates = new Map<string, Partial<ConceptRef>>()
            for (const b of schemeResults.results.bindings) {
              const uri = b.member?.value
              if (!uri) continue
              updates.set(uri, {
                inCurrentScheme: b.inCurrentScheme?.value === 'true',
                displayScheme: b.displayScheme?.value || undefined,
              })
            }
            updateMembersByUri(updates)
          } catch (e) {
            logger.warn('CollectionData', 'Failed to load member scheme info', { error: e })
          } finally {
            schemeLoading.value = false
          }
        }
      }

      logger.info('CollectionData', `Labels loaded for ${members.value.length} members`)
    } catch (e) {
      logger.error('CollectionData', 'Failed to load collection members', { error: e })
      if (isCurrentRequest()) {
        members.value = []
      }
    } finally {
      if (isCurrentRequest()) {
        loadingMembers.value = false
        loadingMemberLabels.value = false
      }
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
    memberCount.value = null
    membersLoaded.value = false
    labelsResolvedCount.value = 0
    hierarchyLoading.value = false
    schemeLoading.value = false
    error.value = null
    resolvedPredicates.value = new Map()
    memberUriSet.clear()
  }

  return {
    // State
    details,
    members,
    loading,
    loadingMembers,
    loadingMemberLabels,
    membersLoaded,
    labelsResolvedCount,
    hierarchyLoading,
    schemeLoading,
    memberCount,
    error,
    resolvedPredicates,
    // Actions
    loadDetails,
    reset,
    // Utilities (pass through from useLabelResolver)
    sortLabels,
  }
}
