<script setup lang="ts">
/**
 * SchemeDetails - SKOS concept scheme property display
 *
 * Shows comprehensive scheme information organized in sections.
 * Each section and property is only displayed if values exist.
 *
 * Sections:
 * - Labels: prefLabel, altLabel, SKOS-XL extended labels
 * - Title: dct:title (if different from prefLabel)
 * - Documentation: definition, description, scopeNote, historyNote, etc.
 * - Metadata: creator, created, modified
 * - Other Properties: non-SKOS predicates
 *
 * Implementation uses config-driven template rendering via documentationConfig
 * and labelConfig arrays to minimize duplication. Data loading handled by
 * useSchemeData composable.
 *
 * @see /spec/ae-skos/sko02-SchemeSelector.md
 */
import { ref, watch, computed } from 'vue'
import { useSchemeStore } from '../../stores'
import { isValidURI, formatQualifiedName } from '../../services'
import { useDelayedLoading, useLabelResolver, useElapsedTime, useClipboard, useResourceExport, useSchemeData } from '../../composables'
import { getPredicateName } from '../../utils/displayUtils'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'
import Menu from 'primevue/menu'
import { useToast } from 'primevue/usetoast'
import XLLabelsGroup from '../common/XLLabelsGroup.vue'
import RawRdfDialog from '../common/RawRdfDialog.vue'

const emit = defineEmits<{
  browseScheme: [uri: string]
}>()

const schemeStore = useSchemeStore()
const toast = useToast()
const { selectLabel, selectLabelWithXL, sortLabels, shouldShowLangTag } = useLabelResolver()
const { copyToClipboard } = useClipboard()
const { exportAsTurtle, downloadFile } = useResourceExport()
const { details, loading, error, resolvedPredicates, loadDetails } = useSchemeData()

// Local state
const showRawRdfDialog = ref(false)

// Track elapsed time when loading
const loadingElapsed = useElapsedTime(loading)

// Export menu
const exportMenu = ref()
const exportMenuItems = [
  { label: 'Export as JSON', icon: 'pi pi-file', command: () => exportAsJson() },
  { label: 'Export as Turtle', icon: 'pi pi-code', command: () => details.value && exportAsTurtle(details.value.uri) },
]

// Delayed loading - show spinner only after 300ms to prevent flicker
const showLoading = useDelayedLoading(loading)

