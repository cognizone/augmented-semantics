<script setup lang="ts">
/**
 * ConceptBreadcrumb - Hierarchical navigation path
 *
 * Shows the broader concept chain from root to current concept.
 * Uses recursive SPARQL query to build the full path.
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { ref, watch, computed } from 'vue'
import { useConceptStore, useEndpointStore, useLanguageStore, useSchemeStore } from '../../stores'
import { executeSparql, withPrefixes, logger } from '../../services'
import { useLabelResolver } from '../../composables'
import type { ConceptRef } from '../../types'
import Breadcrumb from 'primevue/breadcrumb'
import Select from 'primevue/select'

const emit = defineEmits<{
  selectConcept: [uri: string]
}>()

const conceptStore = useConceptStore()
const endpointStore = useEndpointStore()
const languageStore = useLanguageStore()
const schemeStore = useSchemeStore()
const { shouldShowLangTag } = useLabelResolver()

// Local state
const loading = ref(false)

// Scheme dropdown options
const schemeOptions = computed(() => {
  const options: { label: string; value: string | null }[] = [
    { label: 'All Schemes', value: null },
  ]

  schemeStore.sortedSchemes.forEach(scheme => {
    options.push({
      label: scheme.label || scheme.uri.split('/').pop() || scheme.uri,
      value: scheme.uri,
    })
  })

  return options
})

const selectedScheme = computed({
  get: () => schemeStore.selectedUri,
  set: (uri: string | null) => schemeStore.selectScheme(uri),
})

const currentSchemeName = computed(() => {
  if (!schemeStore.selected) return 'All Schemes'
  return schemeStore.selected.label || schemeStore.selected.uri.split('/').pop() || 'Scheme'
})

// Convert breadcrumb to PrimeVue format with notation + label + lang
const breadcrumbItems = computed(() => {
  return conceptStore.breadcrumb.map(item => {
    const label = item.label || item.uri.split('/').pop() || item.uri
    // Show notation + label if both exist
    const displayLabel = item.notation && item.label
      ? `${item.notation} - ${label}`
      : item.notation || label

    return {
      label: displayLabel,
      uri: item.uri,
      lang: item.lang,
      showLangTag: item.lang ? shouldShowLangTag(item.lang) : false,
      command: () => navigateTo(item.uri),
    }
  })
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

  // Query to get all broader concepts recursively with all label types (including SKOS-XL) and notation
  const query = withPrefixes(`
    SELECT ?concept ?label ?labelLang ?labelType ?notation ?depth
    WHERE {
      <${uri}> skos:broader* ?concept .
      OPTIONAL { ?concept skos:notation ?notation }
      OPTIONAL {
        {
          ?concept skos:prefLabel ?label .
          BIND("prefLabel" AS ?labelType)
        } UNION {
          ?concept skosxl:prefLabel/skosxl:literalForm ?label .
          BIND("xlPrefLabel" AS ?labelType)
        } UNION {
          ?concept dct:title ?label .
          BIND("title" AS ?labelType)
        } UNION {
          ?concept rdfs:label ?label .
          BIND("rdfsLabel" AS ?labelType)
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
      notation?: string
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

      // Store notation (first one wins)
      if (b.notation?.value && !entry.notation) {
        entry.notation = b.notation.value
      }

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
        // Pick best label: prefLabel > xlPrefLabel > title > rdfsLabel, with language priority
        const labelPriority = ['prefLabel', 'xlPrefLabel', 'title', 'rdfsLabel']
        let bestLabel: string | undefined
        let bestLabelLang: string | undefined

        for (const labelType of labelPriority) {
          const labelsOfType = data.labels.filter(l => l.type === labelType)
          if (!labelsOfType.length) continue

          const preferred = labelsOfType.find(l => l.lang === languageStore.preferred)
          const noLang = labelsOfType.find(l => l.lang === '')
          const any = labelsOfType[0]

          const selected = preferred || noLang || any
          if (selected) {
            bestLabel = selected.value
            bestLabelLang = selected.lang || undefined
            break
          }
        }

        return { uri: conceptUri, label: bestLabel, lang: bestLabelLang, notation: data.notation }
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
      const noLang = labels.find(l => l.lang === '')
      const any = labels[0]
      const bestLabel = preferred?.value || noLang?.value || any?.value

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
  <div class="concept-breadcrumb">
    <!-- Home button (always visible, first) -->
    <button class="home-btn" @click="emit('selectConcept', '')" title="Go to root">
      <span class="material-symbols-outlined">home</span>
    </button>

    <!-- Separator -->
    <span class="breadcrumb-separator">
      <span class="material-symbols-outlined">chevron_right</span>
    </span>

    <!-- Scheme selector (styled like endpoint badge) -->
    <Select
      v-model="selectedScheme"
      :options="schemeOptions"
      optionLabel="label"
      optionValue="value"
      placeholder="Select Scheme"
      class="scheme-select"
      :disabled="!endpointStore.current || schemeOptions.length <= 1"
    >
      <template #value>
        <span class="scheme-value">{{ currentSchemeName }}</span>
      </template>
    </Select>

    <!-- Breadcrumb path (only when concept selected) -->
    <template v-if="breadcrumbItems.length > 0">
      <span class="breadcrumb-separator">
        <span class="material-symbols-outlined">chevron_right</span>
      </span>
      <Breadcrumb :model="breadcrumbItems" class="breadcrumb-nav">
        <template #item="{ item }">
          <a class="breadcrumb-link" @click.prevent="() => item.command && item.command({} as never)">
            {{ item.label }}
            <span v-if="item.showLangTag" class="lang-tag">{{ item.lang }}</span>
          </a>
        </template>
      </Breadcrumb>
    </template>
  </div>
</template>

<style scoped>
.concept-breadcrumb {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 1rem;
  background: var(--ae-bg-elevated);
  border-bottom: 1px solid var(--ae-border-color);
  min-height: 40px;
}

/* Scheme selector - styled like endpoint badge */
.scheme-select {
  flex-shrink: 0;
}

