<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useConceptStore, useEndpointStore, useLanguageStore } from '../../stores'
import { executeSparql, withPrefixes, logger } from '../../services'
import type { ConceptRef } from '../../types'
import Breadcrumb from 'primevue/breadcrumb'

const emit = defineEmits<{
  selectConcept: [uri: string]
}>()

const conceptStore = useConceptStore()
const endpointStore = useEndpointStore()
const languageStore = useLanguageStore()

// Local state
const loading = ref(false)

// Convert breadcrumb to PrimeVue format
const breadcrumbItems = computed(() => {
  return conceptStore.breadcrumb.map(item => ({
    label: item.label || item.uri.split('/').pop() || item.uri,
    uri: item.uri,
    command: () => navigateTo(item.uri),
  }))
})

// Home item
const homeItem = computed(() => ({
  icon: 'pi pi-home',
  command: () => emit('selectConcept', ''),
}))

// Load breadcrumb path for concept
async function loadBreadcrumb(uri: string) {
  const endpoint = endpointStore.current
  if (!endpoint) return

  logger.debug('Breadcrumb', 'Loading path', { uri })
  loading.value = true

  // Query to get all broader concepts recursively
  const query = withPrefixes(`
    SELECT ?concept ?label ?depth
    WHERE {
      <${uri}> skos:broader* ?concept .
      OPTIONAL {
        ?concept skos:prefLabel ?label .
        FILTER (LANG(?label) = "${languageStore.preferred}" || LANG(?label) = "${languageStore.fallback}" || LANG(?label) = "")
      }
      {
        SELECT ?concept (COUNT(?mid) AS ?depth)
        WHERE {
          <${uri}> skos:broader* ?mid .
          ?mid skos:broader* ?concept .
        }
        GROUP BY ?concept
      }
    }
    ORDER BY DESC(?depth)
  `)

  try {
    const results = await executeSparql(endpoint, query, { retries: 0 })

    const path: ConceptRef[] = results.results.bindings
      .map(b => ({
        uri: b.concept?.value || '',
        label: b.label?.value,
      }))
      .filter(c => c.uri)

    logger.debug('Breadcrumb', `Loaded path with ${path.length} items`)
    conceptStore.setBreadcrumb(path)
  } catch (e) {
    logger.warn('Breadcrumb', 'Failed to load path, using simple fallback', { error: e })
    // Fallback: just show the current concept
    const simpleQuery = withPrefixes(`
      SELECT ?label
      WHERE {
        <${uri}> skos:prefLabel ?label .
        FILTER (LANG(?label) = "${languageStore.preferred}" || LANG(?label) = "${languageStore.fallback}" || LANG(?label) = "")
      }
      LIMIT 1
    `)

    try {
      const results = await executeSparql(endpoint, simpleQuery, { retries: 0 })
      const label = results.results.bindings[0]?.label?.value
      conceptStore.setBreadcrumb([{ uri, label }])
    } catch {
      conceptStore.setBreadcrumb([{ uri }])
    }
  } finally {
    loading.value = false
  }
}

// Navigate to concept
function navigateTo(uri: string) {
  emit('selectConcept', uri)
}

// Watch for selection changes
watch(
  () => conceptStore.selectedUri,
  (uri) => {
    if (uri) {
      loadBreadcrumb(uri)
    } else {
      conceptStore.setBreadcrumb([])
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="concept-breadcrumb" v-if="conceptStore.selectedUri">
    <Breadcrumb :home="homeItem" :model="breadcrumbItems" class="breadcrumb-nav">
      <template #item="{ item }">
        <a class="breadcrumb-link" @click.prevent="() => item.command && item.command({} as never)">
          <i v-if="item.icon" :class="item.icon"></i>
          <span v-else>{{ item.label }}</span>
        </a>
      </template>
    </Breadcrumb>
  </div>
</template>

<style scoped>
.concept-breadcrumb {
  padding: 0.5rem 1rem;
  background: var(--p-surface-50);
  border-bottom: 1px solid var(--p-surface-200);
}

.breadcrumb-nav {
  background: transparent;
  padding: 0;
}

.breadcrumb-link {
  cursor: pointer;
  color: var(--p-text-color);
  text-decoration: none;
  font-size: 0.875rem;
}

.breadcrumb-link:hover {
  color: var(--p-primary-color);
}

:deep(.p-breadcrumb-list) {
  margin: 0;
  padding: 0;
}

:deep(.p-breadcrumb-separator) {
  color: var(--p-text-muted-color);
}
</style>
