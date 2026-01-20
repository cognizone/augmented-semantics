<script setup lang="ts">
/**
 * CollectionDetails - SKOS Collection property display
 *
 * Shows collection information organized in sections:
 * - Labels: prefLabel, altLabel, notation
 * - Documentation: definition, scopeNote, note
 * - Members: list of concepts in the collection
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { watch, computed } from 'vue'
import { useSchemeStore } from '../../stores'
import { useDelayedLoading, useLabelResolver, useCollectionData, useResourceExport, useElapsedTime } from '../../composables'
import { getRefLabel } from '../../utils/displayUtils'
import type { ConceptRef } from '../../types'
import DetailsStates from '../common/DetailsStates.vue'
import DetailsHeader from '../common/DetailsHeader.vue'
import LabelsSection from '../common/LabelsSection.vue'
import DocumentationSection from '../common/DocumentationSection.vue'
import OtherPropertiesSection from '../common/OtherPropertiesSection.vue'

const props = defineProps<{
  collectionUri: string | null
}>()

const emit = defineEmits<{
  selectConcept: [uri: string]
  selectCollection: [uri: string]
}>()

const schemeStore = useSchemeStore()
const { selectCollectionLabel, sortLabels, shouldShowLangTag } = useLabelResolver()
const { details, members, loading, loadingMembers, error, resolvedPredicates, loadDetails, reset } = useCollectionData()
const { exportAsTurtle } = useResourceExport()

// Track elapsed time when loading
const loadingElapsed = useElapsedTime(loading)

// Export menu items (only Turtle for collections)
const exportMenuItems = computed(() => [
  { label: 'Export as Turtle', icon: 'pi pi-code', command: () => details.value && exportAsTurtle(details.value.uri) },
])

// Delayed loading - show spinner only after 300ms to prevent flicker
const showLoading = useDelayedLoading(loading)

// Get preferred label using full priority (prefLabel/XL > dctTitle > dcTitle > rdfsLabel)
const preferredLabelObj = computed(() => {
  if (!details.value) return null
  return selectCollectionLabel({
    prefLabels: details.value.prefLabels,
    prefLabelsXL: details.value.prefLabelsXL,
    dctTitles: details.value.dctTitles,
    dcTitles: details.value.dcTitles,
    rdfsLabels: details.value.rdfsLabels,
  })
})

const preferredLabel = computed(() => preferredLabelObj.value?.value || null)

const displayLang = computed(() => preferredLabelObj.value?.lang || null)

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
  return notation || label || 'Unnamed Collection'
})

// Sorted title/label arrays
const sortedDctTitles = computed(() =>
  details.value?.dctTitles ? sortLabels(details.value.dctTitles) : []
)
const sortedDcTitles = computed(() =>
  details.value?.dcTitles ? sortLabels(details.value.dcTitles) : []
)
const sortedRdfsLabels = computed(() =>
  details.value?.rdfsLabels ? sortLabels(details.value.rdfsLabels) : []
)

// Sorted documentation notes
const sortedHistoryNotes = computed(() => sortLabels(details.value?.historyNotes ?? []))
const sortedChangeNotes = computed(() => sortLabels(details.value?.changeNotes ?? []))
const sortedEditorialNotes = computed(() => sortLabels(details.value?.editorialNotes ?? []))
const sortedExamples = computed(() => sortLabels(details.value?.examples ?? []))

// Label config for LabelsSection (SKOS labels with XL support)
const labelConfig = computed(() => {
  if (!details.value) return []
  const config = []
  if (details.value.prefLabels.length || details.value.prefLabelsXL.length) {
    config.push({
      label: 'Preferred',
      values: sortLabels(details.value.prefLabels),
      hasXL: (details.value.prefLabelsXL?.length ?? 0) > 0,
      xlLabels: details.value.prefLabelsXL ?? [],
      regularLabels: details.value.prefLabels ?? []
    })
  }
  if (details.value.altLabels.length || details.value.altLabelsXL.length) {
    config.push({
      label: 'Alternative',
      values: sortLabels(details.value.altLabels),
      hasXL: (details.value.altLabelsXL?.length ?? 0) > 0,
      xlLabels: details.value.altLabelsXL ?? [],
      regularLabels: details.value.altLabels ?? []
    })
  }
  if (details.value.hiddenLabels.length || details.value.hiddenLabelsXL.length) {
    config.push({
      label: 'Hidden',
      values: sortLabels(details.value.hiddenLabels),
      hasXL: (details.value.hiddenLabelsXL?.length ?? 0) > 0,
      xlLabels: details.value.hiddenLabelsXL ?? [],
      regularLabels: details.value.hiddenLabels ?? [],
      isHidden: true
    })
  }
  return config
})

const hasLabels = computed(() =>
  labelConfig.value.length > 0 || (details.value?.notations?.length ?? 0) > 0
)

// Documentation config
const documentationConfig = computed(() => [
  { label: 'Definition', values: sortLabels(details.value?.definitions ?? []) },
  { label: 'Scope Note', values: sortLabels(details.value?.scopeNotes ?? []) },
  { label: 'History Note', values: sortedHistoryNotes.value },
  { label: 'Change Note', values: sortedChangeNotes.value },
  { label: 'Editorial Note', values: sortedEditorialNotes.value },
  { label: 'Note', values: sortLabels(details.value?.notes ?? []) },
  { label: 'Example', values: sortedExamples.value, class: 'example' },
].filter(d => d.values.length > 0))

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

function navigateToMember(member: { uri: string; type?: string }) {
  if (member.type === 'collection') {
    emit('selectCollection', member.uri)
  } else {
    emit('selectConcept', member.uri)
  }
}

/**
 * Check if a concept ref belongs to a different scheme than the current selection
 * Uses inCurrentScheme boolean from EXISTS check - concept is external if NOT in current scheme
 */
