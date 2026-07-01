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
import { useBrowseStore, useSettingsStore, useTypeConfigStore } from '../../stores'
import { useResourceView, useIncomingRelations, useClipboard, useDelayedLoading } from '../../composables'
import { LABEL_PREDICATES } from '../../services'
import { localName as localNameOf, humanizeLocalName, qname as toQname, displayType } from '../../utils/format'
import { orderedByConfig, toggleInList } from '../../utils/propertyOrder'
import { URL_PARAMS } from '../../router'
import type { PropertyGroup } from '../../composables'
import PropertyTable from './PropertyTable.vue'

const route = useRoute()
const router = useRouter()
const browseStore = useBrowseStore()
const settings = useSettingsStore()
const typeConfig = useTypeConfigStore()
const { copyToClipboard } = useClipboard()
const { triples, types, label, loading, error, resolved, objectLabels, objectTypes, embedded, loadResource } = useResourceView()
const showLoading = useDelayedLoading(loading)

// Inverse relations (who points at this resource) — loaded lazily on expand.
const {
  groups: incomingGroups,
  count: incomingCount,
  truncated: incomingTruncated,
  loading: incomingLoading,
  loaded: incomingLoaded,
  error: incomingError,
  resolved: incomingResolved,
  objectLabels: incomingLabels,
  objectTypes: incomingTypes,
  load: loadIncoming,
  reset: resetIncoming,
} = useIncomingRelations()
const incomingOpen = ref(false)
const INCOMING_LIMIT = 1000

const uri = computed(() => browseStore.currentResource)
const showGraphs = ref(false)

function toggleIncoming() {
  incomingOpen.value = !incomingOpen.value
  if (incomingOpen.value && !incomingLoaded.value && uri.value) loadIncoming(uri.value)
}
const mode = computed(() => settings.uriDisplay)

const qname = (u: string) => toQname(u, resolved.value)

// Subject type(s) as header chips; clicking one browses that type's instances.
const typeChips = computed(() =>
  types.value.filter(o => o.termType === 'uri').map(o => ({ uri: o.value, label: displayType(o.value, resolved.value, mode.value) }))
)

// Priority within a section: labels → identifiers → dates → status → rest,
// then alphabetical by humanized name.
function rank(predicate: string): number {
  const ln = localNameOf(predicate).toLowerCase()
  if ((LABEL_PREDICATES as readonly string[]).includes(predicate)) return 0
  if (/identifier|notation|^id$/.test(ln)) return 1
  if (/date|created|modified|issued|time/.test(ln)) return 2
  if (/status|state/.test(ln)) return 3
  return 4
}
function byPriority(a: PropertyGroup, b: PropertyGroup): number {
  return rank(a.predicate) - rank(b.predicate)
    || humanizeLocalName(a.predicate).localeCompare(humanizeLocalName(b.predicate))
}

// Per-type field config (order + hide). A resource can have several types, so
// pick a deterministic one: the first (alphabetically) of its types that has
// any config, else the first type — so read and write target the same config.
const cfgType = computed<string | null>(() => {
  const uris = typeChips.value.map(c => c.uri).sort()
  return uris.find(u => {
    const c = typeConfig.get(u)
    return (c.order?.length ?? 0) > 0 || (c.hide?.length ?? 0) > 0
  }) ?? uris[0] ?? null
})
const orderList = computed(() => (cfgType.value ? typeConfig.get(cfgType.value).order ?? [] : []))
const hideList = computed(() => (cfgType.value ? typeConfig.get(cfgType.value).hide ?? [] : []))
const canEdit = computed(() => settings.editMode && !!cfgType.value)

// Hidden predicates are dropped in normal mode; kept (greyed) in edit mode so
// they can be un-hidden. Configured order wins; the rest fall back to priority.
const visible = (gs: PropertyGroup[]) =>
  settings.editMode ? gs : gs.filter(g => !hideList.value.includes(g.predicate))
