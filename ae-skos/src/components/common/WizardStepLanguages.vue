<script setup lang="ts">
/**
 * WizardStepLanguages - Step 3 of the endpoint wizard
 *
 * Allows drag-and-drop reordering of language priorities.
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import Button from 'primevue/button'
import draggable from 'vuedraggable'

export interface LanguageInfo {
  lang: string
  count?: number
}

const props = defineProps<{
  priorities: string[]
  endpointLanguages: LanguageInfo[]
  isEditing: boolean
  // Helper functions passed from parent
  getLanguageName: (lang: string) => string
  getLanguageCount: (lang: string) => number | undefined
  getPriorityLabel: (index: number) => string
  getBadgeColor: (index: number) => { bg: string; text: string }
}>()

const emit = defineEmits<{
  'update:priorities': [priorities: string[]]
  save: []
  back: []
}>()

// v-model wrapper for draggable
const prioritiesModel = {
  get: () => props.priorities,
  set: (value: string[]) => emit('update:priorities', value),
}
</script>

<template>
  <div class="step-content">
    <div v-if="!endpointLanguages.length" class="no-languages">
      <span class="material-symbols-outlined">info</span>
      <p>No languages detected.</p>
      <p class="hint">Go back to Capabilities and click "Re-analyze" to detect languages.</p>
    </div>

    <div v-else class="language-priority-section">
      <div class="drag-hint">
        <span class="material-symbols-outlined">drag_indicator</span>
        <span>Drag items to set language priority. The first language is used when your preferred language isn't available.</span>
      </div>

      <draggable
        :modelValue="prioritiesModel.get()"
        item-key="id"
        handle=".drag-handle"
        class="language-list"
        :component-data="{ class: 'language-list-inner' }"
        @update:modelValue="prioritiesModel.set($event)"
      >
        <template #item="{ element, index }">
          <div class="language-item">
            <span class="material-symbols-outlined drag-handle">drag_indicator</span>
            <div class="language-badge" :class="getBadgeColor(index).bg">
              {{ element }}
            </div>
            <div class="language-info">
              <span class="language-name">{{ getLanguageName(element) }}</span>
              <span class="language-priority">{{ getPriorityLabel(index) }}</span>
            </div>
            <span v-if="getLanguageCount(element)" class="language-count">
              {{ getLanguageCount(element)?.toLocaleString() }} labels
            </span>
          </div>
        </template>
      </draggable>
    </div>
  </div>

  <div class="step-footer">
    <Button
      label="Back"
      icon="pi pi-arrow-left"
      severity="secondary"
      outlined
      @click="$emit('back')"
    />
    <Button
      :label="isEditing ? 'Save' : 'Add Endpoint'"
      icon="pi pi-check"
      @click="$emit('save')"
    />
  </div>
</template>

<style scoped>
.step-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 300px;
  padding: 1rem 0;
}

.step-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 1rem;
  border-top: 1px solid var(--p-content-border-color);
  margin-top: 1rem;
}

.no-languages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem;
  color: var(--p-text-muted-color);
  text-align: center;
}

.no-languages .material-symbols-outlined {
  font-size: 2rem;
  opacity: 0.5;
}

.no-languages p {
  margin: 0;
}

.hint {
  font-size: 0.75rem;
  font-style: italic;
}

.language-priority-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.drag-hint {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--ae-bg-hover);
  border: 1px solid var(--ae-border-color);
  border-radius: 6px;
  font-size: 0.8125rem;
  color: var(--ae-text-secondary);
  line-height: 1.4;
}

.drag-hint .material-symbols-outlined {
  font-size: 1.125rem;
  color: var(--ae-text-muted);
  flex-shrink: 0;
  margin-top: 0.0625rem;
}

/* Draggable language list */
.language-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.language-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--ae-bg-hover);
  border: 1px solid var(--ae-border-color);
  border-radius: 8px;
  transition: all 0.15s ease;
}

.language-item:hover {
  border-color: var(--ae-accent);
  background: var(--ae-bg-elevated);
}

.drag-handle {
  font-size: 1.25rem;
  color: var(--ae-text-muted);
  cursor: grab;
  transition: color 0.15s;
}

.language-item:hover .drag-handle {
  color: var(--ae-accent);
}

.language-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

/* Badge colors */
.language-badge.bg-blue {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.language-badge.bg-purple {
  background: rgba(168, 85, 247, 0.15);
  color: #a855f7;
  border: 1px solid rgba(168, 85, 247, 0.3);
}

.language-badge.bg-orange {
  background: rgba(249, 115, 22, 0.15);
  color: #f97316;
  border: 1px solid rgba(249, 115, 22, 0.3);
}

.language-badge.bg-green {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.language-badge.bg-pink {
  background: rgba(236, 72, 153, 0.15);
  color: #ec4899;
  border: 1px solid rgba(236, 72, 153, 0.3);
}

.language-badge.bg-cyan {
  background: rgba(6, 182, 212, 0.15);
  color: #06b6d4;
  border: 1px solid rgba(6, 182, 212, 0.3);
}

.language-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.language-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--ae-text-primary);
}

.language-priority {
  font-size: 0.75rem;
  color: var(--ae-text-muted);
}

.language-count {
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
  white-space: nowrap;
}
</style>
