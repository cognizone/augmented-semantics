<script setup lang="ts">
/**
 * HistoryDeleteDialog - History clearing confirmation dialog
 *
 * Confirmation dialog for clearing recent browsing history.
 * Uses softer styling than endpoint delete (info icon instead of warning).
 *
 * @see /spec/ae-skos/sko06-Utilities.md
 */
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'

defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  confirm: []
}>()

function handleConfirm() {
  emit('confirm')
  emit('update:visible', false)
}

function handleCancel() {
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    header="Clear History"
    :style="{ width: '400px' }"
    :modal="true"
    :closable="true"
    position="top"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="delete-confirmation">
      <i class="pi pi-info-circle info-icon"></i>
      <p>Clear all recent history?</p>
      <p class="delete-hint">Your browsing history will be removed.</p>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <Button label="Cancel" severity="secondary" text @click="handleCancel" />
        <Button label="Clear" icon="pi pi-trash" severity="danger" @click="handleConfirm" />
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

.info-icon {
  font-size: 3rem;
  color: var(--ae-accent);
}

.delete-confirmation p {
  margin: 0;
}

.delete-hint {
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
