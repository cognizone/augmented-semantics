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
import { ref, computed, watch, nextTick } from 'vue'
import {
  useEndpointForm,
  useEndpointTest,
  useEndpointAnalysis,
  useLanguagePriorities,
  useEndpointCapabilities,
} from '../../composables'
import { testConnection, analyzeEndpoint } from '../../services/sparql'
import { getConfigStatus } from '../../utils'
import type { SPARQLEndpoint } from '../../types'
import type { BasicInfoForm } from './WizardStepBasicInfo.vue'

import Dialog from 'primevue/dialog'
import Stepper from 'primevue/stepper'
import StepList from 'primevue/steplist'
import StepPanels from 'primevue/steppanels'
import Step from 'primevue/step'
import StepPanel from 'primevue/steppanel'

import WizardStepBasicInfo from './WizardStepBasicInfo.vue'
import WizardStepCapabilities from './WizardStepCapabilities.vue'
import WizardStepLanguages from './WizardStepLanguages.vue'

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
const activeStep = ref<'1' | '2' | '3'>('1')

// Form state (Step 1)
const { form, formValid, securityCheck, trustCheck, resetForm, loadEndpoint, buildEndpoint } = useEndpointForm()
const { testing, testResult, testConnection: testConn, clearResult } = useEndpointTest()
const { analyzing, analyzeStep, analyzeElapsed, analysisLog, reanalyzeEndpoint, clearAnalysis } = useEndpointAnalysis()

// Temp endpoint for analysis results (during wizard flow)
const tempEndpoint = ref<SPARQLEndpoint | null>(null)

// Language state (Step 3)
const endpointForLanguage = computed(() => tempEndpoint.value || props.endpoint || null)
const { priorities, endpointLanguages, loadPriorities, getLanguageCount, getLanguageName, getPriorityLabel, getBadgeColor } = useLanguagePriorities(endpointForLanguage)

// Capabilities state (Step 2)
const {
  skosContentStatus,
  skosContentSeverity,
  skosContentIcon,
  skosContentDescription,
  graphSupportStatus,
  graphSupportSeverity,
  graphSupportIcon,
  graphSupportDescription,
  skosGraphStatus,
  skosGraphSeverity,
  skosGraphIcon,
  skosGraphDescription,
  schemeCountStatus,
  schemeCountSeverity,
  schemeCountIcon,
  schemeCountDescription,
  conceptCountStatus,
  conceptCountSeverity,
  conceptCountIcon,
  conceptCountDescription,
  relationshipsStatus,
  relationshipsSeverity,
  relationshipsIcon,
  relationshipsDescription,
} = useEndpointCapabilities(endpointForLanguage)

const isEditing = computed(() => !!props.endpoint)
const dialogTitle = computed(() => isEditing.value ? 'Configure Endpoint' : 'Add Endpoint')
const corsIssue = computed(() => statusEndpoint.value?.analysis?.cors === false)
const schemeUriMismatch = computed(
  () => statusEndpoint.value?.analysis?.schemeUriSlashMismatch === true
)
const statusEndpoint = computed(() => tempEndpoint.value || props.endpoint || null)
const configStatus = computed(() => {
  const endpoint = statusEndpoint.value
  const isTemp = endpoint === tempEndpoint.value
  // In wizard, pass additional language count from priorities state
  const additionalLanguageCount = isTemp ? priorities.value.length : 0
  return getConfigStatus(endpoint, { additionalLanguageCount })
})

// Computed form object for step component
const formData = computed<BasicInfoForm>(() => ({
  name: form.name,
  url: form.url,
  authType: form.authType,
  username: form.username,
  password: form.password,
  headerName: form.headerName,
  apiKey: form.apiKey,
  token: form.token,
}))

const isHydrating = ref(false)

// Watch for endpoint changes (edit mode)
watch(() => props.endpoint, (endpoint) => {
  if (endpoint) {
    isHydrating.value = true
    loadEndpoint(endpoint)
    tempEndpoint.value = endpoint
    loadPriorities(endpoint)
    nextTick(() => {
      isHydrating.value = false
    })
  } else {
    resetForm()
    tempEndpoint.value = null
  }
}, { immediate: true })

watch(() => props.endpoint?.id, (id) => {
  if (id && tempEndpoint.value) {
    tempEndpoint.value = {
      ...tempEndpoint.value,
      id,
    }
  }
})

