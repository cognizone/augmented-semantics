<script setup lang="ts">
/**
 * TypeList - sidebar listing the endpoint's rdf:types with instance counts.
 *
 * Selecting a type pushes ?type to the URL (T5 lists its instances).
 *
 * @see /spec/ae-rdf
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import ProgressSpinner from 'primevue/progressspinner'
import { useBrowseStore } from '../../stores'
import { useRdfTypes, useDelayedLoading } from '../../composables'
import { qname as toQname } from '../../utils/format'
import { URL_PARAMS } from '../../router'

const router = useRouter()
const browseStore = useBrowseStore()
const { types, loading, error, resolved } = useRdfTypes()
const showLoading = useDelayedLoading(loading)

const selected = computed(() => browseStore.currentType)

const qname = (uri: string) => toQname(uri, resolved.value)

function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

function selectType(uri: string) {
  // Drop ?resource so the instance list shows (resource view has precedence).
  router.push({ query: { [URL_PARAMS.TYPE]: uri } })
}
</script>

<template>
  <aside class="type-list">
    <div class="type-list-header">Types</div>

    <div v-if="showLoading" class="state">
      <ProgressSpinner style="width: 28px; height: 28px" strokeWidth="4" />
    </div>

    <div v-else-if="error" class="state error">
      <span class="material-symbols-outlined">error</span>
      <span>{{ error }}</span>
    </div>

    <p v-else-if="!types.length" class="state">No types found.</p>

    <ul v-else class="type-items">
      <li v-for="t in types" :key="t.uri">
        <button
          class="type-item"
          :class="{ active: selected === t.uri }"
          :title="t.uri"
          @click="selectType(t.uri)"
        >
          <span class="type-name">{{ qname(t.uri) }}</span>
          <span class="type-count">{{ formatCount(t.count) }}</span>
        </button>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.type-list {
  display: flex;
  flex-direction: column;
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid var(--ae-border-color);
  overflow: hidden;
  background: var(--ae-bg-elevated);
}

.type-list-header {
  padding: 0.75rem 1rem;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ae-text-secondary);
  border-bottom: 1px solid var(--ae-border-color);
  flex-shrink: 0;
}

.type-items {
  list-style: none;
  margin: 0;
  padding: 0.25rem;
  overflow-y: auto;
}

.type-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  color: var(--ae-text-primary);
}

.type-item:hover {
  background: var(--ae-bg-hover);
}

.type-item.active {
  background: var(--ae-bg-hover);
  box-shadow: inset 2px 0 0 var(--ae-accent);
}

.type-name {
  font-family: var(--ae-font-mono);
  font-size: 0.8125rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.type-count {
  font-size: 0.6875rem;
  color: var(--ae-text-secondary);
  background: var(--ae-bg-base);
  border-radius: 10px;
  padding: 0.05rem 0.45rem;
  flex-shrink: 0;
}

.state {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 1rem;
  font-size: 0.8125rem;
  color: var(--ae-text-secondary);
}

.state.error {
  color: var(--ae-status-error);
}
</style>
