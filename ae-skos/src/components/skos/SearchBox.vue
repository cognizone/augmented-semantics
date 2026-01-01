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
import { useConceptStore, useEndpointStore, useSchemeStore, useLanguageStore, useUIStore } from '../../stores'
import { executeSparql, withPrefixes, logger, escapeSparqlString } from '../../services'
import type { SearchResult } from '../../types'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import Listbox from 'primevue/listbox'
import Dialog from 'primevue/dialog'
import Checkbox from 'primevue/checkbox'
import RadioButton from 'primevue/radiobutton'
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

// Local state
const searchInput = ref('')
const searchInputRef = ref<{ $el: HTMLInputElement } | null>(null)
const showSettings = ref(false)
const error = ref<string | null>(null)
const debounceTimer = ref<number | null>(null)

// Search settings
const searchInPrefLabel = ref(true)
const searchInAltLabel = ref(true)
const searchInDefinition = ref(false)
const matchMode = ref<'contains' | 'startsWith' | 'exact' | 'regex'>('contains')
const searchAllSchemes = ref(false)

// Computed
const results = computed(() => conceptStore.searchResults)
const loading = computed(() => conceptStore.loadingSearch)
const hasQuery = computed(() => searchInput.value.trim().length >= 2)

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

  switch (matchMode.value) {
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

  if (searchInPrefLabel.value) {
    labelPatterns.push(`{ ?concept skos:prefLabel ?matchedLabel . BIND("prefLabel" AS ?matchType) }`)
  }
  if (searchInAltLabel.value) {
    labelPatterns.push(`{ ?concept skos:altLabel ?matchedLabel . BIND("altLabel" AS ?matchType) }`)
  }
  if (searchInDefinition.value) {
    labelPatterns.push(`{ ?concept skos:definition ?matchedLabel . BIND("definition" AS ?matchType) }`)
  }

  if (!labelPatterns.length) {
    labelPatterns.push(`{ ?concept skos:prefLabel ?matchedLabel . BIND("prefLabel" AS ?matchType) }`)
  }

  const labelUnion = labelPatterns.join(' UNION ')

  // Build scheme filter
  const schemeFilter = !searchAllSchemes.value && schemeStore.selected
    ? `?concept skos:inScheme <${schemeStore.selected.uri}> .`
    : ''

  const sparqlQuery = withPrefixes(`
    SELECT DISTINCT ?concept ?label ?matchedLabel ?matchType
    WHERE {
      ?concept a skos:Concept .
      ${schemeFilter}
      ${labelUnion}
      FILTER (${filterCondition})
      OPTIONAL {
        ?concept skos:prefLabel ?label .
        FILTER (LANG(?label) = "${languageStore.preferred}" || LANG(?label) = "${languageStore.fallback}" || LANG(?label) = "")
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
  conceptStore.addToHistory({ uri: result.uri, label: result.label })
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
    if (hasQuery.value && !searchAllSchemes.value) {
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
</script>

<template>
  <div class="search-box">
    <!-- Search input -->
    <div class="search-input-container">
      <span class="p-input-icon-left p-input-icon-right search-input-wrapper">
        <i class="pi pi-search"></i>
        <InputText
          ref="searchInputRef"
          v-model="searchInput"
          placeholder="Search concepts..."
          class="search-input"
          @input="onSearchInput"
          @keyup.escape="clearSearch"
        />
        <i
          v-if="searchInput"
          class="pi pi-times clear-icon"
          @click="clearSearch"
        ></i>
      </span>
      <Button
        icon="pi pi-cog"
        severity="secondary"
        text
        rounded
        size="small"
        v-tooltip.bottom="'Search settings'"
        @click="showSettings = true"
      />
    </div>

    <!-- Loading indicator -->
    <div v-if="loading" class="loading-indicator">
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
        @change="(e) => e.value && selectResult(e.value)"
      >
        <template #option="slotProps">
          <div class="result-item">
            <div class="result-label">{{ slotProps.option.label }}</div>
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
      <i class="pi pi-search"></i>
      <p>No results for "{{ searchInput }}"</p>
      <small>Try different keywords or adjust search settings</small>
    </div>

    <!-- Settings Dialog -->
    <Dialog
      v-model:visible="showSettings"
      header="Search Settings"
      :style="{ width: '350px' }"
      :modal="true"
    >
      <div class="settings-content">
        <div class="setting-group">
          <label class="group-label">Search in:</label>
          <div class="checkbox-group">
            <div class="checkbox-item">
              <Checkbox v-model="searchInPrefLabel" :binary="true" inputId="prefLabel" />
              <label for="prefLabel">Preferred labels</label>
            </div>
            <div class="checkbox-item">
              <Checkbox v-model="searchInAltLabel" :binary="true" inputId="altLabel" />
              <label for="altLabel">Alternative labels</label>
            </div>
            <div class="checkbox-item">
              <Checkbox v-model="searchInDefinition" :binary="true" inputId="definition" />
              <label for="definition">Definitions</label>
            </div>
          </div>
        </div>

        <div class="setting-group">
          <label class="group-label">Match mode:</label>
          <div class="radio-group">
            <div class="radio-item">
              <RadioButton v-model="matchMode" inputId="contains" value="contains" />
              <label for="contains">Contains</label>
            </div>
            <div class="radio-item">
              <RadioButton v-model="matchMode" inputId="startsWith" value="startsWith" />
              <label for="startsWith">Starts with</label>
            </div>
            <div class="radio-item">
              <RadioButton v-model="matchMode" inputId="exact" value="exact" />
              <label for="exact">Exact match</label>
            </div>
            <div class="radio-item">
              <RadioButton v-model="matchMode" inputId="regex" value="regex" />
              <label for="regex">Regular expression</label>
            </div>
          </div>
        </div>

        <div class="setting-group">
          <label class="group-label">Scope:</label>
          <div class="checkbox-group">
            <div class="checkbox-item">
              <Checkbox v-model="searchAllSchemes" :binary="true" inputId="allSchemes" />
              <label for="allSchemes">Search all schemes</label>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <Button label="Apply" @click="showSettings = false; hasQuery && executeSearch()" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.search-box {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.search-input-container {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.search-input-wrapper {
  flex: 1;
}

.search-input {
  width: 100%;
}

.clear-icon {
  cursor: pointer;
  opacity: 0.5;
}

.clear-icon:hover {
  opacity: 1;
}

.loading-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  color: var(--p-text-muted-color);
  font-size: 0.875rem;
}

.search-error {
  margin: 0;
}

.search-results {
  display: flex;
  flex-direction: column;
  max-height: 400px;
  overflow: hidden;
}

.results-header {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  padding: 0.5rem;
  border-bottom: 1px solid var(--p-surface-200);
}

.results-list {
  flex: 1;
  overflow: auto;
  border: none;
}

.result-item {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.result-label {
  font-weight: 500;
}

.result-meta {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.result-uri {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
}

.match-type {
  font-size: 0.7rem;
  color: var(--p-primary-color);
  font-style: italic;
}

.no-results {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem;
  text-align: center;
  color: var(--p-text-muted-color);
}

.no-results i {
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

.settings-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.group-label {
  font-weight: 600;
  font-size: 0.875rem;
}

.checkbox-group,
.radio-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-left: 0.5rem;
}

.checkbox-item,
.radio-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.checkbox-item label,
.radio-item label {
  font-size: 0.875rem;
  cursor: pointer;
}
</style>