const lastAnalyzedKey = ref<string | null>(null)

function getAnalysisKey() {
  const authKey = JSON.stringify({
    type: form.authType,
    username: form.username,
    password: form.password,
    apiKey: form.apiKey,
    headerName: form.headerName,
    token: form.token,
  })
  return `${form.url}::${authKey}`
}

watch(
  () => [
    form.url,
    form.authType,
    form.username,
    form.password,
    form.apiKey,
    form.headerName,
    form.token,
  ],
  () => {
    if (isHydrating.value) return
    lastAnalyzedKey.value = null
    if (tempEndpoint.value?.analysis) {
      tempEndpoint.value = {
        ...tempEndpoint.value,
        analysis: undefined,
      }
    }
  }
)

// Handle dialog open/close
watch(() => props.visible, (visible) => {
  if (visible) {
    isHydrating.value = true
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
    nextTick(() => {
      isHydrating.value = false
    })
  } else {
    // Clear state when dialog closes
    activeStep.value = '1'
    clearResult()
    clearAnalysis()
    resetForm()
    tempEndpoint.value = null
  }
})

function buildAutosaveEndpoint(): SPARQLEndpoint | null {
  if (!formValid.value) return null

  const base = tempEndpoint.value || props.endpoint || buildEndpoint()
  const auth = form.authType === 'none' ? undefined : buildEndpoint().auth
  const languagePriorities = priorities.value.length > 0
    ? priorities.value
    : base.languagePriorities

  return {
    ...base,
    name: form.name,
    url: form.url,
    auth,
    languagePriorities,
  }
}

function autosaveEndpoint() {
  const endpoint = buildAutosaveEndpoint()
  if (!endpoint) return
  tempEndpoint.value = endpoint
  emit('save', endpoint)
}

watch(
  () => [
    form.name,
    form.url,
    form.authType,
    form.username,
    form.password,
    form.headerName,
    form.apiKey,
    form.token,
    priorities.value.slice(),
  ],
  () => {
    autosaveEndpoint()
  },
  { deep: true }
)

watch(
  () => tempEndpoint.value?.analysis,
  () => {
    autosaveEndpoint()
  }
)

watch(
  () => [formValid.value, form.url, form.authType, form.username, form.password, form.apiKey, form.headerName, form.token] as const,
  ([isValid, url]) => {
    if (!isValid || !url.trim()) return
    if (analyzing.value) return
    if (isHydrating.value) return
    if (trustCheck.value?.level === 'trusted' && tempEndpoint.value?.analysis) return
    const key = getAnalysisKey()
    if (lastAnalyzedKey.value === key) return

    const endpoint = buildAutosaveEndpoint()
    if (!endpoint) return
    tempEndpoint.value = endpoint
    lastAnalyzedKey.value = key
    runAnalysis()
  }
)

// Auto-trigger analysis when entering Capabilities step (step 2) for new endpoints
watch(activeStep, (newStep) => {
  if (newStep === '2' && !isEditing.value && !tempEndpoint.value?.analysis) {
    runAnalysis()
  }
})

// Step 1 handlers
function handleFormUpdate(newForm: BasicInfoForm) {
  form.name = newForm.name
  form.url = newForm.url
  form.authType = newForm.authType
  form.username = newForm.username
  form.password = newForm.password
  form.headerName = newForm.headerName
  form.apiKey = newForm.apiKey
  form.token = newForm.token
}

async function handleTest() {
  const endpoint = buildEndpoint('test')
  const result = await testConn(endpoint)
  if (!tempEndpoint.value) {
    tempEndpoint.value = buildEndpoint()
  }
  tempEndpoint.value = {
    ...tempEndpoint.value,
    lastTestStatus: result.success ? 'success' : 'error',
    lastTestedAt: new Date().toISOString(),
    lastTestErrorCode: result.success ? undefined : result.errorCode,
  }
  autosaveEndpoint()
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

  autosaveEndpoint()

  activateCallback('2') // Go to Capabilities
}

