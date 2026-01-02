<script setup lang="ts">
/**
 * SchemeDetails - SKOS concept scheme property display
 *
 * Shows comprehensive scheme information organized in sections.
 * Each section and property is only displayed if values exist.
 *
 * Sections:
 * - Labels: prefLabel, altLabel
 * - Documentation: definition, scopeNote, description, historyNote, etc.
 * - Metadata: creator, created, modified
 * - Other Properties: non-SKOS predicates
 *
 * @see /spec/ae-skos/sko02-SchemeSelector.md
 */
import { ref, watch, computed } from 'vue'
import { useSchemeStore, useEndpointStore } from '../../stores'
import { executeSparql, withPrefixes, logger, isValidURI, fetchRawRdf, resolveUris, formatQualifiedName } from '../../services'
import { useDelayedLoading, useLabelResolver, useElapsedTime } from '../../composables'
import type { RdfFormat } from '../../services'
import type { SchemeDetails } from '../../types'
import Button from 'primevue/button'
import Divider from 'primevue/divider'
import Dialog from 'primevue/dialog'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'
import Select from 'primevue/select'
import Textarea from 'primevue/textarea'
import Menu from 'primevue/menu'
import { useToast } from 'primevue/usetoast'
import XLLabelsGroup from '../common/XLLabelsGroup.vue'

const emit = defineEmits<{
  browseScheme: [uri: string]
}>()

const schemeStore = useSchemeStore()
const endpointStore = useEndpointStore()
const toast = useToast()
const { selectLabelWithXL, sortLabels, shouldShowLangTag } = useLabelResolver()

// Local state
const error = ref<string | null>(null)
const resolvedPredicates = ref<Map<string, { prefix: string; localName: string }>>(new Map())

// Track elapsed time when loading
const isLoading = computed(() => schemeStore.loadingDetails)
const loadingElapsed = useElapsedTime(isLoading)

// Raw RDF dialog state
const showRawRdfDialog = ref(false)
const rawRdfContent = ref('')
const rawRdfFormat = ref<RdfFormat>('turtle')
const rawRdfLoading = ref(false)
const rawRdfError = ref<string | null>(null)

const rdfFormatOptions = [
  { label: 'Turtle', value: 'turtle' },
  { label: 'JSON-LD', value: 'jsonld' },
  { label: 'N-Triples', value: 'ntriples' },
  { label: 'RDF/XML', value: 'rdfxml' },
]

// Export menu
const exportMenu = ref()
const exportMenuItems = [
  { label: 'Export as JSON', icon: 'pi pi-file', command: () => exportAsJson() },
  { label: 'Export as Turtle', icon: 'pi pi-code', command: () => exportAsTurtle() },
]

// Computed
const details = computed(() => schemeStore.schemeDetails)
const loading = computed(() => schemeStore.loadingDetails)

// Delayed loading - show spinner only after 300ms to prevent flicker
const showLoading = useDelayedLoading(loading)

// Get preferred label (full LabelValue for language info)
const preferredLabelObj = computed(() => {
  if (!details.value) return null
  return selectLabelWithXL(details.value.prefLabels, details.value.prefLabelsXL)
})

// Get preferred label string
const preferredLabel = computed(() => {
  return preferredLabelObj.value?.value || null
})

// Get language of displayed label
const displayLang = computed(() => {
  return preferredLabelObj.value?.lang || null
})

// Should we show the language tag in header?
const showHeaderLangTag = computed(() => {
  return displayLang.value && shouldShowLangTag(displayLang.value)
})

// Sorted label arrays
const sortedPrefLabels = computed(() => {
  return details.value ? sortLabels(details.value.prefLabels) : []
})

const sortedAltLabels = computed(() => {
  return details.value ? sortLabels(details.value.altLabels) : []
})

const sortedDefinitions = computed(() => {
  return details.value ? sortLabels(details.value.definitions) : []
})

const sortedDescriptions = computed(() => {
  return details.value ? sortLabels(details.value.description) : []
})

const sortedScopeNotes = computed(() => {
  return details.value ? sortLabels(details.value.scopeNotes) : []
})

const sortedHistoryNotes = computed(() => {
  return details.value ? sortLabels(details.value.historyNotes) : []
})

const sortedChangeNotes = computed(() => {
  return details.value ? sortLabels(details.value.changeNotes) : []
})

