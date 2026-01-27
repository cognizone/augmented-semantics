<script setup lang="ts">
/**
 * SearchBox - SKOS concept search
 *
 * Full-text search with:
 * - Multiple match modes (contains, startsWith, exact)
 * - Search scope (prefLabel, altLabel, definition)
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
import type { SearchResult } from '../../types'
import Listbox from 'primevue/listbox'
import ProgressSpinner from 'primevue/progressspinner'
import Message from 'primevue/message'

const emit = defineEmits<{
  selectConcept: [uri: string]
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

  if (!endpoint || query.length < 2) return

  logger.info('SearchBox', 'Executing search', {
    query,
    scheme: schemeStore.selected?.uri || 'all'
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
    labelPatterns.push(`{ ?concept skos:prefLabel ?matchedLabel . BIND("prefLabel" AS ?matchType) }`)
  }
  if (settingsStore.searchInAltLabel) {
    labelPatterns.push(`{ ?concept skos:altLabel ?matchedLabel . BIND("altLabel" AS ?matchType) }`)
  }
  if (settingsStore.searchInDefinition) {
    labelPatterns.push(`{ ?concept skos:definition ?matchedLabel . BIND("definition" AS ?matchType) }`)
  }

  if (!labelPatterns.length) {
    labelPatterns.push(`{ ?concept skos:prefLabel ?matchedLabel . BIND("prefLabel" AS ?matchType) }`)
  }

  const labelUnion = labelPatterns.join(' UNION ')

  // Build scheme filter
  let schemeFilter = ''
  if (!settingsStore.searchAllSchemes && schemeStore.selected) {
    const { schemeTerm, valuesClause } = buildSchemeValuesClause(
      schemeStore.selected.uri,
      endpointStore.current?.analysis,
      settingsStore.enableSchemeUriSlashFix,
      'scheme'
    )
    schemeFilter = `
      ${valuesClause}
      ?concept skos:inScheme ${schemeTerm} .
    `
  }

  const sparqlQuery = withPrefixes(`
    SELECT DISTINCT ?concept ?label ?labelLang ?notation ?matchedLabel ?matchType
    WHERE {
      ?concept a skos:Concept .
      ${schemeFilter}
      ${labelUnion}
      FILTER (${filterCondition})
      OPTIONAL { ?concept skos:notation ?notation }
      OPTIONAL {
        ?concept skos:prefLabel ?label .
        BIND(LANG(?label) AS ?labelLang)
        FILTER (LANG(?label) = "${languageStore.preferred}" || LANG(?label) = "")
      }
    }
    ORDER BY ?label
    LIMIT 100
  `)

  logger.debug('SearchBox', 'Search query', { sparqlQuery })

  try {
    const results = await executeSparql(endpoint, sparqlQuery, { retries: 1 })

    const searchResults: SearchResult[] = results.results.bindings.map(b => ({
      uri: b.concept?.value || '',
      label: b.label?.value || b.matchedLabel?.value || '',
      notation: b.notation?.value,
      lang: b.labelLang?.value || undefined,
      matchedIn: (b.matchType?.value as SearchResult['matchedIn']) || 'prefLabel',
      matchedValue: b.matchedLabel?.value,
    })).filter(r => r.uri)

    // Deduplicate by URI
    const uniqueResults = Array.from(
      new Map(searchResults.map(r => [r.uri, r])).values()
    )

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
  emit('selectConcept', result.uri)
  conceptStore.addToHistory({
    uri: result.uri,
    label: result.label,
    notation: result.notation,
    lang: result.lang,
    endpointUrl: endpointStore.current?.url,
    schemeUri: schemeStore.selectedUri || undefined,
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
          placeholder="Search concepts..."
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
              {{ formatSearchLabel(slotProps.option) }}
              <span v-if="slotProps.option.lang && shouldShowLangTag(slotProps.option.lang)" class="lang-tag">
                {{ slotProps.option.lang }}
              </span>
            </div>
            <div class="result-meta">
              <span class="result-uri">{{ slotProps.option.uri }}</span>
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
