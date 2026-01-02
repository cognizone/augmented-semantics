<script setup lang="ts">
/**
 * EndpointLanguageDialog - Language priority configuration dialog
 *
 * Allows users to reorder language preferences for label resolution.
 * Languages are detected during endpoint analysis.
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import { ref, watch } from 'vue'
import { useLanguagePriorities } from '../../composables'
import type { SPARQLEndpoint } from '../../types'

import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import OrderList from 'primevue/orderlist'

const props = defineProps<{
  visible: boolean
  endpoint: SPARQLEndpoint | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  save: [endpoint: SPARQLEndpoint, priorities: string[]]
}>()

const endpointRef = ref(props.endpoint)
const { priorities, endpointLanguages, loadPriorities, onReorder, getLanguageCount } = useLanguagePriorities(endpointRef)

// Watch for endpoint changes
watch(() => props.endpoint, (endpoint) => {
  endpointRef.value = endpoint
  if (endpoint) {
    loadPriorities(endpoint)
  }
}, { immediate: true })

function handleSave() {
  if (props.endpoint) {
    emit('save', props.endpoint, priorities.value)
  }
  emit('update:visible', false)
}

function handleClose() {
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    :header="`Language Priority - ${endpoint?.name || ''}`"
    :style="{ width: '450px' }"
    :modal="true"
    :closable="true"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="language-settings">
      <div v-if="!endpointLanguages.length" class="no-languages">
        <i class="pi pi-info-circle"></i>
        <p>No languages detected.</p>
        <p class="hint">Run "Re-analyze" from SPARQL Capabilities to detect languages.</p>
      </div>

      <div v-else>
        <p class="section-description">
          Use the buttons to reorder. First language is used when preferred is unavailable.
        </p>

        <OrderList
          v-model="priorities"
          :listStyle="{ height: 'auto', maxHeight: '350px' }"
          @reorder="onReorder"
        >
          <template #item="{ item, index }">
            <div class="language-item">
              <span class="language-rank">{{ index + 1 }}.</span>
              <span class="language-code">{{ item }}</span>
              <span v-if="getLanguageCount(item)" class="language-count">
                ({{ getLanguageCount(item)?.toLocaleString() }})
              </span>
            </div>
          </template>
        </OrderList>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <Button
          label="Cancel"
          severity="secondary"
          text
          @click="handleClose"
        />
        <Button
          label="Save"
          icon="pi pi-check"
          :disabled="!priorities.length"
          @click="handleSave"
        />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.language-settings {
  min-height: 200px;
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

.no-languages i {
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

.section-description {
  font-size: 0.875rem;
  color: var(--p-text-muted-color);
  margin: 0 0 1rem 0;
}

.language-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
}

.language-rank {
  font-weight: 600;
  color: var(--p-text-muted-color);
  min-width: 2rem;
}

.language-code {
  font-weight: 500;
}

.language-count {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  margin-left: auto;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  width: 100%;
}
</style>
