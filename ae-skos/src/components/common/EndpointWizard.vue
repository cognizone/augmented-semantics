<script setup lang="ts">
/**
 * EndpointWizard - Multi-step endpoint configuration wizard
 *
 * Combines endpoint configuration into a 3-step wizard:
 * 1. Basic Info - Name, URL, Authentication
 * 2. Capabilities - Named graphs, duplicate detection (analysis runs here)
 * 3. Languages - Language priority configuration (depends on analysis)
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import { ref, computed, watch } from 'vue'
import {
  useEndpointForm,
  useEndpointTest,
  useEndpointAnalysis,
  useLanguagePriorities,
  useEndpointCapabilities,
} from '../../composables'
import { testConnection, analyzeEndpoint } from '../../services/sparql'
import type { SPARQLEndpoint } from '../../types'

import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Stepper from 'primevue/stepper'
import StepList from 'primevue/steplist'
import StepPanels from 'primevue/steppanels'
import Step from 'primevue/step'
import StepPanel from 'primevue/steppanel'
import Select from 'primevue/select'
import Message from 'primevue/message'
import Tag from 'primevue/tag'
import Divider from 'primevue/divider'
import OrderList from 'primevue/orderlist'

const props = defineProps<{
  visible: boolean
  endpoint?: SPARQLEndpoint
  initialStep?: '1' | '2' | '3'
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  save: [endpoint: SPARQLEndpoint]
}>()

// Wizard step
const activeStep = ref('1')

// Form state (Step 1)
const { form, formValid, securityCheck, trustCheck, resetForm, loadEndpoint, useExample, buildEndpoint } = useEndpointForm()
const { testing, testResult, testConnection: testConn, clearResult } = useEndpointTest()
const { analyzing, analyzeStep, analyzeElapsed, analysisLog, reanalyzeEndpoint, clearAnalysis } = useEndpointAnalysis()

// Temp endpoint for analysis results (during wizard flow)
const tempEndpoint = ref<SPARQLEndpoint | null>(null)

// Language state (Step 2)
const endpointForLanguage = computed(() => tempEndpoint.value || props.endpoint || null)
const { priorities, endpointLanguages, loadPriorities, onReorder, getLanguageCount, getLanguageName, getPriorityLabel, getBadgeColor, removeLanguage } = useLanguagePriorities(endpointForLanguage)

// Capabilities state (Step 3)
const {
  graphStatus,
  graphSeverity,
  graphIcon,
  graphDescription,
  duplicateStatus,
  duplicateSeverity,
  duplicateIcon,
  duplicateDescription,
} = useEndpointCapabilities(endpointForLanguage)

const authOptions = [
  { label: 'None', value: 'none' },
  { label: 'Basic Auth', value: 'basic' },
  { label: 'API Key', value: 'apikey' },
  { label: 'Bearer Token', value: 'bearer' },
]

const exampleEndpoints = [
  { name: 'DBpedia', url: 'https://dbpedia.org/sparql' },
  { name: 'Wikidata', url: 'https://query.wikidata.org/sparql' },
  { name: 'EU Publications', url: 'https://publications.europa.eu/webapi/rdf/sparql' },
]

const isEditing = computed(() => !!props.endpoint)
const dialogTitle = computed(() => isEditing.value ? 'Configure Endpoint' : 'Add Endpoint')

// Watch for endpoint changes (edit mode)
watch(() => props.endpoint, (endpoint) => {
  if (endpoint) {
    loadEndpoint(endpoint)
    tempEndpoint.value = endpoint
    loadPriorities(endpoint)
  } else {
    resetForm()
    tempEndpoint.value = null
  }
}, { immediate: true })

// Handle dialog open/close
watch(() => props.visible, (visible) => {
  if (visible) {
    // Load endpoint data when opening (handles re-open with same endpoint)
    if (props.endpoint) {
      loadEndpoint(props.endpoint)
      tempEndpoint.value = props.endpoint
      loadPriorities(props.endpoint)
    }
    // Set initial step if provided
    if (props.initialStep) {
      activeStep.value = props.initialStep
    }
  } else {
    // Clear state when dialog closes
    activeStep.value = '1'
    clearResult()
    clearAnalysis()
    resetForm()
    tempEndpoint.value = null
  }
})

// Auto-trigger analysis when entering Capabilities step (step 2) for new endpoints
watch(activeStep, (newStep) => {
  if (newStep === '2' && !isEditing.value && !tempEndpoint.value?.analysis) {
    runAnalysis()
  }
})

async function handleTest() {
  const endpoint = buildEndpoint('test')
  await testConn(endpoint)
}

function handleNextFromBasicInfo(activateCallback: (step: string) => void) {
  if (!formValid.value) return

  if (isEditing.value && props.endpoint) {
    // Edit mode - preserve existing endpoint data
    tempEndpoint.value = {
      ...props.endpoint,
      name: form.name,
      url: form.url,
      auth: form.authType === 'none' ? undefined : buildEndpoint().auth,
    }
  } else {
    // Add mode - build new endpoint (analysis will auto-trigger on step 2)
    tempEndpoint.value = buildEndpoint()
  }

  activateCallback('2') // Go to Capabilities
}

async function runAnalysis() {
  if (!tempEndpoint.value) return

  analyzing.value = true
  analyzeStep.value = 'Testing connection...'

  try {
    // Step 1: Test connection
    const connectionResult = await testConnection(tempEndpoint.value)
    if (!connectionResult.success) {
      throw new Error(connectionResult.error?.message || 'Connection failed')
    }

    // Step 2: Analyze endpoint
    analyzeStep.value = 'Analyzing endpoint structure...'
    const analysis = await analyzeEndpoint(tempEndpoint.value)

    analyzeStep.value = 'Done!'

    // Store the endpoint with analysis
    tempEndpoint.value = {
      ...tempEndpoint.value,
      analysis: {
        supportsNamedGraphs: analysis.supportsNamedGraphs,
        graphCount: analysis.graphCount,
        graphCountExact: analysis.graphCountExact,
        hasDuplicateTriples: analysis.hasDuplicateTriples,
        analyzedAt: analysis.analyzedAt,
        languages: analysis.languages,
      },
    }

    // Load language priorities from analysis
    loadPriorities(tempEndpoint.value)

    // Brief delay to show "Done!"
    await new Promise(resolve => setTimeout(resolve, 500))

    analyzing.value = false
    analyzeStep.value = null
  } catch (e) {
    analyzeStep.value = `Error: ${e instanceof Error ? e.message : 'Unknown error'}`
    analyzing.value = false
  }
}

async function handleReanalyze() {
  if (!tempEndpoint.value) return

  try {
    const analysis = await reanalyzeEndpoint(tempEndpoint.value)
    tempEndpoint.value = { ...tempEndpoint.value, analysis }
    loadPriorities(tempEndpoint.value)
  } catch {
    // Error handled in composable
  }
}

function handleSave() {
  if (!tempEndpoint.value) return

  const finalEndpoint: SPARQLEndpoint = {
    ...tempEndpoint.value,
    languagePriorities: priorities.value,
  }

  emit('save', finalEndpoint)
  emit('update:visible', false)
}

function handleClose() {
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    :header="dialogTitle"
    :style="{ width: '600px' }"
    :modal="true"
    :closable="true"
    class="endpoint-wizard-dialog"
    @update:visible="$emit('update:visible', $event)"
  >
    <Stepper v-model:value="activeStep">
      <StepList>
        <Step value="1">Basic Info</Step>
        <Step value="2">Capabilities</Step>
        <Step value="3">Languages</Step>
      </StepList>

      <StepPanels>
        <!-- Step 1: Basic Info -->
        <StepPanel v-slot="{ activateCallback }" value="1">
          <div class="step-content">
            <!-- Example suggestions -->
            <div v-if="!isEditing && !form.url" class="examples-section">
              <span class="examples-label">Quick add:</span>
              <Button
                v-for="ex in exampleEndpoints"
                :key="ex.url"
                :label="ex.name"
                size="small"
                severity="secondary"
                text
                @click="useExample(ex)"
              />
            </div>

            <!-- Name -->
            <div class="form-field">
              <label for="ep-name">Name</label>
              <input
                id="ep-name"
                v-model="form.name"
                type="text"
                placeholder="My Endpoint"
                class="ae-input"
              />
            </div>

            <!-- URL -->
            <div class="form-field">
              <label for="ep-url">URL</label>
              <input
                id="ep-url"
                v-model="form.url"
                type="text"
                placeholder="https://example.org/sparql"
                class="ae-input"
                :disabled="isEditing"
              />
              <!-- Security warnings -->
              <Message
                v-if="securityCheck?.warning && !securityCheck.isHttps && !securityCheck.isLocalhost"
                severity="warn"
                :closable="false"
                class="security-warning"
              >
                {{ securityCheck.warning }}
              </Message>
              <div v-if="trustCheck" class="trust-indicator">
                <Tag
                  :severity="trustCheck.level === 'trusted' ? 'success' : trustCheck.level === 'warning' ? 'warn' : 'secondary'"
                >
                  {{ trustCheck.level === 'trusted' ? 'Trusted' : trustCheck.level === 'warning' ? 'Warning' : 'Unknown' }}
                </Tag>
                <span v-if="trustCheck.reasons.length" class="trust-reason">
                  {{ trustCheck.reasons[0] }}
                </span>
              </div>
            </div>

            <Divider />

            <!-- Authentication -->
            <div class="form-field">
              <label for="ep-auth">Authentication</label>
              <Select
                id="ep-auth"
                v-model="form.authType"
                :options="authOptions"
                optionLabel="label"
                optionValue="value"
              />
            </div>

            <!-- Basic Auth -->
            <template v-if="form.authType === 'basic'">
              <div class="form-row">
                <div class="form-field">
                  <label for="ep-user">Username</label>
                  <input id="ep-user" v-model="form.username" type="text" class="ae-input" />
                </div>
                <div class="form-field">
                  <label for="ep-pass">Password</label>
                  <input id="ep-pass" v-model="form.password" type="password" class="ae-input" />
                </div>
              </div>
            </template>

            <!-- API Key -->
            <template v-if="form.authType === 'apikey'">
              <div class="form-row">
                <div class="form-field">
                  <label for="ep-header">Header Name</label>
                  <input id="ep-header" v-model="form.headerName" type="text" class="ae-input" />
                </div>
                <div class="form-field">
                  <label for="ep-apikey">API Key</label>
                  <input id="ep-apikey" v-model="form.apiKey" type="password" class="ae-input" />
                </div>
              </div>
            </template>

            <!-- Bearer Token -->
            <template v-if="form.authType === 'bearer'">
              <div class="form-field">
                <label for="ep-token">Token</label>
                <input id="ep-token" v-model="form.token" type="password" class="ae-input" />
              </div>
            </template>

            <!-- Test Result -->
            <Transition name="fade">
              <Message
                v-if="testResult"
                :severity="testResult.success ? 'success' : 'error'"
                :closable="false"
                class="test-result"
              >
                {{ testResult.message }}
              </Message>
            </Transition>
          </div>

          <div class="step-footer">
            <Button
              label="Test Connection"
              icon="pi pi-sync"
              severity="secondary"
              outlined
              :loading="testing"
              :disabled="!formValid"
              @click="handleTest"
            />
            <div class="footer-right">
              <Button
                label="Cancel"
                severity="secondary"
                text
                @click="handleClose"
              />
              <Button
                label="Next"
                icon="pi pi-arrow-right"
                iconPos="right"
                :disabled="!formValid"
                @click="handleNextFromBasicInfo(activateCallback)"
              />
            </div>
          </div>
        </StepPanel>

        <!-- Step 2: Capabilities (analysis runs here) -->
        <StepPanel v-slot="{ activateCallback }" value="2">
          <div class="step-content">
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
              <div v-if="tempEndpoint?.analysis?.analyzedAt && analysisLog.length === 0" class="capabilities-footer">
                <span class="capabilities-timestamp">
                  Analyzed: {{ new Date(tempEndpoint.analysis.analyzedAt).toLocaleString() }}
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
                @click="activateCallback('1')"
              />
              <Button
                label="Re-analyze"
                icon="pi pi-refresh"
                severity="secondary"
                outlined
                :loading="analyzing"
                @click="handleReanalyze"
              />
            </div>
            <Button
              label="Next"
              icon="pi pi-arrow-right"
              iconPos="right"
              :disabled="analyzing"
              @click="activateCallback('3')"
            />
          </div>
        </StepPanel>

        <!-- Step 3: Languages (depends on analysis) -->
        <StepPanel v-slot="{ activateCallback }" value="3">
          <div class="step-content">
            <div v-if="!endpointLanguages.length" class="no-languages">
              <span class="material-symbols-outlined">info</span>
              <p>No languages detected.</p>
              <p class="hint">Go back to Capabilities and click "Re-analyze" to detect languages.</p>
            </div>

            <div v-else class="language-priority-section">
              <div class="priority-header">
                <span class="priority-label">Priority Order</span>
                <span class="drag-hint">Drag to reorder</span>
              </div>

              <OrderList
                v-model="priorities"
                :listStyle="{ height: 'auto', maxHeight: '300px' }"
                @reorder="onReorder"
                class="language-order-list"
              >
                <template #item="{ item, index }">
                  <div class="language-item">
                    <span class="material-symbols-outlined drag-handle">drag_indicator</span>
                    <div class="language-badge" :class="getBadgeColor(index).bg">
                      {{ item }}
                    </div>
                    <div class="language-info">
                      <span class="language-name">{{ getLanguageName(item) }}</span>
                      <span class="language-priority">{{ getPriorityLabel(index) }}</span>
                    </div>
                    <span v-if="getLanguageCount(item)" class="language-count">
                      {{ getLanguageCount(item)?.toLocaleString() }} labels
                    </span>
                    <button
                      class="delete-btn"
                      aria-label="Remove language"
                      @click.stop="removeLanguage(item)"
                    >
                      <span class="material-symbols-outlined">delete</span>
                    </button>
                  </div>
                </template>
              </OrderList>

              <!-- Info box -->
              <div class="language-info-box">
                <span class="material-symbols-outlined">info</span>
                <p>Concepts without labels in your preferred languages will fallback to display the URI or any available label found in the dataset.</p>
              </div>
            </div>
          </div>

          <div class="step-footer">
            <Button
              label="Back"
              icon="pi pi-arrow-left"
              severity="secondary"
              outlined
              @click="activateCallback('2')"
            />
            <Button
              :label="isEditing ? 'Save' : 'Add Endpoint'"
              icon="pi pi-check"
              @click="handleSave"
            />
          </div>
        </StepPanel>
      </StepPanels>
    </Stepper>
  </Dialog>
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

.footer-right {
  display: flex;
  gap: 0.5rem;
}

.footer-left {
  display: flex;
  gap: 0.5rem;
}

/* Step 1: Basic Info */
.examples-section {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: var(--p-content-hover-background);
  border-radius: var(--p-border-radius);
  flex-wrap: wrap;
}

