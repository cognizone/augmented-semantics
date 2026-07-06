<script setup lang="ts">
/**
 * ResourceView - shows a resource's label, URI and outgoing properties.
 *
 * Reads the current resource from the browse store, loads its triples, and
 * walks links by pushing ?resource to the URL (RdfView syncs URL -> store).
 *
 * @see /spec/ae-rdf
 */
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ProgressSpinner from 'primevue/progressspinner'
import { useBrowseStore, useSettingsStore, useTypeConfigStore } from '../../stores'
import { useResourceView, useIncomingRelations, useClipboard, useDelayedLoading } from '../../composables'
import { LABEL_PREDICATES, validateURI } from '../../services'
import { localName as localNameOf, humanizeLocalName, qname as toQname, displayType } from '../../utils/format'
import { isAlwaysLast, orderedByConfig, toggleInList } from '../../utils/propertyOrder'
import { URL_PARAMS } from '../../router'
import type { PropertyGroup, ResourceObject } from '../../composables'
import PropertyTable from './PropertyTable.vue'

const route = useRoute()
const router = useRouter()
const browseStore = useBrowseStore()
const settings = useSettingsStore()
const typeConfig = useTypeConfigStore()
const { copyToClipboard } = useClipboard()
const { triples, types, label, loading, error, resolved, objectLabels, contextLabels, objectTypes, embedded, deprecated, deprecatedObjects, loadResource } = useResourceView()
const showLoading = useDelayedLoading(loading)

// Inverse relations (who points at this resource) — loaded lazily on expand.
const {
  groups: incomingGroups,
  count: incomingCount,
  truncated: incomingTruncated,
  shown: incomingShown,
  loading: incomingLoading,
  loaded: incomingLoaded,
  error: incomingError,
  resolved: incomingResolved,
  objectLabels: incomingLabels,
  objectTypes: incomingTypes,
  embedded: incomingEmbedded,
  load: loadIncoming,
  loadCount: loadIncomingCount,
  reset: resetIncoming,
} = useIncomingRelations()
const incomingOpen = ref(false)

const uri = computed(() => browseStore.currentResource)
// Protocol-check before it hits the href sink — a ?resource=javascript:… deep
// link would otherwise be a clickable script sink in the app origin (R01).
const safeHref = computed(() => validateURI(uri.value ?? '') ?? undefined)
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
  // Sink below the rank-4 "rest" so ALWAYS_LAST predicates land at the section
  // bottom (`order` only pins to the top). The embed path sinks them too.
  if (isAlwaysLast(predicate)) return 5
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

// Per-type field config (order + hide + label). A resource can have several
// types; the store picks the one deterministic config type (same rule the
// heading label uses — see useResourceView.deriveLabel), so read and write and
// the composed heading all target the same config. (R28)
const cfgType = computed<string | null>(() => typeConfig.configType(typeChips.value.map(c => c.uri)))
const orderList = computed(() => (cfgType.value ? typeConfig.get(cfgType.value).order ?? [] : []))
const hideList = computed(() => (cfgType.value ? typeConfig.get(cfgType.value).hide ?? [] : []))
const labelList = computed(() => (cfgType.value ? typeConfig.get(cfgType.value).label ?? [] : []))
const foldAfterVal = computed(() => (cfgType.value ? typeConfig.get(cfgType.value).foldAfter : undefined))
const groupByTypeList = computed(() => (cfgType.value ? typeConfig.get(cfgType.value).groupByType ?? [] : []))
const booleanList = computed(() => (cfgType.value ? typeConfig.get(cfgType.value).boolean ?? [] : []))
const numberList = computed(() => (cfgType.value ? typeConfig.get(cfgType.value).number ?? [] : []))
const columnsList = computed(() => (cfgType.value ? typeConfig.get(cfgType.value).columns ?? [] : []))
const capWidthList = computed(() => (cfgType.value ? typeConfig.get(cfgType.value).capWidth ?? [] : []))
const canEdit = computed(() => settings.editMode && !!cfgType.value)

