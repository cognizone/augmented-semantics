<script setup lang="ts">
/**
 * SchemeSelector - Concept scheme selection
 *
 * Lists available SKOS concept schemes from the endpoint.
 * Allows selecting a scheme to filter the concept tree,
 * or "All Schemes" to show all concepts.
 *
 * @see /spec/ae-skos/sko02-SchemeSelector.md
 */
import { ref, computed, watch } from 'vue'
import { useSchemeStore, useEndpointStore, useLanguageStore } from '../../stores'
import { executeSparql, withPrefixes, logger, isValidURI } from '../../services'
import { useLabelResolver } from '../../composables'
import type { ConceptScheme } from '../../types'
import Select from 'primevue/select'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Message from 'primevue/message'

const schemeStore = useSchemeStore()
const endpointStore = useEndpointStore()
const languageStore = useLanguageStore()
const { shouldShowLangTag } = useLabelResolver()

// Update endpoint connection status based on query results
function setConnected() {
  if (endpointStore.status !== 'connected') {
    endpointStore.setStatus('connected')
  }
}

function setConnectionError() {
  endpointStore.setStatus('error')
}

// Local state
const loading = ref(false)
const error = ref<string | null>(null)
const showDetails = ref(false)
const selectedSchemeDetails = ref<ConceptScheme | null>(null)

// Computed
const dropdownOptions = computed(() => {
  const options: { label: string; value: string | null; uri: string | null; lang?: string; showLangTag: boolean }[] = [
    { label: 'All Schemes', value: null, uri: null, showLangTag: false },
  ]

  schemeStore.sortedSchemes.forEach(scheme => {
    const showTag = scheme.labelLang ? shouldShowLangTag(scheme.labelLang) : false
    options.push({
      label: scheme.label || scheme.uri,
      value: scheme.uri,
      uri: scheme.uri,
      lang: scheme.labelLang,
      showLangTag: showTag,
    })
  })

  return options
})

const selectedScheme = computed({
  get: () => schemeStore.selectedUri,
  set: (uri: string | null) => schemeStore.selectScheme(uri),
})

const currentScheme = computed(() => schemeStore.selected)

