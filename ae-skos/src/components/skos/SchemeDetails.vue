<script setup lang="ts">
/**
 * SchemeDetails - SKOS concept scheme property display
 *
 * Shows comprehensive scheme information organized in sections.
 * Uses shared components for consistent rendering.
 *
 * @see /spec/ae-skos/sko02-SchemeSelector.md
 */
import { ref, watch, computed } from 'vue'
import { useSchemeStore } from '../../stores'
import { isValidURI } from '../../services'
import { useDelayedLoading, useLabelResolver, useElapsedTime, useResourceExport, useSchemeData, useDeprecation } from '../../composables'
import { getUriFragment, formatTemporalValue, formatDatatype } from '../../utils/displayUtils'
import { useToast } from 'primevue/usetoast'
import RawRdfDialog from '../common/RawRdfDialog.vue'
import DetailsStates from '../common/DetailsStates.vue'
import DetailsHeader from '../common/DetailsHeader.vue'
import LabelsSection from '../common/LabelsSection.vue'
import DocumentationSection from '../common/DocumentationSection.vue'
import OtherPropertiesSection from '../common/OtherPropertiesSection.vue'

const schemeStore = useSchemeStore()
const toast = useToast()
const { selectSchemeLabel, sortLabels, shouldShowLangTag } = useLabelResolver()
const { exportAsTurtle, downloadFile } = useResourceExport()
const { details, loading, error, resolvedPredicates, loadDetails } = useSchemeData()
const { showIndicator: showDeprecationIndicator } = useDeprecation()

// Local state
const showRawRdfDialog = ref(false)

// Track elapsed time when loading
const loadingElapsed = useElapsedTime(loading)

// Export menu items
const exportMenuItems = [
  { label: 'Export as JSON', icon: 'pi pi-file', command: () => exportAsJson() },
  { label: 'Export as Turtle', icon: 'pi pi-code', command: () => details.value && exportAsTurtle(details.value.uri) },
]

// Delayed loading
const showLoading = useDelayedLoading(loading)

// Preferred label for header
const preferredLabelObj = computed(() => {
  if (!details.value) return null
  return selectSchemeLabel({
    prefLabels: details.value.prefLabels,
    prefLabelsXL: details.value.prefLabelsXL,
    titles: details.value.title,
  })
})

const preferredLabel = computed(() => preferredLabelObj.value?.value || details.value?.uri.split('/').pop() || '')
const displayLang = computed(() => preferredLabelObj.value?.lang || null)
const showHeaderLangTag = computed(() => displayLang.value ? shouldShowLangTag(displayLang.value) : false)

// Helper to create sorted computed properties
const getSorted = (field: keyof NonNullable<typeof details.value>) =>
  computed(() => {
    const value = details.value?.[field]
    return value && Array.isArray(value) ? sortLabels(value as any) : []
  })

// Sorted arrays
const sortedPrefLabels = getSorted('prefLabels')
const sortedAltLabels = getSorted('altLabels')
const sortedHiddenLabels = getSorted('hiddenLabels')
const sortedLabels = getSorted('labels')
const sortedDefinitions = getSorted('definitions')
const sortedDescriptions = getSorted('description')
const sortedComments = getSorted('comments')
const sortedScopeNotes = getSorted('scopeNotes')
const sortedHistoryNotes = getSorted('historyNotes')
const sortedChangeNotes = getSorted('changeNotes')
const sortedEditorialNotes = getSorted('editorialNotes')
const sortedNotes = getSorted('notes')
const sortedExamples = getSorted('examples')
const sortedTitles = getSorted('title')

// Sorted other properties
const sortedOtherProperties = computed(() => {
  if (!details.value) return []
  return [...details.value.otherProperties].sort((a, b) => {
    const aResolved = resolvedPredicates.value.get(a.predicate)
    const bResolved = resolvedPredicates.value.get(b.predicate)
    const aName = aResolved?.localName || a.predicate
    const bName = bResolved?.localName || b.predicate
    return aName.localeCompare(bName)
  })
})

// Label config for LabelsSection
const labelConfig = computed(() => {
  if (!details.value) return []
  const config = []
  if (details.value.prefLabels.length || details.value.prefLabelsXL.length) {
    config.push({
      label: 'Preferred',
      values: sortedPrefLabels.value,
      hasXL: (details.value.prefLabelsXL?.length ?? 0) > 0,
      xlLabels: details.value.prefLabelsXL ?? [],
      regularLabels: details.value.prefLabels ?? []
    })
  }
  if (details.value.altLabels.length || details.value.altLabelsXL.length) {
    config.push({
      label: 'Alternative',
      values: sortedAltLabels.value,
      hasXL: (details.value.altLabelsXL?.length ?? 0) > 0,
      xlLabels: details.value.altLabelsXL ?? [],
      regularLabels: details.value.altLabels ?? []
    })
  }
  if (details.value.hiddenLabels.length || details.value.hiddenLabelsXL.length) {
    config.push({
      label: 'Hidden',
      values: sortedHiddenLabels.value,
      hasXL: (details.value.hiddenLabelsXL?.length ?? 0) > 0,
      xlLabels: details.value.hiddenLabelsXL ?? [],
      regularLabels: details.value.hiddenLabels ?? [],
      isHidden: true
    })
  }
  if (details.value.labels?.length) {
    config.push({
      label: 'Label',
      values: sortedLabels.value,
    })
  }
  return config
})

// Has any labels to show (for section visibility including notation)
const hasLabels = computed(() =>
  labelConfig.value.length > 0 || (details.value?.notations?.length ?? 0) > 0
)