const order = (gs: PropertyGroup[]) => orderedByConfig(gs, g => g.predicate, orderList.value, byPriority)
// Split: Attributes = literal-valued predicates; Relationships = link-valued.
const attributes = computed(() =>
  order(visible(triples.value.filter(g => g.objects.every(o => o.termType === 'literal'))))
)
const relationships = computed(() =>
  order(visible(triples.value.filter(g => g.objects.some(o => o.termType !== 'literal'))))
)

// Persist a drag-reorder. The stored order is attributes then relationships, so
// rebuild the full list from both sections (the dragged one uses the new seq).
function onReorder(section: 'attr' | 'rel', predicates: string[]) {
  if (!cfgType.value) return
  const attrPreds = section === 'attr' ? predicates : attributes.value.map(g => g.predicate)
  const relPreds = section === 'rel' ? predicates : relationships.value.map(g => g.predicate)
  typeConfig.set(cfgType.value, { order: [...attrPreds, ...relPreds] })
}

function onToggleHide(predicate: string) {
  if (!cfgType.value) return
  typeConfig.set(cfgType.value, { hide: toggleInList(typeConfig.get(cfgType.value).hide ?? [], predicate) })
}

function selectType(typeUri: string) {
  router.push({ query: { [URL_PARAMS.TYPE]: typeUri } })
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

const heading = computed(() => label.value || (uri.value ? localNameOf(uri.value) : ''))

watch(
  uri,
  (u) => {
    incomingOpen.value = false
    resetIncoming()
    if (u) loadResource(u)
  },
  { immediate: true }
)

function navigate(target: string) {
  router.push({ query: { ...route.query, [URL_PARAMS.RESOURCE]: target } })
}
</script>

<template>
  <div v-if="uri" class="resource-view">
    <header class="resource-header">
      <h2 class="resource-title">{{ heading }}</h2>
      <div class="resource-uri-row">
        <a :href="uri" target="_blank" rel="noopener" class="resource-uri" v-tooltip.top="{ value: uri, showDelay: 120 }">{{ uri }}</a>
        <button class="copy-btn" aria-label="Copy URI" title="Copy URI" @click="copyToClipboard(uri, 'URI')">
          <span class="material-symbols-outlined">content_copy</span>
        </button>
      </div>

      <!-- Type chips (left) + graph provenance (right) share one row to save space -->
      <div v-if="typeChips.length || (!showLoading && !error && triples.length)" class="resource-meta">
        <!-- Subject type(s) — identity, lifted out of the property table -->
        <div v-if="typeChips.length" class="resource-types">
          <button
            v-for="t in typeChips"
            :key="t.uri"
            class="type-chip"
            v-tooltip.top="{ value: `Browse all ${t.label}`, showDelay: 120 }"
            @click="selectType(t.uri)"
          >{{ t.label }}</button>
        </div>

        <!-- Graph provenance summary + per-triple reveal toggle -->
        <div v-if="!showLoading && !error && triples.length" class="resource-graphs">
          <span class="material-symbols-outlined graph-icon">hub</span>
          <span class="graph-summary">
            <template v-if="graphSummary.graphs.length">
              <span v-for="g in graphSummary.graphs" :key="g" class="graph-chip" v-tooltip.top="{ value: g, showDelay: 120 }">{{ qname(g) }}</span>
              <span v-if="graphSummary.hasDefault" class="graph-chip default">default graph</span>
            </template>
            <span v-else class="graph-chip default">default graph</span>
          </span>
          <button class="graph-toggle" :class="{ on: showGraphs }" @click="showGraphs = !showGraphs">
            {{ showGraphs ? 'Hide graphs' : 'Show graphs' }}
          </button>
        </div>
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

    <template v-else>
      <section v-if="attributes.length" class="prop-section">
        <h3 class="section-title">Attributes</h3>
        <PropertyTable :groups="attributes" :resolved="resolved" :labels="objectLabels" :object-types="objectTypes" :show-graphs="showGraphs" :reorderable="canEdit" :hidden="hideList" @navigate="navigate" @reorder="p => onReorder('attr', p)" @toggle-hide="onToggleHide" />
      </section>

      <section v-if="relationships.length" class="prop-section">
        <h3 class="section-title">Relationships</h3>
        <PropertyTable :groups="relationships" :resolved="resolved" :labels="objectLabels" :object-types="objectTypes" :embedded="embedded" :ancestors="uri ? [uri] : []" :show-graphs="showGraphs" :reorderable="canEdit" :hidden="hideList" @navigate="navigate" @reorder="p => onReorder('rel', p)" @toggle-hide="onToggleHide" />
      </section>
    </template>

    <!-- Inverse relations: who points at this resource. Lazily loaded on expand. -->
    <section v-if="!showLoading && !error" class="prop-section incoming-section">
      <button class="incoming-toggle" :aria-expanded="incomingOpen" @click="toggleIncoming">
        <span class="material-symbols-outlined inc-chevron">{{ incomingOpen ? 'expand_more' : 'chevron_right' }}</span>
        <span class="section-title inc-title">Referenced by</span>
        <span v-if="incomingLoaded && incomingCount !== null" class="inc-count">{{ incomingCount.toLocaleString('en-US') }}</span>
      </button>

      <div v-if="incomingOpen" class="incoming-body">
        <div v-if="incomingLoading" class="inc-state">
          <ProgressSpinner style="width: 24px; height: 24px" strokeWidth="4" />
        </div>
        <div v-else-if="incomingError" class="inc-state error">{{ incomingError }}</div>
        <template v-else-if="incomingLoaded">
          <p v-if="!incomingGroups.length" class="inc-state">Nothing references this resource.</p>
          <template v-else>
            <PropertyTable :groups="incomingGroups" :resolved="incomingResolved" :labels="incomingLabels" :object-types="incomingTypes" :show-graphs="showGraphs" :incoming="true" @navigate="navigate" />
            <p v-if="incomingTruncated" class="inc-truncated">
              Showing the first {{ INCOMING_LIMIT.toLocaleString('en-US') }}{{ incomingCount !== null ? ` of ${incomingCount.toLocaleString('en-US')}` : '' }} — open a specific one to keep walking.
            </p>
          </template>
        </template>
      </div>
    </section>
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

/* Type chips + graph provenance on one row; graph block pushed to the right. */
.resource-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  margin-top: 0.5rem;
}

