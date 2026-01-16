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
import type { SPARQLEndpoint, SuggestedEndpoint } from '../../types'

import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'

import EndpointWizard from './EndpointWizard.vue'
import EndpointDeleteDialog from './EndpointDeleteDialog.vue'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const endpointStore = useEndpointStore()

// Banner state
const showInfoBanner = ref(true)

// Suggested endpoints collapsed state (persisted)
const SUGGESTED_COLLAPSED_KEY = 'ae-suggested-endpoints-collapsed'
const suggestedCollapsed = ref(localStorage.getItem(SUGGESTED_COLLAPSED_KEY) === 'true')

function toggleSuggestedCollapsed() {
  suggestedCollapsed.value = !suggestedCollapsed.value
  localStorage.setItem(SUGGESTED_COLLAPSED_KEY, String(suggestedCollapsed.value))
}

// Dialog state
const showWizard = ref(false)
const showDeleteDialog = ref(false)

// Dialog data
const wizardEndpoint = ref<SPARQLEndpoint | undefined>(undefined)
const deleteTarget = ref<SPARQLEndpoint | null>(null)

// Connection testing state
const testingEndpointId = ref<string | null>(null)

// Computed
const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

// Wizard Handlers
function openAddWizard() {
  wizardEndpoint.value = undefined
  showWizard.value = true
}

function openConfigureWizard(endpoint: SPARQLEndpoint) {
  wizardEndpoint.value = endpoint
  showWizard.value = true
}