const sortedEditorialNotes = computed(() => {
  return details.value ? sortLabels(details.value.editorialNotes) : []
})

const sortedExamples = computed(() => {
  return details.value ? sortLabels(details.value.examples) : []
})

const sortedTitles = computed(() => {
  return details.value ? sortLabels(details.value.title) : []
})

// Sorted other properties
const sortedOtherProperties = computed(() => {
  if (!details.value) return []
  return [...details.value.otherProperties].sort((a, b) => {
    const aResolved = resolvedPredicates.value.get(a.predicate)
    const bResolved = resolvedPredicates.value.get(b.predicate)
    const aName = aResolved ? formatQualifiedName(aResolved) : a.predicate
    const bName = bResolved ? formatQualifiedName(bResolved) : b.predicate
    return aName.localeCompare(bName)
  })
})

// Get formatted predicate name
function getPredicateName(predicate: string): string {
  const resolved = resolvedPredicates.value.get(predicate)
  if (resolved) {
    return resolved.prefix
      ? formatQualifiedName(resolved)
      : resolved.localName
  }
  return predicate.split('/').pop()?.split('#').pop() || predicate
}

// Load scheme details
async function loadDetails(uri: string) {
  const endpoint = endpointStore.current
  if (!endpoint) return

  logger.info('SchemeDetails', 'Loading details', { uri })

  schemeStore.setLoadingDetails(true)
  error.value = null

  const query = withPrefixes(`
    SELECT ?property ?value
    WHERE {
      <${uri}> ?property ?value .
      FILTER (?property IN (
        skos:prefLabel, skos:altLabel,
        skos:definition, skos:scopeNote, skos:historyNote,
        skos:changeNote, skos:editorialNote, skos:example,
        dct:title, dct:description, dct:creator, dct:created, dct:modified,
        dct:publisher, dct:rights, dct:license,
        rdfs:label
      ))
    }
  `)

  try {
    const results = await executeSparql(endpoint, query, { retries: 1 })

    const details: SchemeDetails = {
      uri,
      prefLabels: [],
      altLabels: [],
      definitions: [],
      scopeNotes: [],
      historyNotes: [],
      changeNotes: [],
      editorialNotes: [],
      examples: [],
      title: [],
      description: [],
      creator: [],
      prefLabelsXL: [],
      otherProperties: [],
    }

    // Process results
    for (const binding of results.results.bindings) {
      const prop = binding.property?.value || ''
      const val = binding.value?.value || ''
      const lang = binding.value?.['xml:lang']

      if (prop.endsWith('prefLabel')) {
        details.prefLabels.push({ value: val, lang })
      } else if (prop.endsWith('#label') || prop.endsWith('/label')) {
        details.prefLabels.push({ value: val, lang })
      } else if (prop.endsWith('altLabel')) {
        details.altLabels.push({ value: val, lang })
      } else if (prop.endsWith('definition')) {
        details.definitions.push({ value: val, lang })
      } else if (prop.endsWith('scopeNote')) {
        details.scopeNotes.push({ value: val, lang })
      } else if (prop.endsWith('historyNote')) {
        details.historyNotes.push({ value: val, lang })
      } else if (prop.endsWith('changeNote')) {
        details.changeNotes.push({ value: val, lang })
      } else if (prop.endsWith('editorialNote')) {
        details.editorialNotes.push({ value: val, lang })
      } else if (prop.endsWith('example')) {
        details.examples.push({ value: val, lang })
      } else if (prop.endsWith('title')) {
        details.title.push({ value: val, lang })
      } else if (prop.endsWith('description')) {
        details.description.push({ value: val, lang })
      } else if (prop.endsWith('creator')) {
        if (!details.creator.includes(val)) {
          details.creator.push(val)
        }
      } else if (prop.endsWith('created')) {
        details.created = val
      } else if (prop.endsWith('modified')) {
        details.modified = val
      }
    }

    // Load SKOS-XL labels
    await loadXLLabels(uri, details)

    // Load other (non-SKOS) properties
    await loadOtherProperties(uri, details)

    // Resolve prefixes for other properties
    if (details.otherProperties.length > 0) {
      const predicates = details.otherProperties.map(p => p.predicate)
      resolvedPredicates.value = await resolveUris(predicates)
    } else {
      resolvedPredicates.value = new Map()
    }

    logger.info('SchemeDetails', 'Loaded details', {
      labels: details.prefLabels.length,
      definitions: details.definitions.length,
    })

    schemeStore.setSchemeDetails(details)
  } catch (e: unknown) {
    const errMsg = e && typeof e === 'object' && 'message' in e
      ? (e as { message: string }).message
      : 'Unknown error'
    logger.error('SchemeDetails', 'Failed to load details', { uri, error: e })
    error.value = `Failed to load details: ${errMsg}`
    schemeStore.setSchemeDetails(null)
  } finally {
    schemeStore.setLoadingDetails(false)
  }
}

