<script setup lang="ts">
/**
 * PropertyTable - renders a resource's predicate/object triples.
 *
 * Object URIs are clickable (emit `navigate`) so the user can walk links.
 * Literals show language and (non-string) datatype tags.
 *
 * @see /spec/ae-rdf
 */
import { computed, ref } from 'vue'
import { isNavigableIri } from '../../services'
import { useSettingsStore, useTypeConfigStore } from '../../stores'
import { qname as toQname, displayPredicate, displayObject, displayType, type ResolvedMap } from '../../utils/format'
import { moveInOrder, orderedByConfig, toggleInList } from '../../utils/propertyOrder'
import type { PropertyGroup, ResourceObject } from '../../composables'

const props = defineProps<{
  groups: PropertyGroup[]
  resolved: ResolvedMap
  /** Object IRI → human label (Phase 2). Falls back to the qname when absent. */
  labels?: Map<string, string>
  /** Object IRI → a type IRI, shown as a badge / fallback text. */
  objectTypes?: Map<string, string>
  /** Object IRI → its triples, when its type is configured render:embed (depth-1). */
  embedded?: Map<string, PropertyGroup[]>
  /** IRIs already inlined on the path to here. An object that embeds a value
   *  which is one of its own ancestors (a cycle, e.g. A→B→A) would recurse
   *  forever, so such an object renders as a plain link instead. */
  ancestors?: string[]
  /** Reveal a graph chip on every triple. Multi-graph triples always show one. */
  showGraphs?: boolean
  /** Inverse relations (`?s ?p <this>`): mark predicates as inbound. */
  incoming?: boolean
  /** Edit mode: rows get a drag handle to reorder predicates + a hide toggle.
   *  Emits `reorder` / `toggle-hide`; the parent persists to the type config. */
  reorderable?: boolean
  /** Predicates hidden for this table's type. In edit mode they're greyed with
   *  the toggle "on"; in normal mode the parent has already filtered them out. */
  hidden?: string[]
  /** Predicates that compose this table's type's label (highlighted in edit mode). */
  labelParts?: string[]
  /** Predicate to fold after: rows past it collapse behind a toggle. Only folds
   *  when `embed` and not reorderable (edit mode). Unset = show all. */
  foldAfter?: string
  /** True when this table is an inlined embed (enables fold behavior). */
  embed?: boolean
  /** Predicates whose object lists render grouped by the object's type (a
   *  subheading + count per type) instead of a flat list. */
  groupByType?: string[]
}>()

const emit = defineEmits<{
  navigate: [uri: string]
  reorder: [predicates: string[]]
  toggleHide: [predicate: string]
  toggleLabel: [predicate: string]
  toggleFold: [predicate: string]
  toggleGroupByType: [predicate: string]
}>()

const isHidden = (predicate: string) => props.hidden?.includes(predicate) ?? false
const isLabelPart = (predicate: string) => props.labelParts?.includes(predicate) ?? false
const isFoldBoundary = (predicate: string) => props.foldAfter === predicate
const isGrouped = (predicate: string) => props.groupByType?.includes(predicate) ?? false

// Embed row-fold: show rows through `foldAfter`, reveal the rest on demand. Only
// when inlined (embed) and not editing — edit mode shows all rows to configure.
const rowsExpanded = ref(false)
const foldIndex = computed(() => {
  if (!props.embed || !props.foldAfter || props.reorderable) return -1
  const i = props.groups.findIndex(g => g.predicate === props.foldAfter)
  return i >= 0 && i < props.groups.length - 1 ? i : -1 // nothing to fold if it's last
})
const foldable = computed(() => foldIndex.value >= 0)
const shownGroups = computed(() =>
  foldable.value && !rowsExpanded.value ? props.groups.slice(0, foldIndex.value + 1) : props.groups,
)

