<script setup lang="ts">
/**
 * RecentHistory - Recently viewed concepts and schemes
 *
 * Displays the last 50 items viewed with relative timestamps.
 * Persisted across sessions in localStorage.
 *
 * @see /spec/ae-skos/sko06-Utilities.md
 */
import { computed } from 'vue'
import { useConceptStore } from '../../stores'
import { useLabelResolver } from '../../composables'
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
        <span class="material-symbols-outlined header-icon">history</span>
        Recent
      </span>
      <button
        v-if="hasHistory"
        class="clear-btn"
        title="Clear history"
        @click="clearHistory"
      >
        <span class="material-symbols-outlined icon-sm">delete</span>
      </button>
    </div>

    <div v-if="!hasHistory" class="empty-state">
      <small>No recent items</small>
    </div>

    <Listbox
      v-else
      :options="history"
      optionLabel="label"
      class="history-list"
      scrollHeight="100%"
      @change="(e) => e.value && selectItem(e.value)"
    >
      <template #option="slotProps">
        <div class="history-item">
          <span
            class="material-symbols-outlined item-icon"
            :class="slotProps.option.type === 'scheme' ? 'icon-folder' : (slotProps.option.hasNarrower ? 'icon-label' : 'icon-leaf')"
          >{{ slotProps.option.type === 'scheme' ? 'folder' : (slotProps.option.hasNarrower ? 'label' : 'circle') }}</span>
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
  min-height: 0;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  border-bottom: 1px solid var(--ae-border-color);
}

.header-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
  font-size: 0.875rem;
  color: var(--ae-text-primary);
}

.header-icon {
  font-size: 16px;
  color: var(--ae-text-secondary);
}

.clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--ae-text-secondary);
  transition: background-color 0.15s, color 0.15s;
}

.clear-btn:hover {
  background: var(--ae-bg-hover);
  color: var(--ae-text-primary);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  color: var(--ae-text-secondary);
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
  background: transparent;
  border: none;
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
  align-items: center;
  gap: 0.5rem;
  width: 100%;
}

.item-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.item-label {
  flex: 1;
  font-size: 0.875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-time {
  font-size: 0.7rem;
  color: var(--ae-text-secondary);
  white-space: nowrap;
  margin-left: auto;
}
</style>
