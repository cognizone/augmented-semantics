<script setup lang="ts">
/**
 * RdfView - main RDF browser layout.
 *
 * T1 shell: shows a connect prompt until an endpoint is selected.
 * T3 adds the type-list sidebar; T4/T5 fill the main pane (resource view,
 * instance list).
 *
 * @see /spec/ae-rdf
 */
import { computed } from 'vue'
import { useEndpointStore } from '../stores'

const endpointStore = useEndpointStore()
const hasEndpoint = computed(() => !!endpointStore.current)
</script>

<template>
  <div class="rdf-view">
    <div v-if="!hasEndpoint" class="empty-state">
      <span class="material-symbols-outlined empty-icon">database</span>
      <h2>No endpoint selected</h2>
      <p>Pick or add a SPARQL endpoint from the menu in the header to start browsing.</p>
    </div>

    <div v-else class="connected-state">
      <span class="material-symbols-outlined empty-icon">hub</span>
      <h2>Connected to {{ endpointStore.current?.name }}</h2>
      <p>Type discovery and resource browsing arrive in the next steps.</p>
    </div>
  </div>
</template>

<style scoped>
.rdf-view {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  width: 100%;
}

.empty-state,
.connected-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  text-align: center;
  color: var(--ae-text-secondary);
  max-width: 420px;
  padding: 2rem;
}

.empty-icon {
  font-size: 56px;
  color: var(--ae-text-muted);
}

.empty-state h2,
.connected-state h2 {
  margin: 0;
  font-size: 1.125rem;
  color: var(--ae-text-primary);
}

.empty-state p,
.connected-state p {
  margin: 0;
  font-size: 0.875rem;
}
</style>
