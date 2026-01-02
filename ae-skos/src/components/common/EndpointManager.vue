<script setup lang="ts">
/**
 * EndpointManager - SPARQL endpoint configuration and management
 *
 * Provides CRUD operations for SPARQL endpoints with:
 * - Connection testing and analysis
 * - Authentication support (Basic, API Key, Bearer)
 * - Named graph detection
 * - Language detection
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import { ref, reactive, computed } from 'vue'
import { useEndpointStore } from '../../stores'
import { testConnection, analyzeEndpoint, detectLanguages, detectGraphs, detectDuplicates } from '../../services/sparql'
import {
  isValidEndpointUrl,
  checkEndpointSecurity,
  assessEndpointTrust,
} from '../../services/security'
import { useElapsedTime } from '../../composables'
import type { SPARQLEndpoint, EndpointAuth } from '../../types'

import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Message from 'primevue/message'
import Tag from 'primevue/tag'
import Divider from 'primevue/divider'
import OrderList from 'primevue/orderlist'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const endpointStore = useEndpointStore()

// Dialog state
const showAddDialog = ref(false)
const editingEndpoint = ref<SPARQLEndpoint | null>(null)
const testing = ref(false)
const testResult = ref<{ success: boolean; message: string; time?: number } | null>(null)
const analyzing = ref(false)
const analyzeStep = ref<string | null>(null) // Current step being executed

// Elapsed time for analyzing (shows after 2 seconds)
const analyzeElapsed = useElapsedTime(analyzing)

// Language settings dialog state
const showLanguageDialog = ref(false)
const languageEndpoint = ref<SPARQLEndpoint | null>(null)
const languagePriorities = ref<string[]>([])

// Delete confirmation dialog state
const showDeleteDialog = ref(false)
const deleteTarget = ref<SPARQLEndpoint | null>(null)

// SPARQL capabilities dialog state
const showCapabilitiesDialog = ref(false)
const capabilitiesEndpoint = ref<SPARQLEndpoint | null>(null)
const reanalyzing = ref(false)
const reanalyzeStep = ref<string | null>(null)
const reanalyzeDuration = ref<number | null>(null) // Total analysis time in seconds
const reanalyzeElapsed = useElapsedTime(reanalyzing)

// Analysis log entries
interface AnalysisLogEntry {
  message: string
  status: 'pending' | 'success' | 'warning' | 'error' | 'info'
}
const analysisLog = ref<AnalysisLogEntry[]>([])


// Form state
const form = reactive({
  name: '',
  url: '',
  authType: 'none' as 'none' | 'basic' | 'apikey' | 'bearer',
  username: '',
  password: '',
  apiKey: '',
  headerName: 'X-API-Key',
  token: '',
})

const authOptions = [
  { label: 'None', value: 'none' },
  { label: 'Basic Auth', value: 'basic' },
  { label: 'API Key', value: 'apikey' },
  { label: 'Bearer Token', value: 'bearer' },
]

// Example endpoints
const exampleEndpoints = [
  { name: 'DBpedia', url: 'https://dbpedia.org/sparql' },
  { name: 'Wikidata', url: 'https://query.wikidata.org/sparql' },
  { name: 'EU Publications', url: 'https://publications.europa.eu/webapi/rdf/sparql' },
]

// Computed
const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

const isEditing = computed(() => editingEndpoint.value !== null)

const formValid = computed(() => {
  if (!form.name.trim() || !form.url.trim()) return false
  if (!isValidEndpointUrl(form.url)) return false

  if (form.authType === 'basic' && (!form.username || !form.password)) return false
  if (form.authType === 'apikey' && !form.apiKey) return false
  if (form.authType === 'bearer' && !form.token) return false

  return true
})

const securityCheck = computed(() => {
  if (!form.url) return null
  return checkEndpointSecurity(form.url)
})

const trustCheck = computed(() => {
  if (!form.url) return null
  return assessEndpointTrust(form.url)
})

// Methods
function resetForm() {
  form.name = ''
  form.url = ''
  form.authType = 'none'
  form.username = ''
  form.password = ''
  form.apiKey = ''
  form.headerName = 'X-API-Key'
  form.token = ''
  testResult.value = null
  editingEndpoint.value = null
}

function openAddDialog() {
  resetForm()
  showAddDialog.value = true
}

function openEditDialog(endpoint: SPARQLEndpoint) {
  editingEndpoint.value = endpoint
  form.name = endpoint.name
  form.url = endpoint.url
  form.authType = endpoint.auth?.type || 'none'
  form.username = endpoint.auth?.credentials?.username || ''
  form.password = endpoint.auth?.credentials?.password || ''
  form.apiKey = endpoint.auth?.credentials?.apiKey || ''
  form.headerName = endpoint.auth?.credentials?.headerName || 'X-API-Key'
  form.token = endpoint.auth?.credentials?.token || ''
  testResult.value = null
  showAddDialog.value = true
}

function closeAddDialog() {
  showAddDialog.value = false
  resetForm()
}

function useExample(example: { name: string; url: string }) {
  form.name = example.name
  form.url = example.url
  form.authType = 'none'
}

function buildAuth(): EndpointAuth | undefined {
  if (form.authType === 'none') return undefined

  const auth: EndpointAuth = { type: form.authType }

  switch (form.authType) {
    case 'basic':
      auth.credentials = { username: form.username, password: form.password }
      break
    case 'apikey':
      auth.credentials = { apiKey: form.apiKey, headerName: form.headerName }
      break
    case 'bearer':
      auth.credentials = { token: form.token }
      break
  }

  return auth
}

async function handleTest() {
  testing.value = true
  testResult.value = null

  const tempEndpoint: SPARQLEndpoint = {
    id: 'test',
    name: form.name,
    url: form.url,
    auth: buildAuth(),
    createdAt: new Date().toISOString(),
    accessCount: 0,
  }

  const result = await testConnection(tempEndpoint)
  testing.value = false

  if (result.success) {
    testResult.value = {
      success: true,
      message: `Connected successfully (${result.responseTime}ms)`,
      time: result.responseTime,
    }
    // Auto-dismiss success message after 3 seconds
    setTimeout(() => {
      if (testResult.value?.success) {
        testResult.value = null
      }
    }, 3000)
  } else {
    testResult.value = {
      success: false,
      message: result.error?.message || 'Connection failed',
    }
  }
}

async function handleSave() {
  if (!formValid.value) return

  const auth = buildAuth()

  if (isEditing.value && editingEndpoint.value) {
    endpointStore.updateEndpoint(editingEndpoint.value.id, {
      name: form.name,
      url: form.url,
      auth,
    })
    closeAddDialog()
  } else {
    const newEndpoint = endpointStore.addEndpoint({
      name: form.name,
      url: form.url,
      auth,
    })

    // Auto-select and analyze with progress feedback
    endpointStore.selectEndpoint(newEndpoint.id)
    endpointStore.setStatus('connecting')

    analyzing.value = true
    analyzeStep.value = 'Testing connection...'

    try {
      // Step 1: Test connection
      const connectionResult = await testConnection(newEndpoint)
      if (!connectionResult.success) {
        throw new Error(connectionResult.error?.message || 'Connection failed')
      }

      // Step 2: Analyze endpoint (named graphs, etc.)
      analyzeStep.value = 'Analyzing endpoint structure...'
      const analysis = await analyzeEndpoint(newEndpoint)

      endpointStore.updateEndpoint(newEndpoint.id, {
        analysis: {
          supportsNamedGraphs: analysis.supportsNamedGraphs,
          graphCount: analysis.graphCount,
          graphCountExact: analysis.graphCountExact,
          hasDuplicateTriples: analysis.hasDuplicateTriples,
          analyzedAt: analysis.analyzedAt,
        },
      })

      analyzeStep.value = 'Done!'
      endpointStore.setStatus('connected')

      // Brief delay to show "Done!" before closing
      await new Promise(resolve => setTimeout(resolve, 500))
    } catch (e) {
      endpointStore.setStatus('error')
      analyzeStep.value = `Error: ${e instanceof Error ? e.message : 'Unknown error'}`
      // Keep dialog open on error so user can see what went wrong
      analyzing.value = false
      return
    }

    analyzing.value = false
    analyzeStep.value = null
    closeAddDialog()
  }
}

function handleDelete(endpoint: SPARQLEndpoint) {
  deleteTarget.value = endpoint
  showDeleteDialog.value = true
}

function confirmDelete() {
  if (deleteTarget.value) {
    endpointStore.removeEndpoint(deleteTarget.value.id)
  }
  showDeleteDialog.value = false
  deleteTarget.value = null
}

function cancelDelete() {
  showDeleteDialog.value = false
  deleteTarget.value = null
}

async function handleConnect(endpoint: SPARQLEndpoint) {
  endpointStore.selectEndpoint(endpoint.id)
  endpointStore.setStatus('connecting')

  const result = await testConnection(endpoint)
  if (result.success) {
    endpointStore.setStatus('connected')
  } else {
    endpointStore.setStatus('error')
    endpointStore.setError(result.error!)
  }
}

function formatDate(dateStr?: string) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString()
}

// Language settings functions
function openLanguageDialog(endpoint: SPARQLEndpoint) {
  languageEndpoint.value = endpoint
  // Load existing priorities or default to alphabetical with 'en' first
  const detected = endpoint.analysis?.languages?.map(l => l.lang) || []
  if (endpoint.languagePriorities?.length) {
    languagePriorities.value = [...endpoint.languagePriorities]
  } else {
    // Default: alphabetical, but 'en' always first
    const sorted = [...detected].sort((a, b) => {
      if (a === 'en') return -1
      if (b === 'en') return 1
      return a.localeCompare(b)
    })
    languagePriorities.value = sorted
  }
  showLanguageDialog.value = true
}

function closeLanguageDialog() {
  showLanguageDialog.value = false
  languageEndpoint.value = null
  languagePriorities.value = []
}

function saveLanguagePriorities() {
  if (!languageEndpoint.value) return
  endpointStore.updateEndpoint(languageEndpoint.value.id, {
    languagePriorities: languagePriorities.value,
  })
  closeLanguageDialog()
}

function onLanguageReorder(event: { value: string[] }) {
  languagePriorities.value = event.value
}

// Computed: languages from current endpoint's analysis with counts
const endpointLanguages = computed(() => {
  return languageEndpoint.value?.analysis?.languages || []
})

// Get count for a language code
function getLanguageCount(lang: string): number | undefined {
  return endpointLanguages.value.find(l => l.lang === lang)?.count
}

// SPARQL capabilities dialog functions
function openCapabilitiesDialog(endpoint: SPARQLEndpoint) {
  capabilitiesEndpoint.value = endpoint
  showCapabilitiesDialog.value = true
}

function closeCapabilitiesDialog() {
  showCapabilitiesDialog.value = false
  capabilitiesEndpoint.value = null
}

// Helper to format query method for display
function formatQueryMethod(method: string): string {
  switch (method) {
    case 'empty-pattern': return 'empty graph pattern'
    case 'blank-node-pattern': return 'triple pattern'
    case 'fallback-limit': return 'enumeration'
    case 'none': return 'not supported'
    default: return method
  }
}

// Add entry to analysis log
function logStep(message: string, status: AnalysisLogEntry['status'] = 'pending') {
  analysisLog.value.push({ message, status })
}

// Update last log entry status
function updateLastLog(message: string, status: AnalysisLogEntry['status']) {
  const last = analysisLog.value[analysisLog.value.length - 1]
  if (last) {
    last.message = message
    last.status = status
  }
}

async function reanalyzeEndpoint() {
  if (!capabilitiesEndpoint.value) return

  const endpoint = capabilitiesEndpoint.value
  const endpointId = endpoint.id
  const startTime = performance.now()
  reanalyzing.value = true
  analysisLog.value = [] // Clear previous log
  reanalyzeStep.value = 'Analyzing...'

  try {
    // Step 1: Detect graphs
    logStep('(1/3) Detecting named graphs...', 'pending')
    const graphResult = await detectGraphs(endpoint)
    console.log('Graph detection result:', graphResult)

    if (graphResult.supportsNamedGraphs === null) {
      updateLastLog(`(1/3) Graphs: not supported`, 'warning')
    } else if (graphResult.supportsNamedGraphs === false) {
      updateLastLog(`(1/3) Graphs: none found`, 'info')
    } else {
      const countStr = graphResult.graphCountExact
        ? `${graphResult.graphCount} graphs`
        : `${graphResult.graphCount}+ graphs`
      updateLastLog(`(1/3) Graphs: ${countStr} (${formatQueryMethod(graphResult.queryMethod)})`, 'success')
    }

    // Step 2: Detect duplicates (only if multiple graphs exist)
    let hasDuplicateTriples: boolean | null = null
    if (graphResult.supportsNamedGraphs === true && graphResult.graphCount && graphResult.graphCount > 1) {
      logStep('(2/3) Checking for duplicates...', 'pending')
      const duplicateResult = await detectDuplicates(endpoint)
      console.log('Duplicate detection result:', duplicateResult)
      hasDuplicateTriples = duplicateResult.hasDuplicates
      if (hasDuplicateTriples) {
        updateLastLog(`(2/3) Duplicates: found across graphs`, 'warning')
      } else {
        updateLastLog(`(2/3) Duplicates: none`, 'success')
      }
    } else if (graphResult.supportsNamedGraphs === null) {
      // Graphs not supported = no duplicates possible
      hasDuplicateTriples = false
      logStep('(2/3) Duplicates: not applicable (no graph support)', 'info')
    } else {
      // No graphs or single graph = no duplicates possible
      hasDuplicateTriples = false
      logStep('(2/3) Duplicates: none (single graph)', 'info')
    }

    // Step 3: Detect languages
    // Use GRAPH scope if duplicates exist to ensure concept+labels are in same graph
    const useGraphScope = hasDuplicateTriples === true
    const queryMode = useGraphScope ? 'graph-scoped' : 'default'
    logStep(`(3/3) Detecting languages (${queryMode})...`, 'pending')
    const languages = await detectLanguages(endpoint, useGraphScope)
    console.log('Language detection result:', languages)
    updateLastLog(`(3/3) Languages: found ${languages.length} (${queryMode})`, 'success')

    // Calculate total duration
    reanalyzeDuration.value = Math.round((performance.now() - startTime) / 1000)

    const analysis = {
      supportsNamedGraphs: graphResult.supportsNamedGraphs,
      graphCount: graphResult.graphCount,
      graphCountExact: graphResult.graphCountExact,
      hasDuplicateTriples,
      languages,
      analyzedAt: new Date().toISOString(),
    }
    console.log('Saving analysis:', analysis)

    endpointStore.updateEndpoint(endpointId, { analysis })

    // Refresh the reference to get updated data
    const updated = endpointStore.endpoints.find(e => e.id === endpointId)
    if (updated) {
      capabilitiesEndpoint.value = updated
    }

    reanalyzeStep.value = null
    reanalyzing.value = false
  } catch (e) {
    console.error('Reanalyze error:', e)
    logStep(`Error: ${e instanceof Error ? e.message : 'Analysis failed'}`, 'error')
    reanalyzeDuration.value = Math.round((performance.now() - startTime) / 1000)
    reanalyzeStep.value = null
    reanalyzing.value = false
  }
}

// Format number with thousand separator
function formatCount(n: number): string {
  return n.toLocaleString('de-DE') // Uses period as thousand separator
}

// Computed properties for capabilities display
const graphStatus = computed(() => {
  const analysis = capabilitiesEndpoint.value?.analysis
  if (!analysis) return 'Unknown'
  if (analysis.supportsNamedGraphs === null) return 'Not supported'
  if (analysis.supportsNamedGraphs === false) return 'None'
  if (analysis.graphCount == null) return 'Detected'
  if (analysis.graphCountExact) return `${formatCount(analysis.graphCount)} graphs`
  return `${formatCount(analysis.graphCount)}+ graphs`
})

const graphSeverity = computed(() => {
  const analysis = capabilitiesEndpoint.value?.analysis
  if (!analysis) return 'secondary'
  if (analysis.supportsNamedGraphs === null || analysis.supportsNamedGraphs === false) return 'secondary'
  return 'info'
})

const graphIcon = computed(() => {
  const analysis = capabilitiesEndpoint.value?.analysis
  if (!analysis) return 'pi pi-minus-circle muted-icon'
  if (analysis.supportsNamedGraphs === null || analysis.supportsNamedGraphs === false) {
    return 'pi pi-minus-circle muted-icon'
  }
  return 'pi pi-check-circle success-icon'
})

const graphDescription = computed(() => {
  const analysis = capabilitiesEndpoint.value?.analysis
  if (!analysis) return null
  if (analysis.supportsNamedGraphs === null) return 'This endpoint doesn\'t support named graph queries'
  if (analysis.supportsNamedGraphs === false) return null
  if (analysis.graphCountExact === false) return 'This endpoint uses named graphs (exact count unavailable)'
  return 'This endpoint uses named graphs to organize data'
})

const duplicateStatus = computed(() => {
  const analysis = capabilitiesEndpoint.value?.analysis
  if (!analysis || analysis.hasDuplicateTriples === null) return 'Unknown'
  return analysis.hasDuplicateTriples ? 'Detected' : 'None'
})

const duplicateSeverity = computed(() => {
  const analysis = capabilitiesEndpoint.value?.analysis
  if (!analysis || analysis.hasDuplicateTriples === null) return 'secondary'
  return analysis.hasDuplicateTriples ? 'warn' : 'success'
})

const duplicateIcon = computed(() => {
  const analysis = capabilitiesEndpoint.value?.analysis
  if (!analysis || analysis.hasDuplicateTriples === null) return 'pi pi-minus-circle muted-icon'
  return analysis.hasDuplicateTriples ? 'pi pi-exclamation-triangle warning-icon' : 'pi pi-check-circle success-icon'
})

const duplicateDescription = computed(() => {
  const analysis = capabilitiesEndpoint.value?.analysis
  if (!analysis || analysis.hasDuplicateTriples === null) return null
  if (analysis.hasDuplicateTriples) return 'Same triples exist in multiple graphs. This may cause duplicate results.'
  return null
})
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    header="Endpoint Manager"
    :style="{ width: '850px' }"
    :modal="true"
    :closable="true"
  >
    <!-- Endpoint List -->
    <div class="endpoint-list">
      <div class="list-header">
        <h3>Saved Endpoints</h3>
        <Button
          label="Add Endpoint"
          icon="pi pi-plus"
          size="small"
          @click="openAddDialog"
        />
      </div>

      <DataTable
        :value="endpointStore.sortedEndpoints"
        :rows="5"
        :paginator="endpointStore.endpoints.length > 5"
        class="endpoints-table"
      >
        <template #empty>
          <div class="empty-state">
            <p>No endpoints configured.</p>
            <div class="example-endpoints">
              <p>Try one of these:</p>
              <div class="example-list">
                <Button
                  v-for="ex in exampleEndpoints"
                  :key="ex.url"
                  :label="ex.name"
                  size="small"
                  severity="secondary"
                  outlined
                  @click="useExample(ex); openAddDialog()"
                />
              </div>
            </div>
          </div>
        </template>

        <Column field="name" header="Name" sortable>
          <template #body="{ data }">
            <div class="endpoint-cell">
              <span class="name">{{ data.name }}</span>
              <Tag
                v-if="data.id === endpointStore.currentId"
                severity="success"
                value="Active"
                class="active-tag"
              />
            </div>
          </template>
        </Column>

        <Column field="url" header="URL">
          <template #body="{ data }">
            <span class="url-cell">{{ data.url }}</span>
          </template>
        </Column>

        <Column field="lastAccessedAt" header="Last Used" sortable>
          <template #body="{ data }">
            {{ formatDate(data.lastAccessedAt) }}
          </template>
        </Column>

        <Column header="Actions" :style="{ width: '180px' }">
          <template #body="{ data }">
            <div class="action-buttons">
              <Button
                icon="pi pi-link"
                severity="success"
                text
                rounded
                size="small"
                aria-label="Connect"
                :disabled="data.id === endpointStore.currentId"
                @click="handleConnect(data)"
              />
              <Button
                icon="pi pi-globe"
                severity="info"
                text
                rounded
                size="small"
                aria-label="Language settings"
                v-tooltip.top="'Language settings'"
                @click="openLanguageDialog(data)"
              />
              <Button
                icon="pi pi-sitemap"
                severity="info"
                text
                rounded
                size="small"
                aria-label="SPARQL capabilities"
                v-tooltip.top="'SPARQL capabilities'"
                @click="openCapabilitiesDialog(data)"
              />
              <Button
                icon="pi pi-pencil"
                severity="secondary"
                text
                rounded
                size="small"
                aria-label="Edit"
                @click="openEditDialog(data)"
              />
              <Button
                icon="pi pi-trash"
                severity="danger"
                text
                rounded
                size="small"
                aria-label="Delete"
                @click="handleDelete(data)"
              />
            </div>
          </template>
        </Column>
      </DataTable>
    </div>
  </Dialog>

  <!-- Add/Edit Dialog -->
  <Dialog
    v-model:visible="showAddDialog"
    :header="isEditing ? 'Edit Endpoint' : 'Add Endpoint'"
    :style="{ width: '500px' }"
    :modal="true"
    :closable="true"
    @hide="resetForm"
  >
    <div class="form-content">
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
        <InputText
          id="ep-name"
          v-model="form.name"
          placeholder="My Endpoint"
          class="w-full"
        />
      </div>

      <!-- URL -->
      <div class="form-field">
        <label for="ep-url">URL</label>
        <InputText
          id="ep-url"
          v-model="form.url"
          placeholder="https://example.org/sparql"
          class="w-full"
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
          class="w-full"
        />
      </div>

      <!-- Basic Auth -->
      <template v-if="form.authType === 'basic'">
        <div class="form-row">
          <div class="form-field">
            <label for="ep-user">Username</label>
            <InputText id="ep-user" v-model="form.username" class="w-full" />
          </div>
          <div class="form-field">
            <label for="ep-pass">Password</label>
            <InputText
              id="ep-pass"
              v-model="form.password"
              type="password"
              class="w-full"
            />
          </div>
        </div>
      </template>

      <!-- API Key -->
      <template v-if="form.authType === 'apikey'">
        <div class="form-row">
          <div class="form-field">
            <label for="ep-header">Header Name</label>
            <InputText id="ep-header" v-model="form.headerName" class="w-full" />
          </div>
          <div class="form-field">
            <label for="ep-apikey">API Key</label>
            <InputText
              id="ep-apikey"
              v-model="form.apiKey"
              type="password"
              class="w-full"
            />
          </div>
        </div>
      </template>

      <!-- Bearer Token -->
      <template v-if="form.authType === 'bearer'">
        <div class="form-field">
          <label for="ep-token">Token</label>
          <InputText
            id="ep-token"
            v-model="form.token"
            type="password"
            class="w-full"
          />
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

      <!-- Progress indicator during save -->
      <div v-if="analyzeStep" class="progress-indicator">
        <i v-if="analyzing" class="pi pi-spin pi-spinner"></i>
        <i v-else-if="analyzeStep.startsWith('Error')" class="pi pi-times-circle error-icon"></i>
        <i v-else class="pi pi-check-circle success-icon"></i>
        <span :class="{ 'error-text': analyzeStep.startsWith('Error') }">
          {{ analyzeStep }}
          <span v-if="analyzeElapsed.show.value" class="elapsed-time">({{ analyzeElapsed.elapsed.value }}s)</span>
        </span>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
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
            @click="closeAddDialog"
          />
          <Button
            :label="isEditing ? 'Save' : 'Add'"
            icon="pi pi-check"
            :disabled="!formValid"
            :loading="analyzing"
            @click="handleSave"
          />
        </div>
      </div>
    </template>
  </Dialog>

  <!-- Language Settings Dialog -->
  <Dialog
    v-model:visible="showLanguageDialog"
    :header="`Language Priority - ${languageEndpoint?.name || ''}`"
    :style="{ width: '450px' }"
    :modal="true"
    :closable="true"
    @hide="closeLanguageDialog"
  >
    <div class="language-settings">
      <div v-if="!endpointLanguages.length" class="no-languages">
        <i class="pi pi-info-circle"></i>
        <p>No languages detected.</p>
        <p class="hint">Run "Re-analyze" from SPARQL Capabilities to detect languages.</p>
      </div>

      <div v-else>
        <p class="section-description">
          Use the buttons to reorder. First language is used when preferred is unavailable.
        </p>

        <OrderList
          v-model="languagePriorities"
          :listStyle="{ height: 'auto', maxHeight: '350px' }"
          @reorder="onLanguageReorder"
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

    <template #footer>
      <div class="dialog-footer">
        <Button
          label="Cancel"
          severity="secondary"
          text
          @click="closeLanguageDialog"
        />
        <Button
          label="Save"
          icon="pi pi-check"
          :disabled="!languagePriorities.length"
          @click="saveLanguagePriorities"
        />
      </div>
    </template>
  </Dialog>

  <!-- Delete Confirmation Dialog -->
  <Dialog
    v-model:visible="showDeleteDialog"
    header="Delete Endpoint"
    :style="{ width: '400px' }"
    :modal="true"
    :closable="true"
  >
    <div class="delete-confirmation">
      <i class="pi pi-exclamation-triangle warning-icon"></i>
      <p>Are you sure you want to delete <strong>{{ deleteTarget?.name }}</strong>?</p>
      <p class="delete-warning">This action cannot be undone.</p>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <Button
          label="Cancel"
          severity="secondary"
          text
          @click="cancelDelete"
        />
        <Button
          label="Delete"
          icon="pi pi-trash"
          severity="danger"
          @click="confirmDelete"
        />
      </div>
    </template>
  </Dialog>

  <!-- SPARQL Capabilities Dialog -->
  <Dialog
    v-model:visible="showCapabilitiesDialog"
    :header="`SPARQL Capabilities - ${capabilitiesEndpoint?.name || ''}`"
    :style="{ width: '500px' }"
    :modal="true"
    :closable="true"
    @hide="closeCapabilitiesDialog"
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
        <div v-if="reanalyzing && reanalyzeElapsed.show.value" class="elapsed-time">
          ({{ reanalyzeElapsed.elapsed.value }}s)
        </div>
      </div>

      <!-- Analysis Timestamp -->
      <div v-if="capabilitiesEndpoint?.analysis?.analyzedAt && analysisLog.length === 0" class="capabilities-footer">
        <span class="capabilities-timestamp">
          Analyzed: {{ new Date(capabilitiesEndpoint.analysis.analyzedAt).toLocaleString() }}
          <span v-if="reanalyzeDuration !== null" class="analysis-duration">({{ reanalyzeDuration }}s)</span>
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
          :loading="reanalyzing"
          @click="reanalyzeEndpoint"
        />
        <Button
          label="Close"
          severity="secondary"
          @click="closeCapabilitiesDialog"
        />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.endpoint-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.list-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.endpoints-table {
  font-size: 0.875rem;
}

.endpoint-cell {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.endpoint-cell .name {
  font-weight: 500;
}

.active-tag {
  font-size: 0.7rem;
}

.url-cell {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-buttons {
  display: flex;
  gap: 0.25rem;
}

.empty-state {
  text-align: center;
  padding: 2rem;
  color: var(--p-text-muted-color);
}

.example-endpoints {
  margin-top: 1rem;
}

.example-list {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  margin-top: 0.5rem;
}

.form-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.examples-section {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.examples-label {
  font-size: 0.875rem;
  color: var(--p-text-muted-color);
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.form-field label {
  font-size: 0.875rem;
  font-weight: 500;
}

.form-row {
  display: flex;
  gap: 1rem;
}

.form-row .form-field {
  flex: 1;
}

.w-full {
  width: 100%;
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

/* Fade transition for test result */
.fade-enter-active {
  transition: opacity 0.3s ease;
}