// Load SKOS-XL extended labels
async function loadXLLabels(uri: string, details: SchemeDetails) {
  const endpoint = endpointStore.current
  if (!endpoint) return

  const query = withPrefixes(`
    SELECT ?xlLabel ?labelType ?literalForm ?literalLang
    WHERE {
      {
        <${uri}> skosxl:prefLabel ?xlLabel .
        BIND("prefLabel" AS ?labelType)
      }
      ?xlLabel skosxl:literalForm ?literalForm .
      BIND(LANG(?literalForm) AS ?literalLang)
    }
  `)

  try {
    const results = await executeSparql(endpoint, query, { retries: 0 })

    const seenXLUris = new Set<string>()

    for (const binding of results.results.bindings) {
      const xlUri = binding.xlLabel?.value
      const literalForm = binding.literalForm?.value
      const literalLang = binding.literalLang?.value

      if (!xlUri || !literalForm) continue
      if (seenXLUris.has(xlUri)) continue
      seenXLUris.add(xlUri)

      details.prefLabelsXL.push({
        uri: xlUri,
        literalForm: {
          value: literalForm,
          lang: literalLang || undefined,
        },
      })
    }

    logger.debug('SchemeDetails', 'Loaded XL labels', {
      prefLabelsXL: details.prefLabelsXL.length,
    })
  } catch (e) {
    logger.debug('SchemeDetails', 'SKOS-XL labels not available or query failed', { error: e })
  }
}

// Load other (non-SKOS) properties
async function loadOtherProperties(uri: string, details: SchemeDetails) {
  const endpoint = endpointStore.current
  if (!endpoint) return

  const query = withPrefixes(`
    SELECT ?predicate ?value
    WHERE {
      <${uri}> ?predicate ?value .
      FILTER (
        !STRSTARTS(STR(?predicate), STR(skos:)) &&
        !STRSTARTS(STR(?predicate), STR(skosxl:)) &&
        !STRSTARTS(STR(?predicate), STR(rdf:)) &&
        ?predicate != rdfs:label &&
        ?predicate != dct:title &&
        ?predicate != dct:description &&
        ?predicate != dct:creator &&
        ?predicate != dct:created &&
        ?predicate != dct:modified &&
        ?predicate != dct:publisher &&
        ?predicate != dct:rights &&
        ?predicate != dct:license
      )
    }
    LIMIT 100
  `)

  try {
    const results = await executeSparql(endpoint, query, { retries: 0 })

    const propMap = new Map<string, Map<string, { value: string; lang?: string; isUri: boolean }>>()

    for (const binding of results.results.bindings) {
      const predicate = binding.predicate?.value
      const value = binding.value?.value
      const lang = binding.value?.['xml:lang']
      const isUri = binding.value?.type === 'uri'

      if (!predicate || !value) continue

      if (!propMap.has(predicate)) {
        propMap.set(predicate, new Map())
      }
      const key = `${value}|${lang || ''}`
      if (!propMap.get(predicate)!.has(key)) {
        propMap.get(predicate)!.set(key, { value, lang, isUri })
      }
    }

    details.otherProperties = Array.from(propMap.entries()).map(([predicate, valuesMap]) => ({
      predicate,
      values: Array.from(valuesMap.values()),
    }))

    logger.debug('SchemeDetails', 'Loaded other properties', {
      count: details.otherProperties.length,
    })
  } catch (e) {
    logger.debug('SchemeDetails', 'Failed to load other properties', { error: e })
  }
}

