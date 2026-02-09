<script setup lang="ts">
/**
 * SearchBox - SKOS resource search
 *
 * Full-text search with:
 * - Multiple match modes (contains, startsWith, exact)
 * - Search scope (prefLabel, altLabel, definition)
 * - Resource types (concepts, schemes, collections, ordered collections)
 * - Scheme filtering
 * - Debounced input (300ms)
 * - Result highlighting
 *
 * @see /spec/ae-skos/sko05-SearchBox.md
 */
import { ref, watch, computed, nextTick } from 'vue'
import { useConceptStore, useEndpointStore, useSchemeStore, useLanguageStore, useUIStore, useSettingsStore } from '../../stores'
import { executeSparql, withPrefixes, logger, escapeSparqlString } from '../../services'
import { useDelayedLoading, useLabelResolver } from '../../composables'
import { getRefLabel } from '../../utils/displayUtils'
import { buildSchemeValuesClause } from '../../utils/schemeUri'
import type { SearchResult, SPARQLEndpoint } from '../../types'
import Listbox from 'primevue/listbox'
import ProgressSpinner from 'primevue/progressspinner'
import Message from 'primevue/message'

type SearchSelection = {
  uri: string
  type: 'concept' | 'scheme' | 'collection' | 'orderedCollection'
  schemeUri?: string
}

type RelationshipCapabilities = NonNullable<NonNullable<SPARQLEndpoint['analysis']>['relationships']>

const emit = defineEmits<{
  selectConcept: [selection: SearchSelection]
}>()

const conceptStore = useConceptStore()
const endpointStore = useEndpointStore()
const schemeStore = useSchemeStore()
const languageStore = useLanguageStore()
const uiStore = useUIStore()
const settingsStore = useSettingsStore()
const { shouldShowLangTag } = useLabelResolver()
const includeNotation = computed(() => settingsStore.showNotationInLabels)

function formatSearchLabel(result: SearchResult): string {
  return getRefLabel({ uri: result.uri, label: result.label, notation: result.notation }, { includeNotation: includeNotation.value })
}

function getSchemeLabel(result: SearchResult): string | undefined {
  const schemeUri = result.scheme?.uri
  if (!schemeUri) return undefined
  const scheme = schemeStore.schemes.find(s => s.uri === schemeUri)
  return result.scheme?.label || scheme?.label || schemeUri.split('/').pop() || schemeUri
}

function parseExistsValue(value?: string): boolean {
  return value === 'true' || value === '1'
}

function parseResourceType(value?: string): SearchSelection['type'] {
  if (value === 'scheme' || value === 'collection' || value === 'orderedCollection') {
    return value
  }
  return 'concept'
}

function getResourceTypePriority(type?: SearchSelection['type']): number {
  if (type === 'orderedCollection') return 4
  if (type === 'collection') return 3
  if (type === 'scheme') return 2
  return 1
}

function pickPreferredResourceType(
  current?: SearchSelection['type'],
  candidate?: SearchSelection['type']
): SearchSelection['type'] {
  return getResourceTypePriority(candidate) > getResourceTypePriority(current)
    ? (candidate || 'concept')
    : (current || 'concept')
}

/**
 * Build membership branches that determine whether a concept belongs to a scheme.
 * Uses endpoint capabilities when available, otherwise falls back to a broad SKOS pattern set.
 */
