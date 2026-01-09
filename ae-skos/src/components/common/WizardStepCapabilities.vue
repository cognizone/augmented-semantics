<script setup lang="ts">
/**
 * WizardStepCapabilities - Step 2 of the endpoint wizard
 *
 * Displays endpoint analysis results: graph support and SKOS graphs.
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import type { AnalysisLogEntry } from '../../composables/useEndpointAnalysis'
import Button from 'primevue/button'
import Tag from 'primevue/tag'

defineProps<{
  // Capability display
  graphSupportStatus: string
  graphSupportSeverity: 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' | undefined
  graphSupportIcon: string
  graphSupportDescription: string | null
  skosGraphStatus: string
  skosGraphSeverity: 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' | undefined
  skosGraphIcon: string
  skosGraphDescription: string | null
  // Analysis state
  analyzing: boolean
  analyzeElapsedShow: boolean
  analyzeElapsedValue: number
  analysisLog: AnalysisLogEntry[]
  analyzedAt: string | null
}>()

defineEmits<{
  reanalyze: []
  next: []
  back: []
}>()

// Map status to icon class
const logIconClass = (status: string) => ({
  pending: 'pi pi-spin pi-spinner',
  success: 'pi pi-check-circle',
  warning: 'pi pi-exclamation-triangle',
  error: 'pi pi-times-circle',
}[status] || 'pi pi-info-circle')
</script>

<template>
  <div class="step-content">
    <div class="capabilities-info">
      <!-- Graph Support (Yes/No) -->
      <div class="capability-item">
        <div class="capability-row">
          <i :class="graphSupportIcon"></i>
          <span class="capability-label">Graph Support</span>
          <Tag :severity="graphSupportSeverity">{{ graphSupportStatus }}</Tag>
        </div>
        <p v-if="graphSupportDescription" class="capability-description">
          {{ graphSupportDescription }}
        </p>
      </div>

      <!-- SKOS Graphs (count) -->
      <div class="capability-item">
        <div class="capability-row">
          <i :class="skosGraphIcon"></i>
          <span class="capability-label">SKOS Graphs</span>
          <Tag :severity="skosGraphSeverity">{{ skosGraphStatus }}</Tag>
        </div>
        <p v-if="skosGraphDescription" class="capability-description">
          {{ skosGraphDescription }}
        </p>
      </div>

      <!-- Analysis Log -->
      <div v-if="analysisLog.length > 0" class="analysis-log">
        <div v-if="analyzing && analyzeElapsedShow" class="elapsed-indicator">
          Analyzing... ({{ analyzeElapsedValue }}s)
        </div>
        <div
          v-for="(entry, index) in analysisLog"
          :key="index"
          class="log-entry"
          :class="entry.status"
        >
          <i :class="logIconClass(entry.status)"></i>
          <span>{{ entry.message }}</span>
        </div>
      </div>

      <!-- Analysis Timestamp -->
      <div v-if="analyzedAt && analysisLog.length === 0" class="capabilities-footer">
        <span class="capabilities-timestamp">
          Analyzed: {{ new Date(analyzedAt).toLocaleString() }}
        </span>
      </div>
    </div>
  </div>

  <div class="step-footer">
    <div class="footer-left">
      <Button
        label="Back"
        icon="pi pi-arrow-left"
        severity="secondary"
        outlined
        @click="$emit('back')"
      />
      <Button
        label="Re-analyze"
        icon="pi pi-refresh"
        severity="secondary"
        outlined
        :loading="analyzing"
        @click="$emit('reanalyze')"
      />
    </div>
    <Button
      label="Next"
      icon="pi pi-arrow-right"
      iconPos="right"
      :disabled="analyzing"
      @click="$emit('next')"
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

.footer-left {
  display: flex;
  gap: 0.5rem;
}

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
</style>
