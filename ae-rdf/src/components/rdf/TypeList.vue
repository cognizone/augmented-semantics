<script setup lang="ts">
/**
 * TypeList - sidebar listing the endpoint's rdf:types with instance counts.
 *
 * Selecting a type pushes ?type to the URL. A per-type gear configures its
 * sidebar visibility (show/hide/pin) and object-render strategy
 * (link/embed/label) — authored into the typeConfig store (left side of the
 * config feature). Embed-rendering is consumed by the resource view (next step).
 *
 * @see /spec/ae-rdf
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import ProgressSpinner from 'primevue/progressspinner'
import Menu from 'primevue/menu'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import { useBrowseStore, useSettingsStore, useTypeConfigStore, useFacetStore } from '../../stores'
import { useRdfTypes, useDelayedLoading } from '../../composables'
import { INCOMING_PREDICATES_SAMPLE } from '../../services'
import { displayType, localName } from '../../utils/format'
import { URL_PARAMS } from '../../router'
import FacetPanel from './FacetPanel.vue'

const router = useRouter()
const browseStore = useBrowseStore()
const settings = useSettingsStore()
const typeConfig = useTypeConfigStore()
const facetStore = useFacetStore()

// Switchable sidebar rail: the type tree ('types') or the facet panel ('filters').
// The Filters tab is enabled only when the current type has facets configured. We
// never auto-switch to Filters on type selection (avoids surprise) — but if the
// user is ON Filters and moves to a type WITHOUT facets, fall back to Types so the
// rail is never stuck empty.
const rail = ref<'types' | 'filters'>('types')
watch(() => facetStore.hasFacets, (has) => {
  if (!has && rail.value === 'filters') rail.value = 'types'
})
const { types, loading, error, resolved, typeLabels, composition, subclasses, pathCounts, orphanCounts, requestPathCount, fetchIncomingPredicates } = useRdfTypes()
const showLoading = useDelayedLoading(loading)

// Draggable sidebar width, persisted. Pointer events + setPointerCapture so the
// drag tracks reliably across mouse/trackpad and keeps firing even when the
// pointer leaves the 6px handle or moves fast (raw window mousemove drops these).
const SIDEBAR_WIDTH_KEY = 'ae-rdf-sidebar-width'
const MIN_W = 200, MAX_W = 560
const clampW = (w: number) => Math.min(MAX_W, Math.max(MIN_W, w))
const sidebarWidth = ref(clampW(Number(localStorage.getItem(SIDEBAR_WIDTH_KEY)) || 280))

// Show/hide embed types nested inline under their composing class. Off → they
// only appear in the collapsed "Embedded" system group at the bottom. Lives in the
// settings store (Settings panel + this {} header button, both bound to it).
const showEmbeds = computed(() => settings.showEmbedsNested)
function toggleEmbeds() { settings.showEmbedsNested = !settings.showEmbedsNested }
const dragging = ref(false)
let dragStartX = 0, dragStartW = 0
function startDrag(e: PointerEvent) {
  dragging.value = true
  dragStartX = e.clientX
  dragStartW = sidebarWidth.value
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  document.body.style.userSelect = 'none'
}
function onDragMove(e: PointerEvent) {
  if (dragging.value) sidebarWidth.value = clampW(dragStartW + e.clientX - dragStartX)
}
function endDrag() {
  if (!dragging.value) return
  dragging.value = false
  document.body.style.userSelect = ''
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth.value))
}
onBeforeUnmount(() => { document.body.style.userSelect = '' })

const selected = computed(() => browseStore.currentType)
const typeMenu = ref()
const menuType = ref<string | null>(null)
// New-group dialog state.
const showGroupDialog = ref(false)
const groupDialogUri = ref<string | null>(null)
const groupNameInput = ref('')
// Embed "owning predicate" dialog state.
const showEmbedDialog = ref(false)
const embedDialogUri = ref<string | null>(null)
const embedCandidates = ref<{ predicate: string; parentType: string; count: number }[]>([])
const embedLoadingCands = ref(false)
const embedSelected = ref('') // '' = any predicate (inline everywhere)
// Discovery samples the type's instances, so counts are approximate above the cap.
const embedSampled = computed(() => countOf(embedDialogUri.value ?? '') > INCOMING_PREDICATES_SAMPLE)
// Collapsed superclasses (default expanded). A Set, replaced wholesale to stay reactive.
const collapsed = ref<Set<string>>(new Set())

// Client-side type filter. Non-empty → the tree is replaced by a flat, count-
// sorted list of matching types (no SPARQL, purely over types.value). Reset when
// the endpoint reloads `types` so a stale query never carries across endpoints.
const filter = ref('')
const filterQuery = computed(() => filter.value.trim().toLowerCase())
const filtering = computed(() => filterQuery.value !== '')
watch(types, () => { filter.value = '' })

// Auto "system" groups at the bottom of the list (collapsed by default).
const SYS_EMBEDDED = 'Embedded'
const SYS_LABELS = 'Value objects'
const SYS_HIDDEN = 'Hidden'

// Humanized mode prefers a fetched human label for the class (e.g. "Personal data")
// over its local name; prefixed/full stay pure qname/URI. Prefix tag is unaffected.
const typeName = (uri: string) => {
  if (settings.uriDisplay === 'humanized') {
    const label = typeLabels.value.get(uri)
    if (label) return label
  }
  return displayType(uri, resolved.value, settings.uriDisplay)
}
// Namespace prefix shown small in front of a class (e.g. "schema"); '' when unresolved.
const typePrefix = (uri: string) => resolved.value.get(uri)?.prefix ?? ''
const cfg = (uri: string) => typeConfig.get(uri)
// Blank-node types have no navigable instance view (anonymous nodes) — always
// hidden and never clickable, regardless of per-type config.
const isBlank = (uri: string) => typeConfig.blank(uri)
const isHidden = (uri: string) => cfg(uri).sidebar === 'hide' || isBlank(uri)
const isPinned = (uri: string) => cfg(uri).sidebar === 'pin'
const renderOf = (uri: string) => cfg(uri).render ?? 'link'

function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

const countOf = (uri: string) => types.value.find(t => t.uri === uri)?.count ?? 0
// Cap visual indent so deep trees never run off under the count badge (280px panel).
const indent = (depth: number) => `${0.5 + Math.min(depth, 3) * 0.9}rem`

const isCollapsed = (uri: string) => collapsed.value.has(uri)
function toggleCollapse(uri: string) {
  const next = new Set(collapsed.value)
  next.has(uri) ? next.delete(uri) : next.add(uri)
  collapsed.value = next
}

/* ── Embed nesting (value objects shown inline under their composing class) ── */

