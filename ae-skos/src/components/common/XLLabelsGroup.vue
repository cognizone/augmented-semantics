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
import type { XLLabel } from '../../types'
import Button from 'primevue/button'

const props = defineProps<{
  labels: XLLabel[]
}>()

const { shouldShowLangTag, sortLabels } = useLabelResolver()

interface GroupedLabel {
  key: string
  literalForm: { value: string; lang?: string }
  labels: XLLabel[]
}

// Group labels by literalForm value + lang
const groupedLabels = computed(() => {
  const groups = new Map<string, GroupedLabel>()

  for (const label of props.labels) {
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
  <div v-if="groupedLabels.length > 0" class="xl-labels-group">
    <div v-for="group in groupedLabels" :key="group.key" class="xl-label-item">
      <div class="xl-label-header" @click="toggleGroup(group.key)">
        <span class="xl-indicator">[XL]</span>
        <span class="xl-literal">
          {{ group.literalForm.value }}
          <span v-if="group.literalForm.lang && shouldShowLangTag(group.literalForm.lang)" class="lang-tag">
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
</template>

<style scoped>
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
