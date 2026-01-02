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
import { testConnection, analyzeEndpoint } from '../../services/sparql'
import {
  isValidEndpointUrl,
  checkEndpointSecurity,
  assessEndpointTrust,
} from '../../services/security'
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
          hasNamedGraphs: analysis.hasNamedGraphs,
          graphs: analysis.graphs,
          hasDuplicateTriples: analysis.hasDuplicateTriples,
          duplicateCount: analysis.duplicateCount,
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
  if (confirm(`Delete endpoint "${endpoint.name}"?`)) {
    endpointStore.removeEndpoint(endpoint.id)
  }
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

        <Column header="Actions" :style="{ width: '150px' }">
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
      <Message
        v-if="testResult"
        :severity="testResult.success ? 'success' : 'error'"
        :closable="false"
        class="test-result"
      >
        {{ testResult.message }}
      </Message>

      <!-- Progress indicator during save -->
      <div v-if="analyzeStep" class="progress-indicator">
        <i v-if="analyzing" class="pi pi-spin pi-spinner"></i>
        <i v-else-if="analyzeStep.startsWith('Error')" class="pi pi-times-circle error-icon"></i>
        <i v-else class="pi pi-check-circle success-icon"></i>
        <span :class="{ 'error-text': analyzeStep.startsWith('Error') }">{{ analyzeStep }}</span>
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
</style>
