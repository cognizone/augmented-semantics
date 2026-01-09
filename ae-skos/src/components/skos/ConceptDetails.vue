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
import { useConceptStore, useSettingsStore } from '../../stores'
import { isValidURI } from '../../services'
import { useDelayedLoading, useLabelResolver, useConceptData, useConceptNavigation, useResourceExport, useDeprecation, useElapsedTime } from '../../composables'
import { getRefLabel, getUriFragment, formatDatatype, formatTemporalValue } from '../../utils/displayUtils'
import RawRdfDialog from '../common/RawRdfDialog.vue'
import DetailsStates from '../common/DetailsStates.vue'
import DetailsHeader from '../common/DetailsHeader.vue'
import LabelsSection from '../common/LabelsSection.vue'
import DocumentationSection from '../common/DocumentationSection.vue'
import OtherPropertiesSection from '../common/OtherPropertiesSection.vue'

const emit = defineEmits<{
  selectConcept: [uri: string]
}>()

const conceptStore = useConceptStore()
const settingsStore = useSettingsStore()
const { selectLabelWithXL, sortLabels, shouldShowLangTag } = useLabelResolver()
const { details, loading, error, resolvedPredicates, loadDetails } = useConceptData()
const { navigateTo, handleSchemeClick, isLocalScheme } = useConceptNavigation(emit)
const { exportAsJson, exportAsTurtle, exportAsCsv } = useResourceExport()
const { showIndicator: showDeprecationIndicator } = useDeprecation()

// Local state
const showRawRdfDialog = ref(false)

// Track elapsed time when loading
const loadingElapsed = useElapsedTime(loading)

// Export menu items
const exportMenuItems = [
  { label: 'Export as JSON', icon: 'pi pi-file', command: () => details.value && exportAsJson(details.value) },
  { label: 'Export as Turtle', icon: 'pi pi-code', command: () => details.value && exportAsTurtle(details.value.uri) },
  { label: 'Export as CSV', icon: 'pi pi-table', command: () => details.value && exportAsCsv(details.value) },
]

// Delayed loading - show spinner only after 300ms to prevent flicker
const showLoading = useDelayedLoading(loading)

// Get preferred label (full LabelValue for language info)
// Uses SKOS-XL prefLabel as fallback if regular prefLabel not available
const preferredLabelObj = computed(() => {
  if (!details.value) return null
  return selectLabelWithXL(details.value.prefLabels, details.value.prefLabelsXL)
})

// Get preferred label string
const preferredLabel = computed(() => {
  return preferredLabelObj.value?.value || null
})

// Get language of displayed label (for showing lang tag)
const displayLang = computed(() => {
  return preferredLabelObj.value?.lang || null
})

// Should we show the language tag in header?
const showHeaderLangTag = computed(() => {
  return displayLang.value ? shouldShowLangTag(displayLang.value) : false
})

// Get display title (notation + label if both exist)
const displayTitle = computed(() => {
  if (!details.value) return ''
  const label = preferredLabel.value
  const notation = details.value.notations[0]?.value

  if (notation && label) {
    return `${notation} - ${label}`
  }
  return notation || label || 'Unnamed Concept'
})

// Icon props based on whether concept has children
const headerIcon = computed(() => details.value?.narrower?.length ? 'label' : 'circle')
const headerIconClass = computed(() => details.value?.narrower?.length ? 'icon-label' : 'icon-leaf')
const headerWrapperClass = computed(() => details.value?.narrower?.length ? '' : 'wrapper-leaf')

// Factory for sorted label computeds
const getSorted = <K extends keyof NonNullable<typeof details.value>>(field: K) =>
  computed(() => details.value ? sortLabels(details.value[field] as any) : [])

// Sorted label arrays
const sortedPrefLabels = getSorted('prefLabels')
const sortedAltLabels = getSorted('altLabels')
const sortedHiddenLabels = getSorted('hiddenLabels')
const sortedDefinitions = getSorted('definitions')
const sortedScopeNotes = getSorted('scopeNotes')
const sortedHistoryNotes = getSorted('historyNotes')
const sortedChangeNotes = getSorted('changeNotes')
const sortedEditorialNotes = getSorted('editorialNotes')
const sortedNotes = getSorted('notes')
const sortedExamples = getSorted('examples')

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
  return config
})

