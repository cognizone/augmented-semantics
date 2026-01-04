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
const { priorities, endpointLanguages, loadPriorities, onReorder, getLanguageCount } = useLanguagePriorities(endpointForLanguage)

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

            <div v-else>
              <p class="section-description">
                Drag to reorder. First language is used when your preferred language is unavailable.
              </p>

              <OrderList
                v-model="priorities"
                :listStyle="{ height: 'auto', maxHeight: '300px' }"
                selectionMode="single"
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

/* Step 2: Languages */
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
