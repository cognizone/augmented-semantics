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
import { useConceptStore, useEndpointStore, useLanguageStore, useSchemeStore, useUIStore } from '../../stores'
import { executeSparql, withPrefixes, logger } from '../../services'
import { useLabelResolver } from '../../composables'
import type { ConceptRef, ConceptScheme } from '../../types'
import Breadcrumb from 'primevue/breadcrumb'
import Select from 'primevue/select'

const emit = defineEmits<{
  selectConcept: [uri: string]
}>()

const conceptStore = useConceptStore()
const endpointStore = useEndpointStore()
const languageStore = useLanguageStore()
const schemeStore = useSchemeStore()
const uiStore = useUIStore()
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
  set: (uri: string | null) => {
    schemeStore.selectScheme(uri)
    // When selecting a scheme from dropdown, also show its details and clear concept selection
    if (uri) {
      conceptStore.selectConcept(null)
      schemeStore.viewScheme(uri)
      // Switch to browse tab
      uiStore.setSidebarTab('browse')
      // Add to history
      const scheme = schemeStore.schemes.find(s => s.uri === uri)
      if (scheme) {
        conceptStore.addToHistory({
          uri: scheme.uri,
          label: scheme.label || scheme.uri,
          lang: scheme.labelLang,
          endpointUrl: endpointStore.current?.url,
          type: 'scheme',
        })
      }
    } else {
      schemeStore.viewScheme(null)
    }
  },
})

const currentSchemeName = computed(() => {
  if (!schemeStore.selected) return 'All Schemes'
  return schemeStore.selected.label || schemeStore.selected.uri.split('/').pop() || 'Scheme'
})

// Go to scheme home (show scheme details)
function goHome() {
  const scheme = schemeStore.selected
  if (scheme) {
    conceptStore.selectConcept(null)
    schemeStore.viewScheme(scheme.uri)
    conceptStore.scrollTreeToTop()
    // Add to history
    conceptStore.addToHistory({
      uri: scheme.uri,
      label: scheme.label || scheme.uri,
      lang: scheme.labelLang,
      endpointUrl: endpointStore.current?.url,
      type: 'scheme',
    })
  }
}

// Helper to select best label based on language priorities
function selectBestLabelByLanguage(
  labels: { value: string; lang: string; type: string }[]
): { value: string; lang: string } | undefined {
  if (!labels.length) return undefined

  // 1. Try preferred language
  const preferred = labels.find(l => l.lang === languageStore.preferred)
  if (preferred) return preferred

  // 2. Try endpoint's language priorities in order
  const priorities = endpointStore.current?.languagePriorities || []
  for (const lang of priorities) {
    const match = labels.find(l => l.lang === lang)
    if (match) return match
  }

  // 3. Try labels without language tag
  const noLang = labels.find(l => !l.lang || l.lang === '')
  if (noLang) return noLang

  // 4. Return first available
  return labels[0]
}

// Load schemes from endpoint
async function loadSchemes() {
  const endpoint = endpointStore.current
  if (!endpoint) return

  logger.info('ConceptBreadcrumb', 'Loading concept schemes', { endpoint: endpoint.url })
  endpointStore.setStatus('connecting')

  const query = withPrefixes(`
    SELECT DISTINCT ?scheme ?label ?labelLang ?labelType ?deprecated
    WHERE {
      ?scheme a skos:ConceptScheme .
      OPTIONAL { ?scheme owl:deprecated ?deprecated . }
      OPTIONAL {
        {
          ?scheme skos:prefLabel ?label .
          BIND("prefLabel" AS ?labelType)
        } UNION {
          ?scheme skosxl:prefLabel/skosxl:literalForm ?label .
          BIND("xlPrefLabel" AS ?labelType)
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
  `)

  try {
    const results = await executeSparql(endpoint, query, { retries: 1 })

    // Group by scheme URI and pick best label
    const schemeMap = new Map<string, {
      labels: { value: string; lang: string; type: string }[]
      deprecated: boolean
    }>()

    for (const b of results.results.bindings) {
      const uri = b.scheme?.value
      if (!uri) continue

      if (!schemeMap.has(uri)) {
        schemeMap.set(uri, { labels: [], deprecated: false })
      }

      const entry = schemeMap.get(uri)!

      // Check deprecated status
      if (b.deprecated?.value) {
        const val = b.deprecated.value.toLowerCase()
        if (val === 'true' || val === '1') {
          entry.deprecated = true
        }
      }

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
      const labelPriority = ['prefLabel', 'xlPrefLabel', 'title', 'rdfsLabel']
      let bestLabel: string | undefined
      let bestLabelLang: string | undefined

      for (const labelType of labelPriority) {
        const labelsOfType = data.labels.filter(l => l.type === labelType)
        if (!labelsOfType.length) continue

        const selected = selectBestLabelByLanguage(labelsOfType)
        if (selected) {
          bestLabel = selected.value
          bestLabelLang = selected.lang || undefined
          break
        }
      }

      return { uri, label: bestLabel, labelLang: bestLabelLang, deprecated: data.deprecated || undefined }
    })

    logger.info('ConceptBreadcrumb', `Loaded ${uniqueSchemes.length} schemes`)
    endpointStore.setStatus('connected')
    schemeStore.setSchemes(uniqueSchemes)

    // Auto-select if only one scheme
    if (uniqueSchemes.length === 1 && uniqueSchemes[0] && !schemeStore.selectedUri) {
      schemeStore.selectScheme(uniqueSchemes[0].uri)
    }
  } catch (e: unknown) {
    const errMsg = e && typeof e === 'object' && 'message' in e ? (e as { message: string }).message : 'Unknown error'
    logger.error('ConceptBreadcrumb', 'Failed to load schemes', { error: e, message: errMsg })
    endpointStore.setStatus('error')
    schemeStore.setSchemes([])
  }
}

