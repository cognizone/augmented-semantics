<script setup lang="ts">
/**
 * EndpointSelector - Dropdown for selecting active SPARQL endpoint
 *
 * Displays connection status and provides access to EndpointManager.
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import { computed } from 'vue'
import { useEndpointStore } from '../../stores'
import { useElapsedTime } from '../../composables'
import Select from 'primevue/select'
import Button from 'primevue/button'
import Tag from 'primevue/tag'

const emit = defineEmits<{
  manage: []
}>()

const endpointStore = useEndpointStore()

// Track elapsed time when connecting
const isConnecting = computed(() => endpointStore.status === 'connecting')
const connectingElapsed = useElapsedTime(isConnecting)

const selectedId = computed({
  get: () => endpointStore.currentId,
  set: (id: string | null) => endpointStore.selectEndpoint(id),
})

const dropdownOptions = computed(() => {
  return endpointStore.sortedEndpoints.map(ep => ({
    label: ep.name,
    value: ep.id,
    url: ep.url,
  }))
})

const statusSeverity = computed(() => {
  switch (endpointStore.status) {
    case 'connected':
      return 'success'
    case 'connecting':
      return 'warn'
    case 'error':
      return 'danger'
    default:
      return 'secondary'
  }
})

const statusLabel = computed(() => {
  switch (endpointStore.status) {
    case 'connected':
      return 'Connected'
    case 'connecting':
      return connectingElapsed.show.value
        ? `Connecting... (${connectingElapsed.elapsed.value}s)`
        : 'Connecting...'
    case 'error':
      return 'Error'
    default:
      return 'Disconnected'
  }
})
</script>

<template>
  <div class="endpoint-selector">
    <Select
      v-model="selectedId"
      :options="dropdownOptions"
      optionLabel="label"
      optionValue="value"
      placeholder="Select Endpoint"
      class="endpoint-dropdown"
      :loading="endpointStore.status === 'connecting'"
    >
      <template #value="slotProps">
        <div v-if="slotProps.value" class="selected-endpoint">
          <span class="endpoint-name">{{ endpointStore.current?.name }}</span>
          <Tag :severity="statusSeverity" class="status-tag">
            {{ statusLabel }}
          </Tag>
        </div>
        <span v-else class="placeholder">Select Endpoint</span>
      </template>
      <template #option="slotProps">
        <div class="endpoint-option">
          <span class="endpoint-name">{{ slotProps.option.label }}</span>
          <span class="endpoint-url">{{ slotProps.option.url }}</span>
        </div>
      </template>
    </Select>
    <Button
      icon="pi pi-cog"
      severity="secondary"
      text
      rounded
      aria-label="Manage Endpoints"
      @click="emit('manage')"
    />
  </div>
</template>

<style scoped>
.endpoint-selector {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.endpoint-dropdown {
  min-width: 200px;
}

.selected-endpoint {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.endpoint-name {
  font-weight: 500;
  font-size: 0.8125rem;
}

.status-tag {
  font-size: 0.75rem;
  padding: 0.15rem 0.4rem;
}

.endpoint-option {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.endpoint-url {
  font-size: 0.75rem;
  color: var(--ae-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 250px;
}

.placeholder {
  color: var(--ae-text-muted);
}
</style>
