<script setup lang="ts">
/**
 * EndpointManager - add, edit, test, select and remove SPARQL endpoints.
 *
 * Compact RDF variant: no multi-step wizard and no endpoint analysis
 * (AE RDF is live-query only). Reuses the generic useEndpointForm /
 * useEndpointTest composables lifted from ae-skos.
 *
 * @see /spec/common/com01-EndpointManager.md
 * ponytail: built fresh instead of trimming ae-skos's 900-line manager +
 * 600-line analysis wizard — none of the SKOS capability machinery applies here.
 */
import { ref, computed } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Message from 'primevue/message'
import { useEndpointStore } from '../../stores'
import { useEndpointForm, useEndpointTest } from '../../composables'
import type { SPARQLEndpoint } from '../../types'

const visible = defineModel<boolean>('visible', { required: true })

const endpointStore = useEndpointStore()
const { form, formValid, securityCheck, resetForm, loadEndpoint, buildAuth } = useEndpointForm()
const { testing, testResult, testConnection, clearResult } = useEndpointTest()

const mode = ref<'list' | 'form'>('list')
const editingId = ref<string | null>(null)
const pendingDelete = ref<string | null>(null)

const authOptions = [
  { label: 'None', value: 'none' },
  { label: 'Basic', value: 'basic' },
  { label: 'API key', value: 'apikey' },
  { label: 'Bearer token', value: 'bearer' },
]

const formTitle = computed(() => (editingId.value ? 'Edit endpoint' : 'Add endpoint'))

function openAdd() {
  resetForm()
  clearResult()
  editingId.value = null
  mode.value = 'form'
}

function openEdit(ep: SPARQLEndpoint) {
  loadEndpoint(ep)
  clearResult()
  editingId.value = ep.id
  mode.value = 'form'
}

function backToList() {
  mode.value = 'list'
  clearResult()
  pendingDelete.value = null
}

function save() {
  if (!formValid.value) return
  const payload = { name: form.name.trim(), url: form.url.trim(), auth: buildAuth() }
  if (editingId.value) {
    endpointStore.updateEndpoint(editingId.value, payload)
  } else {
    const created = endpointStore.addEndpoint(payload)
    if (created) endpointStore.selectEndpoint(created.id)
  }
  backToList()
}

function runTest() {
  endpointStore.clearError?.()
  // Build a throwaway endpoint from the current form to test before saving.
  void testConnection({
    id: 'test',
    name: form.name || 'test',
    url: form.url,
    auth: buildAuth(),
    createdAt: new Date().toISOString(),
    accessCount: 0,
  })
}

function selectAndClose(id: string) {
  endpointStore.selectEndpoint(id)
  visible.value = false
}

function addSuggested(suggested: { name: string; url: string }) {
  const created = endpointStore.addEndpoint({ name: suggested.name, url: suggested.url })
  if (created) selectAndClose(created.id)
}

function doDelete(id: string) {
  endpointStore.removeEndpoint(id)
  pendingDelete.value = null
}