.fade-leave-active {
  transition: opacity 1s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.footer-right {
  display: flex;
  gap: 0.5rem;
}

.progress-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--p-surface-100);
  border-radius: 6px;
  font-size: 0.875rem;
}

.progress-indicator .pi-spinner {
  color: var(--p-primary-color);
}

.progress-indicator .success-icon {
  color: var(--p-green-500);
}

.progress-indicator .error-icon {
  color: var(--p-red-500);
}

.progress-indicator .error-text {
  color: var(--p-red-500);
}

.elapsed-time {
  color: var(--p-text-muted-color);
  margin-left: 0.25rem;
}

/* Language Settings Dialog */
.language-settings {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.loading-languages {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem;
  color: var(--p-text-muted-color);
}

.section-description {
  margin: 0 0 0.75rem 0;
  font-size: 0.875rem;
  color: var(--p-text-muted-color);
}

.no-languages {
  text-align: center;
  padding: 1rem;
  color: var(--p-text-muted-color);
}

.no-languages i {
  font-size: 2rem;
  margin-bottom: 0.5rem;
}

.no-languages p {
  margin: 0.25rem 0;
}

.no-languages .hint {
  font-size: 0.75rem;
}

.language-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.language-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  border-radius: 6px;
}

.language-item.clickable {
  cursor: pointer;
  transition: background-color 0.2s;
}

