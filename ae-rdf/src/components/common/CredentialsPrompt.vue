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
import { reactive, computed, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { useEndpointStore } from '../../stores'

const store = useEndpointStore()
const ep = computed(() => store.pendingCredentialsEndpoint)
const authType = computed(() => ep.value?.auth?.type ?? 'none')

const creds = reactive({ username: '', password: '', apiKey: '', token: '', headerName: 'X-API-Key' })

// Reset the fields whenever a new endpoint asks for credentials.
watch(ep, (e) => {
  creds.username = ''
  creds.password = ''
  creds.apiKey = ''
  creds.token = ''
  creds.headerName = e?.auth?.credentials?.headerName || 'X-API-Key'
})

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

function connect() {
  if (!valid.value) return
  if (authType.value === 'basic') store.provideCredentials({ username: creds.username, password: creds.password })
  else if (authType.value === 'bearer') store.provideCredentials({ token: creds.token })
  else if (authType.value === 'apikey') store.provideCredentials({ apiKey: creds.apiKey, headerName: creds.headerName })
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

      <!-- Submit on Enter without a visible button duplicate -->
      <button type="submit" hidden></button>
    </form>

    <template #footer>
      <Button label="Cancel" text @click="store.cancelCredentials()" />
      <Button label="Connect" icon="pi pi-check" :disabled="!valid" @click="connect" />
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