// Documentation config for DocumentationSection
const documentationConfig = computed(() => [
  { label: 'Definition', values: sortedDefinitions.value },
  { label: 'Description', values: sortedDescriptions.value },
  { label: 'Comment', values: sortedComments.value },
  { label: 'Scope Note', values: sortedScopeNotes.value },
  { label: 'History Note', values: sortedHistoryNotes.value },
  { label: 'Change Note', values: sortedChangeNotes.value },
  { label: 'Editorial Note', values: sortedEditorialNotes.value },
  { label: 'Note', values: sortedNotes.value },
  { label: 'Example', values: sortedExamples.value, class: 'example' },
].filter(prop => prop.values.length > 0))

// Metadata links config
const metadataLinksConfig = computed(() => [
  { label: 'Creator', values: details.value?.creator || [] },
  { label: 'Publisher', values: details.value?.publisher || [] },
  { label: 'See Also', values: details.value?.seeAlso || [] },
  { label: 'Rights', values: details.value?.rights || [] },
  { label: 'License', values: details.value?.license || [] },
  { label: 'License (CC)', values: details.value?.ccLicense || [] },
].filter(m => m.values.length > 0))

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

function clearError() {
  error.value = null
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
    <DetailsStates
      :loading="loading"
      :show-loading="showLoading"
      :has-data="!!details"
      :error="error"
      loading-text="Loading scheme..."
      empty-icon="schema"
      empty-title="No scheme selected"
      empty-subtitle="Select a scheme from the dropdown or click 'In Scheme' on a concept"
      :elapsed="loadingElapsed"
      @clear-error="clearError"
    >
      <!-- Details content - wrapped in v-if because Vue evaluates slot expressions before child renders -->
      <div v-if="details" class="details-content">
        <DetailsHeader
          icon="folder"
          icon-class="icon-folder"
          :title="preferredLabel"
          :uri="details.uri"
          :lang-tag="displayLang || undefined"
          :show-lang-tag="showHeaderLangTag"
          :deprecated="details.deprecated && showDeprecationIndicator"
          deprecated-tooltip="This concept scheme is deprecated"
          :export-menu-items="exportMenuItems"
          @show-raw-rdf="showRawRdfDialog = true"
        />

        <!-- Dublin Core Title (scheme-specific) -->
        <section v-if="sortedTitles.length" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">title</span>
            Title
          </h3>
          <div class="property-row">
            <div class="doc-values">
              <p v-for="(title, i) in sortedTitles" :key="i" class="doc-value">
                <span v-if="title.lang" class="lang-tag lang-tag-first">{{ title.lang }}</span>
                <span class="doc-text">{{ title.value }}</span>
              </p>
            </div>
          </div>
        </section>

        <LabelsSection v-if="hasLabels" :items="labelConfig">
          <div v-if="details.notations?.length" class="property-row">
            <label>Notation</label>
            <div class="label-values">
              <span v-for="(n, i) in details.notations" :key="i" class="notation-wrapper">
                <code class="notation">{{ n.value }}</code>
                <span v-if="n.datatype" class="datatype-tag">{{ formatDatatype(n.datatype) }}</span>
              </span>
            </div>
          </div>
        </LabelsSection>

        <DocumentationSection :items="documentationConfig" />

        <!-- Metadata Section (scheme-specific) -->
        <section v-if="metadataLinksConfig.length || details.versionInfo || details.created || details.modified || details.issued" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">info</span>
            Metadata
          </h3>

          <div v-for="meta in metadataLinksConfig" :key="meta.label" class="property-row">
            <label>{{ meta.label }}</label>
            <div class="metadata-values">
              <template v-for="(val, i) in meta.values" :key="i">
                <a v-if="isValidURI(val)" :href="val" target="_blank" class="metadata-link">
                  {{ getUriFragment(val) }}
                  <span class="material-symbols-outlined link-icon">open_in_new</span>
                </a>
                <span v-else class="metadata-value">{{ val }}</span>
              </template>
            </div>
          </div>

          <div v-if="details.versionInfo" class="property-row">
            <label>Version</label>
            <span class="metadata-value">{{ details.versionInfo }}</span>
          </div>

          <div v-if="details.issued" class="property-row">
            <label>Issued</label>
            <span class="metadata-value">
              {{ formatTemporalValue(details.issued, 'xsd:date') }}
              <span class="datatype-tag">xsd:date</span>
            </span>
          </div>

          <div v-if="details.created" class="property-row">
            <label>Created</label>
            <span class="metadata-value">
              {{ formatTemporalValue(details.created, 'xsd:date') }}
              <span class="datatype-tag">xsd:date</span>
            </span>
          </div>

          <div v-if="details.modified" class="property-row">
            <label>Modified</label>
            <span class="metadata-value">
              {{ formatTemporalValue(details.modified, 'xsd:date') }}
              <span class="datatype-tag">xsd:date</span>
            </span>
          </div>
        </section>

        <OtherPropertiesSection
          :properties="sortedOtherProperties"
          :resolved-predicates="resolvedPredicates"
        />
      </div>
    </DetailsStates>

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

.details-content {
  flex: 1;
  overflow: auto;
  padding: 2rem;
  max-width: 900px;
}

/* Scheme-specific sections */
.details-section {
  margin-bottom: 2rem;
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
  margin-right: 0.5rem;
}

.doc-value .doc-text {
  grid-column: 2;
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

.label-values {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.notation-wrapper {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.notation {
  font-size: 0.875rem;
  background: var(--ae-bg-hover);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  border: 1px solid var(--ae-border-color);
}
</style>