function buildConceptSchemeMembershipBranches(
  conceptVar: string,
  schemeTerm: string,
  relationships?: RelationshipCapabilities
): string[] {
  if (!relationships) {
    return [
      `{ ${conceptVar} skos:inScheme ${schemeTerm} . }`,
      `{ ${conceptVar} skos:topConceptOf ${schemeTerm} . }`,
      `{ ${schemeTerm} skos:hasTopConcept ${conceptVar} . }`,
      `{ ${conceptVar} (skos:broader|^skos:narrower)+ ?topConcept . ?topConcept skos:topConceptOf ${schemeTerm} . }`,
      `{ ${conceptVar} (skos:broader|^skos:narrower)+ ?topConcept . ${schemeTerm} skos:hasTopConcept ?topConcept . }`,
    ]
  }

  const branches: string[] = []

  if (relationships.hasInScheme) {
    branches.push(`{ ${conceptVar} skos:inScheme ${schemeTerm} . }`)
  }
  if (relationships.hasTopConceptOf) {
    branches.push(`{ ${conceptVar} skos:topConceptOf ${schemeTerm} . }`)
  }
  if (relationships.hasHasTopConcept) {
    branches.push(`{ ${schemeTerm} skos:hasTopConcept ${conceptVar} . }`)
  }

  const hasTopCapability = relationships.hasTopConceptOf || relationships.hasHasTopConcept
  if (hasTopCapability) {
    const topPatterns: string[] = []
    if (relationships.hasTopConceptOf) {
      topPatterns.push(`?topConcept skos:topConceptOf ${schemeTerm} .`)
    }
    if (relationships.hasHasTopConcept) {
      topPatterns.push(`${schemeTerm} skos:hasTopConcept ?topConcept .`)
    }

    if (relationships.hasBroaderTransitive || relationships.hasNarrowerTransitive) {
      if (relationships.hasBroaderTransitive) {
        for (const topPattern of topPatterns) {
          branches.push(`{ ${conceptVar} skos:broaderTransitive ?topConcept . ${topPattern} }`)
        }
      }
      if (relationships.hasNarrowerTransitive) {
        for (const topPattern of topPatterns) {
          branches.push(`{ ?topConcept skos:narrowerTransitive ${conceptVar} . ${topPattern} }`)
        }
      }
    } else {
      if (relationships.hasBroader) {
        for (const topPattern of topPatterns) {
          branches.push(`{ ${conceptVar} skos:broader+ ?topConcept . ${topPattern} }`)
        }
      }
      if (relationships.hasNarrower) {
        for (const topPattern of topPatterns) {
          branches.push(`{ ?topConcept skos:narrower+ ${conceptVar} . ${topPattern} }`)
        }
      }
    }
  }

  if (branches.length === 0) {
    branches.push(`{ ${conceptVar} skos:inScheme ${schemeTerm} . }`)
  }

  return branches
}

/**
 * Build branches that resolve a concept's scheme URI for result context display.
 */
function buildConceptSchemeResolutionBranches(
  conceptVar: string,
  schemeVar: string,
  relationships?: RelationshipCapabilities
): string[] {
  if (!relationships) {
    return [
      `{ ${conceptVar} skos:inScheme ${schemeVar} . }`,
      `{ ${conceptVar} skos:topConceptOf ${schemeVar} . }`,
      `{ ${schemeVar} skos:hasTopConcept ${conceptVar} . }`,
      `{ ${conceptVar} (skos:broader|^skos:narrower)+ ?topConcept . ?topConcept skos:topConceptOf ${schemeVar} . }`,
      `{ ${conceptVar} (skos:broader|^skos:narrower)+ ?topConcept . ${schemeVar} skos:hasTopConcept ?topConcept . }`,
    ]
  }

  const branches: string[] = []

  if (relationships.hasInScheme) {
    branches.push(`{ ${conceptVar} skos:inScheme ${schemeVar} . }`)
  }
  if (relationships.hasTopConceptOf) {
    branches.push(`{ ${conceptVar} skos:topConceptOf ${schemeVar} . }`)
  }
  if (relationships.hasHasTopConcept) {
    branches.push(`{ ${schemeVar} skos:hasTopConcept ${conceptVar} . }`)
  }

  const hasTopCapability = relationships.hasTopConceptOf || relationships.hasHasTopConcept
  if (hasTopCapability) {
    const topPatterns: string[] = []
    if (relationships.hasTopConceptOf) {
      topPatterns.push(`?topConcept skos:topConceptOf ${schemeVar} .`)
    }
    if (relationships.hasHasTopConcept) {
      topPatterns.push(`${schemeVar} skos:hasTopConcept ?topConcept .`)
    }

    if (relationships.hasBroaderTransitive || relationships.hasNarrowerTransitive) {
      if (relationships.hasBroaderTransitive) {
        for (const topPattern of topPatterns) {
          branches.push(`{ ${conceptVar} skos:broaderTransitive ?topConcept . ${topPattern} }`)
        }
      }
      if (relationships.hasNarrowerTransitive) {
        for (const topPattern of topPatterns) {
          branches.push(`{ ?topConcept skos:narrowerTransitive ${conceptVar} . ${topPattern} }`)
        }
      }
    } else {
      if (relationships.hasBroader) {
        for (const topPattern of topPatterns) {
          branches.push(`{ ${conceptVar} skos:broader+ ?topConcept . ${topPattern} }`)
        }
      }
      if (relationships.hasNarrower) {
        for (const topPattern of topPatterns) {
          branches.push(`{ ?topConcept skos:narrower+ ${conceptVar} . ${topPattern} }`)
        }
      }
    }
  }

  if (branches.length === 0) {
    branches.push(`{ ${conceptVar} skos:inScheme ${schemeVar} . }`)
  }

  return branches
}