// Get preferred label (full LabelValue for language info)
// Priority: prefLabel > xlPrefLabel > title
const preferredLabelObj = computed(() => {
  if (!details.value) return null

  // 1. Try regular prefLabels (includes SKOS-XL fallback)
  const regularLabel = selectLabelWithXL(details.value.prefLabels, details.value.prefLabelsXL)
  if (regularLabel) return regularLabel

  // 2. Fall back to title (dct:title)
  if (details.value.title.length) {
    return selectLabel(details.value.title)
  }

  return null
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

// Helper to create sorted computed properties
// Type assertion: we only use getSorted for LabelValue[] fields
const getSorted = (field: keyof NonNullable<typeof details.value>) =>
  computed(() => {
    const value = details.value?.[field]
    return value && Array.isArray(value) ? sortLabels(value as any) : []
  })

// Sorted label arrays
const sortedPrefLabels = getSorted('prefLabels')
const sortedAltLabels = getSorted('altLabels')
const sortedDefinitions = getSorted('definitions')
const sortedDescriptions = getSorted('description')
const sortedScopeNotes = getSorted('scopeNotes')
const sortedHistoryNotes = getSorted('historyNotes')
const sortedChangeNotes = getSorted('changeNotes')
const sortedEditorialNotes = getSorted('editorialNotes')
const sortedExamples = getSorted('examples')
const sortedTitles = getSorted('title')

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

// Documentation properties config
const documentationConfig = computed(() => [
  { label: 'Definition', values: sortedDefinitions.value, class: '' },
  { label: 'Description', values: sortedDescriptions.value, class: '' },
  { label: 'Scope Note', values: sortedScopeNotes.value, class: '' },
  { label: 'History Note', values: sortedHistoryNotes.value, class: '' },
  { label: 'Change Note', values: sortedChangeNotes.value, class: '' },
  { label: 'Editorial Note', values: sortedEditorialNotes.value, class: '' },
  { label: 'Example', values: sortedExamples.value, class: 'example' },
].filter(prop => prop.values.length > 0))

const hasDocumentation = computed(() => documentationConfig.value.length > 0)

// Label properties config
const labelConfig = computed(() => {
  const config = []
  if (details.value?.prefLabels.length || details.value?.prefLabelsXL.length) {
    config.push({
      label: 'Preferred',
      values: sortedPrefLabels.value,
      hasXL: (details.value.prefLabelsXL?.length ?? 0) > 0,
      xlLabels: details.value.prefLabelsXL ?? [],
      regularLabels: details.value.prefLabels ?? []
    })
  }
  if (details.value?.altLabels.length) {
    config.push({
      label: 'Alternative',
      values: sortedAltLabels.value,
      hasXL: false,
      xlLabels: [],
      regularLabels: []
    })
  }
  return config
})

const hasLabels = computed(() => labelConfig.value.length > 0)

// Browse this scheme (emit to parent)
function browseScheme() {
  if (details.value) {
    emit('browseScheme', details.value.uri)
  }
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
      <span class="material-symbols-outlined empty-icon">schema</span>
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
        <div class="header-icon-wrapper">
          <span class="material-symbols-outlined header-icon icon-folder">folder</span>
        </div>
        <div class="header-content">
          <h2 class="scheme-label">
            {{ preferredLabel || details.uri.split('/').pop() }}
            <span v-if="showHeaderLangTag" class="header-lang-tag">{{ displayLang }}</span>
          </h2>
          <div class="scheme-uri">
            <span class="uri-text mono">{{ details.uri }}</span>
            <button
              class="copy-btn"
              title="Copy URI"
              @click="copyToClipboard(details.uri, 'URI')"
            >
              <span class="material-symbols-outlined icon-sm">content_copy</span>
            </button>
          </div>
        </div>
        <div class="header-actions">
          <button class="browse-btn" title="Browse concepts in this scheme" @click="browseScheme">
            <span class="material-symbols-outlined icon-sm">list</span>
            Browse
          </button>
          <button class="action-btn" title="View RDF" @click="showRawRdfDialog = true">
            <span class="material-symbols-outlined">code</span>
          </button>
          <button class="action-btn" title="Export" @click="(event: Event) => exportMenu.toggle(event)">
            <span class="material-symbols-outlined">download</span>
          </button>
          <a v-if="isValidURI(details.uri)" :href="details.uri" target="_blank" class="action-btn" title="Open in new tab">
            <span class="material-symbols-outlined">open_in_new</span>
          </a>
          <Menu ref="exportMenu" :model="exportMenuItems" :popup="true" />
        </div>
      </div>

      <!-- Labels Section -->
      <section v-if="hasLabels" class="details-section">
        <h3 class="section-title">
          <span class="material-symbols-outlined section-icon">translate</span>
          Labels
        </h3>
        <div v-for="prop in labelConfig" :key="prop.label" class="property-row">
          <label>{{ prop.label }}</label>
          <div class="label-values">
            <span v-for="(label, i) in prop.values" :key="i" class="label-value">
              {{ label.value }}
              <span v-if="label.lang" class="lang-tag">{{ label.lang }}</span>
            </span>
          </div>
          <XLLabelsGroup
            v-if="prop.hasXL"
            :labels="prop.xlLabels"
            :regular-labels="prop.regularLabels"
          />
        </div>
      </section>

      <!-- Dublin Core Title (if different from prefLabel) -->
      <section v-if="sortedTitles.length" class="details-section">
        <h3 class="section-title">
          <span class="material-symbols-outlined section-icon">title</span>
          Title
        </h3>
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
      <section v-if="hasDocumentation" class="details-section">
        <h3 class="section-title">
          <span class="material-symbols-outlined section-icon">description</span>
          Documentation
        </h3>
        <div v-for="prop in documentationConfig" :key="prop.label" class="property-row">
          <label>{{ prop.label }}</label>
          <div class="doc-values">
            <p v-for="(item, i) in prop.values" :key="i" :class="['doc-value', prop.class]">
              <span v-if="item.lang" class="lang-tag lang-tag-first">{{ item.lang }}</span>
              <span class="doc-text">{{ item.value }}</span>
            </p>
          </div>
        </div>
      </section>

      <!-- Metadata Section -->
      <section v-if="details.creator.length || details.created || details.modified || details.publisher.length || details.rights.length || details.license.length" class="details-section">
        <h3 class="section-title">
          <span class="material-symbols-outlined section-icon">info</span>
          Metadata
        </h3>

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
                <span class="material-symbols-outlined link-icon">open_in_new</span>
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

        <div v-if="details.publisher.length" class="property-row">
          <label>Publisher</label>
          <div class="metadata-values">
            <template v-for="(pub, i) in details.publisher" :key="i">
              <a
                v-if="isValidURI(pub)"
                :href="pub"
                target="_blank"
                class="metadata-link"
              >
                {{ pub.split('/').pop() }}
                <span class="material-symbols-outlined link-icon">open_in_new</span>
              </a>
              <span v-else class="metadata-value">{{ pub }}</span>
            </template>
          </div>
        </div>

        <div v-if="details.rights.length" class="property-row">
          <label>Rights</label>
          <div class="metadata-values">
            <template v-for="(r, i) in details.rights" :key="i">
              <a
                v-if="isValidURI(r)"
                :href="r"
                target="_blank"
                class="metadata-link"
              >
                {{ r.split('/').pop() }}
                <span class="material-symbols-outlined link-icon">open_in_new</span>
              </a>
              <span v-else class="metadata-value">{{ r }}</span>
            </template>
          </div>
        </div>

        <div v-if="details.license.length" class="property-row">
          <label>License</label>
          <div class="metadata-values">
            <template v-for="(lic, i) in details.license" :key="i">
              <a
                v-if="isValidURI(lic)"
                :href="lic"
                target="_blank"
                class="metadata-link"
              >
                {{ lic.split('/').pop() }}
                <span class="material-symbols-outlined link-icon">open_in_new</span>
              </a>
              <span v-else class="metadata-value">{{ lic }}</span>
            </template>
          </div>
        </div>
      </section>

      <!-- Other Properties Section -->
      <section v-if="details.otherProperties.length" class="details-section">
        <h3 class="section-title">
          <span class="material-symbols-outlined section-icon">more_horiz</span>
          Other Properties
        </h3>
        <div v-for="prop in sortedOtherProperties" :key="prop.predicate" class="property-row">
          <label class="predicate-label">
            <a
              v-if="isValidURI(prop.predicate)"
              :href="prop.predicate"
              target="_blank"
              class="predicate-link"
            >
              {{ getPredicateName(prop.predicate, resolvedPredicates.get(prop.predicate)) }}
              <span class="material-symbols-outlined link-icon">open_in_new</span>
            </a>
            <span v-else>{{ getPredicateName(prop.predicate, resolvedPredicates.get(prop.predicate)) }}</span>
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
                <span class="material-symbols-outlined link-icon">open_in_new</span>
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
    <RawRdfDialog
      v-if="details"
      v-model:visible="showRawRdfDialog"
      :resource-uri="details.uri"
    />
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
  color: var(--ae-text-secondary);
  flex: 1;
}

.empty-icon {
  font-size: 2.5rem;
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
  padding: 2rem;
  max-width: 900px;
}

/* Header */
.details-header {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 2rem;
}

.header-icon-wrapper {
  padding: 0.75rem;
  background: color-mix(in srgb, var(--ae-icon-folder) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--ae-icon-folder) 25%, transparent);
  border-radius: 0.75rem;
}

.header-icon {
  font-size: 2.5rem;
}

.header-content {
  flex: 1;
  min-width: 0;
}

.scheme-label {
  margin: 0 0 0.5rem 0;
  font-size: 1.75rem;
  font-weight: 600;
  color: var(--ae-text-primary);
  word-break: break-word;
}

.header-lang-tag {
  font-size: 0.625rem;
  font-weight: normal;
  background: var(--ae-bg-hover);
  color: var(--ae-text-secondary);
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  margin-left: 0.5rem;
  vertical-align: middle;
}

.scheme-uri {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 4px;
}

.uri-text {
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
  word-break: break-all;
}

.copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  color: var(--ae-text-secondary);
  transition: color 0.15s;
}