// Blank types never go in the Embedded group — they're hidden (their properties
// still inline via the resource view's always-on blank-node pass, not this set).
const embedSet = computed(() => new Set(types.value.filter(t => renderOf(t.uri) === 'embed' && !isBlank(t.uri)).map(t => t.uri)))

// render:label types (composed value-object identities shown inline, not browsed)
// go to their own system "Labels" group — mirrors embedSet so they don't clutter
// the main tree. Blank types stay hidden (no browsable view).
const labelSet = computed(() => new Set(types.value.filter(t => renderOf(t.uri) === 'label' && !isBlank(t.uri)).map(t => t.uri)))

// Embed children of a class, each with a count scoped to that class (not the
// global type total), commonest first.
const childrenOf = (parentUri: string): { uri: string; count: number }[] =>
  (composition.value.get(parentUri) ?? [])
    .filter(e => embedSet.value.has(e.uri))
    .sort((a, b) => b.count - a.count)

// Walk the composition tree depth-first so embeds-within-embeds nest too
// (Organisation → Site → PostalAddress). Each row's count is relative to its
// immediate parent; `path` is the embed chain to this row (for path-scoped
// counts). `seen` guards cycles and repeats.
interface EmbedRow { uri: string; depth: number; count: number; path: string[] }
function embedRows(parentUri: string, depth = 1, seen = new Set<string>([parentUri]), trail: string[] = []): EmbedRow[] {
  const rows: EmbedRow[] = []
  for (const c of childrenOf(parentUri)) {
    if (seen.has(c.uri)) continue
    seen.add(c.uri)
    const path = [...trail, c.uri]
    rows.push({ uri: c.uri, depth, count: c.count, path })
    rows.push(...embedRows(c.uri, depth + 1, seen, path))
  }
  return rows
}

/* ── Subclass nesting (more-specific kinds tucked under their general type) ── */

// Navigable types in the main tree: not hidden, not embedded (those go to their
// own system groups at the bottom).
const baseTypes = computed(() =>
  types.value.filter(t => !isHidden(t.uri) && !embedSet.value.has(t.uri) && !labelSet.value.has(t.uri)),
)
// Optional sidebar group a type is assigned to (trimmed; '' = none).
const groupOf = (uri: string): string => (cfg(uri).group ?? '').trim()
const isGrouped = (uri: string) => groupOf(uri) !== ''
// A type's subclasses that are listed, navigable, and NOT pulled into a group,
// commonest first. (A grouped type leaves its parent's subtree for its group.)
const subChildren = (uri: string): string[] =>
  (subclasses.value.get(uri) ?? [])
    .filter(s => !embedSet.value.has(s) && !labelSet.value.has(s) && !isGrouped(s) && !isHidden(s))
    .sort((a, b) => countOf(b) - countOf(a))
