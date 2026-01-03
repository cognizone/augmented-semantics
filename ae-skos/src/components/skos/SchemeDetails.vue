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
import Button from 'primevue/button'
import Divider from 'primevue/divider'
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
const { selectLabelWithXL, sortLabels, shouldShowLangTag } = useLabelResolver()
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
            @click="showRawRdfDialog = true"
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
      <section v-if="hasLabels" class="details-section">
        <h3>Labels</h3>
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
      <section v-if="hasDocumentation" class="details-section">
        <h3>Documentation</h3>
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
                <i class="pi pi-external-link"></i>
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
                <i class="pi pi-external-link"></i>
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
                <i class="pi pi-external-link"></i>
              </a>
              <span v-else class="metadata-value">{{ lic }}</span>
            </template>
          </div>
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
              {{ getPredicateName(prop.predicate, resolvedPredicates.get(prop.predicate)) }}
              <i class="pi pi-external-link"></i>
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
  background: var(--p-content-hover-background);
  color: var(--p-text-muted-color);
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
  background: var(--p-content-hover-background);
  color: var(--p-text-muted-color);
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
  background: var(--p-content-hover-background);
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
</style>
