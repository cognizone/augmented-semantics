<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useSchemeStore, useEndpointStore, useLanguageStore } from '../../stores'
import { executeSparql, withPrefixes, logger } from '../../services'
import type { ConceptScheme } from '../../types'
import Select from 'primevue/select'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Message from 'primevue/message'

const schemeStore = useSchemeStore()
const endpointStore = useEndpointStore()
const languageStore = useLanguageStore()

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
  const options: { label: string; value: string | null; uri: string | null }[] = [
    { label: 'All Schemes', value: null, uri: null },
  ]

  schemeStore.sortedSchemes.forEach(scheme => {
    options.push({
      label: scheme.label || scheme.uri,
      value: scheme.uri,
      uri: scheme.uri,
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

  // Simplified query - more compatible with different endpoints
  const query = withPrefixes(`
    SELECT DISTINCT ?scheme ?label
    WHERE {
      ?scheme a skos:ConceptScheme .
      OPTIONAL { ?scheme skos:prefLabel ?label }
      OPTIONAL { ?scheme dct:title ?label }
      OPTIONAL { ?scheme rdfs:label ?label }
    }
    LIMIT 100
  `)

  logger.debug('SchemeSelector', 'Query', { query })

  try {
    const results = await executeSparql(endpoint, query, { retries: 1 })
    const schemes: ConceptScheme[] = results.results.bindings.map(b => ({
      uri: b.scheme?.value || '',
      label: b.label?.value,
      description: b.description?.value,
    })).filter(s => s.uri)

    // Remove duplicates by URI
    const uniqueSchemes = Array.from(
      new Map(schemes.map(s => [s.uri, s])).values()
    )

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

// Reload when language changes
watch(
  () => languageStore.preferred,
  () => {
    if (endpointStore.current) {
      loadSchemes()
    }
  }
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
          </span>
          <span v-else>All Schemes</span>
        </div>
      </template>
      <template #option="slotProps">
        <div class="scheme-option">
          <span class="scheme-label">{{ slotProps.option.label }}</span>
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
          <a :href="selectedSchemeDetails.uri" target="_blank" class="uri-link">
            {{ selectedSchemeDetails.uri }}
            <i class="pi pi-external-link"></i>
          </a>
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

.scheme-label {
  font-weight: 500;
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