// Load schemes from endpoint
async function loadSchemes() {
  const endpoint = endpointStore.current
  if (!endpoint) return

  logger.info('SchemeSelector', 'Loading concept schemes', { endpoint: endpoint.url })

  loading.value = true
  error.value = null
  endpointStore.setStatus('connecting')

  // Query with all label types
  const query = withPrefixes(`
    SELECT DISTINCT ?scheme ?label ?labelLang ?labelType
    WHERE {
      ?scheme a skos:ConceptScheme .
      OPTIONAL {
        {
          ?scheme skos:prefLabel ?label .
          BIND("prefLabel" AS ?labelType)
        } UNION {
          ?scheme dct:title ?label .
          BIND("title" AS ?labelType)
        } UNION {
          ?scheme rdfs:label ?label .
          BIND("rdfsLabel" AS ?labelType)
        }
        BIND(LANG(?label) AS ?labelLang)
      }
    }
    LIMIT 500
  `)

  logger.debug('SchemeSelector', 'Query', { query })

  try {
    const results = await executeSparql(endpoint, query, { retries: 1 })

    // Group by scheme URI and pick best label
    const schemeMap = new Map<string, {
      labels: { value: string; lang: string; type: string }[]
    }>()

    for (const b of results.results.bindings) {
      const uri = b.scheme?.value
      if (!uri) continue

      if (!schemeMap.has(uri)) {
        schemeMap.set(uri, { labels: [] })
      }

      const entry = schemeMap.get(uri)!
      if (b.label?.value) {
        entry.labels.push({
          value: b.label.value,
          lang: b.labelLang?.value || '',
          type: b.labelType?.value || 'prefLabel'
        })
      }
    }

    // Convert to ConceptScheme[] with best label selection
    const uniqueSchemes: ConceptScheme[] = Array.from(schemeMap.entries()).map(([uri, data]) => {
      const labelPriority = ['prefLabel', 'title', 'rdfsLabel']
      let bestLabel: string | undefined
      let bestLabelLang: string | undefined

      for (const labelType of labelPriority) {
        const labelsOfType = data.labels.filter(l => l.type === labelType)
        if (!labelsOfType.length) continue

        // Walk through all language priorities in order
        let selected: { value: string; lang: string } | undefined
        for (const lang of languageStore.priorities) {
          selected = labelsOfType.find(l => l.lang === lang)
          if (selected) break
        }

        // Try labels without language tag
        if (!selected) {
          selected = labelsOfType.find(l => l.lang === '')
        }

        // Fall back to first available
        if (!selected) {
          selected = labelsOfType[0]
        }

        if (selected) {
          bestLabel = selected.value
          bestLabelLang = selected.lang || undefined
          break
        }
      }

      return { uri, label: bestLabel, labelLang: bestLabelLang }
    })

    logger.info('SchemeSelector', `Loaded ${uniqueSchemes.length} schemes`, {
      schemes: uniqueSchemes.map(s => s.label || s.uri),
    })

    setConnected()
    schemeStore.setSchemes(uniqueSchemes)

    // Auto-select if only one scheme
    const firstScheme = uniqueSchemes[0]
    if (uniqueSchemes.length === 1 && firstScheme && !schemeStore.selectedUri) {
      schemeStore.selectScheme(firstScheme.uri)
    }
  } catch (e: unknown) {
    const errMsg = e && typeof e === 'object' && 'message' in e ? (e as { message: string }).message : 'Unknown error'
    logger.error('SchemeSelector', 'Failed to load schemes', { error: e, message: errMsg })
    error.value = `Failed to load schemes: ${errMsg}`
    setConnectionError()
    schemeStore.setSchemes([])
  } finally {
    loading.value = false
  }
}

// Load detailed info for selected scheme
async function loadSchemeDetails(uri: string) {
  const endpoint = endpointStore.current
  if (!endpoint) return

  const query = withPrefixes(`
    SELECT ?label ?title ?description ?creator ?created ?modified
    WHERE {
      OPTIONAL { <${uri}> skos:prefLabel ?label }
      OPTIONAL { <${uri}> dct:title ?title }
      OPTIONAL { <${uri}> dct:description ?description }
      OPTIONAL { <${uri}> dct:creator ?creator }
      OPTIONAL { <${uri}> dct:created ?created }
      OPTIONAL { <${uri}> dct:modified ?modified }
    }
    LIMIT 1
  `)

  try {
    const results = await executeSparql(endpoint, query, { retries: 0 })
    const binding = results.results.bindings[0]

    if (binding) {
      selectedSchemeDetails.value = {
        uri,
        label: binding.label?.value,
        title: binding.title?.value,
        description: binding.description?.value,
        creator: binding.creator?.value,
        created: binding.created?.value,
        modified: binding.modified?.value,
      }
    }
  } catch (e) {
    console.error('Failed to load scheme details:', e)
  }
}

function openDetails() {
  if (currentScheme.value) {
    loadSchemeDetails(currentScheme.value.uri)
    showDetails.value = true
  }
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '-'
  try {
    return new Date(dateStr).toLocaleDateString()
  } catch {
    return dateStr
  }
}

// Watch for endpoint changes
watch(
  () => endpointStore.current?.id,
  (newId, oldId) => {
    if (newId && newId !== oldId) {
      schemeStore.reset()
      loadSchemes()
    }
  },
  { immediate: true }
)

// Reload when language priorities change
watch(
  () => languageStore.priorities,
  () => {
    if (endpointStore.current) {
      loadSchemes()
    }
  },
  { deep: true }
)
</script>