// Local state
const searchInput = ref('')
const searchInputRef = ref<{ $el: HTMLInputElement } | null>(null)
const error = ref<string | null>(null)
const debounceTimer = ref<number | null>(null)

// Computed
const results = computed(() => conceptStore.searchResults)
const loading = computed(() => conceptStore.loadingSearch)
const hasQuery = computed(() => searchInput.value.trim().length >= 2)

// Delayed loading - show spinner only after 300ms to prevent flicker
const showLoading = useDelayedLoading(loading)

// Debounced search
function onSearchInput() {
  if (debounceTimer.value) {
    clearTimeout(debounceTimer.value)
  }

  if (!hasQuery.value) {
    conceptStore.clearSearch()
    return
  }

  debounceTimer.value = window.setTimeout(() => {
    executeSearch()
  }, 300)
}

// Execute search
async function executeSearch() {
  const endpoint = endpointStore.current
  const query = searchInput.value.trim()
  const selectedSchemeUri = schemeStore.selectedUri

  if (!endpoint || query.length < 2) return

  logger.info('SearchBox', 'Executing search', {
    query,
    scheme: selectedSchemeUri || 'all'
  })

  conceptStore.setLoadingSearch(true)
  conceptStore.setSearchQuery(query)
  error.value = null

  // Build FILTER conditions - properly escape for SPARQL injection prevention
  const escapedQuery = escapeSparqlString(query)
  let filterCondition: string

  switch (settingsStore.searchMatchMode) {
    case 'startsWith':
      filterCondition = `STRSTARTS(LCASE(?matchedLabel), LCASE("${escapedQuery}"))`
      break
    case 'exact':
      filterCondition = `LCASE(?matchedLabel) = LCASE("${escapedQuery}")`
      break
    case 'regex':
      // For regex mode, only escape SPARQL string delimiters but preserve regex metacharacters
      // Users can enter patterns like ^wheat, wheat$, (foo|bar)
      filterCondition = `REGEX(?matchedLabel, "${escapedQuery}", "i")`
      break
    default:
      filterCondition = `CONTAINS(LCASE(?matchedLabel), LCASE("${escapedQuery}"))`
  }

  // Build label match patterns
  const labelPatterns: string[] = []

  if (settingsStore.searchInPrefLabel) {
    labelPatterns.push(`{ ?resource skos:prefLabel ?matchedLabel . BIND("prefLabel" AS ?matchType) }`)
  }
  if (settingsStore.searchInAltLabel) {
    labelPatterns.push(`{ ?resource skos:altLabel ?matchedLabel . BIND("altLabel" AS ?matchType) }`)
  }
  if (settingsStore.searchInDefinition) {
    labelPatterns.push(`{ ?resource skos:definition ?matchedLabel . BIND("definition" AS ?matchType) }`)
  }

  if (!labelPatterns.length) {
    labelPatterns.push(`{ ?resource skos:prefLabel ?matchedLabel . BIND("prefLabel" AS ?matchType) }`)
  }

  const labelUnion = labelPatterns.join(' UNION ')

  const resourceTypeUnion = `
    { ?resource a skos:Concept . BIND("concept" AS ?resourceType) }
    UNION
    { ?resource a skos:ConceptScheme . BIND("scheme" AS ?resourceType) }
    UNION
    { ?resource a skos:OrderedCollection . BIND("orderedCollection" AS ?resourceType) }
    UNION
    { ?resource skos:memberList ?memberList . BIND("orderedCollection" AS ?resourceType) }
    UNION
    {
      ?resource a skos:Collection .
      FILTER NOT EXISTS { ?resource a skos:OrderedCollection }
      BIND("collection" AS ?resourceType)
    }
    UNION
    {
      ?resource skos:member ?member .
      FILTER NOT EXISTS { ?resource a skos:OrderedCollection }
      FILTER NOT EXISTS { ?resource skos:memberList ?_memberList }
      BIND("collection" AS ?resourceType)
    }
  `

  const relationships = endpoint.analysis?.relationships
  const resourceSchemeResolutionBranches = buildConceptSchemeResolutionBranches('?resource', '?resourceDerivedScheme', relationships)
  const resourceSchemeResolutionUnion = resourceSchemeResolutionBranches.join('\n        UNION\n        ')
  const memberSchemeResolutionBranches = buildConceptSchemeResolutionBranches('?memberConcept', '?memberDerivedScheme', relationships)
  const memberSchemeResolutionUnion = memberSchemeResolutionBranches.join('\n          UNION\n          ')

  // Build scope filter
  let scopeFilter = ''
  if (!settingsStore.searchAllSchemes && selectedSchemeUri) {
    const { schemeTerm, valuesClause } = buildSchemeValuesClause(
      selectedSchemeUri,
      endpointStore.current?.analysis,
      settingsStore.enableSchemeUriSlashFix,
      'selectedScheme'
    )
    const conceptMembershipBranches = buildConceptSchemeMembershipBranches('?resource', schemeTerm, relationships)
    const conceptMembershipUnion = conceptMembershipBranches.join('\n                UNION\n                ')
    const collectionMemberBranches = buildConceptSchemeMembershipBranches('?memberConcept', schemeTerm, relationships)
    const collectionMemberUnion = collectionMemberBranches.join('\n                  UNION\n                  ')

    scopeFilter = `
      ${valuesClause}
      FILTER (
        (
          ?resourceType = "concept"
          && EXISTS {
            ${conceptMembershipUnion}
          }
        )
        ||
        (
          (?resourceType = "collection" || ?resourceType = "orderedCollection")
          && (
            EXISTS { ?resource skos:inScheme ${schemeTerm} . }
            ||
            EXISTS {
              ?resource (skos:member|skos:memberList/rdf:rest*/rdf:first)* ?memberConcept .
              ?memberConcept a skos:Concept .
              ${collectionMemberUnion}
            }
          )
        )
        ||
        (
          ?resourceType = "scheme"
          && ?resource = ${schemeTerm}
        )
      )
    `
  }

  const sparqlQuery = withPrefixes(`
    SELECT DISTINCT ?resource ?resourceType ?label ?labelLang ?notation ?hasNarrower ?hasMembers ?hasMemberList ?matchedLabel ?matchType ?scheme ?schemeLabel ?schemeLabelLang
    WHERE {
      ${resourceTypeUnion}
      ${scopeFilter}
      ${labelUnion}
      FILTER (${filterCondition})
      OPTIONAL { ?resource skos:notation ?notation }
      BIND(EXISTS { ?resource skos:member [] } AS ?hasMembers)
      BIND(EXISTS { ?resource skos:memberList [] } AS ?hasMemberList)
      BIND(
        IF(
          ?resourceType = "concept",
          EXISTS {
            { ?resource skos:narrower ?narrowerConcept }
            UNION
            { ?narrowerConcept skos:broader ?resource }
          },
          false
        )
        AS ?hasNarrower
      )
      OPTIONAL {
        ?resource skos:prefLabel ?label .
        BIND(LANG(?label) AS ?labelLang)
        FILTER (LANG(?label) = "${languageStore.preferred}" || LANG(?label) = "")
      }
      OPTIONAL {
        FILTER (?resourceType = "concept")
        ${resourceSchemeResolutionUnion}
      }
      OPTIONAL {
        FILTER (?resourceType = "collection" || ?resourceType = "orderedCollection")
        ?resource skos:inScheme ?collectionDirectScheme .
      }
      OPTIONAL {
        FILTER (?resourceType = "collection" || ?resourceType = "orderedCollection")
        ?resource (skos:member|skos:memberList/rdf:rest*/rdf:first)+ ?memberConcept .
        ?memberConcept a skos:Concept .
        ${memberSchemeResolutionUnion}
      }
      BIND(
        IF(
          ?resourceType = "scheme",
          ?resource,
          COALESCE(?collectionDirectScheme, ?resourceDerivedScheme, ?memberDerivedScheme)
        )
        AS ?scheme
      )
      OPTIONAL {
        ?scheme skos:prefLabel ?schemeLabel .
        BIND(LANG(?schemeLabel) AS ?schemeLabelLang)
        FILTER (LANG(?schemeLabel) = "${languageStore.preferred}" || LANG(?schemeLabel) = "")
      }
    }
    ORDER BY LCASE(COALESCE(STR(?label), STR(?matchedLabel)))
    LIMIT 100
  `)

  logger.debug('SearchBox', 'Search query', { sparqlQuery })

  try {
    const results = await executeSparql(endpoint, sparqlQuery, { retries: 1 })
    const singleScopeScheme = (!settingsStore.searchAllSchemes && selectedSchemeUri)
      ? {
          uri: selectedSchemeUri,
          label: schemeStore.selected?.label,
        }
      : null

    const searchResults: SearchResult[] = results.results.bindings.map(b => {
      const baseType = parseResourceType(b.resourceType?.value)
      const hasMemberList = parseExistsValue(b.hasMemberList?.value)
      const hasMembers = parseExistsValue(b.hasMembers?.value)
      const inferredType: SearchSelection['type'] = hasMemberList
        ? 'orderedCollection'
        : (hasMembers && baseType === 'concept' ? 'collection' : baseType)

      return {
        uri: b.resource?.value || '',
        type: inferredType,
        label: b.label?.value || b.matchedLabel?.value || '',
        notation: b.notation?.value,
        lang: b.labelLang?.value || undefined,
        hasNarrower: parseExistsValue(b.hasNarrower?.value),
        matchedIn: (b.matchType?.value as SearchResult['matchedIn']) || 'prefLabel',
        matchedValue: b.matchedLabel?.value,
        scheme: singleScopeScheme || (b.scheme?.value ? {
          uri: b.scheme.value,
          label: b.schemeLabel?.value,
          lang: b.schemeLabelLang?.value || undefined,
        } : undefined),
      }
    }).filter(r => r.uri)

    // Deduplicate by URI while preserving best label hit and richer resource typing.
    const deduped = new Map<string, SearchResult>()
    for (const result of searchResults) {
      const existing = deduped.get(result.uri)
      if (!existing) {
        deduped.set(result.uri, result)
        continue
      }

      // Prefer prefLabel hits as the visual row anchor.
      const base = existing.matchedIn !== 'prefLabel' && result.matchedIn === 'prefLabel'
        ? { ...result }
        : { ...existing }

      deduped.set(result.uri, {
        ...base,
        // Preserve richer typing when a resource appears under multiple inferred types.
        type: pickPreferredResourceType(existing.type, result.type),
        hasNarrower: !!(existing.hasNarrower || result.hasNarrower),
        scheme: base.scheme || existing.scheme || result.scheme,
      })
    }
    const uniqueResults = Array.from(deduped.values())

    logger.info('SearchBox', `Found ${uniqueResults.length} results`)
    conceptStore.setSearchResults(uniqueResults)
  } catch (e: unknown) {
    const errMsg = e && typeof e === 'object' && 'message' in e
      ? (e as { message: string }).message
      : 'Unknown error'
    logger.error('SearchBox', 'Search failed', { error: e })
    error.value = `Search failed: ${errMsg}`
    conceptStore.setSearchResults([])
  } finally {
    conceptStore.setLoadingSearch(false)
  }
}

