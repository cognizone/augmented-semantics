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
import { useConceptStore, useEndpointStore, useLanguageStore, useSchemeStore, useSettingsStore, useUIStore, ORPHAN_SCHEME_URI, ORPHAN_SCHEME } from '../../stores'
import { executeSparql, withPrefixes, logger } from '../../services'
import { useLabelResolver } from '../../composables'
import type { ConceptRef, ConceptScheme } from '../../types'
import Breadcrumb from 'primevue/breadcrumb'
import Select from 'primevue/select'
import InputText from 'primevue/inputtext'

const emit = defineEmits<{
  selectConcept: [uri: string]
}>()

const conceptStore = useConceptStore()
const endpointStore = useEndpointStore()
const languageStore = useLanguageStore()
const schemeStore = useSchemeStore()
const settingsStore = useSettingsStore()
const uiStore = useUIStore()
const { shouldShowLangTag, selectLabelByPriority } = useLabelResolver()

// Local state
const loading = ref(false)
const filterValue = ref('')

// Handle keyboard in filter input
function onFilterKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    // Clear filter on Escape
    filterValue.value = ''
  }
  // Arrow keys and Tab work naturally - no interception needed
}

// All scheme options (unfiltered)
const allSchemeOptions = computed(() => {
  const options: { label: string; value: string | null; isOrphan?: boolean; isPinned?: boolean }[] = [
    { label: 'All Schemes', value: null, isPinned: true },
  ]

  // Add orphan option if enabled in settings
  if (settingsStore.showOrphansSelector) {
    options.push({ label: ORPHAN_SCHEME.label || 'Orphans', value: ORPHAN_SCHEME_URI, isOrphan: true, isPinned: true })
  }

  schemeStore.sortedSchemes.forEach(scheme => {
    options.push({
      label: scheme.label || scheme.uri.split('/').pop() || scheme.uri,
      value: scheme.uri,
    })
  })

  return options
})

// Filtered scheme options
const schemeOptions = computed(() => {
  if (!filterValue.value) {
    return allSchemeOptions.value
  }

  const filter = filterValue.value.toLowerCase()
  return allSchemeOptions.value.filter(option => {
    // Always show pinned items
    if (option.isPinned) return true

    // Filter regular schemes by label
    return option.label.toLowerCase().includes(filter)
  })
})