// Hidden predicates are dropped in normal mode; kept (greyed) in edit mode so
// they can be un-hidden. Configured order wins; the rest fall back to priority.
const visible = (gs: PropertyGroup[]) =>
  settings.editMode || settings.showHidden ? gs : gs.filter(g => !hideList.value.includes(g.predicate))
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
  const seq = [...attrPreds, ...relPreds]
  // Preserve predicates configured on this type but absent from the current
  // (sparse) instance — otherwise dragging here erases them for every instance (R04).
  const preserved = orderList.value.filter(p => !seq.includes(p))
  typeConfig.set(cfgType.value, { order: [...seq, ...preserved] })
}

function onToggleHide(predicate: string) {
  if (!cfgType.value) return
  typeConfig.set(cfgType.value, { hide: toggleInList(typeConfig.get(cfgType.value).hide ?? [], predicate) })
}

function onToggleLabel(predicate: string) {
  if (!cfgType.value) return
  typeConfig.set(cfgType.value, { label: toggleInList(typeConfig.get(cfgType.value).label ?? [], predicate) })
}

function onToggleFold(predicate: string) {
  if (!cfgType.value) return
  const cur = typeConfig.get(cfgType.value).foldAfter
  typeConfig.set(cfgType.value, { foldAfter: cur === predicate ? undefined : predicate })
}

function onToggleGroupByType(predicate: string) {
  if (!cfgType.value) return
  typeConfig.set(cfgType.value, { groupByType: toggleInList(typeConfig.get(cfgType.value).groupByType ?? [], predicate) })
}

function onToggleNumber(predicate: string) {
  if (!cfgType.value) return
  typeConfig.set(cfgType.value, { number: toggleInList(typeConfig.get(cfgType.value).number ?? [], predicate) })
}

function onToggleColumns(predicate: string) {
  if (!cfgType.value) return
  typeConfig.set(cfgType.value, { columns: toggleInList(typeConfig.get(cfgType.value).columns ?? [], predicate) })
}

function onToggleCapWidth(predicate: string) {
  if (!cfgType.value) return
  typeConfig.set(cfgType.value, { capWidth: toggleInList(typeConfig.get(cfgType.value).capWidth ?? [], predicate) })
}

function selectType(typeUri: string) {
  router.push({ query: { [URL_PARAMS.TYPE]: typeUri } })
}

// Union of graphs the resource asserts in (provenance summary).
const graphSummary = computed(() => {
  const set = new Set<string>()
  let hasDefault = false
  const fold = (o: ResourceObject) => {
    if (o.graphs.length) o.graphs.forEach(g => set.add(g))
    else hasDefault = true
  }
  // rdf:type is lifted out of `triples` into `types`, so fold its graphs in too:
  // otherwise the graph a resource's TYPE lives in is dropped, and a type-only
  // resource (triples.length === 0) would show no provenance at all. (R20)
  types.value.forEach(fold)
  // Skip synthetic inverse-embed groups (`^predicate`): their objects are handles
  // with no graphs of their own, so folding them would spuriously add "default graph".
  for (const group of triples.value) if (!group.predicate.startsWith('^')) group.objects.forEach(fold)
  return { graphs: [...set], hasDefault }
})

// Header provenance chips are capped: a replicated vocab concept can appear in
// hundreds of named graphs (Fedlex), flooding the header. Show a few; the existing
// "Show graphs" toggle (which also reveals per-triple tags) expands to all.
const GRAPH_CHIP_CAP = 12
const visibleGraphs = computed(() =>
  showGraphs.value ? graphSummary.value.graphs : graphSummary.value.graphs.slice(0, GRAPH_CHIP_CAP),
)
const hiddenGraphCount = computed(() => graphSummary.value.graphs.length - visibleGraphs.value.length)

const heading = computed(() => label.value || (uri.value ? localNameOf(uri.value) : ''))

watch(
  uri,
  (u) => {
    incomingOpen.value = false
    resetIncoming()
    if (u) {
      loadResource(u)
      loadIncomingCount(u) // cheap COUNT so "Referenced by (N)" shows without expanding
    }
  },
  { immediate: true }
)

function navigate(target: string) {
  router.push({ query: { ...route.query, [URL_PARAMS.RESOURCE]: target } })
}