// Handle result selection
function selectResult(result: SearchResult) {
  const resultType = result.type || 'concept'
  emit('selectConcept', { uri: result.uri, type: resultType, schemeUri: result.scheme?.uri })
  conceptStore.addToHistory({
    uri: result.uri,
    label: result.label,
    notation: result.notation,
    lang: result.lang,
    endpointUrl: endpointStore.current?.url,
    schemeUri: result.scheme?.uri || schemeStore.selectedUri || undefined,
    type: resultType,
    hasNarrower: result.hasNarrower,
  })
}

// Clear search
function clearSearch() {
  searchInput.value = ''
  conceptStore.clearSearch()
  error.value = null
}

// Watch for scheme changes - re-search if active
watch(
  () => schemeStore.selectedUri,
  () => {
    if (hasQuery.value && !settingsStore.searchAllSchemes) {
      executeSearch()
    }
  }
)

// Watch for search focus trigger (keyboard shortcut)
watch(
  () => uiStore.searchFocusTrigger,
  async () => {
    await nextTick()
    const inputEl = searchInputRef.value?.$el
    inputEl?.focus()
    inputEl?.select()
  }
)

watch(
  () => [
    settingsStore.searchInPrefLabel,
    settingsStore.searchInAltLabel,
    settingsStore.searchInDefinition,
    settingsStore.searchMatchMode,
    settingsStore.searchAllSchemes,
    settingsStore.enableSchemeUriSlashFix,
  ],
  () => {
    if (hasQuery.value) {
      executeSearch()
    }
  }
)
</script>