// Copy to clipboard
async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({
      severity: 'success',
      summary: 'Copied',
      detail: `${label} copied to clipboard`,
      life: 2000
    })
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Failed',
      detail: 'Could not copy to clipboard',
      life: 3000
    })
  }
}

// Browse this scheme (emit to parent)
function browseScheme() {
  if (details.value) {
    emit('browseScheme', details.value.uri)
  }
}

// Fetch and show raw RDF
async function openRawRdfDialog() {
  if (!details.value || !endpointStore.current) return

  showRawRdfDialog.value = true
  await loadRawRdf()
}

async function loadRawRdf() {
  if (!details.value || !endpointStore.current) return

  rawRdfLoading.value = true
  rawRdfError.value = null
  rawRdfContent.value = ''

  try {
    const rdf = await fetchRawRdf(
      endpointStore.current,
      details.value.uri,
      rawRdfFormat.value
    )
    rawRdfContent.value = rdf
  } catch (e: unknown) {
    const errMsg = e && typeof e === 'object' && 'message' in e
      ? (e as { message: string }).message
      : 'Failed to fetch RDF'
    rawRdfError.value = errMsg
    logger.error('SchemeDetails', 'Failed to fetch raw RDF', { error: e })
  } finally {
    rawRdfLoading.value = false
  }
}

// Download helper
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Export as JSON
function exportAsJson() {
  if (!details.value) return

  const jsonData = {
    uri: details.value.uri,
    prefLabels: details.value.prefLabels,
    altLabels: details.value.altLabels,
    definitions: details.value.definitions,
    scopeNotes: details.value.scopeNotes,
    title: details.value.title,
    description: details.value.description,
    creator: details.value.creator,
    created: details.value.created,
    modified: details.value.modified,
  }

  const content = JSON.stringify(jsonData, null, 2)
  const filename = `scheme-${details.value.uri.split('/').pop() || 'export'}.json`
  downloadFile(content, filename, 'application/json')

  toast.add({
    severity: 'success',
    summary: 'Exported',
    detail: 'Scheme exported as JSON',
    life: 2000
  })
}

// Export as Turtle
async function exportAsTurtle() {
  if (!details.value || !endpointStore.current) return

  try {
    const turtle = await fetchRawRdf(endpointStore.current, details.value.uri, 'turtle')
    const filename = `scheme-${details.value.uri.split('/').pop() || 'export'}.ttl`
    downloadFile(turtle, filename, 'text/turtle')

    toast.add({
      severity: 'success',
      summary: 'Exported',
      detail: 'Scheme exported as Turtle',
      life: 2000
    })
  } catch (e) {
    toast.add({
      severity: 'error',
      summary: 'Export failed',
      detail: 'Could not export as Turtle',
      life: 3000
    })
  }
}

// Format date for display
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