.language-item.clickable:hover {
  background: var(--p-surface-100);
}

.language-item.selected {
  background: var(--p-primary-50);
}

.language-rank {
  font-weight: 500;
  color: var(--p-text-muted-color);
  min-width: 1.5rem;
}

.language-code {
  font-weight: 600;
  min-width: 2rem;
}

.language-count {
  font-size: 0.875rem;
  color: var(--p-text-muted-color);
  flex: 1;
}

:deep(.p-orderlist-list) {
  padding: 0.5rem;
}

/* Delete Confirmation Dialog */
.delete-confirmation {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.5rem;
}

.delete-confirmation .warning-icon {
  font-size: 3rem;
  color: var(--p-orange-500);
}

.delete-confirmation p {
  margin: 0;
}

.delete-confirmation .delete-warning {
  font-size: 0.875rem;
  color: var(--p-text-muted-color);
}

/* SPARQL Capabilities Dialog */
.capabilities-info {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.capability-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.capability-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.capability-row .success-icon {
  color: var(--p-green-500);
}

.capability-row .warning-icon {
  color: var(--p-orange-500);
}

.capability-row .muted-icon {
  color: var(--p-text-muted-color);
}

.capability-label {
  font-weight: 500;
  flex: 1;
}

.capability-description {
  margin: 0;
  padding-left: 1.5rem;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.capabilities-footer {
  margin-top: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--p-surface-200);
}

.capabilities-timestamp {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.analysis-log {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--p-surface-100);
  border-radius: 6px;
  margin-top: 0.5rem;
}

.log-entry {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.log-entry.pending {
  color: var(--p-primary-color);
}

.log-entry.success {
  color: var(--p-green-600);
}

.log-entry.warning {
  color: var(--p-orange-500);
}

.log-entry.error {
  color: var(--p-red-500);
}

.log-entry.info {
  color: var(--p-text-muted-color);
}

.analysis-duration {
  color: var(--p-text-muted-color);
  margin-left: 0.25rem;
}
</style>
