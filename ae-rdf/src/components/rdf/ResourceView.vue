<script setup lang="ts">
/**
 * ResourceView - shows a resource's label, URI and outgoing properties.
 *
 * Reads the current resource from the browse store, loads its triples, and
 * walks links by pushing ?resource to the URL (RdfView syncs URL -> store).
 *
 * @see /spec/ae-rdf
 */
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ProgressSpinner from 'primevue/progressspinner'
import { useBrowseStore } from '../../stores'
import { useResourceView, useClipboard, useDelayedLoading } from '../../composables'
import PropertyTable from './PropertyTable.vue'

const route = useRoute()
const router = useRouter()
const browseStore = useBrowseStore()
const { copyToClipboard } = useClipboard()
const { triples, label, loading, error, resolved, loadResource } = useResourceView()
const showLoading = useDelayedLoading(loading)

const uri = computed(() => browseStore.currentResource)

const localName = computed(() => {
  const u = uri.value
  if (!u) return ''
  const seg = u.split(/[#/]/).filter(Boolean).pop()
  return seg || u
})

const heading = computed(() => label.value || localName.value)

watch(
  uri,
  (u) => {
    if (u) loadResource(u)
  },
  { immediate: true }
)

function navigate(target: string) {
  router.push({ query: { ...route.query, resource: target } })
}
</script>

<template>
  <div v-if="uri" class="resource-view">
    <header class="resource-header">
      <h2 class="resource-title">{{ heading }}</h2>
      <div class="resource-uri-row">
        <a :href="uri" target="_blank" rel="noopener" class="resource-uri" :title="uri">{{ uri }}</a>
        <button class="copy-btn" aria-label="Copy URI" title="Copy URI" @click="copyToClipboard(uri, 'URI')">
          <span class="material-symbols-outlined">content_copy</span>
        </button>
      </div>
    </header>

    <div v-if="showLoading" class="state">
      <ProgressSpinner style="width: 32px; height: 32px" strokeWidth="4" />
    </div>

    <div v-else-if="error" class="state error">
      <span class="material-symbols-outlined">error</span>
      <p>{{ error }}</p>
    </div>

    <div v-else-if="!triples.length" class="state">
      <p>No outgoing triples for this resource.</p>
    </div>

    <PropertyTable v-else :groups="triples" :resolved="resolved" @navigate="navigate" />
  </div>
</template>

<style scoped>
.resource-view {
  flex: 1;
  overflow: auto;
  padding: 1.25rem 1.5rem;
}

.resource-header {
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--ae-border-color);
}

.resource-title {
  margin: 0 0 0.25rem;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--ae-text-primary);
}

.resource-uri-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.resource-uri {
  font-family: var(--ae-font-mono);
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.resource-uri:hover {
  text-decoration: underline;
}

.copy-btn {
  display: inline-flex;
  align-items: center;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--ae-text-muted);
  padding: 0.125rem;
  border-radius: 4px;
  flex-shrink: 0;
}

.copy-btn:hover {
  color: var(--ae-text-primary);
  background: var(--ae-bg-hover);
}

.copy-btn .material-symbols-outlined {
  font-size: 16px;
}

.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem;
  color: var(--ae-text-secondary);
  font-size: 0.875rem;
}

.state.error {
  color: var(--ae-status-error);
}
</style>