// Subclasses that nest under a parent → never top-level. Grouped types are
// promoted to roots (shown under their group), so they're excluded here. Only
// nest under a *navigable* parent (baseTypes): a subclass of a hidden/embedded
// superclass is never visit()ed under it, so it must stay a root or it vanishes.
const nestedSubs = computed(() => {
  const navigable = new Set(baseTypes.value.map(t => t.uri))
  const s = new Set<string>()
  for (const [parent, subs] of subclasses.value) {
    if (!navigable.has(parent)) continue
    for (const sub of subs) if (!embedSet.value.has(sub) && !labelSet.value.has(sub) && !isGrouped(sub)) s.add(sub)
  }
  return s
})
const pinnedRoots = computed(() => baseTypes.value.filter(t => isPinned(t.uri)).map(t => t.uri))
// Roots = top-level navigable types (not pinned, not nested under another).
const normalRoots = computed(() =>
  baseTypes.value.filter(t => !isPinned(t.uri) && !nestedSubs.value.has(t.uri)).map(t => t.uri),
)
// Partition roots into named groups vs ungrouped.
const ungroupedRoots = computed(() => normalRoots.value.filter(u => !isGrouped(u)))
const groupedRoots = computed(() => {
  const m = new Map<string, string[]>()
  for (const u of normalRoots.value) {
    const g = groupOf(u)
    if (!g) continue
    const arr = m.get(g) ?? []
    arr.push(u)
    m.set(g, arr)
  }
  return m
})
const groupNames = computed(() => [...groupedRoots.value.keys()].sort((a, b) => a.localeCompare(b)))
// All group names currently in use (for the gear's "assign to group" menu).
const existingGroups = computed(() => {
  const s = new Set<string>()
  for (const t of types.value) { const g = groupOf(t.uri); if (g) s.add(g) }
  return [...s].sort((a, b) => a.localeCompare(b))
})

// Explicit per-group toggles; a group not toggled falls to its default: system
// "Embedded" expanded, "Hidden" collapsed, named groups per the groupsCollapsed
// setting. (Changing the setting live re-defaults any group the user hasn't touched.)
const groupOverrides = ref<Map<string, boolean>>(new Map())

// System-group members: every embed type (also nested under its classes — shown
// here too for consistency) and every hidden navigable type.
const embeddedGroupTypes = computed(() =>
  types.value.filter(t => embedSet.value.has(t.uri)).map(t => t.uri).sort((a, b) => countOf(b) - countOf(a)),
)
const labelGroupTypes = computed(() =>
  types.value.filter(t => labelSet.value.has(t.uri)).map(t => t.uri).sort((a, b) => countOf(b) - countOf(a)),
)
const hiddenGroupTypes = computed(() =>
  types.value.filter(t => isHidden(t.uri) && !embedSet.value.has(t.uri) && !labelSet.value.has(t.uri)).map(t => t.uri).sort((a, b) => countOf(b) - countOf(a)),
)
const defaultCollapsed = (name: string) =>
  name === SYS_EMBEDDED ? false : name === SYS_HIDDEN || name === SYS_LABELS ? true : settings.groupsCollapsed
const isGroupCollapsed = (name: string) =>
  groupOverrides.value.has(name) ? groupOverrides.value.get(name)! : defaultCollapsed(name)
function toggleGroup(name: string) {
  const next = new Map(groupOverrides.value)
  next.set(name, !isGroupCollapsed(name))
  groupOverrides.value = next
}

const hasKids = (uri: string) => subChildren(uri).length > 0 || (showEmbeds.value && childrenOf(uri).length > 0)

// scoped=false → the count exists but isn't relative to this row's ancestry
// (a deeper embed's count is the global per-parent-type total), so we hide it
// rather than show a misleading number. Path-scoped deep counts would cost a
// chained COUNT query per path on every load — not worth it eagerly.
interface Row { uri: string; depth: number; kind: 'class' | 'embed' | 'group'; count: number; group?: string; scoped?: boolean; chain?: string[]; system?: boolean; leaf?: boolean; global?: boolean }

