<script setup lang="ts">
/**
 * EndpointFormDialog - Add/Edit SPARQL endpoint form dialog
 *
 * Provides form for creating or editing SPARQL endpoints with:
 * - Name and URL input
 * - Authentication configuration (Basic, API Key, Bearer)
 * - Security warnings
 * - Connection testing
 * - Automatic analysis for new endpoints
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import { computed, watch } from 'vue'
import { useEndpointForm, useEndpointTest, useEndpointAnalysis } from '../../composables'
import { testConnection, analyzeEndpoint } from '../../services/sparql'
import type { SPARQLEndpoint } from '../../types'

import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Message from 'primevue/message'
import Tag from 'primevue/tag'
import Divider from 'primevue/divider'

const props = defineProps<{
  visible: boolean
  endpoint?: SPARQLEndpoint
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  save: [endpoint: SPARQLEndpoint, analysis?: SPARQLEndpoint['analysis']]
}>()

// Form state
const { form, formValid, securityCheck, trustCheck, resetForm, loadEndpoint, useExample, buildEndpoint } = useEndpointForm()
const { testing, testResult, testConnection: testConn, clearResult } = useEndpointTest()
const { analyzing, analyzeStep, analyzeElapsed } = useEndpointAnalysis()

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

// Watch for endpoint changes (edit mode)
watch(() => props.endpoint, (endpoint) => {
  if (endpoint) {
    loadEndpoint(endpoint)
  } else {
    resetForm()
  }
}, { immediate: true })

// Clear test result when dialog closes
watch(() => props.visible, (visible) => {
  if (!visible) {
    clearResult()
    resetForm()
  }
})

async function handleTest() {
  const tempEndpoint = buildEndpoint('test')
  await testConn(tempEndpoint)
}

async function handleSave() {
  if (!formValid.value) return

  if (isEditing.value && props.endpoint) {
    // Edit mode - just save the changes
    const updated: SPARQLEndpoint = {
      ...props.endpoint,
      name: form.name,
      url: form.url,
      auth: form.authType === 'none' ? undefined : buildEndpoint().auth,
    }
    emit('save', updated)
    emit('update:visible', false)
  } else {
    // Add mode - test, analyze, then save
    const newEndpoint = buildEndpoint()

    analyzing.value = true
    analyzeStep.value = 'Testing connection...'

    try {
      // Step 1: Test connection
      const connectionResult = await testConnection(newEndpoint)
      if (!connectionResult.success) {
        throw new Error(connectionResult.error?.message || 'Connection failed')
      }

      // Step 2: Analyze endpoint
      analyzeStep.value = 'Analyzing endpoint structure...'
      const analysis = await analyzeEndpoint(newEndpoint)

      analyzeStep.value = 'Done!'

      // Brief delay to show "Done!" before closing
      await new Promise(resolve => setTimeout(resolve, 500))

      emit('save', newEndpoint, {
        supportsNamedGraphs: analysis.supportsNamedGraphs,
        graphCount: analysis.graphCount,
        graphCountExact: analysis.graphCountExact,
        hasDuplicateTriples: analysis.hasDuplicateTriples,
        analyzedAt: analysis.analyzedAt,
      })
      emit('update:visible', false)

      analyzing.value = false
      analyzeStep.value = null
    } catch (e) {
      analyzeStep.value = `Error: ${e instanceof Error ? e.message : 'Unknown error'}`
      // Keep dialog open on error so user can see what went wrong
      analyzing.value = false
    }
  }
}

function handleClose() {
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    :header="isEditing ? 'Edit Endpoint' : 'Add Endpoint'"
    :style="{ width: '500px' }"
    :modal="true"
    :closable="true"
    @update:visible="$emit('update:visible', $event)"
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
            @click="handleClose"
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
.form-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

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

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.footer-right {
  display: flex;
  gap: 0.5rem;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