<template>
  <div class="search-box">
    <!-- Search input -->
    <div class="search-input-container">
      <div class="search-input-wrapper">
        <span class="material-symbols-outlined search-icon">search</span>
        <input
          ref="searchInputRef"
          v-model="searchInput"
          type="text"
          placeholder="Search resources..."
          class="ae-input ae-input-with-icon"
          @input="onSearchInput"
          @keyup.escape="clearSearch"
        />
        <button
          v-if="searchInput"
          class="clear-btn"
          aria-label="Clear search"
          @click="clearSearch"
        >
          <span class="material-symbols-outlined icon-sm">close</span>
        </button>
      </div>
      <button
        class="settings-btn"
        title="Settings"
        @click="uiStore.openSettingsDialog('search')"
      >
        <span class="material-symbols-outlined">tune</span>
      </button>
    </div>

    <!-- Loading indicator (delayed to prevent flicker) -->
    <div v-if="showLoading" class="loading-indicator">
      <ProgressSpinner style="width: 20px; height: 20px" />
      <span>Searching...</span>
    </div>

    <!-- Error message -->
    <Message v-if="error" severity="error" :closable="true" @close="error = null" class="search-error">
      {{ error }}
    </Message>

    <!-- Results -->
    <div v-if="hasQuery && !loading && results.length > 0" class="search-results">
      <div class="results-header">
        <span>{{ results.length }} result{{ results.length === 1 ? '' : 's' }}</span>
      </div>
      <Listbox
        :options="results"
        optionLabel="label"
        class="results-list"
        scrollHeight="100%"
        @change="(e) => e.value && selectResult(e.value)"
      >
        <template #option="slotProps">
          <div class="result-item">
            <div class="result-label">
              <span
                class="material-symbols-outlined result-icon"
                :class="slotProps.option.type === 'scheme' ? 'icon-folder'
                  : slotProps.option.type === 'orderedCollection' ? 'icon-ordered-collection'
                  : slotProps.option.type === 'collection' ? 'icon-collection'
                  : (slotProps.option.hasNarrower ? 'icon-label' : 'icon-leaf')"
              >{{
                slotProps.option.type === 'scheme' ? 'folder'
                  : slotProps.option.type === 'orderedCollection' ? 'format_list_numbered'
                  : slotProps.option.type === 'collection' ? 'collections_bookmark'
                  : (slotProps.option.hasNarrower ? 'label' : 'circle')
              }}</span>
              {{ formatSearchLabel(slotProps.option) }}
              <span v-if="slotProps.option.lang && shouldShowLangTag(slotProps.option.lang)" class="lang-tag">
                {{ slotProps.option.lang }}
              </span>
            </div>
            <div class="result-meta">
              <span class="result-uri">{{ slotProps.option.uri }}</span>
              <span v-if="slotProps.option.type !== 'scheme' && getSchemeLabel(slotProps.option)" class="result-context">
                {{ getSchemeLabel(slotProps.option) }}
              </span>
              <span v-if="slotProps.option.matchedIn !== 'prefLabel'" class="match-type">
                matched in {{ slotProps.option.matchedIn }}
              </span>
            </div>
          </div>
        </template>
      </Listbox>
    </div>

    <!-- No results -->
    <div v-if="hasQuery && !loading && results.length === 0 && !error" class="no-results">
      <span class="material-symbols-outlined empty-icon">search_off</span>
      <p>No results for "{{ searchInput }}"</p>
      <small>Try different keywords or adjust search settings</small>
    </div>

  </div>