// Watch for viewing scheme changes
watch(
  () => schemeStore.viewingSchemeUri,
  (uri) => {
    if (uri) {
      loadDetails(uri)
    } else {
      schemeStore.setSchemeDetails(null)
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="scheme-details">
    <!-- Loading state -->
    <div v-if="showLoading" class="loading-container">
      <ProgressSpinner style="width: 40px; height: 40px" />
      <span>
        Loading scheme...
        <template v-if="loadingElapsed.show.value">
          ({{ loadingElapsed.elapsed.value }}s)
        </template>
      </span>
    </div>

    <!-- Empty state -->
    <div v-else-if="!loading && !details && !error" class="empty-state">
      <i class="pi pi-sitemap"></i>
      <p>No scheme selected</p>
      <small>Select a scheme from the dropdown or click "In Scheme" on a concept</small>
    </div>

    <!-- Error state -->
    <Message v-else-if="error" severity="error" :closable="true" @close="error = null">
      {{ error }}
    </Message>

    <!-- Details -->
    <div v-else-if="details" class="details-content">
      <!-- Header -->
      <div class="details-header">
        <div class="header-left">
          <div class="scheme-badge">
            <i class="pi pi-sitemap"></i>
            <span>Concept Scheme</span>
          </div>
          <h2 class="scheme-label">
            {{ preferredLabel || details.uri.split('/').pop() }}
            <span v-if="showHeaderLangTag" class="header-lang-tag">{{ displayLang }}</span>
          </h2>
          <div class="scheme-uri">
            <a v-if="isValidURI(details.uri)" :href="details.uri" target="_blank" class="uri-link">
              {{ details.uri }}
              <i class="pi pi-external-link"></i>
            </a>
            <span v-else class="uri-text">{{ details.uri }}</span>
            <Button
              icon="pi pi-copy"
              severity="secondary"
              text
              rounded
              size="small"
              v-tooltip.left="'Copy URI'"
              @click="copyToClipboard(details.uri, 'URI')"
            />
          </div>
        </div>
        <div class="header-actions">
          <Button
            icon="pi pi-list"
            label="Browse"
            severity="primary"
            size="small"
            v-tooltip.left="'Browse concepts in this scheme'"
            @click="browseScheme"
          />
          <Button
            icon="pi pi-code"
            severity="secondary"
            text
            rounded
            size="small"
            v-tooltip.left="'View RDF'"
            @click="openRawRdfDialog"
          />
          <Button
            icon="pi pi-download"
            severity="secondary"
            text
            rounded
            size="small"
            v-tooltip.left="'Export'"
            @click="(event: Event) => exportMenu.toggle(event)"
          />
          <Menu ref="exportMenu" :model="exportMenuItems" :popup="true" />
        </div>
      </div>

      <Divider />

      <!-- Labels Section -->
      <section v-if="details.prefLabels.length || details.altLabels.length || details.prefLabelsXL.length" class="details-section">
        <h3>Labels</h3>

        <div v-if="details.prefLabels.length || details.prefLabelsXL.length" class="property-row">
          <label>Preferred</label>
          <div class="label-values">
            <span
              v-for="(label, i) in sortedPrefLabels"
              :key="i"
              class="label-value"
            >
              {{ label.value }}
              <span v-if="label.lang" class="lang-tag">{{ label.lang }}</span>
            </span>
          </div>
          <XLLabelsGroup
            v-if="details.prefLabelsXL.length"
            :labels="details.prefLabelsXL"
            :regular-labels="details.prefLabels"
          />
        </div>

        <div v-if="details.altLabels.length" class="property-row">
          <label>Alternative</label>
          <div class="label-values">
            <span
              v-for="(label, i) in sortedAltLabels"
              :key="i"
              class="label-value"
            >
              {{ label.value }}
              <span v-if="label.lang" class="lang-tag">{{ label.lang }}</span>
            </span>
          </div>
        </div>
      </section>

      <!-- Dublin Core Title (if different from prefLabel) -->
      <section v-if="sortedTitles.length" class="details-section">
        <h3>Title</h3>
        <div class="property-row">
          <div class="doc-values">
            <p
              v-for="(title, i) in sortedTitles"
              :key="i"
              class="doc-value"
            >
              <span v-if="title.lang" class="lang-tag lang-tag-first">{{ title.lang }}</span>
              <span class="doc-text">{{ title.value }}</span>
            </p>
          </div>
        </div>
      </section>

      <!-- Documentation Section -->
      <section v-if="details.definitions.length || sortedDescriptions.length || details.scopeNotes.length || details.historyNotes.length || details.changeNotes.length || details.editorialNotes.length || details.examples.length" class="details-section">
        <h3>Documentation</h3>

        <div v-if="details.definitions.length" class="property-row">
          <label>Definition</label>
          <div class="doc-values">
            <p
              v-for="(def, i) in sortedDefinitions"
              :key="i"
              class="doc-value"
            >
              <span v-if="def.lang" class="lang-tag lang-tag-first">{{ def.lang }}</span>
              <span class="doc-text">{{ def.value }}</span>
            </p>
          </div>
        </div>

        <div v-if="sortedDescriptions.length" class="property-row">
          <label>Description</label>
          <div class="doc-values">
            <p
              v-for="(desc, i) in sortedDescriptions"
              :key="i"
              class="doc-value"
            >
              <span v-if="desc.lang" class="lang-tag lang-tag-first">{{ desc.lang }}</span>
              <span class="doc-text">{{ desc.value }}</span>
            </p>
          </div>
        </div>

        <div v-if="details.scopeNotes.length" class="property-row">
          <label>Scope Note</label>
          <div class="doc-values">
            <p
              v-for="(note, i) in sortedScopeNotes"
              :key="i"
              class="doc-value"
            >
              <span v-if="note.lang" class="lang-tag lang-tag-first">{{ note.lang }}</span>
              <span class="doc-text">{{ note.value }}</span>
            </p>
          </div>
        </div>

        <div v-if="details.historyNotes.length" class="property-row">
          <label>History Note</label>
          <div class="doc-values">
            <p
              v-for="(note, i) in sortedHistoryNotes"
              :key="i"
              class="doc-value"
            >
              <span v-if="note.lang" class="lang-tag lang-tag-first">{{ note.lang }}</span>
              <span class="doc-text">{{ note.value }}</span>
            </p>
          </div>
        </div>

        <div v-if="details.changeNotes.length" class="property-row">
          <label>Change Note</label>
          <div class="doc-values">
            <p
              v-for="(note, i) in sortedChangeNotes"
              :key="i"
              class="doc-value"
            >
              <span v-if="note.lang" class="lang-tag lang-tag-first">{{ note.lang }}</span>
              <span class="doc-text">{{ note.value }}</span>
            </p>
          </div>
        </div>

        <div v-if="details.editorialNotes.length" class="property-row">
          <label>Editorial Note</label>
          <div class="doc-values">
            <p
              v-for="(note, i) in sortedEditorialNotes"
              :key="i"
              class="doc-value"
            >
              <span v-if="note.lang" class="lang-tag lang-tag-first">{{ note.lang }}</span>
              <span class="doc-text">{{ note.value }}</span>
            </p>
          </div>
        </div>

        <div v-if="details.examples.length" class="property-row">
          <label>Example</label>
          <div class="doc-values">
            <p
              v-for="(ex, i) in sortedExamples"
              :key="i"
              class="doc-value example"
            >
              <span v-if="ex.lang" class="lang-tag lang-tag-first">{{ ex.lang }}</span>
              <span class="doc-text">{{ ex.value }}</span>
            </p>
          </div>
        </div>
      </section>

      <!-- Metadata Section -->
      <section v-if="details.creator.length || details.created || details.modified" class="details-section">
        <h3>Metadata</h3>

        <div v-if="details.creator.length" class="property-row">
          <label>Creator</label>
          <div class="metadata-values">
            <template v-for="(creator, i) in details.creator" :key="i">
              <a
                v-if="isValidURI(creator)"
                :href="creator"
                target="_blank"
                class="metadata-link"
              >
                {{ creator.split('/').pop() }}
                <i class="pi pi-external-link"></i>
              </a>
              <span v-else class="metadata-value">{{ creator }}</span>
            </template>
          </div>
        </div>

        <div v-if="details.created" class="property-row">
          <label>Created</label>
          <span class="metadata-value">{{ formatDate(details.created) }}</span>
        </div>

        <div v-if="details.modified" class="property-row">
          <label>Modified</label>
          <span class="metadata-value">{{ formatDate(details.modified) }}</span>
        </div>
      </section>

      <!-- Other Properties Section -->
      <section v-if="details.otherProperties.length" class="details-section">
        <h3>Other Properties</h3>
        <div v-for="prop in sortedOtherProperties" :key="prop.predicate" class="property-row">
          <label class="predicate-label">
            <a
              v-if="isValidURI(prop.predicate)"
              :href="prop.predicate"
              target="_blank"
              class="predicate-link"
            >
              {{ getPredicateName(prop.predicate) }}
              <i class="pi pi-external-link"></i>
            </a>
            <span v-else>{{ getPredicateName(prop.predicate) }}</span>
          </label>
          <div class="other-values">
            <template v-for="(val, i) in prop.values" :key="i">
              <a
                v-if="val.isUri && isValidURI(val.value)"
                :href="val.value"
                target="_blank"
                class="other-value uri-value"
              >
                {{ val.value.split('/').pop()?.split('#').pop() }}
                <i class="pi pi-external-link"></i>
              </a>
              <span v-else class="other-value">
                {{ val.value }}
                <span v-if="val.lang" class="lang-tag">{{ val.lang }}</span>
              </span>
            </template>
          </div>
        </div>
      </section>
    </div>

    <!-- Raw RDF Dialog -->
    <Dialog
      v-model:visible="showRawRdfDialog"
      header="Raw RDF"
      :style="{ width: '900px', maxHeight: '90vh' }"
      :modal="true"
    >
      <div class="raw-rdf-dialog">
        <div class="format-selector">
          <label>Format:</label>
          <Select
            v-model="rawRdfFormat"
            :options="rdfFormatOptions"
            optionLabel="label"
            optionValue="value"
            @change="loadRawRdf"
          />
          <Button
            icon="pi pi-copy"
            label="Copy"
            severity="secondary"
            size="small"
            :disabled="!rawRdfContent"
            @click="copyToClipboard(rawRdfContent, 'RDF')"
          />
        </div>

        <div v-if="rawRdfLoading" class="rdf-loading">
          <ProgressSpinner style="width: 30px; height: 30px" />
          <span>Loading RDF...</span>
        </div>

        <Message v-if="rawRdfError" severity="error" :closable="false">
          {{ rawRdfError }}
        </Message>

        <Textarea
          v-if="rawRdfContent && !rawRdfLoading"
          v-model="rawRdfContent"
          :readonly="true"
          class="rdf-content"
          :autoResize="false"
          rows="28"
        />
      </div>
    </Dialog>
  </div>
</template>

<style scoped>
.scheme-details {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.loading-container,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 2rem;
  color: var(--p-text-muted-color);
  flex: 1;
}

.empty-state i {
  font-size: 2rem;
  opacity: 0.5;
}

.empty-state p {
  margin: 0;
  font-weight: 500;
}

.empty-state small {
  font-size: 0.75rem;
}

.details-content {
  flex: 1;
  overflow: auto;
  padding: 1rem;
}

.details-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.header-left {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.scheme-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--p-primary-color);
  margin-bottom: 0.25rem;
}

.scheme-badge i {
  font-size: 0.75rem;
}

.scheme-label {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  word-break: break-word;
}

.header-lang-tag {
  font-size: 0.625rem;
  font-weight: normal;
  background: var(--p-surface-200);
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  margin-left: 0.5rem;
  vertical-align: middle;
}

.header-actions {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}

.scheme-uri {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.125rem;
}

.uri-link {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  word-break: break-all;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.uri-link i {
  font-size: 0.625rem;
}

.details-section {
  margin-bottom: 1.5rem;
}

.details-section h3 {
  margin: 0 0 0.75rem 0;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--p-text-color);
  letter-spacing: 0.05em;
}

.property-row {
  margin-bottom: 0.75rem;
}

.property-row label {
  display: block;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--p-text-muted-color);
  margin-bottom: 0.25rem;
}

.label-values {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.label-value {
  font-size: 0.875rem;
}

.label-value:not(:last-child)::after {
  content: '·';
  margin-left: 0.5rem;
  color: var(--p-text-muted-color);
}

.lang-tag {
  font-size: 0.625rem;
  background: var(--p-surface-200);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  margin-left: 0.25rem;
  vertical-align: middle;
}

.lang-tag.lang-tag-first {
  margin-left: 0;
  margin-right: 0.5rem;
}

.doc-values {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.doc-value {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.5;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0;
}

.doc-value .lang-tag-first {
  grid-column: 1;
  align-self: start;
  margin-top: 0.1rem;
}

.doc-value .doc-text {
  grid-column: 2;
}

.doc-value.example {
  font-style: italic;
  color: var(--p-text-muted-color);
}

.metadata-values {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.metadata-value {
  font-size: 0.875rem;
}

.metadata-link {
  font-size: 0.875rem;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.metadata-link i {
  font-size: 0.625rem;
}

/* Other Properties */
.predicate-label {
  font-family: monospace;
  font-size: 0.8rem;
}

.predicate-link {
  color: var(--p-primary-color);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.predicate-link:hover {
  text-decoration: underline;
}

.predicate-link i {
  font-size: 0.5rem;
}

.other-values {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.other-value {
  font-size: 0.875rem;
  background: var(--p-surface-100);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.other-value.uri-value {
  color: var(--p-primary-color);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.other-value.uri-value:hover {
  text-decoration: underline;
}

.other-value.uri-value i {
  font-size: 0.5rem;
}

/* Raw RDF Dialog */
.raw-rdf-dialog {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.format-selector {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.format-selector label {
  font-weight: 500;
}

.rdf-loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  padding: 2rem;
  color: var(--p-text-muted-color);
}

.rdf-content {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 0.7rem;
  width: 100%;
  background: var(--p-surface-50);
}
</style>
