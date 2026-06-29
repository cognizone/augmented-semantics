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
import { useBrowseStore, useSettingsStore, useTypeConfigStore } from '../../stores'
import { useRdfTypes, useDelayedLoading, type RdfType } from '../../composables'
import { displayType } from '../../utils/format'
import { URL_PARAMS } from '../../router'

const router = useRouter()
const browseStore = useBrowseStore()
const settings = useSettingsStore()
const typeConfig = useTypeConfigStore()
const { types, loading, error, resolved, composition } = useRdfTypes()
const showLoading = useDelayedLoading(loading)

const selected = computed(() => browseStore.currentType)
const showHidden = ref(false)
const typeMenu = ref()
const menuType = ref<string | null>(null)

const typeName = (uri: string) => displayType(uri, resolved.value, settings.uriDisplay)
const cfg = (uri: string) => typeConfig.get(uri)
const isHidden = (uri: string) => cfg(uri).sidebar === 'hide'
const isPinned = (uri: string) => cfg(uri).sidebar === 'pin'
const renderOf = (uri: string) => cfg(uri).render ?? 'link'

function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

const countOf = (uri: string) => types.value.find(t => t.uri === uri)?.count ?? 0

// Embed types are shown nested under their composing class, never flat.
const embedSet = computed(() => new Set(types.value.filter(t => renderOf(t.uri) === 'embed').map(t => t.uri)))

// Embed types each composing class contains (only the ones relevant to it),
// commonest first.
const childrenOf = (parentUri: string): string[] =>
  (composition.value.get(parentUri) ?? [])
    .filter(e => embedSet.value.has(e))
    .sort((a, b) => countOf(b) - countOf(a))

// Embed types that found a parent — so they're not also shown flat.
const placedEmbeds = computed(() => {
  const placed = new Set<string>()
  for (const [, kids] of composition.value) for (const k of kids) if (embedSet.value.has(k)) placed.add(k)
  return placed
})

// Top level: non-embed types. An embed type with no discovered parent stays
// flat in edit mode only, so it remains configurable (can be un-embedded).
const visibleTypes = computed<RdfType[]>(() => {
  const list = (showHidden.value ? types.value : types.value.filter(t => !isHidden(t.uri)))
    .filter(t => !embedSet.value.has(t.uri) || (settings.editMode && !placedEmbeds.value.has(t.uri)))
  const pinned = list.filter(t => isPinned(t.uri))
  const rest = list.filter(t => !isPinned(t.uri))
  return [...pinned, ...rest]
})
const hiddenCount = computed(() => types.value.filter(t => isHidden(t.uri) && !embedSet.value.has(t.uri)).length)

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
  ]
})

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
        <template v-for="t in visibleTypes" :key="t.uri">
          <li class="type-row" :class="{ 'is-hidden': isHidden(t.uri) }">
            <button
              class="type-item"
              :class="{ active: selected === t.uri }"
              :title="t.uri"
              @click="selectType(t.uri)"
            >
              <span class="type-name">{{ typeName(t.uri) }}</span>
              <span class="type-ind">
                <span v-if="isPinned(t.uri)" class="material-symbols-outlined ind" title="Pinned to top">push_pin</span>
                <span v-if="renderOf(t.uri) === 'embed'" class="material-symbols-outlined ind" title="Embedded inline as a value">data_object</span>
                <span v-if="renderOf(t.uri) === 'label'" class="material-symbols-outlined ind" title="Shown as a label (no link)">label</span>
              </span>
              <span class="type-count">{{ formatCount(t.count) }}</span>
            </button>
            <button v-if="settings.editMode" class="type-gear" aria-label="Configure type" @click.stop="openMenu($event, t.uri)">
              <span class="material-symbols-outlined">tune</span>
            </button>
          </li>
          <!-- Embed types nested under the class that composes them. -->
          <li v-for="cu in childrenOf(t.uri)" :key="t.uri + '>' + cu" class="type-row type-child">
            <div class="type-item is-static" :title="cu">
              <span class="type-name">{{ typeName(cu) }}</span>
              <span class="type-ind">
                <span class="material-symbols-outlined ind" title="Embedded inline as a value">data_object</span>
              </span>
              <span class="type-count">{{ formatCount(countOf(cu)) }}</span>
            </div>
            <button v-if="settings.editMode" class="type-gear" aria-label="Configure type" @click.stop="openMenu($event, cu)">
              <span class="material-symbols-outlined">tune</span>
            </button>
          </li>
        </template>
      </ul>

      <button v-if="hiddenCount" class="show-hidden" @click="showHidden = !showHidden">
        {{ showHidden ? 'Hide hidden types' : `Show ${hiddenCount} hidden` }}
      </button>
    </template>

    <Menu ref="typeMenu" :model="menuItems" :popup="true" />
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

/* Embed types nested under their composing class: indented, muted, non-clickable. */
.type-child .type-item {
  padding-left: 1.5rem;
}

.type-child .type-name {
  color: var(--ae-text-secondary);
  font-size: 0.75rem;
}

.type-item.is-static {
  cursor: default;
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

.show-hidden {
  background: none;
  border: none;
  border-top: 1px solid var(--ae-border-color);
  cursor: pointer;
  font-size: 0.6875rem;
  color: var(--ae-text-secondary);
  padding: 0.5rem;
  text-align: left;
  flex-shrink: 0;
}

.show-hidden:hover {
  color: var(--ae-text-primary);
  background: var(--ae-bg-hover);
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
