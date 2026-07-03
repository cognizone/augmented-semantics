<script setup lang="ts">
/**
 * InstanceList - paged list of the selected type's instances.
 *
 * Click an instance → push ?resource → ResourceView. Pagination via PrimeVue
 * Paginator bound to the total distinct-instance count.
 *
 * @see /spec/ae-rdf
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ProgressSpinner from 'primevue/progressspinner'
import Paginator from 'primevue/paginator'
import InputText from 'primevue/inputtext'
import { useInstanceList, useDelayedLoading } from '../../composables'
import { URL_PARAMS } from '../../router'

const route = useRoute()
const router = useRouter()
const { instances, total, loading, error, page, pageSize, typeLabel, filter, setPage } = useInstanceList()
const showLoading = useDelayedLoading(loading)

const rangeLabel = computed(() => {
  if (!total.value) return '0'
  const from = page.value * pageSize + 1
  const to = Math.min((page.value + 1) * pageSize, total.value)
  return `${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} of ${total.value.toLocaleString('en-US')}`
})

// The COUNT is lazy and can fail (swallowed with a warn), leaving total=0. Fall
// back to what we've paged through so the paginator still renders and later
// pages stay reachable; a full page implies at least one more.
const effectiveTotal = computed(() => {
  if (total.value) return total.value
  const seen = page.value * pageSize + instances.value.length
  return instances.value.length >= pageSize ? seen + 1 : seen
})

function open(uri: string) {
  router.push({ query: { ...route.query, [URL_PARAMS.RESOURCE]: uri } })
}

function onPage(e: { page: number }) {
  setPage(e.page)
}
</script>

<template>
  <div class="instance-list">
    <header class="il-header">
      <h2 class="il-title">{{ typeLabel }}</h2>
      <div class="il-filter-wrap">
        <InputText
          v-model="filter"
          class="il-filter"
          placeholder="Filter by name or URI…"
          aria-label="Filter instances by name or URI"
          @keyup.escape="filter = ''"
        />
        <button
          v-if="filter"
          class="il-filter-clear"
          aria-label="Clear filter"
          @click="filter = ''"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <span class="il-range">{{ rangeLabel }}</span>
    </header>

    <div v-if="showLoading" class="state">
      <ProgressSpinner style="width: 32px; height: 32px" strokeWidth="4" />
    </div>

    <div v-else-if="error" class="state error">
      <span class="material-symbols-outlined">error</span>
      <p>{{ error }}</p>
    </div>

    <template v-else>
      <ul v-if="instances.length" class="il-items">
        <li v-for="inst in instances" :key="inst.uri">
          <button class="il-item" :title="inst.uri" @click="open(inst.uri)">
            <span class="il-label">{{ inst.label }}</span>
            <span class="il-uri">{{ inst.uri }}</span>
          </button>
        </li>
      </ul>

      <p v-else class="state">
        {{ filter.trim() ? `No instances match “${filter.trim()}”.` : 'No instances of this type.' }}
      </p>

      <Paginator
        v-if="effectiveTotal > pageSize"
        :rows="pageSize"
        :totalRecords="effectiveTotal"
        :first="page * pageSize"
        @page="onPage"
      />
    </template>
  </div>
</template>

<style scoped>
.instance-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.il-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.5rem 0.75rem;
  border-bottom: 1px solid var(--ae-border-color);
  flex-shrink: 0;
}

.il-filter-wrap {
  position: relative;
  display: flex;
  flex: 1;
  max-width: 340px;
}

.il-filter {
  flex: 1;
  font-size: 0.8125rem;
  padding-right: 2rem; /* room for the clear button */
}

.il-filter-clear {
  position: absolute;
  right: 0.25rem;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--ae-text-secondary);
}

.il-filter-clear:hover {
  color: var(--ae-text-primary);
}

.il-filter-clear .material-symbols-outlined {
  font-size: 16px;
}

.il-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  font-family: var(--ae-font-mono);
  color: var(--ae-text-primary);
}

.il-range {
  font-size: 0.6875rem;
  color: var(--ae-text-secondary);
  white-space: nowrap;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 10px;
  padding: 0.1rem 0.5rem;
}

.il-items {
  list-style: none;
  margin: 0;
  padding: 0.5rem;
  overflow-y: auto;
  flex: 1;
}

.il-item {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  transition: background-color 0.12s, box-shadow 0.12s;
}

.il-item:hover {
  background: var(--ae-bg-hover);
  box-shadow: inset 2px 0 0 var(--ae-accent);
}

.il-label {
  font-size: 0.875rem;
  color: var(--ae-text-primary);
  line-height: 1.35;
}

.il-uri {
  font-size: 0.6875rem;
  font-family: var(--ae-font-mono);
  color: var(--ae-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
