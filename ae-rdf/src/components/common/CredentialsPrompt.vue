<script setup lang="ts">
/**
 * CredentialsPrompt - asks for a secured endpoint's credentials at connect time.
 *
 * Credentials are never persisted (the endpoint store strips them on save), so
 * a secured endpoint prompts here each session. Driven entirely by the store's
 * `pendingCredentialsId`, set by selectEndpoint when an endpoint needs auth.
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import { reactive, ref, computed, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { useEndpointStore } from '../../stores'
import { testConnection } from '../../services'
import type { EndpointAuth } from '../../types'

const store = useEndpointStore()
const ep = computed(() => store.pendingCredentialsEndpoint)
const authType = computed(() => ep.value?.auth?.type ?? 'none')

const creds = reactive({ username: '', password: '', apiKey: '', token: '', headerName: 'X-API-Key' })
// Verifying the entered credentials against the endpoint before we accept them.
const testing = ref(false)
const authError = ref<string | null>(null)

// Reset the fields whenever a new endpoint asks for credentials.
watch(ep, (e) => {
  creds.username = ''
  creds.password = ''
  creds.apiKey = ''
  creds.token = ''
  creds.headerName = e?.auth?.credentials?.headerName || 'X-API-Key'
  authError.value = null
})

// Editing a field clears the last failure so the stale error doesn't linger.
watch(creds, () => { authError.value = null })

function enteredCredentials(): NonNullable<EndpointAuth['credentials']> {
  if (authType.value === 'basic') return { username: creds.username, password: creds.password }
  if (authType.value === 'bearer') return { token: creds.token }
  return { apiKey: creds.apiKey, headerName: creds.headerName }
}

const visible = computed({
  get: () => !!store.pendingCredentialsId,
  set: (v: boolean) => { if (!v) store.cancelCredentials() },
})

const valid = computed(() => {
  if (authType.value === 'basic') return !!creds.username && !!creds.password
  if (authType.value === 'bearer') return !!creds.token
  if (authType.value === 'apikey') return !!creds.apiKey
  return false
})

async function connect() {
  if (!valid.value || testing.value) return
  const endpoint = ep.value
  if (!endpoint) return

  const credentials = enteredCredentials()
  // Verify before accepting: test the credentials against the endpoint so a bad
  // password fails HERE, not later as a confusing "Failed to load instances:
  // Authentication required" on the first query.
  testing.value = true
  authError.value = null
  const candidate = { ...endpoint, auth: { type: authType.value, credentials } as EndpointAuth }
  const result = await testConnection(candidate)
  testing.value = false

  // A new endpoint may have taken over the prompt while we awaited.
  if (ep.value?.id !== endpoint.id) return

  if (result.success) {
    store.provideCredentials(credentials)
  } else {
    authError.value = result.error?.message ?? 'Connection failed'
  }
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    :header="`Connect to ${ep?.name ?? 'endpoint'}`"
    :modal="true"
    :style="{ width: '420px' }"
    position="top"
  >
    <form class="cred-form" @submit.prevent="connect">
      <p class="cred-note">Credentials are used for this session only and never saved.</p>

      <template v-if="authType === 'basic'">
        <label class="field">
          <span class="field-label">Username</span>
          <InputText v-model="creds.username" autofocus />
        </label>
        <label class="field">
          <span class="field-label">Password</span>
          <InputText v-model="creds.password" type="password" />
        </label>
      </template>

      <template v-else-if="authType === 'apikey'">
        <label class="field">
          <span class="field-label">Header name</span>
          <InputText v-model="creds.headerName" />
        </label>
        <label class="field">
          <span class="field-label">API key</span>
          <InputText v-model="creds.apiKey" type="password" autofocus />
        </label>
      </template>

      <template v-else-if="authType === 'bearer'">
        <label class="field">
          <span class="field-label">Token</span>
          <InputText v-model="creds.token" type="password" autofocus />
        </label>
      </template>

      <p v-if="authError" class="cred-error" role="alert">{{ authError }}</p>

      <!-- Submit on Enter without a visible button duplicate -->
      <button type="submit" hidden></button>
    </form>

    <template #footer>
      <Button label="Cancel" text :disabled="testing" @click="store.cancelCredentials()" />
      <Button
        :label="testing ? 'Connecting…' : 'Connect'"
        :icon="testing ? 'pi pi-spin pi-spinner' : 'pi pi-check'"
        :disabled="!valid || testing"
        @click="connect"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.cred-form {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.cred-note {
  margin: 0;
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
}

.cred-error {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--ae-status-error);
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