</template>

<style scoped>
.search-box {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  height: 100%;
  min-height: 0;
  padding: 0.5rem;
  overflow: hidden;
}

.search-input-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.search-input-wrapper {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 0.5rem;
  font-size: 16px;
  color: var(--ae-text-secondary);
  pointer-events: none;
}

/* Extra right padding for clear button */
.search-input-wrapper .ae-input {
  padding-right: 2rem;
}

.clear-btn {
  position: absolute;
  right: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--ae-text-secondary);
}

.clear-btn:hover {
  color: var(--ae-text-primary);
}

.settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--ae-text-secondary);
  transition: background-color 0.15s, color 0.15s;
}

.settings-btn:hover {
  background: var(--ae-bg-hover);
  color: var(--ae-text-primary);
}

.loading-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  color: var(--ae-text-secondary);
  font-size: 0.875rem;
}

.search-error {
  margin: 0;
}

.search-results {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.results-header {
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
  padding: 0.5rem;
  border-bottom: 1px solid var(--ae-border-color);
}

.results-list {
  flex: 1;
  overflow: auto;
  border: none;
  min-height: 0;
  height: 100%;
}

:deep(.p-listbox) {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: transparent;
  border: none;
}

:deep(.p-listbox-list-container) {
  flex: 1;
  height: auto;
  max-height: none;
  overflow: auto;
}

:deep(.p-listbox-list) {
  max-height: none;
}

.result-item {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.result-label {
  font-size: 0.875rem;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.result-icon {
  font-size: 15px;
  flex-shrink: 0;
}

.result-meta {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.result-uri {
  font-size: 0.7rem;
  color: var(--ae-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
}

.result-context {
  font-size: 0.7rem;
  color: var(--ae-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
}

.match-type {
  font-size: 0.7rem;
  color: var(--ae-accent);
  font-style: italic;
}

.no-results {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem;
  text-align: center;
  color: var(--ae-text-secondary);
}

.empty-icon {
  font-size: 2rem;
  opacity: 0.5;
}

.no-results p {
  margin: 0;
  font-weight: 500;
}

.no-results small {
  font-size: 0.75rem;
}

</style>
