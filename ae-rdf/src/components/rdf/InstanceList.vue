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
import { useSettingsStore } from '../../stores'
import ProgressSpinner from 'primevue/progressspinner'
import Paginator from 'primevue/paginator'
import InputText from 'primevue/inputtext'
import { useInstanceList, useDelayedLoading } from '../../composables'
import { setSparqlHandoff } from '../../utils/sparqlHandoff'
import { humanizeLocalName } from '../../utils/format'
import { URL_PARAMS } from '../../router'

const route = useRoute()
const router = useRouter()
const {
  instances, total, loading, error, page, pageSize, typeLabel, filter, orphansOnly, canFilterOrphans, columns, setPage, currentListQuery,
} = useInstanceList()
const showLoading = useDelayedLoading(loading)
const settings = useSettingsStore()

// List (table) vs. card/box layout — the header toggle and the Settings panel both
// bind to the one setting (default cards), so the choice is app-wide and consistent.
const viewMode = computed({
  get: () => settings.listView,
  set: v => { settings.listView = v },
})

// Column headings: explicit label, else the humanized predicate local name.
const columnHeaders = computed(() => columns.value.map(c => c.label?.trim() || humanizeLocalName(c.predicate)))

const rangeLabel = computed(() => {
  const shown = instances.value.length
  const from = page.value * pageSize + 1
  // Count is lazy and may still be in flight or have failed (swallowed → total=0).
  // Show the known visible range rather than a bogus "0" while rows are on screen;
  // a full page implies more, so mark it "+" until the real total lands.
  if (!total.value) {
    if (!shown) return '0'
    const to = page.value * pageSize + shown
    return `${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')}${shown >= pageSize ? '+' : ''}`
  }
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

// Hand the current filtered list off to the SPARQL panel as the query behind it
// (same type / graph / search / facets), so you can inspect or refine it.
function openInSparql() {
  const q = currentListQuery()
  if (!q) return
  setSparqlHandoff(q)
  router.push({ path: '/sparql' })
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
      <button
        v-if="canFilterOrphans"
        class="il-orphan-toggle"
        :class="{ active: orphansOnly }"
        :aria-pressed="orphansOnly"
        title="Show only instances with no owner — reachable only here"
        @click="orphansOnly = !orphansOnly"
      >
        <span class="material-symbols-outlined">link_off</span>
        Unreferenced
      </button>
      <button
        class="il-sparql-btn"
        title="Open this list as a SPARQL query"
        aria-label="Open this list as a SPARQL query"
        @click="openInSparql"
      >
        <span class="material-symbols-outlined">code</span>
        SPARQL
      </button>
      <div v-if="columns.length" class="il-view-toggle" role="group" aria-label="Result layout">
        <button
          :class="{ active: viewMode === 'list' }"
          :aria-pressed="viewMode === 'list'"
          title="Table view"
          @click="viewMode = 'list'"
        ><span class="material-symbols-outlined">table_rows</span></button>
        <button
          :class="{ active: viewMode === 'cards' }"
          :aria-pressed="viewMode === 'cards'"
          title="Card view"
          @click="viewMode = 'cards'"
        ><span class="material-symbols-outlined">view_agenda</span></button>
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
      <!-- Card / box layout — only for types that configure columns (else plain list). -->
      <div v-if="viewMode === 'cards' && columns.length && instances.length" class="il-cards">
        <button
          v-for="inst in instances"
          :key="inst.uri"
          class="il-card"
          :title="inst.uri"
          @click="open(inst.uri)"
        >
          <span class="il-card-title">{{ inst.label }}<span v-if="inst.deprecated" class="deprecated-badge">deprecated</span></span>
          <span class="il-card-meta">
            <span v-for="(header, i) in columnHeaders" :key="i" class="il-card-field">
              <span class="il-card-key">{{ header }}</span>
              <span class="il-card-val">{{ inst.cells?.[i] || '—' }}</span>
            </span>
          </span>
        </button>
      </div>

      <!-- Configured columns → a compact table; otherwise the plain label + URI list. -->
      <div v-else-if="columns.length && instances.length" class="il-table-wrap">
        <table class="il-table">
          <thead>
            <tr>
              <th>Name</th>
              <th v-for="(h, i) in columnHeaders" :key="i">{{ h }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="inst in instances" :key="inst.uri" class="il-row" :title="inst.uri" @click="open(inst.uri)">
              <td class="il-cell-name" :title="inst.label">{{ inst.label }}<span v-if="inst.deprecated" class="deprecated-badge">deprecated</span></td>
              <td v-for="(header, i) in columnHeaders" :key="i" :title="inst.cells?.[i] || header" class="il-cell">{{ inst.cells?.[i] || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <ul v-else-if="instances.length" class="il-items">
        <li v-for="inst in instances" :key="inst.uri">
          <button class="il-item" :title="inst.uri" @click="open(inst.uri)">
            <span class="il-label">{{ inst.label }}<span v-if="inst.deprecated" class="deprecated-badge">deprecated</span></span>
            <span class="il-uri">{{ inst.uri }}</span>
          </button>
        </li>
      </ul>

      <p v-else class="state">
        {{ filter.trim()
          ? `No ${orphansOnly ? 'unreferenced ' : ''}instances match “${filter.trim()}”.`
          : orphansOnly ? 'No unreferenced instances — all have an owner.' : 'No instances of this type.' }}
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

.il-orphan-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
  font-size: 0.6875rem;
  padding: 0.2rem 0.5rem;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 10px;
  cursor: pointer;
  color: var(--ae-text-secondary);
  white-space: nowrap;
}

.il-orphan-toggle:hover {
  color: var(--ae-text-primary);
  background: var(--ae-bg-hover);
}

.il-orphan-toggle.active {
  color: var(--ae-status-warning);
  border-color: var(--ae-status-warning);
}

.il-orphan-toggle .material-symbols-outlined {
  font-size: 14px;
}

.il-sparql-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
  font-size: 0.6875rem;
  padding: 0.2rem 0.5rem;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 10px;
  cursor: pointer;
  color: var(--ae-text-secondary);
  white-space: nowrap;
}

.il-sparql-btn:hover {
  color: var(--ae-accent);
  border-color: var(--ae-accent);
  background: var(--ae-bg-hover);
}

.il-sparql-btn .material-symbols-outlined {
  font-size: 14px;
}

.il-view-toggle {
  display: inline-flex;
  flex-shrink: 0;
  border: 1px solid var(--ae-border-color);
  border-radius: 8px;
  overflow: hidden;
}

.il-view-toggle button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.2rem 0.4rem;
  background: var(--ae-bg-elevated);
  border: none;
  cursor: pointer;
  color: var(--ae-text-secondary);
}

.il-view-toggle button + button {
  border-left: 1px solid var(--ae-border-color);
}

.il-view-toggle button:hover {
  color: var(--ae-text-primary);
  background: var(--ae-bg-hover);
}

.il-view-toggle button.active {
  color: var(--ae-accent);
  background: var(--ae-bg-hover);
}

.il-view-toggle .material-symbols-outlined {
  font-size: 16px;
}

/* Card / box layout */
.il-cards {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.il-card {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  width: 100%;
  text-align: left;
  padding: 0.75rem 0.9rem;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.12s, border-color 0.12s;
}

.il-card:hover {
  background: var(--ae-bg-hover);
  border-color: var(--ae-accent);
}

.il-card-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--ae-text-primary);
  line-height: 1.35;
}

.il-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1.25rem;
}

.il-card-field {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  font-size: 0.75rem;
}

.il-card-key {
  color: var(--ae-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: 0.6875rem;
}

.il-card-val {
  color: var(--ae-text-secondary);
}

.il-card-uri {
  font-size: 0.6875rem;
  font-family: var(--ae-font-mono);
  color: var(--ae-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* Column table (configured instance-list columns) */
.il-table-wrap {
  flex: 1;
  overflow: auto;
  padding: 0.25rem 0.5rem;
}

.il-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.il-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  text-align: left;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--ae-text-secondary);
  background: var(--ae-bg-elevated);
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid var(--ae-border-color);
  white-space: nowrap;
}

.il-row {
  cursor: pointer;
  border-bottom: 1px solid var(--ae-border-color);
  transition: background-color 0.12s;
}

.il-row:hover {
  background: var(--ae-bg-hover);
}

.il-table td {
  padding: 0.4rem 0.6rem;
  vertical-align: top;
}

.il-cell-name {
  color: var(--ae-text-primary);
  font-weight: 500;
  max-width: 22rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.il-cell {
  color: var(--ae-text-secondary);
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