// One flat, ordered render list: pinned, then ungrouped roots, then a
// collapsible header per named group with its roots' subtrees. Each class is
// followed by its embed descendants. A global `seen` makes a multi-parent
// subclass show once (under its first parent) and guards cycles.
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  const seen = new Set<string>()
  const pinned = new Set(pinnedRoots.value)

  function visit(uri: string, depth: number) {
    if (seen.has(uri)) return
    seen.add(uri)
    out.push({ uri, depth, kind: 'class', count: countOf(uri) })
    if (isCollapsed(uri)) return
    for (const sub of subChildren(uri)) {
      if (pinned.has(sub)) continue // shown in the pinned section instead
      visit(sub, depth + 1)
    }
    if (showEmbeds.value) for (const e of embedRows(uri)) {
      // Only a direct embed child (e.depth === 1) has a count scoped to this
      // class; deeper ones carry the global per-parent-type total → unscoped,
      // resolved on demand via the [class, …embed chain].
      out.push({ uri: e.uri, depth: depth + e.depth, kind: 'embed', count: e.count, scoped: e.depth === 1, chain: [uri, ...e.path] })
    }
  }

  for (const r of pinnedRoots.value) visit(r, 0)
  for (const r of ungroupedRoots.value) visit(r, 0)
  for (const name of groupNames.value) {
    const members = groupedRoots.value.get(name)!
    out.push({ uri: name, depth: 0, kind: 'group', count: members.length, group: name })
    if (!isGroupCollapsed(name)) for (const r of members) visit(r, 1)
  }
  // System groups (collapsed by default): all embed types (also nested under
  // their classes, listed here for consistency) and all hidden types.
  if (embeddedGroupTypes.value.length) {
    out.push({ uri: SYS_EMBEDDED, depth: 0, kind: 'group', count: embeddedGroupTypes.value.length, group: SYS_EMBEDDED, system: true })
    if (!isGroupCollapsed(SYS_EMBEDDED)) for (const u of embeddedGroupTypes.value) out.push({ uri: u, depth: 1, kind: 'embed', count: countOf(u), scoped: true, global: true })
  }
  if (labelGroupTypes.value.length) {
    out.push({ uri: SYS_LABELS, depth: 0, kind: 'group', count: labelGroupTypes.value.length, group: SYS_LABELS, system: true })
    if (!isGroupCollapsed(SYS_LABELS)) for (const u of labelGroupTypes.value) out.push({ uri: u, depth: 1, kind: 'class', count: countOf(u), leaf: true })
  }
  if (hiddenGroupTypes.value.length) {
    out.push({ uri: SYS_HIDDEN, depth: 0, kind: 'group', count: hiddenGroupTypes.value.length, group: SYS_HIDDEN, system: true })
    if (!isGroupCollapsed(SYS_HIDDEN)) for (const u of hiddenGroupTypes.value) out.push({ uri: u, depth: 1, kind: 'class', count: countOf(u), leaf: true })
  }
  return out
})

// A type matches when the query is a substring of its local name, its fetched human
// label, its namespace prefix, or its full URI (case-insensitive). Local name/label/
// prefix are what a row shows; the URI is included so a namespace search (e.g.
// "purl.org") still hits.
function matchesFilter(uri: string): boolean {
  const q = filterQuery.value
  return localName(uri).toLowerCase().includes(q)
    || (typeLabels.value.get(uri) ?? '').toLowerCase().includes(q)
    || typePrefix(uri).toLowerCase().includes(q)
    || uri.toLowerCase().includes(q)
}

// Filtered view: a flat depth-0 list, commonest first, replacing the tree. Embed
// types mirror the Embedded-group row (data_object icon, class-scoped count);
// every other match is a plain class row. Hidden/blank types are included only
// when showHidden is on. `leaf: true` on class rows suppresses disclosure
// chevrons — no nesting is shown while filtering, so toggling can't mutate
// collapse state (the tree must return unchanged once cleared).
const filteredRows = computed<Row[]>(() =>
  !filtering.value
    ? []
    : types.value
        .filter(t => matchesFilter(t.uri) && (settings.showHidden || !isHidden(t.uri)))
        .sort((a, b) => b.count - a.count)
        .map((t): Row => embedSet.value.has(t.uri)
          ? { uri: t.uri, depth: 0, kind: 'embed', count: t.count, scoped: true, global: true }
          : { uri: t.uri, depth: 0, kind: 'class', count: t.count, leaf: true }),
)

// The list source: filtered flat rows while filtering, else the normal tree.
const displayRows = computed<Row[]>(() => (filtering.value ? filteredRows.value : rows.value))

// Nested-embed counts aren't path-scoped up front; fetch on hover, show once in.
const pathKey = (row: Row) => (row.chain ?? []).join('>')
function onEmbedEnter(row: Row) {
  if (row.kind === 'embed' && row.scoped === false && row.chain) requestPathCount(row.chain)
}
const embedCount = (row: Row): number | null =>
  row.scoped !== false ? row.count : (pathCounts.value.get(pathKey(row)) ?? null)

// Embed orphans: instances of an embedVia type with no owner via that predicate.
const orphansOf = (uri: string) => orphanCounts.value.get(uri) ?? 0
const orphanTitle = (uri: string): string | undefined => {
  const n = orphansOf(uri)
  return n > 0 ? `${formatCount(n)} of ${formatCount(countOf(uri))} have no owner via ${predName(cfg(uri).embedVia ?? '')} — only reachable here` : undefined
}
const embeddedHasOrphans = computed(() => embeddedGroupTypes.value.some(u => orphansOf(u) > 0))