.resource-types {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.type-chip {
  font-family: var(--ae-font-mono);
  font-size: 0.6875rem;
  padding: 0.1rem 0.5rem;
  border: 1px solid var(--ae-border-color);
  border-radius: 10px;
  background: var(--ae-bg-elevated);
  color: var(--ae-text-secondary);
  cursor: pointer;
}

.type-chip:hover {
  border-color: var(--ae-accent);
  color: var(--ae-accent);
}

.prop-section {
  margin-top: 1.25rem;
}

.incoming-section {
  border-top: 1px solid var(--ae-border-color);
  padding-top: 0.75rem;
}

.incoming-toggle {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  color: var(--ae-text-secondary);
}

.incoming-toggle:hover .inc-title {
  color: var(--ae-text-primary);
}

.inc-chevron {
  font-size: 18px;
  color: var(--ae-text-muted);
}

.inc-title {
  margin: 0;
}

.inc-count {
  font-size: 0.6875rem;
  color: var(--ae-text-secondary);
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 10px;
  padding: 0.05rem 0.45rem;
}

.incoming-body {
  margin-top: 0.5rem;
}

.inc-state {
  padding: 0.75rem 0;
  font-size: 0.8125rem;
  color: var(--ae-text-secondary);
}

.inc-state.error {
  color: var(--ae-status-error);
}

.inc-truncated {
  margin: 0.5rem 0 0;
  font-size: 0.6875rem;
  color: var(--ae-text-muted);
}

.section-title {
  margin: 0 0 0.25rem;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ae-text-secondary);
}

.resource-graphs {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-left: auto; /* keep it right-aligned even when there are no type chips */
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
