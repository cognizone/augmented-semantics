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
  graphSupportStatus,
  graphSupportSeverity,
  graphSupportIcon,
  graphSupportDescription,
  skosGraphStatus,
  skosGraphSeverity,
  skosGraphIcon,
  skosGraphDescription,
} = useEndpointCapabilities(endpointForLanguage)

const isEditing = computed(() => !!props.endpoint)
const dialogTitle = computed(() => isEditing.value ? 'Configure Endpoint' : 'Add Endpoint')

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

// Step 2 handlers
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
        hasSkosContent: true,
        supportsNamedGraphs: analysis.supportsNamedGraphs,
        skosGraphCount: analysis.skosGraphCount,
        languages: analysis.languages,
        analyzedAt: analysis.analyzedAt,
      },
    }

    // Load language priorities from analysis
    loadPriorities(tempEndpoint.value!)

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
    loadPriorities(tempEndpoint.value!)
  } catch {
    // Error handled in composable
  }
}

// Step 3 handlers
function handlePrioritiesUpdate(newPriorities: string[]) {
  priorities.value = newPriorities
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
    position="top"
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
          <WizardStepBasicInfo
            :form="formData"
            :formValid="formValid"
            :securityCheck="securityCheck"
            :trustCheck="trustCheck"
            :testing="testing"
            :testResult="testResult"
            :isEditing="isEditing"
            @update:form="handleFormUpdate"
            @test="handleTest"
            @next="handleNextFromBasicInfo(activateCallback)"
            @close="handleClose"
          />
        </StepPanel>

        <!-- Step 2: Capabilities -->
        <StepPanel v-slot="{ activateCallback }" value="2">
          <WizardStepCapabilities
            :graphSupportStatus="graphSupportStatus"
            :graphSupportSeverity="graphSupportSeverity"
            :graphSupportIcon="graphSupportIcon"
            :graphSupportDescription="graphSupportDescription"
            :skosGraphStatus="skosGraphStatus"
            :skosGraphSeverity="skosGraphSeverity"
            :skosGraphIcon="skosGraphIcon"
            :skosGraphDescription="skosGraphDescription"
            :analyzing="analyzing"
            :analyzeElapsedShow="analyzeElapsed.show.value"
            :analyzeElapsedValue="analyzeElapsed.elapsed.value"
            :analysisLog="analysisLog"
            :analyzedAt="tempEndpoint?.analysis?.analyzedAt ?? null"
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
            @save="handleSave"
            @back="activateCallback('2')"
          />
        </StepPanel>
      </StepPanels>
    </Stepper>
  </Dialog>
</template>

<style scoped>
/* All step-specific styles are now in individual step components */
</style>