// Step 2 handlers
async function runAnalysis() {
  if (!tempEndpoint.value) return
  if (analyzing.value) return

  tempEndpoint.value = {
    ...tempEndpoint.value,
    lastTestStatus: 'testing',
    lastTestErrorCode: undefined,
  }
  autosaveEndpoint()

  analyzing.value = true
  analyzeStep.value = 'Testing connection...'

  try {
    // Step 1: Test connection
    const connectionResult = await testConnection(tempEndpoint.value)
    if (!connectionResult.success) {
      tempEndpoint.value = {
        ...tempEndpoint.value,
        lastTestStatus: 'error',
        lastTestedAt: new Date().toISOString(),
        lastTestErrorCode: connectionResult.error?.code,
      }
      autosaveEndpoint()
      throw new Error(connectionResult.error?.message || 'Connection failed')
    }

    // Step 2: Analyze endpoint
    analyzeStep.value = 'Analyzing endpoint structure...'
    const analysis = await analyzeEndpoint(tempEndpoint.value)

    analyzeStep.value = 'Done!'

    // Store the endpoint with analysis
    tempEndpoint.value = {
      ...tempEndpoint.value,
      lastTestStatus: 'success',
      lastTestedAt: new Date().toISOString(),
      lastTestErrorCode: undefined,
      analysis: {
        hasSkosContent: true,
        supportsNamedGraphs: analysis.supportsNamedGraphs,
        skosGraphCount: analysis.skosGraphCount,
        languages: analysis.languages,
        totalConcepts: analysis.totalConcepts,
        relationships: analysis.relationships,
        schemeUris: analysis.schemeUris,
        schemeCount: analysis.schemeCount,
        schemesLimited: analysis.schemesLimited,
        analyzedAt: analysis.analyzedAt,
      },
    }

    // Log analysis results for debugging
    console.log('📊 Analysis result (runAnalysis):', {
      totalConcepts: tempEndpoint.value?.analysis?.totalConcepts,
      relationships: tempEndpoint.value?.analysis?.relationships
    })

    // Load language priorities from analysis
    loadPriorities(tempEndpoint.value!)

    autosaveEndpoint()

    lastAnalyzedKey.value = getAnalysisKey()

    // Brief delay to show "Done!"
    await new Promise(resolve => setTimeout(resolve, 500))

    analyzing.value = false
    analyzeStep.value = null
  } catch (e) {
    analyzeStep.value = `Error: ${e instanceof Error ? e.message : 'Unknown error'}`
    analyzing.value = false
    if (tempEndpoint.value) {
      lastAnalyzedKey.value = getAnalysisKey()
    }
  }
}

async function handleReanalyze() {
  if (!tempEndpoint.value) return

  try {
    tempEndpoint.value = {
      ...tempEndpoint.value,
      lastTestStatus: 'testing',
      lastTestErrorCode: undefined,
    }
    autosaveEndpoint()

    const analysis = await reanalyzeEndpoint(tempEndpoint.value)
    tempEndpoint.value = {
      ...tempEndpoint.value,
      analysis,
      lastTestStatus: 'success',
      lastTestedAt: new Date().toISOString(),
      lastTestErrorCode: undefined,
    }

    // Log analysis results for debugging
    console.log('📊 Analysis result (handleReanalyze):', {
      totalConcepts: tempEndpoint.value?.analysis?.totalConcepts,
      relationships: tempEndpoint.value?.analysis?.relationships
    })

    loadPriorities(tempEndpoint.value!)
    autosaveEndpoint()
  } catch {
    if (tempEndpoint.value) {
      tempEndpoint.value = {
        ...tempEndpoint.value,
        lastTestStatus: 'error',
        lastTestedAt: new Date().toISOString(),
        lastTestErrorCode: 'UNKNOWN',
      }
      autosaveEndpoint()
    }
    // Error handled in composable
  }
}

// Step 3 handlers
function handlePrioritiesUpdate(newPriorities: string[]) {
  priorities.value = newPriorities
}

