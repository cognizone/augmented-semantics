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

  // Query to get all broader concepts recursively with all label types
  const query = withPrefixes(`
    SELECT ?concept ?label ?labelLang ?labelType ?depth
    WHERE {
      <${uri}> skos:broader* ?concept .
      OPTIONAL {
        {
          ?concept skos:prefLabel ?label .
          BIND("prefLabel" AS ?labelType)
        } UNION {
          ?concept rdfs:label ?label .
          BIND("rdfsLabel" AS ?labelType)
        } UNION {
          ?concept dct:title ?label .
          BIND("title" AS ?labelType)
        }
        BIND(LANG(?label) AS ?labelLang)
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

    // Group by concept URI and pick best label
    const conceptMap = new Map<string, {
      labels: { value: string; lang: string; type: string }[]
      depth: number
    }>()

    for (const b of results.results.bindings) {
      const conceptUri = b.concept?.value
      if (!conceptUri) continue

      const depth = parseInt(b.depth?.value || '0', 10)

      if (!conceptMap.has(conceptUri)) {
        conceptMap.set(conceptUri, { labels: [], depth })
      }

      const entry = conceptMap.get(conceptUri)!
      if (b.label?.value) {
        entry.labels.push({
          value: b.label.value,
          lang: b.labelLang?.value || '',
          type: b.labelType?.value || 'prefLabel'
        })
      }
    }

    // Convert to path with best label selection
    const path: ConceptRef[] = Array.from(conceptMap.entries())
      .sort((a, b) => b[1].depth - a[1].depth) // Sort by depth descending
      .map(([conceptUri, data]) => {
        // Pick best label: prefLabel > title > rdfsLabel, with language priority
        const labelPriority = ['prefLabel', 'title', 'rdfsLabel']
        let bestLabel: string | undefined

        for (const labelType of labelPriority) {
          const labelsOfType = data.labels.filter(l => l.type === labelType)
          if (!labelsOfType.length) continue

          const preferred = labelsOfType.find(l => l.lang === languageStore.preferred)
          const fallback = labelsOfType.find(l => l.lang === languageStore.fallback)
          const noLang = labelsOfType.find(l => l.lang === '')
          const any = labelsOfType[0]

          bestLabel = preferred?.value || fallback?.value || noLang?.value || any?.value
          if (bestLabel) break
        }

        return { uri: conceptUri, label: bestLabel }
      })

    logger.debug('Breadcrumb', `Loaded path with ${path.length} items`)
    conceptStore.setBreadcrumb(path)
  } catch (e) {
    logger.warn('Breadcrumb', 'Failed to load path, using simple fallback', { error: e })
    // Fallback: just show the current concept with any available label
    const simpleQuery = withPrefixes(`
      SELECT ?label ?labelLang
      WHERE {
        {
          <${uri}> skos:prefLabel ?label .
        } UNION {
          <${uri}> rdfs:label ?label .
        } UNION {
          <${uri}> dct:title ?label .
        }
        BIND(LANG(?label) AS ?labelLang)
      }
    `)

    try {
      const results = await executeSparql(endpoint, simpleQuery, { retries: 0 })
      const labels = results.results.bindings.map(b => ({
        value: b.label?.value || '',
        lang: b.labelLang?.value || ''
      })).filter(l => l.value)

      // Pick best label
      const preferred = labels.find(l => l.lang === languageStore.preferred)
      const fallback = labels.find(l => l.lang === languageStore.fallback)
      const noLang = labels.find(l => l.lang === '')
      const any = labels[0]
      const bestLabel = preferred?.value || fallback?.value || noLang?.value || any?.value

      conceptStore.setBreadcrumb([{ uri, label: bestLabel }])
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