// Watch for endpoint changes to load schemes
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

// Reload schemes when language preference changes
watch(
  () => languageStore.preferred,
  () => {
    if (endpointStore.current) {
      loadSchemes()
    }
  }
)

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

// Track current request to ignore stale responses
let breadcrumbRequestId = 0

// Load breadcrumb path for concept using iterative queries (fast on large endpoints)
async function loadBreadcrumb(uri: string) {
  const endpoint = endpointStore.current
  if (!endpoint) return

  // Track this request
  const requestId = ++breadcrumbRequestId

  logger.debug('Breadcrumb', 'Loading path iteratively', { uri, requestId })
  loading.value = true

  const path: ConceptRef[] = []
  let current: string | null = uri
  const visited = new Set<string>()
  const MAX_DEPTH = 20  // Safety limit to prevent infinite loops

  try {
    while (current && !visited.has(current) && path.length < MAX_DEPTH) {
      visited.add(current)

      // Simple query for ONE concept's broader + labels (fast!)
      const query = withPrefixes(`
        SELECT ?broader ?label ?labelLang ?labelType ?notation
        WHERE {
          OPTIONAL {
            { <${current}> skos:broader ?broader }
            UNION
            { ?broader skos:narrower <${current}> }
          }
          OPTIONAL { <${current}> skos:notation ?notation }
          OPTIONAL {
            {
              <${current}> skos:prefLabel ?label .
              BIND("prefLabel" AS ?labelType)
            } UNION {
              <${current}> skosxl:prefLabel/skosxl:literalForm ?label .
              BIND("xlPrefLabel" AS ?labelType)
            } UNION {
              <${current}> dct:title ?label .
              BIND("title" AS ?labelType)
            } UNION {
              <${current}> rdfs:label ?label .
              BIND("rdfsLabel" AS ?labelType)
            }
            BIND(LANG(?label) AS ?labelLang)
          }
        }
      `)

      const results = await executeSparql(endpoint, query, { retries: 0 })

      // Check for stale request after each query
      if (requestId !== breadcrumbRequestId) {
        logger.debug('Breadcrumb', 'Ignoring stale response', { requestId, current: breadcrumbRequestId })
        return
      }

      // Collect labels and find broader
      const labels: { value: string; lang: string; type: string }[] = []
      let notation: string | undefined
      let broader: string | null = null

      for (const b of results.results.bindings) {
        if (b.broader?.value && !broader) {
          broader = b.broader.value
        }
        if (b.notation?.value && !notation) {
          notation = b.notation.value
        }
        const labelValue = b.label?.value
        if (labelValue) {
          const labelLang = b.labelLang?.value || ''
          const labelType = b.labelType?.value || 'prefLabel'
          const exists = labels.some(l =>
            l.value === labelValue && l.lang === labelLang && l.type === labelType
          )
          if (!exists) {
            labels.push({
              value: labelValue,
              lang: labelLang,
              type: labelType
            })
          }
        }
      }

      // Pick best label: prefLabel > xlPrefLabel > title > rdfsLabel, with language priority
      const labelPriority = ['prefLabel', 'xlPrefLabel', 'title', 'rdfsLabel']
      let bestLabel: string | undefined
      let bestLabelLang: string | undefined

      for (const labelType of labelPriority) {
        const labelsOfType = labels.filter(l => l.type === labelType)
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

      path.push({ uri: current, label: bestLabel, lang: bestLabelLang, notation })

      // Move to broader (or stop if none)
      current = broader
    }

    // Reverse to get root→leaf order
    path.reverse()

    logger.debug('Breadcrumb', `Loaded path with ${path.length} items (${path.length} queries)`)
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

// Watch for selection OR language changes to reload breadcrumb
watch(
  [() => conceptStore.selectedUri, () => languageStore.preferred],
  ([uri]) => {
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
    <button class="home-btn" @click="goHome" title="Go to scheme">
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
      class="scheme-select select-compact"
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

/* Scheme selector */
.scheme-select {
  flex-shrink: 0;
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
