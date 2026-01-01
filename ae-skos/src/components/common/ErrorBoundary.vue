<script setup lang="ts">
/**
 * ErrorBoundary - Global error boundary component
 *
 * Catches unexpected JavaScript errors in child components
 * and displays a fallback UI with recovery options.
 *
 * @see /spec/common/com03-ErrorHandling.md
 */
import { ref, onErrorCaptured } from 'vue'
import Button from 'primevue/button'
import { logger } from '../../services'

const error = ref<Error | null>(null)
const errorInfo = ref('')
const showDetails = ref(false)

onErrorCaptured((err: Error, instance, info: string) => {
  error.value = err
  errorInfo.value = info

  // Log the error
  logger.error('ErrorBoundary', 'Uncaught error in component', {
    error: err.message,
    stack: err.stack,
    info,
    component: instance?.$options?.name || 'Unknown',
  })

  // Prevent propagation - we handle it here
  return false
})

function reset() {
  error.value = null
  errorInfo.value = ''
  showDetails.value = false
}

function refresh() {
  window.location.reload()
}

function reportIssue() {
  const issueUrl = 'https://github.com/cognizone/augmented-semantics/issues/new'
  const body = encodeURIComponent(
    `## Error Report\n\n**Error:** ${error.value?.message}\n\n**Info:** ${errorInfo.value}\n\n**Stack:**\n\`\`\`\n${error.value?.stack}\n\`\`\``
  )
  window.open(`${issueUrl}?body=${body}`, '_blank')
}
</script>

<template>
  <slot v-if="!error" />

  <div v-else class="error-boundary">
    <div class="error-content">
      <i class="pi pi-exclamation-triangle error-icon"></i>
      <h2>Something went wrong</h2>
      <p class="error-message">
        An unexpected error occurred. Please try again or refresh the page.
      </p>

      <div class="error-actions">
        <Button
          label="Try Again"
          icon="pi pi-refresh"
          @click="reset"
        />
        <Button
          label="Refresh Page"
          icon="pi pi-sync"
          severity="secondary"
          @click="refresh"
        />
        <Button
          label="Report Issue"
          icon="pi pi-github"
          severity="secondary"
          outlined
          @click="reportIssue"
        />
      </div>

      <div class="error-details-toggle">
        <button
          class="details-button"
          @click="showDetails = !showDetails"
        >
          {{ showDetails ? 'Hide' : 'Show' }} error details
          <i :class="showDetails ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"></i>
        </button>
      </div>

      <div v-if="showDetails" class="error-details">
        <div class="detail-section">
          <strong>Error:</strong>
          <code>{{ error?.message }}</code>
        </div>
        <div class="detail-section">
          <strong>Component Info:</strong>
          <code>{{ errorInfo }}</code>
        </div>
        <div v-if="error?.stack" class="detail-section">
          <strong>Stack Trace:</strong>
          <pre>{{ error.stack }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.error-boundary {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 2rem;
  background: var(--p-surface-50);
}

.error-content {
  max-width: 600px;
  text-align: center;
}

.error-icon {
  font-size: 4rem;
  color: var(--p-red-500);
  margin-bottom: 1rem;
}

h2 {
  margin: 0 0 0.5rem;
  font-size: 1.5rem;
  color: var(--p-text-color);
}

.error-message {
  color: var(--p-text-muted-color);
  margin-bottom: 1.5rem;
}

.error-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  flex-wrap: wrap;
  margin-bottom: 1.5rem;
}

.error-details-toggle {
  margin-bottom: 1rem;
}

.details-button {
  background: none;
  border: none;
  color: var(--p-text-muted-color);
  cursor: pointer;
  font-size: 0.875rem;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.details-button:hover {
  color: var(--p-text-color);
}

.error-details {
  text-align: left;
  background: var(--p-surface-100);
  border-radius: 0.5rem;
  padding: 1rem;
  overflow-x: auto;
}

.detail-section {
  margin-bottom: 1rem;
}

.detail-section:last-child {
  margin-bottom: 0;
}

.detail-section strong {
  display: block;
  margin-bottom: 0.25rem;
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--p-text-muted-color);
}

.detail-section code {
  display: block;
  font-family: monospace;
  font-size: 0.875rem;
  color: var(--p-red-600);
  word-break: break-word;
}

.detail-section pre {
  margin: 0;
  font-family: monospace;
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--p-text-muted-color);
  max-height: 200px;
  overflow-y: auto;
}
</style>