// Drag-to-reorder (only when reorderable). The handle is the drag source; the
// whole row is the drop target. We record the drop target on `drop` but apply
// the reorder on `dragend` — reordering the list on `drop` replaces the dragged
// DOM node before the native drag finishes, which leaves some browsers in a
// stuck-drag state that swallows the next clicks (looks like the app hangs).
const dragIndex = ref<number | null>(null)
const overIndex = ref<number | null>(null)
let dropTarget: number | null = null
function onDragStart(i: number, e: DragEvent) {
  dragIndex.value = i
  dropTarget = null
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDragOver(i: number) {
  if (dragIndex.value !== null) overIndex.value = i
}
function onDrop(to: number) {
  if (dragIndex.value !== null) dropTarget = to // apply on dragend, not now
}
function onDragEnd() {
  const from = dragIndex.value
  const to = dropTarget
  dragIndex.value = null
  overIndex.value = null
  dropTarget = null
  if (from === null || to === null) return
  const preds = props.groups.map(g => g.predicate)
  const next = moveInOrder(preds, from, to)
  if (next !== preds) emit('reorder', next) // moveInOrder returns the same ref on no-op
}

const settings = useSettingsStore()
const typeConfig = useTypeConfigStore()
const mode = computed(() => settings.uriDisplay)

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string'

const qname = (uri: string) => toQname(uri, props.resolved)

// Triples to inline for a uri object under `viaPredicate`, or null if it should
// render as a link here. Guards cycles (an object on the ancestor path renders
// as a link, not recursing into itself), AND enforces embedVia PER EDGE: a type
// that pins an owning predicate only inlines under that predicate, so an inverse
// back-reference (e.g. Grant reached via isBeneficiaryOf, not its isFundedBy
// owner) renders as a link even though the object is in the embed map.
function embedGroups(o: ResourceObject, viaPredicate: string): PropertyGroup[] | null {
  if (o.termType !== 'uri') return null
  const groups = props.embedded?.get(o.value)
  if (!groups || (props.ancestors ?? []).includes(o.value)) return null
  const type = embedType(o)
  const cfg = type ? typeConfig.get(type) : {}
  if (cfg.embedVia && cfg.embedVia !== viaPredicate) return null
  // Hidden predicates: dropped in normal mode, kept (greyed) in edit mode.
  const hide = cfg.hide ?? []
  let gs = !settings.editMode && !settings.showHidden && hide.length ? groups.filter(g => !hide.includes(g.predicate)) : groups
  // Honor the embed type's configured field order, so ordering a type applies
  // wherever it renders — standalone or inlined. Unlisted keep insertion order.
  const order = cfg.order ?? []
  if (order.length) gs = orderedByConfig(gs, g => g.predicate, order, () => 0)
  return gs
}

/** The type an embedded object is rendered as (drives its order/hide config). */
function embedType(o: ResourceObject): string | undefined {
  return props.objectTypes?.get(o.value)
}

const embedHidden = (o: ResourceObject) => (embedType(o) ? typeConfig.get(embedType(o)!).hide ?? [] : [])
const embedLabelParts = (o: ResourceObject) => (embedType(o) ? typeConfig.get(embedType(o)!).label ?? [] : [])
const embedFoldAfter = (o: ResourceObject) => (embedType(o) ? typeConfig.get(embedType(o)!).foldAfter : undefined)
const embedGroupByType = (o: ResourceObject) => (embedType(o) ? typeConfig.get(embedType(o)!).groupByType ?? [] : [])

/** Toggle the fold boundary inside an embed (set to this predicate, or clear). */
function onEmbedToggleFold(o: ResourceObject, predicate: string) {
  const type = embedType(o)
  if (!type) return
  const cur = typeConfig.get(type).foldAfter
  typeConfig.set(type, { foldAfter: cur === predicate ? undefined : predicate })
}

/** Toggle group-by-type for a predicate inside an embed, on that object's type. */
function onEmbedToggleGroupByType(o: ResourceObject, predicate: string) {
  const type = embedType(o)
  if (type) typeConfig.set(type, { groupByType: toggleInList(typeConfig.get(type).groupByType ?? [], predicate) })
}

/** Persist a drag-reorder inside an embed to that object's type config. */
function onEmbedReorder(o: ResourceObject, predicates: string[]) {
  const type = embedType(o)
  if (type) typeConfig.set(type, { order: predicates })
}

/** Toggle-hide a predicate inside an embed, on that object's type config. */
function onEmbedToggleHide(o: ResourceObject, predicate: string) {
  const type = embedType(o)
  if (type) typeConfig.set(type, { hide: toggleInList(typeConfig.get(type).hide ?? [], predicate) })
}

/** Toggle a predicate as a label part inside an embed, on that object's type. */
function onEmbedToggleLabel(o: ResourceObject, predicate: string) {
  const type = embedType(o)
  if (type) typeConfig.set(type, { label: toggleInList(typeConfig.get(type).label ?? [], predicate) })
}

/** Predicate label, per the URI-display mode; qname/URI stays on hover. */
function predicateLabel(uri: string): string {
  return displayPredicate(uri, props.resolved, mode.value)
}

// Always show the object's own identity (label, else qname — distinct) as the
// primary text; the type is a context badge. (A generic type like "Concept"
// repeated N times is useless as the value itself.)
function objectText(uri: string): string {
  return displayObject(uri, props.resolved, mode.value, props.labels?.get(uri))
}

/** Type badge text for a linked resource (context), or null. */
function objectBadge(uri: string): string | null {
  const t = props.objectTypes?.get(uri)
  return t ? displayType(t, props.resolved, mode.value) : null
}

// A reference that resolved to NEITHER a label NOR a type points at a resource
// with no data (a dangling reference) — flag it so it's clearly problematic,
// not mistaken for an unlabelled-but-real resource.
function isDangling(uri: string): boolean {
  return (
    isNavigableIri(uri) &&
    !props.embedded?.get(uri) &&
    !props.labels?.get(uri) &&
    !props.objectTypes?.get(uri)
  )
}

/** Objects of a predicate, sorted by display text (label/qname, else literal). */
function sortedObjects(group: PropertyGroup): ResourceObject[] {
  const key = (o: ResourceObject) => (o.termType === 'uri' ? objectText(o.value) : o.value).toLowerCase()
  return [...group.objects].sort((a, b) => key(a).localeCompare(key(b)))
}

// A predicate can have thousands of objects (a hub node linking every grant).
// Long lists start collapsed to just their count (lazy — no rows render until
// asked), and even when revealed we cap the rows, so a hub resource never
// materializes tens of thousands of DOM nodes. The rest is reached by opening a
// specific one, like the "Referenced by" section.
const OBJECT_CAP = 100
const expanded = ref<Set<string>>(new Set())
const fmtN = (n: number) => n.toLocaleString('en-US')
const isBig = (group: PropertyGroup) => group.objects.length > OBJECT_CAP
const isCollapsed = (group: PropertyGroup) => isBig(group) && !expanded.value.has(group.predicate)
function shownObjects(group: PropertyGroup): ResourceObject[] {
  if (isCollapsed(group)) return []
  const all = sortedObjects(group)
  return isBig(group) ? all.slice(0, OBJECT_CAP) : all
}
function toggleExpand(predicate: string) {
  const next = new Set(expanded.value)
  next.has(predicate) ? next.delete(predicate) : next.add(predicate)
  expanded.value = next
}

// A rendered row is either a value (`o`), a type subheading (grouped mode), or a
// truncation note. One flat list so the value cell renders headers + values with
// a single v-for (no duplicated value template).
interface DisplayRow {
  o?: ResourceObject
  header?: string // type subheading label ('' key ⇒ present, so check `header !== undefined`)
  count?: number
  note?: string
}
const groupKeyOf = (o: ResourceObject) =>
  (o.termType === 'uri' ? props.objectTypes?.get(o.value) : undefined) ?? ''
const typeLabelOf = (typeIri: string) => (typeIri ? displayType(typeIri, props.resolved, mode.value) : 'Other')

function displayRows(group: PropertyGroup): DisplayRow[] {
  // Grouped: partition objects by their type, each a subheading + count, capped
  // per section (grouping is for navigation — a huge section still walks by URI).
  if (isGrouped(group.predicate)) {
    const byType = new Map<string, ResourceObject[]>()
    for (const o of sortedObjects(group)) {
      const k = groupKeyOf(o)
      const arr = byType.get(k)
      if (arr) arr.push(o)
      else byType.set(k, [o])
    }
    const sections = [...byType.entries()]
      .map(([type, objects]) => ({ type, label: typeLabelOf(type), objects }))
      .sort((a, b) => Number(!a.type) - Number(!b.type) || a.label.localeCompare(b.label)) // typed first, "Other" last
    const rows: DisplayRow[] = []
    for (const s of sections) {
      rows.push({ header: s.label, count: s.objects.length })
      for (const o of s.objects.slice(0, OBJECT_CAP)) rows.push({ o })
      if (s.objects.length > OBJECT_CAP)
        rows.push({ note: `first ${fmtN(OBJECT_CAP)} of ${fmtN(s.objects.length)} — open one to keep walking` })
    }
    return rows
  }
  // Flat: collapsed big lists render no values (the count row handles them).
  if (isCollapsed(group)) return []
  return shownObjects(group).map(o => ({ o }))
}

// Graphs are always KNOWN; this controls whether they're painted. Multi-graph
// triples are always surfaced (silence there would mislead).
function showGraphsFor(o: ResourceObject): boolean {
  return !!props.showGraphs || o.graphs.length > 1
}

// Hover always reveals the graph(s), even when chips are hidden — aware always.
function graphTitle(o: ResourceObject): string {
  return o.graphs.length ? `Graph(s): ${o.graphs.map(qname).join(', ')}` : 'Default graph'
}
</script>

<template>
  <table class="prop-table">
    <tbody>
      <tr
        v-for="(group, gi) in shownGroups"
        :key="group.predicate"
        :class="{ 'drag-over': reorderable && overIndex === gi && dragIndex !== gi, dragging: reorderable && dragIndex === gi, 'prop-hidden': isHidden(group.predicate) }"
        @dragover.prevent="reorderable && onDragOver(gi)"
        @drop="reorderable && onDrop(gi)"
        @dragend="onDragEnd"
      >
        <th class="prop-key" v-tooltip.top="{ value: qname(group.predicate), showDelay: 120 }">
          <span
            v-if="reorderable"
            class="drag-handle material-symbols-outlined"
            draggable="true"
            title="Drag to reorder"
            @dragstart="onDragStart(gi, $event)"
          >drag_indicator</span><button
            v-if="reorderable"
            class="hide-toggle material-symbols-outlined"
            :title="isHidden(group.predicate) ? 'Hidden — click to show' : 'Hide this property'"
            @click="emit('toggleHide', group.predicate)"
          >{{ isHidden(group.predicate) ? 'visibility_off' : 'visibility' }}</button><button
            v-if="reorderable"
            class="label-toggle material-symbols-outlined"
            :class="{ on: isLabelPart(group.predicate) }"
            :title="isLabelPart(group.predicate) ? 'Part of the label — click to remove' : 'Add to the label'"
            @click="emit('toggleLabel', group.predicate)"
          >title</button><button
            v-if="reorderable"
            class="fold-toggle material-symbols-outlined"
            :class="{ on: isFoldBoundary(group.predicate) }"
            :title="isFoldBoundary(group.predicate) ? 'Fold boundary — click to clear' : 'Fold here: collapse the rows after this one when inlined'"
            @click="emit('toggleFold', group.predicate)"
          >{{ isFoldBoundary(group.predicate) ? 'unfold_less' : 'unfold_more' }}</button><button
            v-if="reorderable"
            class="fold-toggle material-symbols-outlined"
            :class="{ on: isGrouped(group.predicate) }"
            :title="isGrouped(group.predicate) ? 'Grouped by type — click to ungroup' : 'Group this list by object type'"
            @click="emit('toggleGroupByType', group.predicate)"
          >category</button><span v-if="incoming" class="in-arrow" title="incoming — resources that link here">↤</span>{{ predicateLabel(group.predicate) }}</th>
        <td class="prop-values">
          <template v-for="(row, ri) in displayRows(group)" :key="ri">
            <!-- Type subheading (grouped mode) -->
            <div v-if="row.header !== undefined" class="type-subheading">
              <span class="type-subheading-label">{{ row.header }}</span>
              <span class="sec-count">{{ fmtN(row.count ?? 0) }}</span>
            </div>

            <!-- Per-section truncation note (grouped mode) -->
            <div v-else-if="row.note" class="prop-more">
              <span class="prop-more-count">{{ row.note }}</span>
            </div>

            <!-- A value -->
            <div v-else-if="row.o" class="prop-value" :title="graphTitle(row.o)">
              <!-- Embedded value object: inline its triples (recursively — an
                   embedded object may itself embed more, e.g. Site → PostalAddress) -->
              <div v-if="embedGroups(row.o, group.predicate)" class="embed">
                <span v-if="objectBadge(row.o.value)" class="tag type-badge">{{ objectBadge(row.o.value) }}</span>
                <PropertyTable
                  class="embed-table"
                  :groups="embedGroups(row.o, group.predicate)!"
                  :resolved="resolved"
                  :labels="labels"
                  :object-types="objectTypes"
                  :embedded="embedded"
                  :ancestors="[...(ancestors ?? []), row.o.value]"
                  :show-graphs="showGraphs"
                  :reorderable="reorderable"
                  :hidden="embedHidden(row.o)"
                  :label-parts="embedLabelParts(row.o)"
                  :fold-after="embedFoldAfter(row.o)"
                  :group-by-type="embedGroupByType(row.o)"
                  :embed="true"
                  @navigate="emit('navigate', $event)"
                  @reorder="p => onEmbedReorder(row.o!, p)"
                  @toggle-hide="p => onEmbedToggleHide(row.o!, p)"
                  @toggle-label="p => onEmbedToggleLabel(row.o!, p)"
                  @toggle-fold="p => onEmbedToggleFold(row.o!, p)"
                  @toggle-group-by-type="p => onEmbedToggleGroupByType(row.o!, p)"
                />
              </div>

              <!-- URI object: clickable -->
              <a
                v-else-if="row.o.termType === 'uri' && isNavigableIri(row.o.value)"
                class="uri-link"
                :class="{ dangling: isDangling(row.o.value) }"
                v-tooltip.top="{ value: isDangling(row.o.value) ? `${row.o.value}\n⚠ No data — this reference points to a resource with no properties` : row.o.value, showDelay: 120 }"
                @click="emit('navigate', row.o.value)"
              >{{ objectText(row.o.value) }}</a>

              <!-- URI we can't navigate to (e.g. mailto:) -->
              <span
                v-else-if="row.o.termType === 'uri'"
                class="uri-static"
                v-tooltip.top="{ value: row.o.value, showDelay: 120 }"
              >{{ objectText(row.o.value) }}</span>

              <!-- Blank node -->
              <span v-else-if="row.o.termType === 'bnode'" class="bnode">[ anonymous node ]</span>

              <!-- Literal -->
              <span v-else class="literal">
                {{ row.o.value }}
                <span v-if="row.o.lang" class="tag lang-tag">@{{ row.o.lang }}</span>
                <span v-else-if="row.o.datatype && row.o.datatype !== XSD_STRING" class="tag datatype-tag">{{ qname(row.o.datatype) }}</span>
              </span>

              <!-- Dangling reference marker (kept out of the v-if chain above so it
                   doesn't split it — a mid-chain v-if detaches the following v-else-if). -->
              <span
                v-if="row.o.termType === 'uri' && isDangling(row.o.value)"
                class="dangling-icon material-symbols-outlined"
                title="No data — this reference points to a resource with no properties"
              >warning</span>

              <!-- Type badge for a linked resource (embedded objects show it inside the embed) -->
              <span v-if="row.o.termType === 'uri' && !embedded?.get(row.o.value) && objectBadge(row.o.value)" class="tag type-badge">{{ objectBadge(row.o.value) }}</span>

              <!-- Graph provenance (always known; shown per option a) -->
              <span v-if="showGraphsFor(row.o)" class="graph-tags">
                <template v-if="row.o.graphs.length">
                  <span
                    v-for="g in row.o.graphs"
                    :key="g"
                    class="tag graph-tag"
                    :class="{ multi: row.o.graphs.length > 1 }"
                    :title="g"
                  >{{ qname(g) }}</span>
                </template>
                <span v-else class="tag graph-tag default" title="Default graph">default graph</span>
              </span>
            </div>
          </template>

          <!-- Flat long lists: collapsed to a count (lazy), revealed capped on demand. -->
          <div v-if="!isGrouped(group.predicate) && isBig(group)" class="prop-more">
            <template v-if="isCollapsed(group)">
              <span class="prop-more-count">{{ fmtN(group.objects.length) }} values</span>
              <a class="show-more" @click="toggleExpand(group.predicate)">Show first {{ fmtN(OBJECT_CAP) }}</a>
            </template>
            <template v-else>
              <span class="prop-more-count">first {{ fmtN(OBJECT_CAP) }} of {{ fmtN(group.objects.length) }} — open one to keep walking</span>
              <a class="show-more" @click="toggleExpand(group.predicate)">Hide</a>
            </template>
          </div>
        </td>
      </tr>

      <!-- Embed fold: reveal the remaining rows on demand. -->
      <tr v-if="foldable" class="rows-more-row">
        <td colspan="2" class="rows-more">
          <a class="show-more" @click="rowsExpanded = !rowsExpanded">
            {{ rowsExpanded ? 'Show fewer' : `Show ${groups.length - foldIndex - 1} more` }}
          </a>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.prop-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.prop-table tr {
  border-bottom: 1px solid var(--ae-border-color);
}

.prop-table tr:last-child {
  border-bottom: none;
}

.prop-key {
  text-align: left;
  vertical-align: top;
  font-weight: 600;
  color: var(--ae-text-secondary);
  font-family: var(--ae-font-mono);
  padding: 0.5rem 1rem 0.5rem 0;
  white-space: nowrap;
  width: 1%;
}

.prop-values {
  padding: 0.5rem 0;
}

.prop-value {
  padding: 0.125rem 0;
  word-break: break-word;
}

.in-arrow {
  color: var(--ae-accent);
  margin-right: 0.3rem;
  font-weight: 600;
}

/* Drag-to-reorder (edit mode) */
.drag-handle {
  font-size: 16px;
  vertical-align: middle;
  margin-right: 0.25rem;
  color: var(--ae-text-muted);
  cursor: grab;
}

.drag-handle:active {
  cursor: grabbing;
}

.prop-table tr.dragging {
  opacity: 0.5;
}

.prop-table tr.drag-over {
  border-top: 2px solid var(--ae-accent);
}

.hide-toggle {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  font-size: 15px;
  vertical-align: middle;
  margin-right: 0.25rem;
  color: var(--ae-text-muted);
}

.hide-toggle:hover {
  color: var(--ae-text-primary);
}

.label-toggle,
.fold-toggle {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  font-size: 15px;
  vertical-align: middle;
  margin-right: 0.25rem;
  color: var(--ae-text-muted);
}

.label-toggle:hover,
.fold-toggle:hover {
  color: var(--ae-text-primary);
}

.label-toggle.on,
.fold-toggle.on {
  color: var(--ae-accent);
}

/* A hidden property, shown only in edit mode so it can be un-hidden. */
.prop-table tr.prop-hidden {
  opacity: 0.45;
}

.prop-more {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.25rem 0;
  font-size: 0.75rem;
}

.prop-more-count {
  color: var(--ae-text-muted);
}

/* Type subheading in grouped object lists (hasResult → JournalPaper, Dataset …) */
.type-subheading {
  display: flex;
  align-items: baseline;
  gap: 0.375rem;
  margin: 0.5rem 0 0.125rem;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ae-text-secondary);
}

.type-subheading:first-child {
  margin-top: 0;
}

.type-subheading .sec-count {
  font-weight: 500;
  color: var(--ae-text-muted);
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 10px;
  padding: 0 0.4rem;
  letter-spacing: 0;
}

.show-more {
  color: var(--ae-accent);
  cursor: pointer;
}

.show-more:hover {
  text-decoration: underline;
}

/* Embed fold toggle row */
.rows-more {
  padding: 0.35rem 0;
  font-size: 0.75rem;
}

.uri-link {
  color: var(--ae-accent);
  cursor: pointer;
  font-family: var(--ae-font-mono);
}

.uri-link:hover {
  text-decoration: underline;
}

/* Dangling reference: points at a resource with no data. */
.uri-link.dangling {
  color: var(--ae-text-muted);
  font-style: italic;
}

.dangling-icon {
  font-size: 14px;
  vertical-align: middle;
  margin-left: 0.25rem;
  color: var(--ae-status-warning);
  cursor: help;
}

.uri-static {
  color: var(--ae-text-primary);
  font-family: var(--ae-font-mono);
}

.bnode {
  color: var(--ae-text-muted);
  font-style: italic;
}

.literal {
  color: var(--ae-text-primary);
}

.tag {
  display: inline-block;
  margin-left: 0.375rem;
  padding: 0 0.375rem;
  border-radius: 4px;
  font-size: 0.6875rem;
  font-family: var(--ae-font-mono);
  background: var(--ae-bg-hover);
  color: var(--ae-text-secondary);
  vertical-align: middle;
}

.graph-tags {
  display: inline-flex;
  gap: 0.25rem;
  vertical-align: middle;
}

.graph-tag {
  border: 1px solid var(--ae-border-color);
  background: transparent;
}

/* A triple in >1 graph is the case silence would hide — make it noticeable. */
.graph-tag.multi {
  border-color: var(--ae-accent);
  color: var(--ae-accent);
}

.graph-tag.default {
  font-style: italic;
}

/* Type badge alongside a linked resource (e.g. "Conservation… [Project]") */
.type-badge {
  border: 1px solid var(--ae-border-color);
  background: var(--ae-bg-elevated);
  color: var(--ae-text-secondary);
}

/* Inline-embedded value object (MonetaryAmount, coordinates) */
.embed {
  display: inline-block;
  border-left: 2px solid var(--ae-border-color);
  padding-left: 0.625rem;
  margin: 0.125rem 0;
}

.embed .type-badge {
  margin-left: 0;
  margin-bottom: 0.125rem;
}

/* Compact the nested table */
.embed-table :deep(.prop-key) {
  padding: 0.125rem 0.75rem 0.125rem 0;
}

.embed-table :deep(.prop-values) {
  padding: 0.125rem 0;
}

.embed-table :deep(tr) {
  border-bottom: none;
}

</style>