<template>
  <div class="scheme-selector">
    <Select
      v-model="selectedScheme"
      :options="dropdownOptions"
      optionLabel="label"
      optionValue="value"
      placeholder="Concept Scheme"
      :loading="loading"
      :disabled="!endpointStore.current"
      class="scheme-dropdown"
    >
      <template #value="slotProps">
        <div class="selected-scheme">
          <span v-if="slotProps.value">
            {{ currentScheme?.label || 'Scheme' }}
            <span v-if="currentScheme?.labelLang && shouldShowLangTag(currentScheme.labelLang)" class="lang-tag">
              {{ currentScheme.labelLang }}
            </span>
          </span>
          <span v-else>All Schemes</span>
        </div>
      </template>
      <template #option="slotProps">
        <div class="scheme-option">
          <div class="scheme-label-row">
            <span class="scheme-label">{{ slotProps.option.label }}</span>
            <span v-if="slotProps.option.showLangTag" class="lang-tag">
              {{ slotProps.option.lang }}
            </span>
          </div>
          <span v-if="slotProps.option.uri" class="scheme-uri">
            {{ slotProps.option.uri }}
          </span>
        </div>
      </template>
    </Select>

    <Button
      v-if="currentScheme"
      icon="pi pi-info-circle"
      severity="secondary"
      text
      rounded
      size="small"
      aria-label="Scheme details"
      @click="openDetails"
    />

    <!-- Error message -->
    <Message v-if="error" severity="error" :closable="true" @close="error = null">
      {{ error }}
    </Message>

    <!-- Details Dialog -->
    <Dialog
      v-model:visible="showDetails"
      header="Concept Scheme"
      :style="{ width: '500px' }"
      :modal="true"
    >
      <div v-if="selectedSchemeDetails" class="scheme-details">
        <div class="detail-row">
          <label>URI</label>
          <a v-if="isValidURI(selectedSchemeDetails.uri)" :href="selectedSchemeDetails.uri" target="_blank" class="uri-link">
            {{ selectedSchemeDetails.uri }}
            <i class="pi pi-external-link"></i>
          </a>
          <span v-else class="uri-text">{{ selectedSchemeDetails.uri }}</span>
        </div>

        <div v-if="selectedSchemeDetails.label" class="detail-row">
          <label>Label</label>
          <span>{{ selectedSchemeDetails.label }}</span>
        </div>

        <div v-if="selectedSchemeDetails.title" class="detail-row">
          <label>Title</label>
          <span>{{ selectedSchemeDetails.title }}</span>
        </div>

        <div v-if="selectedSchemeDetails.description" class="detail-row">
          <label>Description</label>
          <p class="description">{{ selectedSchemeDetails.description }}</p>
        </div>

        <div v-if="selectedSchemeDetails.creator" class="detail-row">
          <label>Creator</label>
          <span>{{ selectedSchemeDetails.creator }}</span>
        </div>

        <div class="detail-row-inline">
          <div v-if="selectedSchemeDetails.created" class="detail-item">
            <label>Created</label>
            <span>{{ formatDate(selectedSchemeDetails.created) }}</span>
          </div>
          <div v-if="selectedSchemeDetails.modified" class="detail-item">
            <label>Modified</label>
            <span>{{ formatDate(selectedSchemeDetails.modified) }}</span>
          </div>
        </div>
      </div>

      <template #footer>
        <Button label="Close" @click="showDetails = false" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.scheme-selector {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.scheme-dropdown {
  min-width: 180px;
}

.selected-scheme {
  font-weight: 500;
}

.scheme-option {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.scheme-label-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.scheme-label {
  font-weight: 500;
}

.lang-tag {
  font-size: 0.625rem;
  font-weight: normal;
  background: var(--p-surface-200);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
}

.scheme-uri {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  max-width: 250px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scheme-details {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.detail-row {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.detail-row label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
  text-transform: uppercase;
}

.uri-link {
  font-size: 0.875rem;
  word-break: break-all;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.uri-link i {
  font-size: 0.75rem;
}

.description {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.5;
}

.detail-row-inline {
  display: flex;
  gap: 2rem;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.detail-item label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
  text-transform: uppercase;
}
</style>