.copy-btn:hover {
  color: var(--ae-text-primary);
}

.header-actions {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}

.browse-btn {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 1rem;
  background: var(--ae-accent);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: white;
  font-size: 0.875rem;
  font-weight: 500;
  transition: background-color 0.15s;
}

.browse-btn:hover {
  background: var(--ae-accent-hover);
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--ae-text-secondary);
  text-decoration: none;
  transition: background-color 0.15s, color 0.15s;
}

.action-btn:hover {
  background: var(--ae-bg-hover);
  color: var(--ae-text-primary);
}

/* Sections */
.details-section {
  margin-bottom: 2rem;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 1rem 0;
  padding-bottom: 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ae-text-secondary);
  border-bottom: 1px solid var(--ae-border-color);
}

.section-icon {
  font-size: 18px;
}

.property-row {
  margin-bottom: 1rem;
}

.property-row label {
  display: block;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--ae-text-secondary);
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
  color: var(--ae-text-muted);
}

.lang-tag {
  font-size: 0.625rem;
  background: var(--ae-bg-hover);
  color: var(--ae-text-secondary);
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
  color: var(--ae-text-secondary);
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
  color: var(--ae-accent);
}

.link-icon {
  font-size: 14px;
}

/* Other Properties */
.predicate-label {
  font-family: monospace;
  font-size: 0.8rem;
}

.predicate-link {
  color: var(--ae-accent);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.predicate-link:hover {
  text-decoration: underline;
}

.other-values {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.other-value {
  font-size: 0.875rem;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.other-value.uri-value {
  color: var(--ae-accent);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.other-value.uri-value:hover {
  text-decoration: underline;
}
</style>