const menuItems = computed(() => {
  const uri = menuType.value
  if (!uri) return []
  const sidebar = cfg(uri).sidebar ?? 'show'
  const render = cfg(uri).render ?? 'link'
  const check = (on: boolean) => (on ? 'pi pi-check' : undefined)
  return [
    {
      label: sidebar === 'pin' ? 'Unpin' : 'Pin to top',
      icon: 'pi pi-bookmark',
      command: () => typeConfig.set(uri, { sidebar: sidebar === 'pin' ? 'show' : 'pin' }),
    },
    {
      label: sidebar === 'hide' ? 'Show in list' : 'Hide from list',
      icon: sidebar === 'hide' ? 'pi pi-eye' : 'pi pi-eye-slash',
      command: () => typeConfig.set(uri, { sidebar: sidebar === 'hide' ? 'show' : 'hide' }),
    },
    { separator: true },
    {
      label: 'Render as object',
      items: [
        { label: 'Link', icon: check(render === 'link'), command: () => typeConfig.set(uri, { render: 'link', embedVia: undefined }) },
        { label: 'Embed…', icon: check(render === 'embed'), command: () => promptEmbed(uri) },
        { label: 'Label only', icon: check(render === 'label'), command: () => typeConfig.set(uri, { render: 'label', embedVia: undefined }) },
      ],
    },
    {
      label: 'Group',
      items: [
        ...existingGroups.value.map(g => ({ label: g, icon: check(groupOf(uri) === g), command: () => setGroup(uri, g) })),
        ...(existingGroups.value.length ? [{ separator: true }] : []),
        { label: 'New group…', icon: 'pi pi-plus', command: () => promptNewGroup(uri) },
        ...(isGrouped(uri) ? [{ label: 'Remove from group', icon: 'pi pi-times', command: () => setGroup(uri, '') }] : []),
      ],
    },
  ]
})

function setGroup(uri: string, name: string) {
  typeConfig.set(uri, { group: name.trim() || undefined })
}
function promptNewGroup(uri: string) {
  groupDialogUri.value = uri
  groupNameInput.value = groupOf(uri)
  showGroupDialog.value = true
}
function confirmGroup() {
  if (groupDialogUri.value) setGroup(groupDialogUri.value, groupNameInput.value)
  showGroupDialog.value = false
}

// Open the embed dialog and discover (on demand) the predicates that point at
// this type, so the user can pin the one that OWNS it (e.g. isFundedBy ← Project).
async function promptEmbed(uri: string) {
  embedDialogUri.value = uri
  embedSelected.value = cfg(uri).embedVia ?? ''
  embedCandidates.value = []
  showEmbedDialog.value = true
  embedLoadingCands.value = true
  try {
    const cands = await fetchIncomingPredicates(uri)
    if (embedDialogUri.value === uri) embedCandidates.value = cands
  } finally {
    if (embedDialogUri.value === uri) embedLoadingCands.value = false
  }
}
function confirmEmbed() {
  if (embedDialogUri.value) typeConfig.set(embedDialogUri.value, { render: 'embed', embedVia: embedSelected.value || undefined })
  showEmbedDialog.value = false
}
const predName = (uri: string) => localName(uri)

function openMenu(event: Event, uri: string) {
  menuType.value = uri
  typeMenu.value.toggle(event)
}

function selectType(uri: string) {
  // Drop ?resource so the instance list shows (resource view has precedence).
  router.push({ query: { [URL_PARAMS.TYPE]: uri } })
}
</script>