:deep(.scheme-select .p-select) {
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 4px;
  min-width: auto;
  max-width: none;
  transition: background-color 0.15s, border-color 0.15s;
}

:deep(.scheme-select .p-select:hover) {
  background: var(--ae-bg-hover);
  border-color: var(--ae-text-secondary);
}

:deep(.scheme-select .p-select.p-focus) {
  border-color: var(--ae-accent);
  box-shadow: none;
}

:deep(.scheme-select .p-select-label) {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
}

:deep(.scheme-select .p-select-dropdown) {
  width: 1.25rem;
  color: var(--ae-text-secondary);
}

:deep(.scheme-select .p-select-dropdown .p-icon) {
  width: 0.75rem;
  height: 0.75rem;
}

.scheme-value {
  white-space: nowrap;
}

/* Separator */
.breadcrumb-separator {
  display: flex;
  align-items: center;
  color: var(--ae-text-muted);
}

.breadcrumb-separator .material-symbols-outlined {
  font-size: 16px;
}

/* Home button */
.home-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--ae-text-secondary);
  transition: background-color 0.15s, color 0.15s;
}

.home-btn:hover {
  background: var(--ae-bg-hover);
  color: var(--ae-text-primary);
}

.home-btn .material-symbols-outlined {
  font-size: 18px;
}

/* Breadcrumb nav */
.breadcrumb-nav {
  background: transparent;
  padding: 0;
  flex: 1;
  min-width: 0;
}

.breadcrumb-link {
  cursor: pointer;
  color: var(--ae-text-secondary);
  text-decoration: none;
  font-size: 0.8125rem;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.breadcrumb-link:hover {
  color: var(--ae-accent);
}

.lang-tag {
  font-size: 0.625rem;
  font-weight: normal;
  background: var(--ae-bg-hover);
  color: var(--ae-text-secondary);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  margin-left: 0.25rem;
}

:deep(.p-breadcrumb) {
  background: transparent;
  border: none;
  padding: 0;
}

:deep(.p-breadcrumb-list) {
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.25rem;
  overflow: hidden;
}

:deep(.p-breadcrumb-list li) {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

:deep(.p-breadcrumb-separator) {
  color: var(--ae-text-muted);
  margin: 0 0.25rem;
}

:deep(.p-breadcrumb-separator .p-icon) {
  width: 12px;
  height: 12px;
}
</style>