// Sticky header shrinks once the body scrolls (compact only when scrolling).
const scrollEl = ref<HTMLElement | null>(null)
const stuck = ref(false)
function onScroll() { stuck.value = (scrollEl.value?.scrollTop ?? 0) > 4 }
onMounted(() => scrollEl.value?.addEventListener('scroll', onScroll, { passive: true }))
onUnmounted(() => scrollEl.value?.removeEventListener('scroll', onScroll))
</script>

<template>
  <div v-if="uri" class="resource-view" ref="scrollEl">
    <header class="resource-header" :class="{ stuck }">
      <!-- Title + type chip(s) on one line -->
      <div class="rh-title-row">
        <h2 class="resource-title">{{ heading }}</h2>
        <span v-if="deprecated" class="deprecated-badge" v-tooltip.top="'This resource is deprecated'">deprecated</span>
        <div v-if="typeChips.length" class="resource-types">
          <button
            v-for="t in typeChips"
            :key="t.uri"
            class="type-chip"
            v-tooltip.top="{ value: `Browse all ${t.label}`, showDelay: 120 }"
            @click="selectType(t.uri)"
          >{{ t.label }}</button>
        </div>
      </div>

      <!-- URI + copy (left) share a row with graph provenance (right) -->
      <div class="rh-sub-row">
        <a :href="safeHref" target="_blank" rel="noopener" class="resource-uri" v-tooltip.top="{ value: uri, showDelay: 120 }">{{ uri }}</a>
        <button class="copy-btn" aria-label="Copy URI" title="Copy URI" @click="copyToClipboard(uri, 'URI')">
          <span class="material-symbols-outlined">content_copy</span>
        </button>
        <div v-if="!showLoading && !error && (triples.length || types.length)" class="resource-graphs">
          <span class="material-symbols-outlined graph-icon">hub</span>
          <span class="graph-summary">
            <template v-if="graphSummary.graphs.length">
              <span v-for="g in visibleGraphs" :key="g" class="graph-chip" v-tooltip.top="{ value: g, showDelay: 120 }">{{ qname(g) }}</span>
              <span v-if="hiddenGraphCount > 0" class="graph-chip more" @click="showGraphs = true">+{{ hiddenGraphCount }} more</span>
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

    <div v-else-if="!loading && !triples.length" class="state">
      <p>No outgoing triples for this resource.</p>
    </div>

    <template v-else>
      <section v-if="attributes.length" class="prop-section">
        <h3 class="section-title">Attributes</h3>
        <PropertyTable :key="'attr:' + uri" :groups="attributes" :resolved="resolved" :labels="objectLabels" :context-labels="contextLabels" :object-types="objectTypes" :show-graphs="showGraphs" :reorderable="canEdit" :hidden="hideList" :label-parts="labelList" :fold-after="foldAfterVal" :group-by-type="groupByTypeList" :boolean-parts="booleanList" :number-parts="numberList" :column-parts="columnsList" :cap-width-parts="capWidthList" @navigate="navigate" @reorder="p => onReorder('attr', p)" @toggle-hide="onToggleHide" @toggle-label="onToggleLabel" @toggle-fold="onToggleFold" @toggle-group-by-type="onToggleGroupByType" @toggle-number="onToggleNumber" @toggle-columns="onToggleColumns" @toggle-cap-width="onToggleCapWidth" />
      </section>

      <section v-if="relationships.length" class="prop-section">
        <h3 class="section-title">Relationships</h3>
        <PropertyTable :key="'rel:' + uri" :groups="relationships" :resolved="resolved" :labels="objectLabels" :context-labels="contextLabels" :object-types="objectTypes" :embedded="embedded" :deprecated="deprecatedObjects" :ancestors="uri ? [uri] : []" :show-graphs="showGraphs" :reorderable="canEdit" :hidden="hideList" :label-parts="labelList" :fold-after="foldAfterVal" :group-by-type="groupByTypeList" :boolean-parts="booleanList" :number-parts="numberList" :column-parts="columnsList" :cap-width-parts="capWidthList" @navigate="navigate" @reorder="p => onReorder('rel', p)" @toggle-hide="onToggleHide" @toggle-label="onToggleLabel" @toggle-fold="onToggleFold" @toggle-group-by-type="onToggleGroupByType" @toggle-number="onToggleNumber" @toggle-columns="onToggleColumns" @toggle-cap-width="onToggleCapWidth" />
      </section>
    </template>

    <!-- Inverse relations: who points at this resource. Lazily loaded on expand. -->
    <section v-if="!showLoading && !error" class="prop-section incoming-section">
      <button class="incoming-toggle" :aria-expanded="incomingOpen" @click="toggleIncoming">
        <span class="material-symbols-outlined inc-chevron">{{ incomingOpen ? 'expand_more' : 'chevron_right' }}</span>
        <span class="section-title inc-title">Referenced by</span>
        <span v-if="incomingCount !== null" class="inc-count">{{ incomingCount.toLocaleString('en-US') }}</span>
      </button>

      <div v-if="incomingOpen" class="incoming-body">
        <div v-if="incomingLoading" class="inc-state">
          <ProgressSpinner style="width: 24px; height: 24px" strokeWidth="4" />
        </div>
        <div v-else-if="incomingError" class="inc-state error">{{ incomingError }}</div>
        <template v-else-if="incomingLoaded">
          <p v-if="!incomingGroups.length" class="inc-state">Nothing references this resource.</p>
          <template v-else>
            <!-- Own graph toggle for the incoming table when the header has none
                 (no outgoing triples/types) — else the graph provenance of the
                 referencing rows is unreachable. When outgoing content exists the
                 header toggle already drives the shared showGraphs here. (R31) -->
            <div v-if="!triples.length && !types.length" class="inc-graph-row">
              <button class="graph-toggle" :class="{ on: showGraphs }" @click="showGraphs = !showGraphs">
                {{ showGraphs ? 'Hide graphs' : 'Show graphs' }}
              </button>
            </div>
            <PropertyTable :groups="incomingGroups" :resolved="incomingResolved" :labels="incomingLabels" :object-types="incomingTypes" :embedded="incomingEmbedded" :show-graphs="showGraphs" :incoming="true" @navigate="navigate" />
            <p v-if="incomingTruncated" class="inc-truncated">
              Showing the first {{ incomingShown.toLocaleString('en-US') }}{{ incomingCount !== null ? ` of ${incomingCount.toLocaleString('en-US')}` : '' }} — open a specific one to keep walking.
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
  padding: 0 1.5rem 1.25rem;
}