<template>
  <aside class="type-list" :style="{ width: sidebarWidth + 'px' }">
    <div class="type-list-header">
      <!-- Switchable rail: the type tree or the facet filters. The Filters tab is
           disabled (greyed) when the current type has no facets; when it has
           selections active, the count shows on the tab so filters are discoverable
           from the tree side. -->
      <div class="rail-toggle" role="tablist" aria-label="Sidebar view">
        <button
          class="rail-tab"
          role="tab"
          :class="{ active: rail === 'types' }"
          :aria-selected="rail === 'types'"
          @click="rail = 'types'"
        >Types</button>
        <button
          class="rail-tab"
          role="tab"
          :class="{ active: rail === 'filters' }"
          :aria-selected="rail === 'filters'"
          :disabled="!facetStore.hasFacets"
          :title="facetStore.hasFacets ? 'Filter instances by facet' : 'No facets configured for this type'"
          @click="rail = 'filters'"
        >
          Filters<span v-if="facetStore.activeCount" class="rail-badge">{{ facetStore.activeCount }}</span>
        </button>
      </div>
      <button
        v-if="rail === 'types'"
        class="header-toggle"
        :class="{ off: !showEmbeds }"
        :aria-pressed="showEmbeds"
        :title="showEmbeds ? 'Hide embedded types nested under their class' : 'Show embedded types nested under their class'"
        @click="toggleEmbeds"
      >
        <span class="material-symbols-outlined">data_object</span>
      </button>
    </div>

    <FacetPanel v-if="rail === 'filters'" />

    <template v-else>
    <!-- Client-side filter: replaces the tree with matching types while typed in.
         Esc or the ✕ clears it. Hidden while there's nothing to filter. -->
    <div v-if="types.length" class="type-filter">
      <span class="material-symbols-outlined type-filter-icon">filter_list</span>
      <input
        v-model="filter"
        class="type-filter-input"
        type="text"
        placeholder="Filter types…"
        aria-label="Filter types"
        @keydown.esc="filter = ''"
      />
      <button v-if="filter" class="type-filter-clear" type="button" aria-label="Clear filter" @click="filter = ''">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <div v-if="showLoading" class="state">
      <ProgressSpinner style="width: 28px; height: 28px" strokeWidth="4" />
    </div>

    <div v-else-if="error" class="state error">
      <span class="material-symbols-outlined">error</span>
      <span>{{ error }}</span>
    </div>

    <p v-else-if="!types.length" class="state">No types found.</p>

    <p v-else-if="filtering && !filteredRows.length" class="state">No types match.</p>

    <template v-else>
      <div v-if="filtering" class="type-filter-status">{{ filteredRows.length }} of {{ types.length }} types</div>
      <ul class="type-items">
        <li
          v-for="(row, i) in displayRows"
          :key="i"
          class="type-row"
          :class="{ 'is-hidden': row.kind !== 'group' && !row.leaf && isHidden(row.uri), 'type-child': row.kind === 'embed', 'is-group': row.kind === 'group' }"
          :style="{ paddingLeft: indent(row.depth) }"
        >
          <!-- Disclosure: collapse/expand a group, or a class with subclasses/embeds. -->
          <button
            v-if="row.kind === 'group'"
            class="type-disclosure"
            :aria-label="isGroupCollapsed(row.group!) ? 'Expand group' : 'Collapse group'"
            @click.stop="toggleGroup(row.group!)"
          >
            <span class="material-symbols-outlined">{{ isGroupCollapsed(row.group!) ? 'chevron_right' : 'expand_more' }}</span>
          </button>
          <button
            v-else-if="row.kind === 'class' && !row.leaf && hasKids(row.uri)"
            class="type-disclosure"
            :aria-label="isCollapsed(row.uri) ? 'Expand' : 'Collapse'"
            @click.stop="toggleCollapse(row.uri)"
          >
            <span class="material-symbols-outlined">{{ isCollapsed(row.uri) ? 'chevron_right' : 'expand_more' }}</span>
          </button>
          <span v-else class="type-disclosure-spacer"></span>

          <!-- Group header: collapsible bucket of classes. -->
          <button v-if="row.kind === 'group'" class="type-item type-group-item" @click="toggleGroup(row.group!)">
            <span class="type-name">{{ row.group }}</span>
            <span
              v-if="row.group === SYS_EMBEDDED && embeddedHasOrphans"
              class="material-symbols-outlined orphan-flag"
              title="Some embedded types have instances with no owner — they only appear in this group, never inlined"
            >warning</span>
            <span class="type-count">{{ formatCount(row.count) }}</span>
          </button>

          <!-- Blank-node type: anonymous instances, no navigable view — static. -->
          <span
            v-else-if="row.kind === 'class' && isBlank(row.uri)"
            class="type-item type-item-static"
            :title="row.uri + ' — blank-node type: instances are anonymous, no page to open'"
          >
            <span v-if="typePrefix(row.uri)" class="type-prefix">{{ typePrefix(row.uri) }}</span>
            <span class="type-name">{{ typeName(row.uri) }}</span>
            <span class="type-ind">
              <span class="material-symbols-outlined ind" title="Blank-node type — reachable only inline">data_object</span>
            </span>
            <span class="type-count">{{ formatCount(row.count) }}</span>
          </span>

          <!-- Class: a navigable type (click → instance list). -->
          <button
            v-else-if="row.kind === 'class'"
            class="type-item"
            :class="{ active: selected === row.uri }"
            :title="row.uri"
            @click="selectType(row.uri)"
          >
            <span v-if="typePrefix(row.uri)" class="type-prefix">{{ typePrefix(row.uri) }}</span>
            <span class="type-name">{{ typeName(row.uri) }}</span>
            <span class="type-ind">
              <span v-if="isPinned(row.uri)" class="material-symbols-outlined ind" title="Pinned to top">push_pin</span>
              <span v-if="renderOf(row.uri) === 'label'" class="material-symbols-outlined ind" title="Shown as a label (no link)">label</span>
            </span>
            <span class="type-count">{{ formatCount(row.count) }}</span>
          </button>

          <!-- Embed: a value object shown inline elsewhere — muted, but still
               clickable to browse its instances. Direct child → class-scoped
               count; nested → path count on hover. -->
          <button
            v-else
            class="type-item"
            :class="{ active: selected === row.uri }"
            :title="row.uri"
            @mouseenter="onEmbedEnter(row)"
            @click="selectType(row.uri)"
          >
            <span v-if="typePrefix(row.uri)" class="type-prefix">{{ typePrefix(row.uri) }}</span>
            <span class="type-name">{{ typeName(row.uri) }}</span>
            <span class="type-ind">
              <span class="material-symbols-outlined ind" title="Embedded inline as a value — click to browse instances">data_object</span>
            </span>
            <span
              v-if="embedCount(row) !== null"
              class="type-count"
              :class="{ 'count-orphan': row.global && orphansOf(row.uri) > 0 }"
              :title="row.global ? orphanTitle(row.uri) : undefined"
            >{{ formatCount(embedCount(row)!) }}</span>
          </button>

          <button v-if="settings.editMode && row.kind !== 'group'" class="type-gear" aria-label="Configure type" @click.stop="openMenu($event, row.uri)">
            <span class="material-symbols-outlined">tune</span>
          </button>
        </li>
      </ul>
    </template>
    </template>

    <Menu ref="typeMenu" :model="menuItems" :popup="true" />

    <Dialog v-model:visible="showGroupDialog" header="New group" :modal="true" :style="{ width: '360px' }" position="top">
      <div class="group-dialog">
        <label class="group-dialog-label" for="group-name">Group name</label>
        <InputText
          id="group-name"
          v-model="groupNameInput"
          placeholder="e.g. Ontology"
          autofocus
          @keyup.enter="confirmGroup"
        />
        <small class="group-dialog-hint">Classes sharing a name collect under one collapsible header.</small>
      </div>
      <template #footer>
        <Button label="Cancel" text severity="secondary" @click="showGroupDialog = false" />
        <Button label="Save" :disabled="!groupNameInput.trim()" @click="confirmGroup" />
      </template>
    </Dialog>

    <Dialog v-model:visible="showEmbedDialog" header="Embed via" :modal="true" :style="{ width: '460px' }" position="top">
      <div class="embed-dialog">
        <p class="embed-dialog-hint">
          Inline this type only where it is reached via the chosen relationship. Pick
          <strong>Any</strong> for a pure value object with a single owner (it then inlines wherever it appears).
        </p>
        <div v-if="embedLoadingCands" class="embed-dialog-loading">
          <ProgressSpinner style="width: 22px; height: 22px" strokeWidth="4" />
          <span>Finding relationships…</span>
        </div>
        <ul v-else class="embed-options">
          <li>
            <label class="embed-option">
              <input type="radio" value="" v-model="embedSelected" />
              <span class="embed-option-pred">Any predicate</span>
              <span class="embed-option-meta">inline wherever it appears</span>
            </label>
          </li>
          <li v-for="cand in embedCandidates" :key="cand.predicate + cand.parentType">
            <label class="embed-option">
              <input type="radio" :value="cand.predicate" v-model="embedSelected" />
              <span class="embed-option-pred" :title="cand.predicate">{{ predName(cand.predicate) }}</span>
              <span class="embed-option-meta" :title="embedSampled ? `approximate — sampled ${formatCount(INCOMING_PREDICATES_SAMPLE)} of ${formatCount(countOf(embedDialogUri ?? ''))} instances` : undefined">← {{ predName(cand.parentType) }} · {{ embedSampled ? '~' : '' }}{{ formatCount(cand.count) }}</span>
            </label>
          </li>
          <li v-if="!embedCandidates.length" class="embed-empty">No incoming relationships found — only “Any” applies.</li>
        </ul>
      </div>
      <template #footer>
        <Button label="Cancel" text severity="secondary" @click="showEmbedDialog = false" />
        <Button label="Save" @click="confirmEmbed" />
      </template>
    </Dialog>

    <div
      class="resize-handle"
      :class="{ dragging }"
      title="Drag to resize"
      @pointerdown.prevent="startDrag"
      @pointermove="onDragMove"
      @pointerup="endDrag"
      @pointercancel="endDrag"
    ></div>
  </aside>
