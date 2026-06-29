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
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import ProgressSpinner from 'primevue/progressspinner'
import Menu from 'primevue/menu'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import { useBrowseStore, useSettingsStore, useTypeConfigStore } from '../../stores'
import { useRdfTypes, useDelayedLoading } from '../../composables'
import { displayType } from '../../utils/format'
import { URL_PARAMS } from '../../router'

const router = useRouter()
const browseStore = useBrowseStore()
const settings = useSettingsStore()
const typeConfig = useTypeConfigStore()
const { types, loading, error, resolved, composition, subclasses, pathCounts, requestPathCount } = useRdfTypes()
const showLoading = useDelayedLoading(loading)

const selected = computed(() => browseStore.currentType)
const typeMenu = ref()
const menuType = ref<string | null>(null)
// New-group dialog state.
const showGroupDialog = ref(false)
const groupDialogUri = ref<string | null>(null)
const groupNameInput = ref('')
// Collapsed superclasses (default expanded). A Set, replaced wholesale to stay reactive.
const collapsed = ref<Set<string>>(new Set())

// Auto "system" groups at the bottom of the list (collapsed by default).
const SYS_EMBEDDED = 'Embedded'
const SYS_HIDDEN = 'Hidden'

const typeName = (uri: string) => displayType(uri, resolved.value, settings.uriDisplay)
const cfg = (uri: string) => typeConfig.get(uri)
const isHidden = (uri: string) => cfg(uri).sidebar === 'hide'
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

const embedSet = computed(() => new Set(types.value.filter(t => renderOf(t.uri) === 'embed').map(t => t.uri)))

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
  types.value.filter(t => !isHidden(t.uri) && !embedSet.value.has(t.uri)),
)
// Optional sidebar group a type is assigned to (trimmed; '' = none).
const groupOf = (uri: string): string => (cfg(uri).group ?? '').trim()
const isGrouped = (uri: string) => groupOf(uri) !== ''
// A type's subclasses that are listed, navigable, and NOT pulled into a group,
// commonest first. (A grouped type leaves its parent's subtree for its group.)
const subChildren = (uri: string): string[] =>
  (subclasses.value.get(uri) ?? [])
    .filter(s => !embedSet.value.has(s) && !isGrouped(s) && !isHidden(s))
    .sort((a, b) => countOf(b) - countOf(a))
// Subclasses that nest under a parent → never top-level. Grouped types are
// promoted to roots (shown under their group), so they're excluded here.
const nestedSubs = computed(() => {
  const s = new Set<string>()
  for (const [, subs] of subclasses.value) for (const sub of subs) if (!embedSet.value.has(sub) && !isGrouped(sub)) s.add(sub)
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

const collapsedGroups = ref<Set<string>>(new Set([SYS_EMBEDDED, SYS_HIDDEN]))

// System-group members: every embed type (also nested under its classes — shown
// here too for consistency) and every hidden navigable type.
const embeddedGroupTypes = computed(() =>
  types.value.filter(t => embedSet.value.has(t.uri)).map(t => t.uri).sort((a, b) => countOf(b) - countOf(a)),
)
const hiddenGroupTypes = computed(() =>
  types.value.filter(t => isHidden(t.uri) && !embedSet.value.has(t.uri)).map(t => t.uri).sort((a, b) => countOf(b) - countOf(a)),
)
const isGroupCollapsed = (name: string) => collapsedGroups.value.has(name)
function toggleGroup(name: string) {
  const next = new Set(collapsedGroups.value)
  next.has(name) ? next.delete(name) : next.add(name)
  collapsedGroups.value = next
}

const hasKids = (uri: string) => subChildren(uri).length > 0 || childrenOf(uri).length > 0

// scoped=false → the count exists but isn't relative to this row's ancestry
// (a deeper embed's count is the global per-parent-type total), so we hide it
// rather than show a misleading number. Path-scoped deep counts would cost a
// chained COUNT query per path on every load — not worth it eagerly.
interface Row { uri: string; depth: number; kind: 'class' | 'embed' | 'group'; count: number; group?: string; scoped?: boolean; chain?: string[]; system?: boolean; leaf?: boolean }

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
    for (const e of embedRows(uri)) {
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
    if (!isGroupCollapsed(SYS_EMBEDDED)) for (const u of embeddedGroupTypes.value) out.push({ uri: u, depth: 1, kind: 'embed', count: countOf(u), scoped: true })
  }
  if (hiddenGroupTypes.value.length) {
    out.push({ uri: SYS_HIDDEN, depth: 0, kind: 'group', count: hiddenGroupTypes.value.length, group: SYS_HIDDEN, system: true })
    if (!isGroupCollapsed(SYS_HIDDEN)) for (const u of hiddenGroupTypes.value) out.push({ uri: u, depth: 1, kind: 'class', count: countOf(u), leaf: true })
  }
  return out
})

// Nested-embed counts aren't path-scoped up front; fetch on hover, show once in.
const pathKey = (row: Row) => (row.chain ?? []).join('>')
function onEmbedEnter(row: Row) {
  if (row.kind === 'embed' && row.scoped === false && row.chain) requestPathCount(row.chain)
}
const embedCount = (row: Row): number | null =>
  row.scoped !== false ? row.count : (pathCounts.value.get(pathKey(row)) ?? null)

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
        { label: 'Link', icon: check(render === 'link'), command: () => typeConfig.set(uri, { render: 'link' }) },
        { label: 'Embed', icon: check(render === 'embed'), command: () => typeConfig.set(uri, { render: 'embed' }) },
        { label: 'Label only', icon: check(render === 'label'), command: () => typeConfig.set(uri, { render: 'label' }) },
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

    <template v-else>
      <ul class="type-items">
        <li
          v-for="(row, i) in rows"
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
            <span class="type-count">{{ formatCount(row.count) }}</span>
          </button>

          <!-- Class: a navigable type (click → instance list). -->
          <button
            v-else-if="row.kind === 'class'"
            class="type-item"
            :class="{ active: selected === row.uri }"
            :title="row.uri"
            @click="selectType(row.uri)"
          >
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
            <span class="type-name">{{ typeName(row.uri) }}</span>
            <span class="type-ind">
              <span class="material-symbols-outlined ind" title="Embedded inline as a value — click to browse instances">data_object</span>
            </span>
            <span v-if="embedCount(row) !== null" class="type-count">{{ formatCount(embedCount(row)!) }}</span>
          </button>

          <button v-if="settings.editMode && row.kind !== 'group'" class="type-gear" aria-label="Configure type" @click.stop="openMenu($event, row.uri)">
            <span class="material-symbols-outlined">tune</span>
          </button>
        </li>
      </ul>
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
