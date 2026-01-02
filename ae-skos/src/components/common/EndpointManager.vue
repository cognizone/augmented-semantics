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
import { ref, computed } from 'vue'
import { useEndpointStore } from '../../stores'
import { testConnection } from '../../services/sparql'
import type { SPARQLEndpoint } from '../../types'

import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'

import EndpointFormDialog from './EndpointFormDialog.vue'
import EndpointLanguageDialog from './EndpointLanguageDialog.vue'
import EndpointCapabilitiesDialog from './EndpointCapabilitiesDialog.vue'
import EndpointDeleteDialog from './EndpointDeleteDialog.vue'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const endpointStore = useEndpointStore()

// Dialog state
const showFormDialog = ref(false)
const showLanguageDialog = ref(false)
const showCapabilitiesDialog = ref(false)
const showDeleteDialog = ref(false)

// Dialog data
const editingEndpoint = ref<SPARQLEndpoint | undefined>(undefined)
const languageEndpoint = ref<SPARQLEndpoint | null>(null)
const capabilitiesEndpoint = ref<SPARQLEndpoint | null>(null)
const deleteTarget = ref<SPARQLEndpoint | null>(null)

// Example endpoints for quick add
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

// Form Dialog Handlers
function openAddDialog() {
  editingEndpoint.value = undefined
  showFormDialog.value = true
}

function openEditDialog(endpoint: SPARQLEndpoint) {
  editingEndpoint.value = endpoint
  showFormDialog.value = true
}

function handleFormSave(endpoint: SPARQLEndpoint, analysis?: SPARQLEndpoint['analysis']) {
  if (editingEndpoint.value) {
    // Update existing endpoint
    endpointStore.updateEndpoint(editingEndpoint.value.id, {
      name: endpoint.name,
      url: endpoint.url,
      auth: endpoint.auth,
    })
  } else {
    // Add new endpoint
    const newEndpoint = endpointStore.addEndpoint({
      name: endpoint.name,
      url: endpoint.url,
      auth: endpoint.auth,
    })

    // Auto-select and update with analysis
    endpointStore.selectEndpoint(newEndpoint.id)
    if (analysis) {
      endpointStore.updateEndpoint(newEndpoint.id, { analysis })
    }
    endpointStore.setStatus('connected')
  }
}

// Language Dialog Handlers
function openLanguageDialog(endpoint: SPARQLEndpoint) {
  languageEndpoint.value = endpoint
  showLanguageDialog.value = true
}

function handleLanguageSave(endpoint: SPARQLEndpoint, priorities: string[]) {
  endpointStore.updateEndpoint(endpoint.id, {
    languagePriorities: priorities,
  })
}

// Capabilities Dialog Handlers
function openCapabilitiesDialog(endpoint: SPARQLEndpoint) {
  capabilitiesEndpoint.value = endpoint
  showCapabilitiesDialog.value = true
}

function handleCapabilitiesAnalyzed(endpoint: SPARQLEndpoint, analysis: SPARQLEndpoint['analysis']) {
  endpointStore.updateEndpoint(endpoint.id, { analysis })
  // Update the ref to show new data
  capabilitiesEndpoint.value = endpointStore.endpoints.find(e => e.id === endpoint.id) || null
}

// Delete Dialog Handlers
function handleDelete(endpoint: SPARQLEndpoint) {
  deleteTarget.value = endpoint
  showDeleteDialog.value = true
}

function handleDeleteConfirm(endpoint: SPARQLEndpoint) {
  endpointStore.removeEndpoint(endpoint.id)
}

// Connection Handler
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

// Utility Functions
function formatDate(dateStr?: string) {
  if (!dateStr) return '-'
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString()
  } catch {
    return '-'
  }
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
                  @click="openAddDialog"
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

  <!-- Child Dialogs -->
  <EndpointFormDialog
    v-model:visible="showFormDialog"
    :endpoint="editingEndpoint"
    @save="handleFormSave"
  />

  <EndpointLanguageDialog
    v-model:visible="showLanguageDialog"
    :endpoint="languageEndpoint"
    @save="handleLanguageSave"
  />

  <EndpointCapabilitiesDialog
    v-model:visible="showCapabilitiesDialog"
    :endpoint="capabilitiesEndpoint"
    @analyzed="handleCapabilitiesAnalyzed"
  />

  <EndpointDeleteDialog
    v-model:visible="showDeleteDialog"
    :endpoint="deleteTarget"
    @confirm="handleDeleteConfirm"
  />
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

.empty-state {
  padding: 2rem;
  text-align: center;
  color: var(--p-text-muted-color);
}

.empty-state p {
  margin: 0 0 1rem 0;
}

.example-endpoints {
  margin-top: 1rem;
}

.example-list {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.5rem;
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
  font-size: 0.625rem;
}

.url-cell {
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.action-buttons {
  display: flex;
  gap: 0.25rem;
  justify-content: flex-end;
}
</style>
