<script setup lang="ts">
/**
 * RecentHistory - Recently viewed concepts
 *
 * Displays the last 10 concepts viewed with relative timestamps.
 * Persisted across sessions in localStorage.
 *
 * @see /spec/ae-skos/sko06-Utilities.md
 */
import { computed } from 'vue'
import { useConceptStore } from '../../stores'
import { useLabelResolver } from '../../composables'
import Button from 'primevue/button'
import Listbox from 'primevue/listbox'

import type { HistoryEntry } from '../../types'

const emit = defineEmits<{
  selectConcept: [entry: HistoryEntry]
}>()

const conceptStore = useConceptStore()
const { shouldShowLangTag } = useLabelResolver()

// Computed
const history = computed(() => conceptStore.recentHistory)
const hasHistory = computed(() => history.value.length > 0)

// Format relative time
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins} min ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`

  return date.toLocaleDateString()
}

// Select a history item
function selectItem(entry: HistoryEntry) {
  emit('selectConcept', entry)
}

// Clear history
function clearHistory() {
  conceptStore.clearHistory()
}
</script>

<template>
  <div class="recent-history">
    <div class="history-header">
      <span class="header-title">
        <i class="pi pi-history"></i>
        Recent
      </span>
      <Button
        v-if="hasHistory"
        icon="pi pi-trash"
        severity="secondary"
        text
        rounded
        size="small"
        v-tooltip.left="'Clear history'"
        @click="clearHistory"
      />
    </div>

    <div v-if="!hasHistory" class="empty-state">
      <small>No recent concepts</small>
    </div>

    <Listbox
      v-else
      :options="history"
      optionLabel="label"
      class="history-list"
      @change="(e) => e.value && selectItem(e.value)"
    >
      <template #option="slotProps">
        <div class="history-item">
          <span class="item-label">
            {{ slotProps.option.notation && slotProps.option.label
              ? `${slotProps.option.notation} - ${slotProps.option.label}`
              : slotProps.option.notation || slotProps.option.label }}
            <span v-if="slotProps.option.lang && shouldShowLangTag(slotProps.option.lang)" class="lang-tag">
              {{ slotProps.option.lang }}
            </span>
          </span>
          <span class="item-time">{{ formatRelativeTime(slotProps.option.accessedAt) }}</span>
        </div>
      </template>
    </Listbox>
  </div>
</template>

<style scoped>
.recent-history {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem;
  border-bottom: 1px solid var(--p-surface-200);
}

.header-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
  font-size: 0.875rem;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  color: var(--p-text-muted-color);
}

.history-list {
  flex: 1;
  overflow: auto;
  border: none;
  min-height: 0;
  height: 100%;
}

:deep(.p-listbox) {
  height: 100%;
  display: flex;
  flex-direction: column;
}

:deep(.p-listbox-list-container) {
  flex: 1;
  height: auto;
  max-height: none;
  overflow: auto;
}

:deep(.p-listbox-list) {
  max-height: none;
}

.history-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  width: 100%;
}

.item-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lang-tag {
  font-size: 0.625rem;
  font-weight: normal;
  background: var(--p-surface-200);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  margin-left: 0.25rem;
}

.item-time {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  white-space: nowrap;
}
</style>
