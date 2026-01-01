<script setup lang="ts">
/**
 * ConceptDetails - SKOS concept property display
 *
 * Shows comprehensive concept information organized in sections.
 * Each section and property is only displayed if values exist.
 *
 * Sections:
 * - Labels: prefLabel, altLabel, notation (if any exist)
 * - Documentation: definition, scopeNote, historyNote, changeNote,
 *   editorialNote, example (if any exist)
 * - Hierarchy: broader, narrower (if any exist)
 * - Relations: related (if any exist)
 * - Mappings: exactMatch, closeMatch, broadMatch, narrowMatch,
 *   relatedMatch (if any exist)
 * - Schemes: inScheme (if any exist)
 *
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import { ref, watch, computed } from 'vue'
import { useConceptStore, useEndpointStore, useLanguageStore } from '../../stores'
import { executeSparql, withPrefixes, logger } from '../../services'
import type { ConceptDetails, LabelValue, ConceptRef } from '../../types'
import Button from 'primevue/button'
import Chip from 'primevue/chip'
import Divider from 'primevue/divider'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'
import { useToast } from 'primevue/usetoast'

const emit = defineEmits<{
  selectConcept: [uri: string]
}>()

const conceptStore = useConceptStore()
const endpointStore = useEndpointStore()
const languageStore = useLanguageStore()
const toast = useToast()

// Local state
const error = ref<string | null>(null)

// Computed
const details = computed(() => conceptStore.details)
const loading = computed(() => conceptStore.loadingDetails)

// Get preferred label
const preferredLabel = computed(() => {
  if (!details.value) return null
  const labels = details.value.prefLabels
  return findBestLabel(labels)
})

// Get display title (notation + label if both exist)
const displayTitle = computed(() => {
  if (!details.value) return null
  const label = preferredLabel.value
  const notation = details.value.notations[0]

  if (notation && label) {
    return `${notation} - ${label}`
  }
  return notation || label || 'Unnamed Concept'
})

// Find label in preferred language
function findBestLabel(labels: LabelValue[]): string | null {
  if (!labels.length) return null

  // Try preferred language
  const preferred = labels.find(l => l.lang === languageStore.preferred)
  if (preferred) return preferred.value

  // Try fallback
  const fallback = labels.find(l => l.lang === languageStore.fallback)
  if (fallback) return fallback.value

  // Try no language
  const noLang = labels.find(l => !l.lang)
  if (noLang) return noLang.value

  // Return first
  const first = labels[0]
  return first?.value || null
}


// Load concept details
async function loadDetails(uri: string) {
  const endpoint = endpointStore.current
  if (!endpoint) return

  logger.info('ConceptDetails', 'Loading details', { uri })

  conceptStore.setLoadingDetails(true)
  error.value = null

  const query = withPrefixes(`
    SELECT ?property ?value
    WHERE {
      <${uri}> ?property ?value .
      FILTER (?property IN (
        skos:prefLabel, skos:altLabel, skos:hiddenLabel,
        rdfs:label, dct:title,
        skos:definition, skos:scopeNote, skos:historyNote,
        skos:changeNote, skos:editorialNote, skos:example,
        skos:notation, skos:broader, skos:narrower, skos:related,
        skos:inScheme, skos:exactMatch, skos:closeMatch,
        skos:broadMatch, skos:narrowMatch, skos:relatedMatch
      ))
    }
  `)

  try {
    const results = await executeSparql(endpoint, query, { retries: 1 })

    const details: ConceptDetails = {
      uri,
      prefLabels: [],
      altLabels: [],
      hiddenLabels: [],
      definitions: [],
      scopeNotes: [],
      historyNotes: [],
      changeNotes: [],
      editorialNotes: [],
      examples: [],
      notations: [],
      broader: [],
      narrower: [],
      related: [],
      inScheme: [],
      exactMatch: [],
      closeMatch: [],
      broadMatch: [],
      narrowMatch: [],
      relatedMatch: [],
    }

    // Process results
    for (const binding of results.results.bindings) {
      const prop = binding.property?.value || ''
      const val = binding.value?.value || ''
      const lang = binding.value?.['xml:lang']

      if (prop.endsWith('prefLabel')) {
        details.prefLabels.push({ value: val, lang })
      } else if (prop.endsWith('#label') || prop.endsWith('/label')) {
        // rdfs:label - treat as fallback prefLabel
        details.prefLabels.push({ value: val, lang })
      } else if (prop.endsWith('title')) {
        // dct:title - treat as fallback prefLabel
        details.prefLabels.push({ value: val, lang })
      } else if (prop.endsWith('altLabel')) {
        details.altLabels.push({ value: val, lang })
      } else if (prop.endsWith('hiddenLabel')) {
        details.hiddenLabels.push({ value: val, lang })
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
      } else if (prop.endsWith('notation')) {
        if (!details.notations.includes(val)) {
          details.notations.push(val)
        }
      } else if (prop.endsWith('broader')) {
        if (!details.broader.some(r => r.uri === val)) {
          details.broader.push({ uri: val })
        }
      } else if (prop.endsWith('narrower')) {
        if (!details.narrower.some(r => r.uri === val)) {
          details.narrower.push({ uri: val })
        }
      } else if (prop.endsWith('related')) {
        if (!details.related.some(r => r.uri === val)) {
          details.related.push({ uri: val })
        }
      } else if (prop.endsWith('inScheme')) {
        if (!details.inScheme.some(r => r.uri === val)) {
          details.inScheme.push({ uri: val })
        }
      } else if (prop.endsWith('exactMatch')) {
        if (!details.exactMatch.includes(val)) {
          details.exactMatch.push(val)
        }
      } else if (prop.endsWith('closeMatch')) {
        if (!details.closeMatch.includes(val)) {
          details.closeMatch.push(val)
        }
      } else if (prop.endsWith('broadMatch')) {
        if (!details.broadMatch.includes(val)) {
          details.broadMatch.push(val)
        }
      } else if (prop.endsWith('narrowMatch')) {
        if (!details.narrowMatch.includes(val)) {
          details.narrowMatch.push(val)
        }
      } else if (prop.endsWith('relatedMatch')) {
        if (!details.relatedMatch.includes(val)) {
          details.relatedMatch.push(val)
        }
      }
    }

    // Load labels for related concepts
    await loadRelatedLabels(details)

    logger.info('ConceptDetails', 'Loaded details', {
      labels: details.prefLabels.length,
      broader: details.broader.length,
      narrower: details.narrower.length
    })

    conceptStore.setDetails(details)
  } catch (e: unknown) {
    const errMsg = e && typeof e === 'object' && 'message' in e
      ? (e as { message: string }).message
      : 'Unknown error'
    logger.error('ConceptDetails', 'Failed to load details', { uri, error: e })
    error.value = `Failed to load details: ${errMsg}`
    conceptStore.setDetails(null)
  } finally {
    conceptStore.setLoadingDetails(false)
  }
}

// Load labels for related concepts and schemes
async function loadRelatedLabels(details: ConceptDetails) {
  const endpoint = endpointStore.current
  if (!endpoint) return

  const allRefs = [
    ...details.broader,
    ...details.narrower,
    ...details.related,
    ...details.inScheme
  ]

  if (!allRefs.length) return

  const uris = allRefs.map(r => `<${r.uri}>`).join(' ')

  // Fetch notation, prefLabel, altLabel, hiddenLabel, and dct:title (for schemes)
  const query = withPrefixes(`
    SELECT ?concept ?notation ?label ?labelLang ?labelType
    WHERE {
      VALUES ?concept { ${uris} }
      OPTIONAL { ?concept skos:notation ?notation }
      OPTIONAL {
        {
          ?concept skos:prefLabel ?label .
          BIND("prefLabel" AS ?labelType)
        } UNION {
          ?concept skos:altLabel ?label .
          BIND("altLabel" AS ?labelType)
        } UNION {
          ?concept skos:hiddenLabel ?label .
          BIND("hiddenLabel" AS ?labelType)
        } UNION {
          ?concept dct:title ?label .
          BIND("title" AS ?labelType)
        } UNION {
          ?concept rdfs:label ?label .
          BIND("rdfsLabel" AS ?labelType)
        }
        BIND(LANG(?label) AS ?labelLang)
      }
    }
  `)

  try {
    const results = await executeSparql(endpoint, query, { retries: 0 })

    // Group by concept URI
    const conceptData = new Map<string, {
      notation?: string
      labels: { value: string; lang: string; type: string }[]
    }>()

    for (const b of results.results.bindings) {
      const uri = b.concept?.value
      if (!uri) continue

      if (!conceptData.has(uri)) {
        conceptData.set(uri, { labels: [] })
      }

      const data = conceptData.get(uri)!

      if (b.notation?.value && !data.notation) {
        data.notation = b.notation.value
      }

      if (b.label?.value) {
        data.labels.push({
          value: b.label.value,
          lang: b.labelLang?.value || '',
          type: b.labelType?.value || 'prefLabel'
        })
      }
    }

    // Update refs with best label and notation
    allRefs.forEach(ref => {
      const data = conceptData.get(ref.uri)
      if (!data) return

      ref.notation = data.notation

      // Pick best label: prefLabel in preferred lang > fallback > any lang, then altLabel, etc.
      const labelPriority = ['prefLabel', 'title', 'rdfsLabel', 'altLabel', 'hiddenLabel']
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

      if (bestLabel) {
        ref.label = bestLabel
      }
    })
  } catch (e) {
    logger.warn('ConceptDetails', 'Failed to load related labels', { error: e })
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

// Navigate to concept
function navigateTo(ref: ConceptRef) {
  emit('selectConcept', ref.uri)
}

// Open external link
function openExternal(uri: string) {
  window.open(uri, '_blank')
}

// Get display label for a ConceptRef (notation + label if both exist)
function getRefLabel(ref: ConceptRef): string {
  const label = ref.label || ref.uri.split('/').pop() || ref.uri
  if (ref.notation && ref.label) {
    return `${ref.notation} - ${label}`
  }
  return ref.notation || label
}

// Watch for selected concept changes
watch(
  () => conceptStore.selectedUri,
  (uri) => {
    if (uri) {
      loadDetails(uri)
    } else {
      conceptStore.setDetails(null)
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="concept-details">
    <!-- Loading state -->
    <div v-if="loading" class="loading-container">
      <ProgressSpinner style="width: 40px; height: 40px" />
      <span>Loading details...</span>
    </div>

    <!-- Empty state -->
    <div v-else-if="!details && !error" class="empty-state">
      <i class="pi pi-info-circle"></i>
      <p>No concept selected</p>
      <small>Select a concept from the tree or search</small>
    </div>

    <!-- Error state -->
    <Message v-else-if="error" severity="error" :closable="true" @close="error = null">
      {{ error }}
    </Message>

    <!-- Details -->
    <div v-else-if="details" class="details-content">
      <!-- Header -->
      <div class="details-header">
        <h2 class="concept-label">{{ displayTitle }}</h2>
        <div class="header-actions">
          <Button
            icon="pi pi-copy"
            severity="secondary"
            text
            rounded
            size="small"
            v-tooltip.left="'Copy label'"
            @click="copyToClipboard(preferredLabel || details.uri, 'Label')"
          />
        </div>
      </div>

      <div class="concept-uri">
        <a :href="details.uri" target="_blank" class="uri-link">
          {{ details.uri }}
          <i class="pi pi-external-link"></i>
        </a>
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

      <Divider />

      <!-- Labels Section - only shown if any label or notation exists -->
      <section v-if="details.prefLabels.length || details.altLabels.length || details.notations.length" class="details-section">
        <h3>Labels</h3>

        <div v-if="details.prefLabels.length" class="property-row">
          <label>Preferred</label>
          <div class="label-values">
            <span
              v-for="(label, i) in details.prefLabels"
              :key="i"
              class="label-value"
            >
              {{ label.value }}
              <span v-if="label.lang" class="lang-tag">{{ label.lang }}</span>
            </span>
          </div>
        </div>

        <div v-if="details.altLabels.length" class="property-row">
          <label>Alternative</label>
          <div class="label-values">
            <span
              v-for="(label, i) in details.altLabels"
              :key="i"
              class="label-value"
            >
              {{ label.value }}
              <span v-if="label.lang" class="lang-tag">{{ label.lang }}</span>
            </span>
          </div>
        </div>

        <div v-if="details.notations.length" class="property-row">
          <label>Notation</label>
          <div class="label-values">
            <code v-for="(n, i) in details.notations" :key="i" class="notation">{{ n }}</code>
          </div>
        </div>
      </section>

      <!-- Documentation Section -->
      <section v-if="details.definitions.length || details.scopeNotes.length || details.historyNotes.length || details.changeNotes.length || details.editorialNotes.length || details.examples.length" class="details-section">
        <h3>Documentation</h3>

        <div v-if="details.definitions.length" class="property-row">
          <label>Definition</label>
          <div class="doc-values">
            <p
              v-for="(def, i) in details.definitions"
              :key="i"
              class="doc-value"
            >
              {{ def.value }}
              <span v-if="def.lang" class="lang-tag">{{ def.lang }}</span>
            </p>
          </div>
        </div>

        <div v-if="details.scopeNotes.length" class="property-row">
          <label>Scope Note</label>
          <div class="doc-values">
            <p
              v-for="(note, i) in details.scopeNotes"
              :key="i"
              class="doc-value"
            >
              {{ note.value }}
              <span v-if="note.lang" class="lang-tag">{{ note.lang }}</span>
            </p>
          </div>
        </div>

        <div v-if="details.historyNotes.length" class="property-row">
          <label>History Note</label>
          <div class="doc-values">
            <p
              v-for="(note, i) in details.historyNotes"
              :key="i"
              class="doc-value"
            >
              {{ note.value }}
              <span v-if="note.lang" class="lang-tag">{{ note.lang }}</span>
            </p>
          </div>
        </div>

        <div v-if="details.changeNotes.length" class="property-row">
          <label>Change Note</label>
          <div class="doc-values">
            <p
              v-for="(note, i) in details.changeNotes"
              :key="i"
              class="doc-value"
            >
              {{ note.value }}
              <span v-if="note.lang" class="lang-tag">{{ note.lang }}</span>
            </p>
          </div>
        </div>

        <div v-if="details.editorialNotes.length" class="property-row">
          <label>Editorial Note</label>
          <div class="doc-values">
            <p
              v-for="(note, i) in details.editorialNotes"
              :key="i"
              class="doc-value"
            >
              {{ note.value }}
              <span v-if="note.lang" class="lang-tag">{{ note.lang }}</span>
            </p>
          </div>
        </div>

        <div v-if="details.examples.length" class="property-row">
          <label>Example</label>
          <div class="doc-values">
            <p
              v-for="(ex, i) in details.examples"
              :key="i"
              class="doc-value example"
            >
              {{ ex.value }}
              <span v-if="ex.lang" class="lang-tag">{{ ex.lang }}</span>
            </p>
          </div>
        </div>
      </section>

      <!-- Hierarchy Section -->
      <section v-if="details.broader.length || details.narrower.length" class="details-section">
        <h3>Hierarchy</h3>

        <div v-if="details.broader.length" class="property-row">
          <label>Broader</label>
          <div class="concept-chips">
            <Chip
              v-for="ref in details.broader"
              :key="ref.uri"
              :label="getRefLabel(ref)"
              class="concept-chip clickable"
              @click="navigateTo(ref)"
            />
          </div>
        </div>

        <div v-if="details.narrower.length" class="property-row">
          <label>Narrower</label>
          <div class="concept-chips">
            <Chip
              v-for="ref in details.narrower"
              :key="ref.uri"
              :label="getRefLabel(ref)"
              class="concept-chip clickable"
              @click="navigateTo(ref)"
            />
          </div>
        </div>
      </section>

      <!-- Relations Section -->
      <section v-if="details.related.length" class="details-section">
        <h3>Relations</h3>

        <div class="property-row">
          <label>Related</label>
          <div class="concept-chips">
            <Chip
              v-for="ref in details.related"
              :key="ref.uri"
              :label="getRefLabel(ref)"
              class="concept-chip clickable"
              @click="navigateTo(ref)"
            />
          </div>
        </div>
      </section>

      <!-- Mappings Section -->
      <section v-if="details.exactMatch.length || details.closeMatch.length || details.broadMatch.length || details.narrowMatch.length || details.relatedMatch.length" class="details-section">
        <h3>Mappings</h3>

        <div v-if="details.exactMatch.length" class="property-row">
          <label>Exact Match</label>
          <div class="mapping-links">
            <a
              v-for="uri in details.exactMatch"
              :key="uri"
              :href="uri"
              target="_blank"
              class="mapping-link"
            >
              {{ uri.split('/').pop() }}
              <i class="pi pi-external-link"></i>
            </a>
          </div>
        </div>

        <div v-if="details.closeMatch.length" class="property-row">
          <label>Close Match</label>
          <div class="mapping-links">
            <a
              v-for="uri in details.closeMatch"
              :key="uri"
              :href="uri"
              target="_blank"
              class="mapping-link"
            >
              {{ uri.split('/').pop() }}
              <i class="pi pi-external-link"></i>
            </a>
          </div>
        </div>

        <div v-if="details.broadMatch.length" class="property-row">
          <label>Broad Match</label>
          <div class="mapping-links">
            <a
              v-for="uri in details.broadMatch"
              :key="uri"
              :href="uri"
              target="_blank"
              class="mapping-link"
            >
              {{ uri.split('/').pop() }}
              <i class="pi pi-external-link"></i>
            </a>
          </div>
        </div>

        <div v-if="details.narrowMatch.length" class="property-row">
          <label>Narrow Match</label>
          <div class="mapping-links">
            <a
              v-for="uri in details.narrowMatch"
              :key="uri"
              :href="uri"
              target="_blank"
              class="mapping-link"
            >
              {{ uri.split('/').pop() }}
              <i class="pi pi-external-link"></i>
            </a>
          </div>
        </div>

        <div v-if="details.relatedMatch.length" class="property-row">
          <label>Related Match</label>
          <div class="mapping-links">
            <a
              v-for="uri in details.relatedMatch"
              :key="uri"
              :href="uri"
              target="_blank"
              class="mapping-link"
            >
              {{ uri.split('/').pop() }}
              <i class="pi pi-external-link"></i>
            </a>
          </div>
        </div>
      </section>

      <!-- Scheme Section -->
      <section v-if="details.inScheme.length" class="details-section">
        <h3>Schemes</h3>
        <div class="property-row">
          <label>In Scheme</label>
          <div class="concept-chips">
            <Chip
              v-for="ref in details.inScheme"
              :key="ref.uri"
              :label="getRefLabel(ref)"
              class="concept-chip"
              @click="openExternal(ref.uri)"
            />
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.concept-details {
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

.concept-label {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  word-break: break-word;
}

.header-actions {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}

.concept-uri {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
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
  font-weight: 600;
  text-transform: uppercase;
  color: var(--p-text-muted-color);
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

.lang-tag {
  font-size: 0.625rem;
  background: var(--p-surface-200);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  margin-left: 0.25rem;
  vertical-align: middle;
}

.notation {
  font-size: 0.875rem;
  background: var(--p-surface-100);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
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
}

.doc-value.example {
  font-style: italic;
  color: var(--p-text-muted-color);
}

.concept-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.concept-chip {
  font-size: 0.875rem;
}

.concept-chip.clickable {
  cursor: pointer;
}

.concept-chip.clickable:hover {
  background: var(--p-primary-100);
}

.mapping-links {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.mapping-link {
  font-size: 0.875rem;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.mapping-link i {
  font-size: 0.625rem;
}
</style>