function isExternalScheme(ref: ConceptRef): boolean {
  // Skip if no scheme selected (no badges shown)
  if (!schemeStore.selectedUri) return false
  // Schemes and collections don't show external indicator
  if (ref.type === 'scheme' || ref.type === 'collection') return false
  // External if inCurrentScheme is explicitly false (undefined means we didn't check)
  return ref.inCurrentScheme === false
}

/**
 * Extract short name from scheme URI for display
 * e.g., "http://www.yso.fi/onto/afo/" → "afo"
 */
function getSchemeShortName(schemeUri: string): string {
  const match = schemeUri.match(/\/([^/]+)\/?$/)
  return match ? match[1] : schemeUri
}

// Watch for collection URI changes
watch(
  () => props.collectionUri,
  (uri) => {
    if (uri) {
      loadDetails(uri)
    } else {
      reset()
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="collection-details">
    <DetailsStates
      :loading="loading"
      :show-loading="showLoading"
      :has-data="!!details"
      :error="error"
      loading-text="Loading collection..."
      empty-icon="collections_bookmark"
      empty-title="No collection selected"
      empty-subtitle="Select a collection from the tree"
      :elapsed="loadingElapsed"
      @clear-error="clearError"
    >
      <div v-if="details" class="details-content">
        <DetailsHeader
          icon="collections_bookmark"
          icon-class="icon-collection"
          wrapper-class="wrapper-collection"
          :title="displayTitle"
          :uri="details.uri"
          :lang-tag="displayLang || undefined"
          :show-lang-tag="showHeaderLangTag"
          :export-menu-items="exportMenuItems"
        />

        <!-- Labels Section with Notation slot -->
        <LabelsSection v-if="hasLabels" :items="labelConfig">
          <div v-if="details.notations.length" class="property-row">
            <label>Notation</label>
            <div class="label-values">
              <code v-for="(n, i) in details.notations" :key="i" class="notation">{{ n.value }}</code>
            </div>
          </div>
        </LabelsSection>

        <!-- Title/Label Sections (displayed separately by predicate) -->
        <section v-if="sortedDctTitles.length" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">title</span>
            Title (dct:title)
          </h3>
          <div class="property-row">
            <div class="doc-values">
              <p v-for="(title, i) in sortedDctTitles" :key="i" class="doc-value">
                <span v-if="title.lang && shouldShowLangTag(title.lang)" class="lang-tag lang-tag-first">{{ title.lang }}</span>
                <span class="doc-text">{{ title.value }}</span>
              </p>
            </div>
          </div>
        </section>

        <section v-if="sortedDcTitles.length" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">title</span>
            Title (dc:title)
          </h3>
          <div class="property-row">
            <div class="doc-values">
              <p v-for="(title, i) in sortedDcTitles" :key="i" class="doc-value">
                <span v-if="title.lang && shouldShowLangTag(title.lang)" class="lang-tag lang-tag-first">{{ title.lang }}</span>
                <span class="doc-text">{{ title.value }}</span>
              </p>
            </div>
          </div>
        </section>

        <section v-if="sortedRdfsLabels.length" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">label</span>
            Label (rdfs:label)
          </h3>
          <div class="property-row">
            <div class="doc-values">
              <p v-for="(lbl, i) in sortedRdfsLabels" :key="i" class="doc-value">
                <span v-if="lbl.lang && shouldShowLangTag(lbl.lang)" class="lang-tag lang-tag-first">{{ lbl.lang }}</span>
                <span class="doc-text">{{ lbl.value }}</span>
              </p>
            </div>
          </div>
        </section>

        <DocumentationSection :items="documentationConfig" />

        <!-- Members Section -->
        <section v-if="members.length || loadingMembers" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">list</span>
            Members
            <span v-if="details.memberCount" class="member-count">({{ details.memberCount }})</span>
          </h3>

          <div v-if="loadingMembers" class="loading-members">
            Loading members...
          </div>

          <div v-else class="member-list">
            <div
              v-for="member in members"
              :key="member.uri"
              class="member-item"
              @click="navigateToMember(member)"
            >
              <span class="material-symbols-outlined member-icon"
                    :class="member.type === 'collection' ? 'icon-collection' : (member.hasNarrower ? 'icon-label' : 'icon-leaf')">
                {{ member.type === 'collection' ? 'collections_bookmark' : (member.hasNarrower ? 'label' : 'circle') }}
              </span>
              <span class="member-label">
                {{ getRefLabel(member) }}
                <span v-if="member.lang && shouldShowLangTag(member.lang)" class="lang-tag">
                  {{ member.lang }}
                </span>
                <span v-if="isExternalScheme(member)" class="scheme-badge" :title="member.displayScheme">
                  {{ getSchemeShortName(member.displayScheme!) }}
                </span>
              </span>
            </div>
          </div>
        </section>

        <OtherPropertiesSection
          :properties="sortedOtherProperties"
          :resolved-predicates="resolvedPredicates"
        />
      </div>
    </DetailsStates>
  </div>
</template>

<style scoped>
.collection-details {
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

.notation {
  font-size: 0.875rem;
  background: var(--ae-bg-hover);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  border: 1px solid var(--ae-border-color);
}

.member-count {
  font-weight: normal;
  color: var(--ae-text-secondary);
  font-size: 0.875rem;
}

.loading-members {
  color: var(--ae-text-secondary);
  font-size: 0.875rem;
  font-style: italic;
  padding: 0.5rem 0;
}

.member-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.member-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.member-item:hover {
  background: var(--ae-bg-hover);
  color: var(--ae-accent);
}

.member-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.member-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
}

/* Wrapper class for collection icon in header */
:deep(.wrapper-collection) {
  background: color-mix(in srgb, var(--ae-icon-collection) 15%, transparent);
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
</style>