// Has any labels to show (for section visibility)
const hasLabels = computed(() =>
  labelConfig.value.length > 0 || (details.value?.notations?.length ?? 0) > 0
)

// Documentation config for DocumentationSection
const documentationConfig = computed(() => [
  { label: 'Definition', values: sortedDefinitions.value },
  { label: 'Scope Note', values: sortedScopeNotes.value },
  { label: 'History Note', values: sortedHistoryNotes.value },
  { label: 'Change Note', values: sortedChangeNotes.value },
  { label: 'Editorial Note', values: sortedEditorialNotes.value },
  { label: 'Note', values: sortedNotes.value },
  { label: 'Example', values: sortedExamples.value, class: 'example' },
].filter(d => d.values.length > 0))

// Mappings config for DRY template rendering
const mappingsConfig = computed(() => [
  { label: 'Exact Match', uris: details.value?.exactMatch || [] },
  { label: 'Close Match', uris: details.value?.closeMatch || [] },
  { label: 'Broad Match', uris: details.value?.broadMatch || [] },
  { label: 'Narrow Match', uris: details.value?.narrowMatch || [] },
  { label: 'Related Match', uris: details.value?.relatedMatch || [] },
].filter(m => m.uris.length > 0))

// Has any metadata to show
const hasMetadata = computed(() =>
  (details.value?.identifier?.length ?? 0) > 0 ||
  details.value?.created ||
  details.value?.modified ||
  details.value?.status ||
  (details.value?.seeAlso?.length ?? 0) > 0
)

// Sorted other properties (alphabetically by qualified name)
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

function clearError() {
  error.value = null
}

