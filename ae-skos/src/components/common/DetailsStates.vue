<script setup lang="ts">
/**
 * DetailsStates - Loading, empty, and error state rendering
 *
 * Shared component for consistent state handling across detail views.
 * Renders loading spinner, empty state message, or error message.
 *
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import { computed, type Ref } from 'vue'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'

interface Props {
  loading: boolean
  showLoading: boolean
  hasData: boolean
  error: string | null
  loadingText?: string
  emptyIcon?: string
  emptyTitle?: string
  emptySubtitle?: string
  elapsed?: { show: Ref<boolean>; elapsed: Ref<number> }
}

const props = withDefaults(defineProps<Props>(), {
  loadingText: 'Loading...',
  emptyIcon: 'info',
  emptyTitle: 'No data',
  emptySubtitle: '',
})

const emit = defineEmits<{
  clearError: []
}>()

// Computed to determine which state to show
const state = computed(() => {
  if (props.showLoading) return 'loading'
  if (!props.loading && !props.hasData && !props.error) return 'empty'
  if (props.error) return 'error'
  return 'content'
})
</script>

<template>
  <!-- Loading state -->
  <div v-if="state === 'loading'" class="loading-container">
    <ProgressSpinner style="width: 40px; height: 40px" />
    <span>
      {{ loadingText }}
      <template v-if="elapsed?.show.value">
        ({{ elapsed.elapsed.value }}s)
      </template>
    </span>
  </div>

  <!-- Empty state -->
  <div v-else-if="state === 'empty'" class="empty-state">
    <span class="material-symbols-outlined empty-icon">{{ emptyIcon }}</span>
    <p>{{ emptyTitle }}</p>
    <small v-if="emptySubtitle">{{ emptySubtitle }}</small>
  </div>

  <!-- Error state -->
  <Message v-else-if="state === 'error'" severity="error" :closable="true" @close="emit('clearError')">
    {{ error }}
  </Message>

  <!-- Content slot (when data is available) -->
  <slot v-else-if="state === 'content'" />
</template>

<style scoped>
.loading-container,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 2rem;
  color: var(--ae-text-secondary);
  flex: 1;
}

.empty-icon {
  font-size: 2.5rem;
  opacity: 0.5;
}

.empty-state p {
  margin: 0;
  font-weight: 500;
}

.empty-state small {
  font-size: 0.75rem;
}
</style>