function handleWizardSave(endpoint: SPARQLEndpoint) {
  if (wizardEndpoint.value) {
    // Update existing endpoint
    endpointStore.updateEndpoint(wizardEndpoint.value.id, {
      name: endpoint.name,
      url: endpoint.url,
      auth: endpoint.auth,
      analysis: endpoint.analysis,
      languagePriorities: endpoint.languagePriorities,
    })
  } else {
    // Add new endpoint
    const newEndpoint = endpointStore.addEndpoint({
      name: endpoint.name,
      url: endpoint.url,
      auth: endpoint.auth,
    })

    if (newEndpoint) {
      // Update with analysis and language priorities
      endpointStore.updateEndpoint(newEndpoint.id, {
        analysis: endpoint.analysis,
        languagePriorities: endpoint.languagePriorities,
      })

      // Auto-select and set connected
      endpointStore.selectEndpoint(newEndpoint.id)
      endpointStore.setStatus('connected')
    }
  }
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
async function handleTestConnection(endpoint: SPARQLEndpoint) {
  testingEndpointId.value = endpoint.id

  const result = await testConnection(endpoint)
  if (result.success) {
    endpointStore.selectEndpoint(endpoint.id)
    endpointStore.setStatus('connected')
  } else {
    endpointStore.setStatus('error')
    endpointStore.setError(result.error!)
  }

  testingEndpointId.value = null
}

// Suggested Endpoint Handlers
function handleAddSuggestedEndpoint(suggested: SuggestedEndpoint) {
  const newEndpoint = endpointStore.addSuggestedEndpoint(suggested)
  if (newEndpoint) {
    endpointStore.selectEndpoint(newEndpoint.id)
    endpointStore.setStatus('connected')
  }
}

// Utility Functions
// Note: This is for UI timestamps (lastAccessedAt), not RDF dates.
// For RDF dates use formatTemporalValue from displayUtils.
function formatUIDate(dateStr?: string) {
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
    :style="{ width: '900px' }"
    :modal="true"
    :closable="true"
    position="top"
  >
    <div class="endpoint-manager-content">
      <!-- Info Banner -->
      <div v-if="showInfoBanner" class="info-banner">
        <span class="material-symbols-outlined info-icon">info</span>
        <div class="info-content">
          <span class="info-title">Configuration Wizard Enabled</span>
          <span class="info-text">
            Managing endpoints is now more powerful. Clicking
            <strong>Add Endpoint</strong> or the
            <span class="icon-badge"><span class="material-symbols-outlined">tune</span></span>
            configuration action will launch the new multi-step setup flow.
          </span>
        </div>
        <button class="dismiss-btn" @click="showInfoBanner = false" aria-label="Dismiss">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <!-- Suggested Endpoints -->
      <div v-if="endpointStore.availableSuggestedEndpoints.length > 0" class="suggested-section">
        <button class="suggested-header" @click="toggleSuggestedCollapsed">
          <span class="material-symbols-outlined">verified</span>
          <span class="suggested-header-text">Suggested Endpoints</span>
          <span class="suggested-count">{{ endpointStore.availableSuggestedEndpoints.length }}</span>
          <span class="material-symbols-outlined chevron" :class="{ 'chevron-collapsed': suggestedCollapsed }">
            expand_more
          </span>
        </button>
        <div v-show="!suggestedCollapsed" class="suggested-list">
          <div
            v-for="suggested in endpointStore.availableSuggestedEndpoints"
            :key="suggested.url"
            class="suggested-item"
          >
            <div class="suggested-info">
              <span class="suggested-name">{{ suggested.name }}</span>
              <span v-if="suggested.description" class="suggested-description">{{ suggested.description }}</span>
              <span class="suggested-url">{{ suggested.url }}</span>
              <div v-if="suggested.analysis.languages && suggested.analysis.languages.length > 0" class="suggested-langs">
                <Tag
                  v-for="lang in suggested.analysis.languages.slice(0, 3)"
                  :key="lang.lang"
                  severity="secondary"
                  class="lang-tag"
                >
                  {{ lang.lang }}
                </Tag>
                <span v-if="suggested.analysis.languages.length > 3" class="more-langs">
                  +{{ suggested.analysis.languages.length - 3 }}
                </span>
              </div>
            </div>
            <Button
              label="Add"
              size="small"
              severity="secondary"
              outlined
              @click="handleAddSuggestedEndpoint(suggested)"
            >
              <template #icon>
                <span class="material-symbols-outlined btn-icon-small">add</span>
              </template>
            </Button>
          </div>
        </div>
      </div>

      <!-- Header -->
      <div class="list-header">
        <h3>Saved Endpoints</h3>
        <Button
          label="Add Endpoint"
          size="small"
          class="add-endpoint-btn"
          @click="openAddWizard"
        >
          <template #icon>
            <span class="material-symbols-outlined btn-icon">add</span>
          </template>
        </Button>
      </div>

      <!-- Endpoint Table -->
      <DataTable
        :value="endpointStore.sortedEndpoints"
        :rows="5"
        paginator
        paginatorTemplate="PrevPageLink CurrentPageReport NextPageLink"
        currentPageReportTemplate="Showing {first} to {last} of {totalRecords} entries"
        class="endpoints-table"
        stripedRows
      >
        <template #empty>
          <div class="empty-state">
            <span class="material-symbols-outlined empty-icon">dns</span>
            <p>No endpoints configured yet.</p>
            <p class="empty-hint">Click "Add Endpoint" to get started.</p>
          </div>
        </template>

        <Column field="name" header="Name" sortable :style="{ width: '25%' }">
          <template #body="{ data }">
            <div class="endpoint-name-cell">
              <span class="endpoint-name">{{ data.name }}</span>
              <Tag
                v-if="data.id === endpointStore.currentId"
                severity="success"
                class="active-tag"
              >
                Active
              </Tag>
            </div>
          </template>
        </Column>

        <Column field="url" header="URL" :style="{ width: '40%' }">
          <template #body="{ data }">
            <span class="url-cell">{{ data.url }}</span>
          </template>
        </Column>

        <Column field="lastAccessedAt" header="Last Used" sortable :style="{ width: '15%' }">
          <template #body="{ data }">
            <span class="date-cell">{{ formatUIDate(data.lastAccessedAt) }}</span>
          </template>
        </Column>

        <Column header="Actions" :style="{ width: '20%' }">
          <template #body="{ data }">
            <div class="action-buttons">
              <button
                class="action-btn action-btn-link"
                :class="{ 'action-btn-disabled': data.id === endpointStore.currentId }"
                :disabled="data.id === endpointStore.currentId || testingEndpointId === data.id"
                title="Check connection"
                @click="handleTestConnection(data)"
              >
                <span v-if="testingEndpointId === data.id" class="material-symbols-outlined spinning">sync</span>
                <span v-else class="material-symbols-outlined">link</span>
              </button>
              <div class="action-divider"></div>
              <button
                class="action-btn action-btn-configure"
                title="Configure Endpoint"
                @click="openConfigureWizard(data)"
              >
                <span class="material-symbols-outlined">tune</span>
              </button>
              <button
                class="action-btn action-btn-delete"
                title="Delete"
                @click="handleDelete(data)"
              >
                <span class="material-symbols-outlined">delete</span>
              </button>
            </div>
          </template>
        </Column>
      </DataTable>
    </div>
  </Dialog>

  <!-- Child Dialogs -->
  <EndpointWizard
    v-model:visible="showWizard"
    :endpoint="wizardEndpoint"
    @save="handleWizardSave"
  />

  <EndpointDeleteDialog
    v-model:visible="showDeleteDialog"
    :endpoint="deleteTarget"
    @confirm="handleDeleteConfirm"
  />
</template>

<style scoped>
.endpoint-manager-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Info Banner */
.info-banner {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem;
  background: var(--ae-accent-bg, rgba(0, 122, 204, 0.08));
  border: 1px solid var(--ae-accent-border, rgba(0, 122, 204, 0.2));
  border-radius: 0.375rem;
}

.info-icon {
  color: var(--ae-accent);
  font-size: 1.25rem;
  flex-shrink: 0;
  margin-top: 0.125rem;
}

.info-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.info-title {
  font-weight: 600;
  color: var(--ae-text-primary);
  font-size: 0.8125rem;
}

.info-text {
  font-size: 0.8125rem;
  color: var(--ae-text-secondary);
  line-height: 1.5;
}

.icon-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 0.25rem;
  padding: 0 0.25rem;
  height: 1.25rem;
  vertical-align: middle;
  margin: 0 0.125rem;
}

.icon-badge .material-symbols-outlined {
  font-size: 0.875rem;
  color: var(--ae-accent);
}

.dismiss-btn {
  background: none;
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  color: var(--ae-text-muted);
  border-radius: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dismiss-btn:hover {
  background: var(--ae-bg-hover);
  color: var(--ae-text-primary);
}

.dismiss-btn .material-symbols-outlined {
  font-size: 1.125rem;
}

/* Suggested Endpoints */
.suggested-section {
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 0.375rem;
  padding: 1rem;
}

.suggested-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0;
  margin: 0;
  background: none;
  border: none;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--ae-text-primary);
  cursor: pointer;
  text-align: left;
}