</template>

<style scoped>
.type-list {
  display: flex;
  flex-direction: column;
  position: relative;
  flex-shrink: 0;
  border-right: 1px solid var(--ae-border-color);
  overflow: hidden;
  background: var(--ae-bg-elevated);
}

/* Full-height drag handle sitting on the right edge to resize the sidebar. */
.resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 5;
}

.resize-handle:hover,
.resize-handle.dragging {
  background: var(--ae-accent);
  opacity: 0.4;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* Segmented Types | Filters rail switch. */
.rail-toggle {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--ae-bg-base);
  border: 1px solid var(--ae-border-color);
  border-radius: 6px;
}

.rail-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.15rem 0.55rem;
  border-radius: 4px;
  font: inherit;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ae-text-secondary);
}

.rail-tab:hover:not(:disabled) {
  color: var(--ae-text-primary);
}

.rail-tab.active {
  background: var(--ae-bg-elevated);
  color: var(--ae-text-primary);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}

.rail-tab:disabled {
  opacity: 0.45;
  cursor: default;
}

.rail-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.05rem;
  height: 1.05rem;
  padding: 0 0.25rem;
  border-radius: 9px;
  background: var(--ae-accent);
  color: #fff;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0;
}

.header-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.15rem;
  border-radius: 4px;
  color: var(--ae-accent);
}

.header-toggle:hover {
  background: var(--ae-bg-hover);
}

.header-toggle.off {
  color: var(--ae-text-muted);
}

.header-toggle .material-symbols-outlined {
  font-size: 16px;
}

/* Filter box: sits between the header and the list, doesn't scroll with it. */
.type-filter {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--ae-border-color);
  flex-shrink: 0;
}

.type-filter-icon {
  font-size: 16px;
  color: var(--ae-text-muted);
  flex-shrink: 0;
}

