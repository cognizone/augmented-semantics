<script setup lang="ts">
/**
 * WizardStepBasicInfo - Step 1 of the endpoint wizard
 *
 * Handles endpoint name, URL, and authentication configuration.
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import type { EndpointSecurityCheck, EndpointTrust } from '../../services/security'
import type { TestResult } from '../../composables/useEndpointTest'
import Button from 'primevue/button'
import Select from 'primevue/select'
import Message from 'primevue/message'
import Divider from 'primevue/divider'
import Tag from 'primevue/tag'

export interface BasicInfoForm {
  name: string
  url: string
  authType: 'none' | 'basic' | 'apikey' | 'bearer'
  username: string
  password: string
  headerName: string
  apiKey: string
  token: string
}

const props = defineProps<{
  form: BasicInfoForm
  formValid: boolean
  securityCheck: EndpointSecurityCheck | null
  trustCheck: EndpointTrust | null
  testing: boolean
  testResult: TestResult | null
  isEditing: boolean
}>()

const emit = defineEmits<{
  'update:form': [form: BasicInfoForm]
  test: []
  next: []
  close: []
}>()

const authOptions = [
  { label: 'None', value: 'none' },
  { label: 'Basic Auth', value: 'basic' },
  { label: 'API Key', value: 'apikey' },
  { label: 'Bearer Token', value: 'bearer' },
]

// Helper to update form fields
function updateField<K extends keyof BasicInfoForm>(key: K, value: BasicInfoForm[K]) {
  emit('update:form', { ...props.form, [key]: value })
}

// Trust indicator helpers
const trustSeverity = (level: string) => {
  if (level === 'trusted') return 'success'
  if (level === 'warning') return 'warn'
  return 'secondary'
}

const trustLabel = (level: string) => {
  if (level === 'trusted') return 'Trusted'
  if (level === 'warning') return 'Warning'
  return 'Unknown'
}
</script>

<template>
  <div class="step-content">
    <!-- Name -->
    <div class="form-field">
      <label for="ep-name">Name</label>
      <input
        id="ep-name"
        :value="form.name"
        type="text"
        placeholder="My Endpoint"
        class="ae-input"
        @input="updateField('name', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <!-- URL -->
    <div class="form-field">
      <label for="ep-url">URL</label>
      <input
        id="ep-url"
        :value="form.url"
        type="text"
        placeholder="https://example.org/sparql"
        class="ae-input"
        :disabled="isEditing"
        @input="updateField('url', ($event.target as HTMLInputElement).value)"
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
        <Tag :severity="trustSeverity(trustCheck.level)">
          {{ trustLabel(trustCheck.level) }}
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
        :modelValue="form.authType"
        :options="authOptions"
        optionLabel="label"
        optionValue="value"
        @update:modelValue="updateField('authType', $event)"
      />
    </div>

    <!-- Basic Auth -->
    <template v-if="form.authType === 'basic'">
      <div class="form-row">
        <div class="form-field">
          <label for="ep-user">Username</label>
          <input
            id="ep-user"
            :value="form.username"
            type="text"
            class="ae-input"
            @input="updateField('username', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="form-field">
          <label for="ep-pass">Password</label>
          <input
            id="ep-pass"
            :value="form.password"
            type="password"
            class="ae-input"
            @input="updateField('password', ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>
    </template>

    <!-- API Key -->
    <template v-if="form.authType === 'apikey'">
      <div class="form-row">
        <div class="form-field">
          <label for="ep-header">Header Name</label>
          <input
            id="ep-header"
            :value="form.headerName"
            type="text"
            class="ae-input"
            @input="updateField('headerName', ($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="form-field">
          <label for="ep-apikey">API Key</label>
          <input
            id="ep-apikey"
            :value="form.apiKey"
            type="password"
            class="ae-input"
            @input="updateField('apiKey', ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>
    </template>

    <!-- Bearer Token -->
    <template v-if="form.authType === 'bearer'">
      <div class="form-field">
        <label for="ep-token">Token</label>
        <input
          id="ep-token"
          :value="form.token"
          type="password"
          class="ae-input"
          @input="updateField('token', ($event.target as HTMLInputElement).value)"
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
  </div>

  <div class="step-footer">
    <Button
      label="Test Connection"
      icon="pi pi-sync"
      severity="secondary"
      outlined
      :loading="testing"
      :disabled="!formValid"
      @click="$emit('test')"
    />
    <div class="footer-right">
      <Button
        label="Cancel"
        severity="secondary"
        text
        @click="$emit('close')"
      />
      <Button
        label="Next"
        icon="pi pi-arrow-right"
        iconPos="right"
        :disabled="!formValid"
        @click="$emit('next')"
      />
    </div>
  </div>
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
