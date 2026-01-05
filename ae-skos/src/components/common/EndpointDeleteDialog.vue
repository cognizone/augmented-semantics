<script setup lang="ts">
/**
 * EndpointDeleteDialog - Endpoint deletion confirmation dialog
 *
 * Simple confirmation dialog for deleting SPARQL endpoints.
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import type { SPARQLEndpoint } from '../../types'

import Dialog from 'primevue/dialog'
import Button from 'primevue/button'

const props = defineProps<{
  visible: boolean
  endpoint: SPARQLEndpoint | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  confirm: [endpoint: SPARQLEndpoint]
}>()

function handleConfirm() {
  if (props.endpoint) {
    emit('confirm', props.endpoint)
  }
  emit('update:visible', false)
}

function handleCancel() {
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    header="Delete Endpoint"
    :style="{ width: '400px' }"
    :modal="true"
    :closable="true"
    position="top"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="delete-confirmation">
      <i class="pi pi-exclamation-triangle warning-icon"></i>
      <p>Are you sure you want to delete <strong>{{ endpoint?.name }}</strong>?</p>
      <p class="delete-warning">This action cannot be undone.</p>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <Button
          label="Cancel"
          severity="secondary"
          text
          @click="handleCancel"
        />
        <Button
          label="Delete"
          icon="pi pi-trash"
          severity="danger"
          @click="handleConfirm"
        />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.delete-confirmation {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  text-align: center;
}

.warning-icon {
  font-size: 3rem;
  color: var(--p-orange-500);
}

.delete-confirmation p {
  margin: 0;
}

.delete-warning {
  font-size: 0.875rem;
  color: var(--p-text-muted-color);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  width: 100%;
}
</style>