.type-filter-input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  outline: none;
  padding: 0;
  color: var(--ae-text-primary);
  font-family: var(--ae-font-sans);
  font-size: 0.8125rem;
}

.type-filter-input::placeholder {
  color: var(--ae-text-muted);
}

.type-filter-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.1rem;
  border-radius: 4px;
  color: var(--ae-text-muted);
  flex-shrink: 0;
}

.type-filter-clear:hover {
  color: var(--ae-text-primary);
  background: var(--ae-bg-hover);
}

.type-filter-clear .material-symbols-outlined {
  font-size: 16px;
}

/* Match-count line above the filtered list. */
.type-filter-status {
  padding: 0.375rem 0.75rem 0.25rem;
  font-size: 0.6875rem;
  color: var(--ae-text-muted);
  flex-shrink: 0;
}

.type-items {
  list-style: none;
  margin: 0;
  padding: 0.25rem;
  overflow-y: auto;
  flex: 1;
}

.type-row {
  display: flex;
  align-items: center;
  border-radius: 6px;
}

.type-row:hover {
  background: var(--ae-bg-hover);
}

.type-row.is-hidden {
  opacity: 0.5;
}

.type-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  color: var(--ae-text-primary);
}

.type-item.active {
  box-shadow: inset 2px 0 0 var(--ae-accent);
}

/* Blank-node type row: not a link, not clickable. */
.type-item-static {
  cursor: default;
  color: var(--ae-text-muted);
}

/* Disclosure chevron (collapse/expand a superclass) + alignment spacer. */
.type-disclosure,
.type-disclosure-spacer {
  flex-shrink: 0;
  width: 18px;
}

.type-disclosure {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  color: var(--ae-text-muted);
}

.type-disclosure:hover {
  color: var(--ae-text-primary);
}

.type-disclosure .material-symbols-outlined {
  font-size: 18px;
}

/* Embed types nested under their composing class: muted, non-clickable.
   Indent is depth-driven inline (padding-left) so embeds-within-embeds step in. */
.type-child .type-name {
  color: var(--ae-text-secondary);
  font-size: 0.75rem;
}


/* Group header: a collapsible section divider, visually distinct from a type. */
.type-row.is-group {
  margin-top: 0.25rem;
}

.type-group-item {
  cursor: pointer;
}

.group-dialog {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.group-dialog-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--ae-text-secondary);
}

.group-dialog :deep(.p-inputtext) {
  width: 100%;
}

.group-dialog-hint {
  font-size: 0.6875rem;
  color: var(--ae-text-muted);
}

.embed-dialog {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.embed-dialog-hint {
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
  margin: 0;
  line-height: 1.4;
}

.embed-dialog-loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--ae-text-secondary);
  padding: 0.5rem 0;
}

.embed-options {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.embed-option {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
}

.embed-option:hover {
  background: var(--ae-bg-hover);
}

.embed-option-pred {
  font-family: var(--ae-font-mono);
  font-size: 0.8125rem;
  color: var(--ae-text-primary);
}

.embed-option-meta {
  font-size: 0.6875rem;
  color: var(--ae-text-muted);
}

.embed-empty {
  font-size: 0.75rem;
  color: var(--ae-text-muted);
  padding: 0.4rem 0.5rem;
}

.type-group-item .type-name {
  font-family: var(--ae-font-sans);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ae-text-secondary);
}

.type-name {
  flex: 1;
  min-width: 0;
  font-family: var(--ae-font-mono);
  font-size: 0.8125rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Namespace prefix, small and muted, in a fixed-width column so the class names
   after it align into a clean column within a group. */
.type-prefix {
  flex: none;
  width: 3rem;
  margin-right: 0.45rem;
  font-family: var(--ae-font-mono);
  font-size: 0.6875rem;
  color: var(--ae-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.type-ind {
  display: inline-flex;
  align-items: center;
  gap: 0.125rem;
  flex-shrink: 0;
}

.type-ind .ind {
  font-size: 14px;
  color: var(--ae-text-muted);
}

.type-count {
  font-size: 0.6875rem;
  color: var(--ae-text-secondary);
  background: var(--ae-bg-base);
  border-radius: 10px;
  padding: 0.05rem 0.45rem;
  flex-shrink: 0;
}

/* Embed type with instances that have no owner via its embedVia — flagged red. */
.type-count.count-orphan {
  color: var(--ae-status-error);
  font-weight: 600;
}

.orphan-flag {
  font-size: 14px;
  color: var(--ae-status-error);
  flex-shrink: 0;
}

.type-gear {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--ae-text-muted);
  padding: 0.25rem;
  margin-right: 0.125rem;
  border-radius: 4px;
  opacity: 0.5;
  transition: opacity 0.12s, color 0.12s;
}

.type-row:hover .type-gear {
  opacity: 1;
}

.type-gear:hover {
  color: var(--ae-text-primary);
  background: var(--ae-bg-base);
}

.type-gear .material-symbols-outlined {
  font-size: 16px;
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