.suggested-header:hover {
  color: var(--ae-accent);
}

.suggested-header .material-symbols-outlined {
  font-size: 1.125rem;
  color: var(--ae-accent);
}

.suggested-header-text {
  flex: 1;
}

.suggested-count {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--ae-text-muted);
  background: var(--ae-bg-surface);
  padding: 0.125rem 0.5rem;
  border-radius: 1rem;
}

.chevron {
  color: var(--ae-text-muted);
  transition: transform 0.2s ease;
}

.chevron-collapsed {
  transform: rotate(-90deg);
}

.suggested-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.suggested-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem;
  background: var(--ae-bg-surface);
  border: 1px solid var(--ae-border-color);
  border-radius: 0.25rem;
}

.suggested-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.suggested-name {
  font-weight: 500;
  color: var(--ae-text-primary);
  font-size: 0.8125rem;
}

.suggested-description {
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
  line-height: 1.4;
}

.suggested-url {
  font-family: var(--ae-font-mono);
  font-size: 0.75rem;
  color: var(--ae-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suggested-langs {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.25rem;
}

.suggested-langs .lang-tag {
  font-size: 0.625rem;
  padding: 0.125rem 0.375rem;
}

.more-langs {
  font-size: 0.625rem;
  color: var(--ae-text-muted);
}

.btn-icon-small {
  font-size: 1rem;
  margin-right: 0.125rem;
}

/* List Header */
.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.list-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--ae-text-primary);
}

.add-endpoint-btn {
  background: var(--ae-accent) !important;
  border-color: var(--ae-accent) !important;
}

.add-endpoint-btn:hover {
  background: var(--ae-accent-hover, #005a9e) !important;
  border-color: var(--ae-accent-hover, #005a9e) !important;
}

.btn-icon {
  font-size: 1.125rem;
  margin-right: 0.25rem;
}

/* Table */
.endpoints-table {
  font-size: 0.8125rem;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 3rem 2rem;
  color: var(--ae-text-muted);
}

.empty-icon {
  font-size: 2.5rem;
  opacity: 0.4;
}

.empty-state p {
  margin: 0;
}

.empty-hint {
  font-size: 0.75rem;
}

/* Table Cells */
.endpoint-name-cell {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.endpoint-name {
  font-weight: 500;
  color: var(--ae-text-primary);
}

.active-tag {
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.url-cell {
  font-family: var(--ae-font-mono);
  font-size: 0.75rem;
  color: var(--ae-text-muted);
}

.date-cell {
  color: var(--ae-text-secondary);
  font-variant-numeric: tabular-nums;
}

/* Action Buttons */
.action-buttons {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}

.action-btn {
  background: none;
  border: none;
  padding: 0.375rem;
  cursor: pointer;
  border-radius: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.action-btn .material-symbols-outlined {
  font-size: 1.25rem;
}

.action-btn-link {
  color: var(--ae-text-muted);
}

.action-btn-link:hover:not(:disabled) {
  color: var(--ae-accent);
  background: var(--ae-bg-hover);
}

.action-btn-configure {
  color: var(--ae-accent);
}

.action-btn-configure:hover {
  color: var(--ae-accent);
  background: var(--ae-bg-hover);
  transform: scale(1.1);
}

.action-btn-delete {
  color: var(--ae-text-muted);
}

.action-btn-delete:hover {
  color: var(--ae-status-error);
  background: var(--ae-bg-hover);
}

.action-btn-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.action-divider {
  width: 1px;
  height: 1rem;
  background: var(--ae-border-color);
}

/* Spinning animation for loading state */
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.spinning {
  animation: spin 1s linear infinite;
}
</style>
