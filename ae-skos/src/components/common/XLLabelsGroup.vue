<script setup lang="ts">
/**
 * XLLabelsGroup - Grouped SKOS-XL labels display
 *
 * Groups XL labels by literalForm value and collapses duplicates.
 * Shows a count indicator when multiple labels share the same literalForm.
 *
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import { computed, ref } from 'vue'
import { useLabelResolver } from '../../composables'
import { isValidURI } from '../../services'
import type { XLLabel, LabelValue } from '../../types'
import Button from 'primevue/button'

const props = defineProps<{
  labels: XLLabel[]
  regularLabels?: LabelValue[]
}>()

const { sortLabels } = useLabelResolver()

// Filter out XL labels that have the same value+lang as regular labels
const filteredLabels = computed(() => {
  if (!props.regularLabels?.length) return props.labels

  const regularKeys = new Set(
    props.regularLabels.map(l => `${l.value}|${l.lang || ''}`)
  )

  return props.labels.filter(xl => {
    const key = `${xl.literalForm.value}|${xl.literalForm.lang || ''}`
    return !regularKeys.has(key)
  })
})

// Count of hidden XL labels (matching regular labels)
const hiddenCount = computed(() => props.labels.length - filteredLabels.value.length)

// Hidden XL labels (those matching regular labels)
const hiddenLabels = computed(() => {
  if (!props.regularLabels?.length) return []

  const regularKeys = new Set(
    props.regularLabels.map(l => `${l.value}|${l.lang || ''}`)
  )

  return props.labels.filter(xl => {
    const key = `${xl.literalForm.value}|${xl.literalForm.lang || ''}`
    return regularKeys.has(key)
  })
})

// Toggle for showing hidden labels
const showHiddenXL = ref(false)

interface GroupedLabel {
  key: string
  literalForm: { value: string; lang?: string }
  labels: XLLabel[]
}

// Group labels by literalForm value + lang
const groupedLabels = computed(() => {
  const groups = new Map<string, GroupedLabel>()

  for (const label of filteredLabels.value) {
    const key = `${label.literalForm.value}|${label.literalForm.lang || ''}`
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        literalForm: label.literalForm,
        labels: []
      })
    }
    groups.get(key)!.labels.push(label)
  }

  // Convert to array and sort by language priority
  const values = Array.from(groups.values())

  // Sort using the same logic as sortLabels
  const labelValues = values.map(g => g.literalForm)
  const sorted = sortLabels(labelValues)

  // Reorder groups to match sorted order
  return sorted.map(lv => {
    const key = `${lv.value}|${lv.lang || ''}`
    return groups.get(key)!
  }).filter(Boolean)
})

// Grouped hidden labels (same structure as groupedLabels)
const groupedHiddenLabels = computed(() => {
  const groups = new Map<string, GroupedLabel>()

  for (const label of hiddenLabels.value) {
    const key = `${label.literalForm.value}|${label.literalForm.lang || ''}`
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        literalForm: label.literalForm,
        labels: []
      })
    }
    groups.get(key)!.labels.push(label)
  }

  const values = Array.from(groups.values())
  const labelValues = values.map(g => g.literalForm)
  const sorted = sortLabels(labelValues)

  return sorted.map(lv => {
    const key = `${lv.value}|${lv.lang || ''}`
    return groups.get(key)!
  }).filter(Boolean)
})

// Track which groups are expanded
const expandedGroups = ref<Set<string>>(new Set())

function toggleGroup(key: string) {
  if (expandedGroups.value.has(key)) {
    expandedGroups.value.delete(key)
  } else {
    expandedGroups.value.add(key)
  }
  // Trigger reactivity
  expandedGroups.value = new Set(expandedGroups.value)
}

function isExpanded(key: string): boolean {
  return expandedGroups.value.has(key)
}
</script>

<template>
  <div class="xl-labels-container">
    <!-- Hidden indicator when XL labels match regular labels - clickable to expand -->
    <button
      v-if="hiddenCount > 0"
      class="xl-hidden-toggle"
      @click="showHiddenXL = !showHiddenXL"
      :title="showHiddenXL ? 'Hide XL labels that match regular labels' : 'Show XL labels that match regular labels'"
    >
      <span v-if="groupedLabels.length === 0">({{ hiddenCount }} XL hidden)</span>
      <span v-else>(+{{ hiddenCount }} XL hidden)</span>
      <i :class="showHiddenXL ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"></i>
    </button>

    <!-- Hidden XL labels (matching regular labels) - shown when expanded -->
    <div v-if="showHiddenXL && groupedHiddenLabels.length > 0" class="xl-labels-group xl-hidden-group">
      <div v-for="group in groupedHiddenLabels" :key="'hidden-' + group.key" class="xl-label-item xl-hidden-item">
        <div class="xl-label-header" @click="toggleGroup('hidden-' + group.key)">
          <span class="xl-indicator xl-hidden-badge">[XL]</span>
          <span class="xl-literal">
            {{ group.literalForm.value }}
            <span v-if="group.literalForm.lang" class="lang-tag">
              {{ group.literalForm.lang }}
            </span>
          </span>
          <span v-if="group.labels.length > 1" class="collapse-count" :title="`${group.labels.length} label resources with same value`">
            {{ group.labels.length }}
          </span>
          <Button
            :icon="isExpanded('hidden-' + group.key) ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
            severity="secondary"
            text
            rounded
            size="small"
            class="expand-btn"
          />
        </div>

        <div v-if="isExpanded('hidden-' + group.key)" class="xl-label-details">
          <div v-for="(label, idx) in group.labels" :key="label.uri" class="xl-label-entry">
            <div v-if="group.labels.length > 1" class="entry-header">
              Label {{ idx + 1 }} of {{ group.labels.length }}
            </div>
            <div class="xl-detail-row">
              <span class="detail-label">URI:</span>
              <a
                v-if="isValidURI(label.uri)"
                :href="label.uri"
                target="_blank"
                rel="noopener noreferrer"
                class="detail-value uri-link"
              >
                {{ label.uri }}
                <i class="pi pi-external-link"></i>
              </a>
              <span v-else class="detail-value">{{ label.uri }}</span>
            </div>
            <div class="xl-detail-row">
              <span class="detail-label">literalForm:</span>
              <span class="detail-value">
                {{ label.literalForm.value }}
                <span v-if="label.literalForm.lang" class="lang-tag">{{ label.literalForm.lang }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

  <div v-if="groupedLabels.length > 0" class="xl-labels-group">
    <div v-for="group in groupedLabels" :key="group.key" class="xl-label-item">
      <div class="xl-label-header" @click="toggleGroup(group.key)">
        <span class="xl-indicator">[XL]</span>
        <span class="xl-literal">
          {{ group.literalForm.value }}
          <span v-if="group.literalForm.lang" class="lang-tag">
            {{ group.literalForm.lang }}
          </span>
        </span>
        <span v-if="group.labels.length > 1" class="collapse-count" :title="`${group.labels.length} label resources with same value`">
          {{ group.labels.length }}
        </span>
        <Button
          :icon="isExpanded(group.key) ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
          severity="secondary"
          text
          rounded
          size="small"
          class="expand-btn"
        />
      </div>

      <div v-if="isExpanded(group.key)" class="xl-label-details">
        <div v-for="(label, idx) in group.labels" :key="label.uri" class="xl-label-entry">
          <div v-if="group.labels.length > 1" class="entry-header">
            Label {{ idx + 1 }} of {{ group.labels.length }}
          </div>
          <div class="xl-detail-row">
            <span class="detail-label">URI:</span>
            <a
              v-if="isValidURI(label.uri)"
              :href="label.uri"
              target="_blank"
              rel="noopener noreferrer"
              class="detail-value uri-link"
            >
              {{ label.uri }}
              <i class="pi pi-external-link"></i>
            </a>
            <span v-else class="detail-value">{{ label.uri }}</span>
          </div>
          <div class="xl-detail-row">
            <span class="detail-label">literalForm:</span>
            <span class="detail-value">
              {{ label.literalForm.value }}
              <span v-if="label.literalForm.lang" class="lang-tag">{{ label.literalForm.lang }}</span>
            </span>
          </div>
          <div v-if="label.labelRelations && label.labelRelations.length > 0" class="xl-relations">
            <span class="detail-label">Relations:</span>
            <div v-for="(rel, index) in label.labelRelations" :key="index" class="relation-item">
              <span class="relation-type">{{ rel.type }}:</span>
              <span class="relation-target">{{ rel.target.literalForm.value }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  </div>
</template>

<style scoped>
.xl-labels-container {
  display: contents;
}

.xl-hidden-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  font-style: italic;
  background: none;
  border: none;
  padding: 0.125rem 0.25rem;
  margin-left: 0.25rem;
  cursor: pointer;
  border-radius: 3px;
  font-family: inherit;
}

.xl-hidden-toggle:hover {
  background: var(--p-surface-100);
  color: var(--p-text-color);
}

.xl-hidden-toggle i {
  font-size: 0.625rem;
}

.xl-hidden-group {
  width: 100%;
  margin-top: 0.5rem;
  padding: 0.5rem;
  background: var(--p-surface-50);
  border-radius: 4px;
  border: 1px dashed var(--p-surface-300);
}

.xl-hidden-item {
  opacity: 0.8;
}

.xl-hidden-badge {
  background: var(--p-surface-200) !important;
  color: var(--p-text-muted-color) !important;
}

.xl-labels-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.xl-label-item {
  background: var(--p-surface-50);
  border: 1px solid var(--p-surface-200);
  border-radius: 4px;
  overflow: hidden;
  width: fit-content;
  max-width: 100%;
}

.xl-label-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  cursor: pointer;
}

.xl-label-header:hover {
  background: var(--p-surface-100);
}

.xl-indicator {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--p-primary-color);
  background: var(--p-primary-100);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  flex-shrink: 0;
}

.xl-literal {
  flex: 1;
  font-size: 0.875rem;
}

.lang-tag {
  font-size: 0.625rem;
  font-weight: normal;
  background: var(--p-surface-200);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  margin-left: 0.25rem;
}

.collapse-count {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
  background: var(--p-surface-200);
  padding: 0.1rem 0.4rem;
  border-radius: 10px;
  flex-shrink: 0;
}

.expand-btn {
  flex-shrink: 0;
}

.xl-label-details {
  padding: 0.5rem;
  background: var(--p-surface-0);
  border-top: 1px solid var(--p-surface-200);
}

.xl-label-entry {
  padding: 0.5rem 0;
}

.xl-label-entry:not(:last-child) {
  border-bottom: 1px dashed var(--p-surface-200);
  margin-bottom: 0.5rem;
}

.entry-header {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--p-primary-color);
  margin-bottom: 0.5rem;
}

.xl-detail-row {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  margin-bottom: 0.5rem;
}

.xl-detail-row:last-child {
  margin-bottom: 0;
}

.detail-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--p-text-muted-color);
}

.detail-value {
  font-size: 0.875rem;
  word-break: break-all;
}

.uri-link {
  color: var(--p-primary-color);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.uri-link:hover {
  text-decoration: underline;
}

.uri-link .pi {
  font-size: 0.625rem;
}

.xl-relations {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px dashed var(--p-surface-200);
}

.relation-item {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.relation-type {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.relation-target {
  font-size: 0.875rem;
}
</style>