function statusClass(ep: SPARQLEndpoint): string {
  if (ep.id === endpointStore.currentId) return 'connected'
  if (ep.lastTestStatus === 'error') return 'error'
  return 'idle'
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    :header="mode === 'list' ? 'Manage endpoints' : formTitle"
    :modal="true"
    :style="{ width: '560px' }"
    position="top"
  >
    <!-- List -->
    <div v-if="mode === 'list'" class="ep-list-shell">
      <p v-if="!endpointStore.endpoints.length" class="ep-empty">
        No endpoints yet. Add one to connect.
      </p>

      <ul v-else class="ep-list">
        <li v-for="ep in endpointStore.sortedEndpoints" :key="ep.id" class="ep-item">
          <button class="ep-main" :title="ep.url" @click="selectAndClose(ep.id)">
            <span class="status-dot" :class="statusClass(ep)"></span>
            <span class="ep-text">
              <span class="ep-name">{{ ep.name }}</span>
              <span class="ep-url">{{ ep.url }}</span>
            </span>
          </button>

          <div class="ep-actions">
            <template v-if="pendingDelete === ep.id">
              <Button label="Confirm" size="small" severity="danger" @click="doDelete(ep.id)" />
              <Button label="Cancel" size="small" text @click="pendingDelete = null" />
            </template>
            <template v-else>
              <Button icon="pi pi-pencil" size="small" text aria-label="Edit" @click="openEdit(ep)" />
              <Button icon="pi pi-trash" size="small" text severity="danger" aria-label="Delete" @click="pendingDelete = ep.id" />
            </template>
          </div>
        </li>
      </ul>

      <div v-if="endpointStore.availableSuggestedEndpoints.length" class="ep-suggested">
        <span class="ep-suggested-title">Suggested</span>
        <button
          v-for="s in endpointStore.availableSuggestedEndpoints"
          :key="s.url"
          class="ep-suggested-item"
          :title="s.url"
          @click="addSuggested(s)"
        >
          <span class="material-symbols-outlined">add</span>
          <span class="ep-text">
            <span class="ep-name">{{ s.name }}</span>
            <span class="ep-url">{{ s.description || s.url }}</span>
          </span>
        </button>
      </div>

      <Button label="Add endpoint" icon="pi pi-plus" @click="openAdd" />
    </div>

    <!-- Add / edit form -->
    <div v-else class="ep-form">
      <label class="field">
        <span class="field-label">Name</span>
        <InputText v-model="form.name" placeholder="My endpoint" />
      </label>

      <label class="field">
        <span class="field-label">SPARQL endpoint URL</span>
        <InputText v-model="form.url" placeholder="https://example.org/sparql" />
      </label>

      <Message v-if="securityCheck?.warning" severity="warn" :closable="false">
        {{ securityCheck.warning }}
      </Message>

      <label class="field">
        <span class="field-label">Authentication</span>
        <Select v-model="form.authType" :options="authOptions" optionLabel="label" optionValue="value" />
      </label>

      <template v-if="form.authType === 'basic'">
        <label class="field">
          <span class="field-label">Username</span>
          <InputText v-model="form.username" />
        </label>
        <label class="field">
          <span class="field-label">Password</span>
          <InputText v-model="form.password" type="password" />
        </label>
      </template>

      <template v-else-if="form.authType === 'apikey'">
        <label class="field">
          <span class="field-label">Header name</span>
          <InputText v-model="form.headerName" />
        </label>
        <label class="field">
          <span class="field-label">API key</span>
          <InputText v-model="form.apiKey" type="password" />
        </label>
      </template>

      <template v-else-if="form.authType === 'bearer'">
        <label class="field">
          <span class="field-label">Token</span>
          <InputText v-model="form.token" type="password" />
        </label>
      </template>

      <Message v-if="testResult" :severity="testResult.success ? 'success' : 'error'" :closable="false">
        {{ testResult.message }}
      </Message>
    </div>

    <template v-if="mode === 'form'" #footer>
      <Button label="Back" text @click="backToList" />
      <Button
        label="Test"
        icon="pi pi-bolt"
        severity="secondary"
        :loading="testing"
        :disabled="!form.url"
        @click="runTest"
      />
      <Button label="Save" icon="pi pi-check" :disabled="!formValid" @click="save" />
    </template>
  </Dialog>
</template>

<style scoped>
.ep-list-shell {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.ep-empty {
  margin: 0;
  color: var(--ae-text-secondary);
  font-size: 0.875rem;
}

.ep-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.ep-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.25rem 0.25rem 0;
  border-radius: 8px;
}

.ep-item:hover {
  background: var(--ae-bg-hover);
}

.ep-main {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  padding: 0.5rem;
  color: inherit;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--ae-text-muted);
}

.status-dot.connected { background: var(--ae-status-success); }
.status-dot.error { background: var(--ae-status-error); }

.ep-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ep-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--ae-text-primary);
}

.ep-url {
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ep-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}

.ep-suggested {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  border-top: 1px solid var(--ae-border-color);
  padding-top: 0.75rem;
}

.ep-suggested-title {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ae-text-secondary);
}

.ep-suggested-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  padding: 0.5rem;
  border-radius: 8px;
  color: var(--ae-text-secondary);
}

.ep-suggested-item:hover {
  background: var(--ae-bg-hover);
  color: var(--ae-text-primary);
}

.ep-suggested-item .material-symbols-outlined {
  font-size: 18px;
}

.ep-form {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.field-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--ae-text-primary);
}
</style>
