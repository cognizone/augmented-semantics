<script setup lang="ts">
/**
 * ResourceView - shows a resource's label, URI and outgoing properties.
 *
 * Reads the current resource from the browse store, loads its triples, and
 * walks links by pushing ?resource to the URL (RdfView syncs URL -> store).
 *
 * @see /spec/ae-rdf
 */
import { computed, ref, watch } from 'vue'
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
const showGraphs = ref(false)

function qname(u: string): string {
  const r = resolved.value.get(u)
  if (r && r.prefix) return `${r.prefix}:${r.localName}`
  if (r && r.localName) return r.localName
  return u
}

// Union of graphs the resource's triples assert in (provenance summary).
const graphSummary = computed(() => {
  const set = new Set<string>()
  let hasDefault = false
  for (const group of triples.value) {
    for (const o of group.objects) {
      if (o.graphs.length) o.graphs.forEach(g => set.add(g))
      else hasDefault = true
    }
  }
  return { graphs: [...set], hasDefault }
})

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

      <!-- Graph provenance summary + per-triple reveal toggle -->
      <div v-if="!showLoading && !error && triples.length" class="resource-graphs">
        <span class="material-symbols-outlined graph-icon">hub</span>
        <span class="graph-summary">
          <template v-if="graphSummary.graphs.length">
            <span v-for="g in graphSummary.graphs" :key="g" class="graph-chip" :title="g">{{ qname(g) }}</span>
            <span v-if="graphSummary.hasDefault" class="graph-chip default">default graph</span>
          </template>
          <span v-else class="graph-chip default">default graph</span>
        </span>
        <button class="graph-toggle" :class="{ on: showGraphs }" @click="showGraphs = !showGraphs">
          {{ showGraphs ? 'Hide graphs' : 'Show graphs' }}
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

    <PropertyTable v-else :groups="triples" :resolved="resolved" :show-graphs="showGraphs" @navigate="navigate" />
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

.resource-graphs {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}

.graph-icon {
  font-size: 16px;
  color: var(--ae-text-muted);
}

.graph-summary {
  display: inline-flex;
  gap: 0.25rem;
  flex-wrap: wrap;
}

.graph-chip {
  font-family: var(--ae-font-mono);
  font-size: 0.6875rem;
  padding: 0.05rem 0.45rem;
  border: 1px solid var(--ae-border-color);
  border-radius: 10px;
  color: var(--ae-text-secondary);
}

.graph-chip.default {
  font-style: italic;
}

.graph-toggle {
  margin-left: 0.25rem;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.6875rem;
  color: var(--ae-accent);
  padding: 0.1rem 0.25rem;
  border-radius: 4px;
}

.graph-toggle:hover {
  background: var(--ae-bg-hover);
}

.graph-toggle.on {
  font-weight: 600;
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