const selectedScheme = computed({
  get: () => schemeStore.selectedUri,
  set: (uri: string | null) => {
    schemeStore.selectScheme(uri)
    filterValue.value = ''
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
    conceptStore.selectCollection(null)
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

// Load schemes from endpoint (uses schemeUris whitelist from analysis)
async function loadSchemes() {
  const endpoint = endpointStore.current
  if (!endpoint) return

  // Get whitelist from endpoint analysis
  const schemeUris = endpoint.analysis?.schemeUris || []
  logger.info('ConceptBreadcrumb', 'Loading concept schemes', {
    endpoint: endpoint.url,
    whitelistCount: schemeUris.length
  })

  // If no schemes in whitelist, set empty and return
  if (schemeUris.length === 0) {
    logger.info('ConceptBreadcrumb', 'No schemes in whitelist, setting empty')
    schemeStore.setSchemes([])
    endpointStore.setStatus('connected')
    return
  }

  endpointStore.setStatus('connecting')

  // Build VALUES clause for whitelist
  const valuesClause = schemeUris.map(uri => `<${uri}>`).join(' ')

  const query = withPrefixes(`
    SELECT DISTINCT ?scheme ?label ?labelLang ?labelType ?deprecated
    WHERE {
      VALUES ?scheme { ${valuesClause} }
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
          BIND("dctTitle" AS ?labelType)
        } UNION {
          ?scheme dc:title ?label .
          BIND("dcTitle" AS ?labelType)
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

    // Initialize map with ALL whitelist URIs (so we include schemes without labels)
    const schemeMap = new Map<string, {
      labels: { value: string; lang: string; type: string }[]
      deprecated: boolean
    }>()

    // Pre-populate with whitelist URIs
    for (const uri of schemeUris) {
      schemeMap.set(uri, { labels: [], deprecated: false })
    }

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

    // Convert to ConceptScheme[] with best label selection (includes all whitelist URIs)
    const uniqueSchemes: ConceptScheme[] = Array.from(schemeMap.entries()).map(([uri, data]) => {
      // Use centralized resolver for label selection
      const selected = selectLabelByPriority(data.labels)
      return {
        uri,
        label: selected?.value,
        labelLang: selected?.lang || undefined,
        deprecated: data.deprecated || undefined
      }
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
  const items = conceptStore.breadcrumb

  return items.map((item, index) => {
    const label = item.label || item.uri.split('/').pop() || item.uri
    // Show notation + label if both exist
    const displayLabel = item.notation && item.label
      ? `${item.notation} - ${label}`
      : item.notation || label

    // Determine if this is the last (current) item
    const isLast = index === items.length - 1

    // Command depends on item type
    let command: (() => void) | undefined

    if (isLast) {
      // Last item is current selection - no action
      command = undefined
    } else if (item.type === 'scheme') {
      // Clicking scheme in collection breadcrumb goes to scheme details
      command = () => goHome()
    } else {
      // Regular concept navigation
      command = () => navigateTo(item.uri)
    }

    return {
      label: displayLabel,
      uri: item.uri,
      lang: item.lang,
      type: item.type,
      hasNarrower: (item as ConceptRef & { hasNarrower?: boolean }).hasNarrower,
      isLast,
      showLangTag: item.lang ? shouldShowLangTag(item.lang) : false,
      command,
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

      // Simple query for ONE concept's broader + labels + hasNarrower (fast!)
      // hasNarrower only needed for the selected concept (first iteration)
      const isSelectedConcept = path.length === 0
      const query = withPrefixes(`
        SELECT ?broader ?label ?labelLang ?labelType ?notation ${isSelectedConcept ? '?hasNarrower' : ''}
        WHERE {
          OPTIONAL {
            { <${current}> skos:broader ?broader }
            UNION
            { ?broader skos:narrower <${current}> }
          }
          OPTIONAL { <${current}> skos:notation ?notation }
          ${isSelectedConcept ? `
          OPTIONAL {
            { <${current}> skos:narrower ?hasNarrower }
            UNION
            { ?hasNarrower skos:broader <${current}> }
          }
          ` : ''}
          OPTIONAL {
            {
              <${current}> skos:prefLabel ?label .
              BIND("prefLabel" AS ?labelType)
            } UNION {
              <${current}> skosxl:prefLabel/skosxl:literalForm ?label .
              BIND("xlPrefLabel" AS ?labelType)
            } UNION {
              <${current}> dct:title ?label .
              BIND("dctTitle" AS ?labelType)
            } UNION {
              <${current}> dc:title ?label .
              BIND("dcTitle" AS ?labelType)
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
      let hasNarrower = false

      for (const b of results.results.bindings) {
        if (b.broader?.value && !broader) {
          broader = b.broader.value
        }
        if (b.notation?.value && !notation) {
          notation = b.notation.value
        }
        if (b.hasNarrower?.value) {
          hasNarrower = true
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

      // Pick best label using centralized resolver
      const selected = selectLabelByPriority(labels)
      const bestLabel = selected?.value
      const bestLabelLang = selected?.lang || undefined

      // For the selected concept (first item), include hasNarrower info
      const item: ConceptRef = {
        uri: current,
        label: bestLabel,
        lang: bestLabelLang,
        notation,
        type: 'concept',
      }
      // Store hasNarrower on the item (will be used for icon selection)
      if (isSelectedConcept) {
        (item as ConceptRef & { hasNarrower?: boolean }).hasNarrower = hasNarrower
      }
      path.push(item)

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
          <${uri}> skosxl:prefLabel/skosxl:literalForm ?label .
        } UNION {
          <${uri}> dct:title ?label .
        } UNION {
          <${uri}> dc:title ?label .
        } UNION {
          <${uri}> rdfs:label ?label .
        }
        BIND(LANG(?label) AS ?labelLang)
      }
    `)

    try {
      const results = await executeSparql(endpoint, simpleQuery, { retries: 0 })
      const labels = results.results.bindings.map(b => ({
        value: b.label?.value || '',
        lang: b.labelLang?.value || '',
        type: 'prefLabel'  // Use prefLabel type for unified handling
      })).filter(l => l.value)

      // Pick best label using centralized resolver
      const selected = selectLabelByPriority(labels)
      const bestLabel = selected?.value

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

/**
 * Load breadcrumb for collection via SPARQL query
 * Similar to loadBreadcrumb() but simpler (no broader chain)
 */
async function loadCollectionBreadcrumb(collectionUri: string) {
  const endpoint = endpointStore.current
  if (!endpoint) return

  const scheme = schemeStore.selected
  if (!scheme) {
    conceptStore.setBreadcrumb([])
    return
  }

  logger.debug('Breadcrumb', 'Loading collection labels', { uri: collectionUri })
  loading.value = true

  try {
    // Query for collection labels using same priority as concepts
    const query = withPrefixes(`
      SELECT ?label ?labelLang ?labelType ?notation
      WHERE {
        OPTIONAL { <${collectionUri}> skos:notation ?notation }
        OPTIONAL {
          {
            <${collectionUri}> skos:prefLabel ?label .
            BIND("prefLabel" AS ?labelType)
          } UNION {
            <${collectionUri}> skosxl:prefLabel/skosxl:literalForm ?label .
            BIND("xlPrefLabel" AS ?labelType)
          } UNION {
            <${collectionUri}> dct:title ?label .
            BIND("dctTitle" AS ?labelType)
          } UNION {
            <${collectionUri}> dc:title ?label .
            BIND("dcTitle" AS ?labelType)
          } UNION {
            <${collectionUri}> rdfs:label ?label .
            BIND("rdfsLabel" AS ?labelType)
          }
          BIND(LANG(?label) AS ?labelLang)
        }
      }
    `)

    const results = await executeSparql(endpoint, query, { retries: 0 })

    // Collect labels and notation
    const labels: { value: string; lang: string; type: string }[] = []
    let notation: string | undefined

    for (const b of results.results.bindings) {
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
          labels.push({ value: labelValue, lang: labelLang, type: labelType })
        }
      }
    }

    // Pick best label using centralized resolver
    const selected = selectLabelByPriority(labels)
    const bestLabel = selected?.value
    const bestLabelLang = selected?.lang || undefined

    // Build breadcrumb with just the collection
    const path: ConceptRef[] = [
      {
        uri: collectionUri,
        label: bestLabel || collectionUri.split('/').pop() || collectionUri,
        lang: bestLabelLang,
        notation,
        type: 'collection',
      },
    ]

    conceptStore.setBreadcrumb(path)
  } catch (e) {
    logger.warn('Breadcrumb', 'Failed to load collection labels', { error: e })
    // Fallback to URI fragment
    conceptStore.setBreadcrumb([{
      uri: collectionUri,
      label: collectionUri.split('/').pop() || collectionUri,
      type: 'collection',
    }])
  } finally {
    loading.value = false
  }
}

// Watch for selection OR language changes to reload breadcrumb
watch(
  [() => conceptStore.selectedUri, () => conceptStore.selectedCollectionUri, () => languageStore.preferred],
  ([conceptUri, collectionUri]) => {
    if (conceptUri) {
      loadBreadcrumb(conceptUri)
    } else if (collectionUri) {
      loadCollectionBreadcrumb(collectionUri)
    } else {
      breadcrumbRequestId++  // Invalidate any in-flight requests
      conceptStore.setBreadcrumb([])
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="concept-breadcrumb">
    <!-- Scheme icon -->
    <span class="material-symbols-outlined breadcrumb-icon icon-folder">folder</span>

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
      <template #header v-if="allSchemeOptions.length > 5">
        <div class="scheme-filter-container">
          <div class="filter-input-wrapper">
            <InputText
              v-model="filterValue"
              placeholder="Filter schemes..."
              class="scheme-filter"
              @keydown="onFilterKeyDown"
            />
            <button
              v-if="filterValue"
              @click="filterValue = ''"
              class="filter-clear-btn"
              aria-label="Clear filter"
            >
              ×
            </button>
          </div>
        </div>
      </template>
      <template #value>
        <span class="scheme-value">{{ currentSchemeName }}</span>
      </template>
      <template #option="slotProps">
        <div class="scheme-option" :class="{ orphan: slotProps.option.isOrphan }">
          <span v-if="slotProps.option.isOrphan" class="material-symbols-outlined orphan-icon">link_off</span>
          <span>{{ slotProps.option.label }}</span>
        </div>
      </template>
      <template #empty>
        <div class="empty-message">
          {{ filterValue ? 'No schemes match your search' : 'No schemes available' }}
        </div>
      </template>
    </Select>

    <!-- Breadcrumb path (only when concept selected) -->
    <template v-if="breadcrumbItems.length > 0">
      <span class="breadcrumb-separator">
        <span class="material-symbols-outlined">chevron_right</span>
      </span>
      <Breadcrumb :model="breadcrumbItems" class="breadcrumb-nav">
        <template #item="{ item }">
          <span v-if="item.isLast" class="breadcrumb-current">
            <span v-if="item.type === 'collection'" class="material-symbols-outlined breadcrumb-icon icon-collection">collections_bookmark</span>
            <span v-else-if="item.hasNarrower" class="material-symbols-outlined breadcrumb-icon icon-label">label</span>
            <span v-else class="material-symbols-outlined breadcrumb-icon icon-leaf">circle</span>
            {{ item.label }}
            <span v-if="item.showLangTag" class="lang-tag">{{ item.lang }}</span>
          </span>
          <a v-else class="breadcrumb-link" @click.prevent="() => item.command && item.command({} as never)">
            <span v-if="item.type === 'collection'" class="material-symbols-outlined breadcrumb-icon icon-collection">collections_bookmark</span>
            <span v-else class="material-symbols-outlined breadcrumb-icon icon-label">label</span>
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

/* Scheme filter (inside dropdown header) */
.scheme-filter-container {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--ae-border-color);
  background: var(--ae-bg-base);
}

.filter-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.scheme-filter {
  width: 100%;
  padding: 0.375rem 0.5rem;
  padding-right: 2rem;
  font-size: 0.8125rem;
  background: transparent;
  border: 1px solid var(--ae-border-color);
  border-radius: 4px;
  color: var(--ae-text-primary);
  transition: border-color 0.15s;
}

.scheme-filter:focus {
  outline: none;
  border-color: var(--ae-accent);
}

.scheme-filter::placeholder {
  color: var(--ae-text-muted);
  font-style: italic;
}

.filter-clear-btn {
  position: absolute;
  right: 0.25rem;
  top: 50%;
  transform: translateY(-50%);
  width: 1.5rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--ae-text-secondary);
  font-size: 1.25rem;
  cursor: pointer;
  transition: all 0.15s;
  padding: 0;
  line-height: 1;
}

.filter-clear-btn:hover {
  background: var(--ae-bg-hover);
  color: var(--ae-text-primary);
}

.filter-clear-btn:active {
  transform: translateY(-50%) scale(0.9);
}

.empty-message {
  padding: 1rem;
  text-align: center;
  font-size: 0.875rem;
  color: var(--ae-text-secondary);
  font-style: italic;
}

/* Scheme selector */
.scheme-select {
  flex-shrink: 0;
}

.scheme-value {
  white-space: nowrap;
  color: var(--ae-text-primary);
  font-weight: 500;
}

.scheme-option {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.scheme-option.orphan {
  color: var(--ae-text-secondary);
  font-style: italic;
}

.orphan-icon {
  font-size: 14px;
  color: var(--ae-text-muted);
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

/* Breadcrumb icons */
.breadcrumb-icon {
  font-size: 14px;
  flex-shrink: 0;
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
  color: var(--ae-text-primary);
  text-decoration: none;
  font-size: 0.8125rem;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.breadcrumb-link:hover {
  color: var(--ae-accent);
}

.breadcrumb-current {
  color: var(--ae-text-secondary);
  font-size: 0.8125rem;
  display: flex;
  align-items: center;
  gap: 0.25rem;
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