.examples-label {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  font-weight: 500;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.form-field label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--p-text-color);
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.security-warning {
  margin-top: 0.5rem;
}

.trust-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.trust-reason {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.test-result {
  margin-top: 0.5rem;
}

.progress-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--p-content-hover-background);
  border-radius: var(--p-border-radius);
}

.progress-indicator i {
  font-size: 1rem;
}

.success-icon {
  color: var(--p-green-500);
}

.error-icon {
  color: var(--p-red-500);
}

.error-text {
  color: var(--p-red-500);
}

.elapsed-time {
  color: var(--p-text-muted-color);
  font-size: 0.875rem;
  margin-left: 0.25rem;
}

/* Step 3: Languages */
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

.priority-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.priority-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--ae-text-primary);
}

.drag-hint {
  font-size: 0.75rem;
  color: var(--ae-text-muted);
  background: var(--ae-bg-hover);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

/* Hide OrderList default buttons */
.language-order-list :deep(.p-orderlist-controls) {
  display: none;
}

.language-order-list :deep(.p-orderlist-list) {
  padding: 0;
  gap: 0.5rem;
}

.language-order-list :deep(.p-orderlist-item) {
  padding: 0;
  background: var(--ae-bg-hover);
  border: 1px solid var(--ae-border-color);
  border-radius: 8px;
  transition: all 0.15s ease;
}

.language-order-list :deep(.p-orderlist-item:hover) {
  border-color: var(--ae-accent);
  background: var(--ae-bg-elevated);
}

.language-order-list :deep(.p-orderlist-item.p-highlight) {
  background: var(--ae-bg-elevated);
  border-color: var(--ae-accent);
}

.language-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  cursor: move;
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

.delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.375rem;
  background: none;
  border: none;
  border-radius: 6px;
  color: var(--ae-text-muted);
  cursor: pointer;
  transition: all 0.15s;
}

.delete-btn:hover {
  color: var(--ae-status-error);
  background: rgba(239, 68, 68, 0.1);
}

.delete-btn .material-symbols-outlined {
  font-size: 1.25rem;
}

.language-info-box {
  display: flex;
  gap: 0.75rem;
  padding: 1rem;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 8px;
}

.language-info-box .material-symbols-outlined {
  color: var(--ae-accent);
  font-size: 1.25rem;
  flex-shrink: 0;
}

.language-info-box p {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--ae-text-secondary);
  line-height: 1.5;
}

/* Step 3: Capabilities */
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

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

</style>