function handleClose() {
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    :style="{ width: '600px' }"
    :modal="true"
    :closable="true"
    position="top"
    class="endpoint-wizard-dialog"
    @update:visible="$emit('update:visible', $event)"
  >
    <template #header>
      <div class="wizard-header">
        <span class="wizard-title">{{ dialogTitle }}</span>
        <span
          class="config-status-dot"
          :class="`status-${configStatus.status}`"
          :title="configStatus.label"
        ></span>
        <span class="config-status-label">{{ configStatus.label }}</span>
      </div>
    </template>
    <Stepper v-model:value="activeStep">
      <StepList>
        <Step value="1">Basic Info</Step>
        <Step value="2">Capabilities</Step>
        <Step value="3">
          <span class="step-label">Languages</span>
          <span
            class="config-status-dot step-status-dot"
            :class="`status-${configStatus.status}`"
            :title="configStatus.label"
          ></span>
        </Step>
      </StepList>

      <StepPanels>
        <!-- Step 1: Basic Info -->
        <StepPanel v-slot="{ activateCallback }" value="1">
          <WizardStepBasicInfo
            :form="formData"
            :formValid="formValid"
            :securityCheck="securityCheck"
            :trustCheck="trustCheck"
            :testing="testing"
            :testResult="testResult"
            :isEditing="isEditing"
            :corsIssue="corsIssue"
            :schemeUriMismatch="schemeUriMismatch"
            @update:form="handleFormUpdate"
            @test="handleTest"
            @next="handleNextFromBasicInfo(activateCallback)"
            @close="handleClose"
          />
        </StepPanel>

        <!-- Step 2: Capabilities -->
        <StepPanel v-slot="{ activateCallback }" value="2">
          <WizardStepCapabilities
            :skosContentStatus="skosContentStatus"
            :skosContentSeverity="skosContentSeverity"
            :skosContentIcon="skosContentIcon"
            :skosContentDescription="skosContentDescription"
            :graphSupportStatus="graphSupportStatus"
            :graphSupportSeverity="graphSupportSeverity"
            :graphSupportIcon="graphSupportIcon"
            :graphSupportDescription="graphSupportDescription"
            :skosGraphStatus="skosGraphStatus"
            :skosGraphSeverity="skosGraphSeverity"
            :skosGraphIcon="skosGraphIcon"
            :skosGraphDescription="skosGraphDescription"
            :schemeCountStatus="schemeCountStatus"
            :schemeCountSeverity="schemeCountSeverity"
            :schemeCountIcon="schemeCountIcon"
            :schemeCountDescription="schemeCountDescription"
            :conceptCountStatus="conceptCountStatus"
            :conceptCountSeverity="conceptCountSeverity"
            :conceptCountIcon="conceptCountIcon"
            :conceptCountDescription="conceptCountDescription"
            :relationshipsStatus="relationshipsStatus"
            :relationshipsSeverity="relationshipsSeverity"
            :relationshipsIcon="relationshipsIcon"
            :relationshipsDescription="relationshipsDescription"
            :analyzing="analyzing"
            :analyzeElapsedShow="analyzeElapsed.show.value"
            :analyzeElapsedValue="analyzeElapsed.elapsed.value"
            :analysisLog="analysisLog"
            :analyzedAt="tempEndpoint?.analysis?.analyzedAt ?? null"
            :relationships="tempEndpoint?.analysis?.relationships ?? null"
            @reanalyze="handleReanalyze"
            @next="activateCallback('3')"
            @back="activateCallback('1')"
          />
        </StepPanel>

        <!-- Step 3: Languages -->
        <StepPanel v-slot="{ activateCallback }" value="3">
          <WizardStepLanguages
            :priorities="priorities"
            :endpointLanguages="endpointLanguages"
            :isEditing="isEditing"
            :getLanguageName="getLanguageName"
            :getLanguageCount="getLanguageCount"
            :getPriorityLabel="getPriorityLabel"
            :getBadgeColor="getBadgeColor"
            @update:priorities="handlePrioritiesUpdate"
            @close="handleClose"
            @back="activateCallback('2')"
          />
        </StepPanel>
      </StepPanels>
    </Stepper>
  </Dialog>
</template>

<style scoped>
.wizard-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.wizard-title {
  font-weight: 600;
}

.config-status-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  display: inline-block;
  border: 1px solid transparent;
}

.config-status-dot.status-success {
  background: var(--ae-status-success);
}

.config-status-dot.status-warning {
  background: var(--ae-status-warning);
}

.config-status-dot.status-error {
  background: var(--ae-status-error);
}

.config-status-dot.status-neutral {
  background: var(--ae-text-muted);
}

.config-status-label {
  font-size: 0.8125rem;
  color: var(--ae-text-secondary);
}

.step-label {
  margin-right: 0.375rem;
}

.step-status-dot {
  vertical-align: middle;
}
</style>
