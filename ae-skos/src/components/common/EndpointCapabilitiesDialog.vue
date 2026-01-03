<script setup lang="ts">
/**
 * EndpointCapabilitiesDialog - SPARQL endpoint capabilities viewer
 *
 * Displays endpoint capabilities and allows re-analysis:
 * - Named graph support
 * - Duplicate triple detection
 * - Analysis log with progress
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import { ref, watch } from 'vue'
import { useEndpointAnalysis, useEndpointCapabilities } from '../../composables'
import type { SPARQLEndpoint } from '../../types'

import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Tag from 'primevue/tag'

const props = defineProps<{
  visible: boolean
  endpoint: SPARQLEndpoint | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  analyzed: [endpoint: SPARQLEndpoint, analysis: SPARQLEndpoint['analysis']]
}>()

const endpointRef = ref(props.endpoint)
const { analyzing, analyzeElapsed, analysisLog, analysisDuration, reanalyzeEndpoint: reanalyze, clearAnalysis } = useEndpointAnalysis()
const {
  graphStatus,
  graphSeverity,
  graphIcon,
  graphDescription,
  duplicateStatus,
  duplicateSeverity,
  duplicateIcon,
  duplicateDescription,
} = useEndpointCapabilities(endpointRef)

// Watch for endpoint changes
watch(() => props.endpoint, (endpoint) => {
  endpointRef.value = endpoint
  clearAnalysis()
}, { immediate: true })

// Clear analysis log when dialog closes
watch(() => props.visible, (visible) => {
  if (!visible) {
    clearAnalysis()
  }
})

async function handleReanalyze() {
  if (!props.endpoint) return

  try {
    const analysis = await reanalyze(props.endpoint)
    emit('analyzed', props.endpoint, analysis)

    // Update the ref so capabilities display refreshes
    endpointRef.value = { ...props.endpoint, analysis }
  } catch (e) {
    // Error already logged in composable
  }
}

function handleClose() {
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    :header="`SPARQL Capabilities - ${endpoint?.name || ''}`"
    :style="{ width: '500px' }"
    :modal="true"
    :closable="true"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="capabilities-info">
      <!-- Named Graphs -->
      <div class="capability-item">
        <div class="capability-row">
          <i :class="graphIcon"></i>
          <span class="capability-label">Named Graphs</span>
          <Tag :severity="graphSeverity">{{ graphStatus }}</Tag>
        </div>
        <p v-if="graphDescription" class="capability-description">
          {{ graphDescription }}
        </p>
      </div>

      <!-- Duplicate Triples -->
      <div class="capability-item">
        <div class="capability-row">
          <i :class="duplicateIcon"></i>
          <span class="capability-label">Duplicate Triples</span>
          <Tag :severity="duplicateSeverity">{{ duplicateStatus }}</Tag>
        </div>
        <p v-if="duplicateDescription" class="capability-description">
          {{ duplicateDescription }}
        </p>
      </div>

      <!-- Analysis Log -->
      <div v-if="analysisLog.length > 0" class="analysis-log">
        <div v-if="analyzing && analyzeElapsed.show.value" class="elapsed-indicator">
          Analyzing... ({{ analyzeElapsed.elapsed.value }}s)
        </div>
        <div
          v-for="(entry, index) in analysisLog"
          :key="index"
          class="log-entry"
          :class="entry.status"
        >
          <i v-if="entry.status === 'pending'" class="pi pi-spin pi-spinner"></i>
          <i v-else-if="entry.status === 'success'" class="pi pi-check-circle"></i>
          <i v-else-if="entry.status === 'warning'" class="pi pi-exclamation-triangle"></i>
          <i v-else-if="entry.status === 'error'" class="pi pi-times-circle"></i>
          <i v-else class="pi pi-info-circle"></i>
          <span>{{ entry.message }}</span>
        </div>
      </div>

      <!-- Analysis Timestamp -->
      <div v-if="endpoint?.analysis?.analyzedAt && analysisLog.length === 0" class="capabilities-footer">
        <span class="capabilities-timestamp">
          Analyzed: {{ new Date(endpoint.analysis.analyzedAt).toLocaleString() }}
          <span v-if="analysisDuration !== null" class="analysis-duration">({{ analysisDuration }}s)</span>
        </span>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <Button
          label="Re-analyze"
          icon="pi pi-refresh"
          severity="secondary"
          outlined
          :loading="analyzing"
          @click="handleReanalyze"
        />
        <Button
          label="Close"
          severity="secondary"
          @click="handleClose"
        />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.capabilities-info {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.capability-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--p-content-hover-background);
  border-radius: var(--p-border-radius);
}

.capability-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.capability-row i {
  font-size: 1.25rem;
}

.capability-label {
  font-weight: 500;
  flex: 1;
}

.capability-description {
  margin: 0;
  font-size: 0.875rem;
  color: var(--p-text-muted-color);
  margin-left: 2rem;
}

.analysis-log {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--p-content-hover-background);
  border-radius: var(--p-border-radius);
  font-size: 0.875rem;
}

.elapsed-indicator {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  text-align: right;
  margin-bottom: 0.25rem;
}

.log-entry {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.log-entry.success {
  color: var(--p-green-600);
}

.log-entry.warning {
  color: var(--p-orange-600);
}

.log-entry.error {
  color: var(--p-red-600);
}

.log-entry.info {
  color: var(--p-blue-600);
}

.capabilities-footer {
  display: flex;
  justify-content: center;
  padding-top: 0.5rem;
  border-top: 1px solid var(--p-content-border-color);
}

.capabilities-timestamp {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.analysis-duration {
  margin-left: 0.5rem;
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  width: 100%;
}

/* Icon colors */
.success-icon {
  color: var(--p-green-500);
}

.warning-icon {
  color: var(--p-orange-500);
}

.muted-icon {
  color: var(--p-text-muted-color);
}
</style>