/* Sticky, full-bleed header: cancel the scroll container's padding so the
   background + divider span edge to edge, and pin it while the body scrolls. */
.resource-header {
  position: sticky;
  top: 0;
  z-index: 5;
  margin: 0 -1.5rem 1rem;
  padding: 1rem 1.5rem 0.85rem;
  background: var(--ae-bg-base);
  border-bottom: 1px solid var(--ae-border-color);
  transition: padding 0.16s ease, box-shadow 0.16s ease;
}

/* Once the body scrolls: tighter padding, smaller title, elevated, URI tucked. */
.resource-header.stuck {
  padding: 0.4rem 1.5rem;
  box-shadow: 0 4px 10px -6px rgba(0, 0, 0, 0.5);
}

.resource-header.stuck .resource-title {
  font-size: 0.95rem;
}

.resource-header.stuck .rh-sub-row {
  display: none;
}

.rh-title-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.25rem 0.625rem;
}

.resource-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--ae-text-primary);
  transition: font-size 0.16s ease;
}

.rh-sub-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-top: 0.2rem;
}

/* Graph provenance pushed to the right of the URI row. */
.rh-sub-row .resource-graphs {
  margin-left: auto;
}

.resource-uri {
  font-family: var(--ae-font-mono);
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 0 1 auto;
  min-width: 0;
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

.inc-graph-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.25rem;
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

.graph-chip.more {
  cursor: pointer;
  color: var(--ae-accent);
  border-color: var(--ae-accent);
}

.graph-chip.more:hover {
  background: var(--ae-bg-hover);
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