// Watch for selected concept changes
watch(
  () => conceptStore.selectedUri,
  (uri) => {
    if (uri) {
      loadDetails(uri)
    } else {
      // Clear details when no concept selected (e.g., endpoint switch)
      details.value = null
      error.value = null
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="concept-details">
    <DetailsStates
      :loading="loading"
      :show-loading="showLoading"
      :has-data="!!details"
      :error="error"
      loading-text="Loading details..."
      empty-icon="info"
      empty-title="No concept selected"
      empty-subtitle="Select a concept from the tree or search"
      :elapsed="loadingElapsed"
      @clear-error="clearError"
    >
      <!-- Details content - wrapped in v-if because Vue evaluates slot expressions before child renders -->
      <div v-if="details" class="details-content">
        <DetailsHeader
          :icon="headerIcon"
          :icon-class="headerIconClass"
          :wrapper-class="headerWrapperClass"
          :title="displayTitle"
          :uri="details.uri"
          :lang-tag="displayLang || undefined"
          :show-lang-tag="showHeaderLangTag"
          :deprecated="details.deprecated && showDeprecationIndicator"
          deprecated-tooltip="This concept is deprecated"
          :export-menu-items="exportMenuItems"
          @show-raw-rdf="showRawRdfDialog = true"
        />

        <!-- Labels Section with Notation slot -->
        <LabelsSection v-if="hasLabels" :items="labelConfig">
          <div v-if="details.notations.length" class="property-row">
            <label>Notation</label>
            <div class="label-values">
              <span v-for="(n, i) in details.notations" :key="i" class="notation-wrapper">
                <code class="notation">{{ n.value }}</code>
                <span v-if="settingsStore.showDatatypes && n.datatype" class="datatype-tag">{{ formatDatatype(n.datatype) }}</span>
              </span>
            </div>
          </div>
        </LabelsSection>

        <DocumentationSection :items="documentationConfig" />

        <!-- Hierarchy Section (concept-specific) -->
        <section v-if="details.broader.length || details.narrower.length" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">account_tree</span>
            Hierarchy
          </h3>

          <div v-if="details.broader.length" class="property-row">
            <label>Broader</label>
            <div class="concept-chips">
              <span
                v-for="ref in details.broader"
                :key="ref.uri"
                class="concept-chip clickable"
                @click="navigateTo(ref)"
              >
                {{ getRefLabel(ref) }}<span v-if="ref.lang && shouldShowLangTag(ref.lang)" class="lang-tag">{{ ref.lang }}</span>
              </span>
            </div>
          </div>

          <div v-if="details.narrower.length" class="property-row">
            <label>Narrower</label>
            <div class="concept-chips">
              <span
                v-for="ref in details.narrower"
                :key="ref.uri"
                class="concept-chip clickable"
                @click="navigateTo(ref)"
              >
                {{ getRefLabel(ref) }}<span v-if="ref.lang && shouldShowLangTag(ref.lang)" class="lang-tag">{{ ref.lang }}</span>
              </span>
            </div>
          </div>
        </section>

        <!-- Relations Section (concept-specific) -->
        <section v-if="details.related.length" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">link</span>
            Relations
          </h3>

          <div class="property-row">
            <label>Related</label>
            <div class="concept-chips">
              <span
                v-for="ref in details.related"
                :key="ref.uri"
                class="concept-chip clickable"
                @click="navigateTo(ref)"
              >
                {{ getRefLabel(ref) }}<span v-if="ref.lang && shouldShowLangTag(ref.lang)" class="lang-tag">{{ ref.lang }}</span>
              </span>
            </div>
          </div>
        </section>

        <!-- Mappings Section (concept-specific) -->
        <section v-if="mappingsConfig.length" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">swap_horiz</span>
            Mappings
          </h3>

          <div v-for="mapping in mappingsConfig" :key="mapping.label" class="property-row">
            <label>{{ mapping.label }}</label>
            <div class="mapping-links">
              <template v-for="uri in mapping.uris" :key="uri">
                <a v-if="isValidURI(uri)" :href="uri" target="_blank" class="mapping-link">
                  {{ getUriFragment(uri) }}
                  <span class="material-symbols-outlined link-icon">open_in_new</span>
                </a>
                <span v-else class="mapping-text">{{ getUriFragment(uri) }}</span>
              </template>
            </div>
          </div>
        </section>

        <!-- Scheme Section (concept-specific) -->
        <section v-if="details.inScheme.length" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">schema</span>
            Schemes
          </h3>
          <div class="property-row">
            <label>In Scheme</label>
            <div class="concept-chips">
              <span
                v-for="ref in details.inScheme"
                :key="ref.uri"
                :class="['concept-chip', { clickable: isLocalScheme(ref.uri) }]"
                @click="handleSchemeClick(ref)"
              >
                {{ getRefLabel(ref) }}<span v-if="ref.lang && shouldShowLangTag(ref.lang)" class="lang-tag">{{ ref.lang }}</span>
              </span>
            </div>
          </div>
        </section>

        <!-- Metadata Section (concept-specific) -->
        <section v-if="hasMetadata" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">info</span>
            Metadata
          </h3>

          <div v-if="details.identifier?.length" class="property-row">
            <label>Identifier</label>
            <div class="metadata-values">
              <span v-for="(id, i) in details.identifier" :key="i" class="metadata-value">{{ id }}</span>
            </div>
          </div>

          <div v-if="details.status" class="property-row">
            <label>Status</label>
            <span class="metadata-value">{{ details.status }}</span>
          </div>

          <div v-if="details.seeAlso?.length" class="property-row">
            <label>See Also</label>
            <div class="metadata-values">
              <template v-for="(uri, i) in details.seeAlso" :key="i">
                <a :href="uri" target="_blank" class="metadata-link">
                  {{ getUriFragment(uri) }}
                  <span class="material-symbols-outlined link-icon">open_in_new</span>
                </a>
              </template>
            </div>
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
.concept-details {
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

/* Concept-specific sections */
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

.concept-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.concept-chip {
  display: inline-flex;
  align-items: center;
  font-size: 0.875rem;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 4px;
  padding: 0.375rem 0.75rem;
}

.concept-chip.clickable {
  cursor: pointer;
}

.concept-chip.clickable:hover {
  background: var(--ae-bg-hover);
  color: var(--ae-accent);
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
  color: var(--ae-accent);
}

.link-icon {
  font-size: 14px;
}
</style>
