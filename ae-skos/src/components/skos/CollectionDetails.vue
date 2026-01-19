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
import { useDelayedLoading, useLabelResolver, useCollectionData, useResourceExport, useElapsedTime } from '../../composables'
import { getRefLabel } from '../../utils/displayUtils'
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
}>()

const { selectLabel, sortLabels, shouldShowLangTag } = useLabelResolver()
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

// Get preferred label
const preferredLabelObj = computed(() => {
  if (!details.value) return null
  return selectLabel(details.value.prefLabels)
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

// Label config for LabelsSection
const labelConfig = computed(() => {
  if (!details.value) return []
  const config = []
  if (details.value.prefLabels.length) {
    config.push({
      label: 'Preferred',
      values: sortLabels(details.value.prefLabels),
    })
  }
  if (details.value.altLabels.length) {
    config.push({
      label: 'Alternative',
      values: sortLabels(details.value.altLabels),
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
  { label: 'Note', values: sortLabels(details.value?.notes ?? []) },
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

function navigateToMember(ref: { uri: string }) {
  emit('selectConcept', ref.uri)
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
              <span class="material-symbols-outlined member-icon icon-leaf">circle</span>
              <span class="member-label">
                {{ getRefLabel(member) }}
                <span v-if="member.lang && shouldShowLangTag(member.lang)" class="lang-tag">
                  {{ member.lang }}
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
</style>
