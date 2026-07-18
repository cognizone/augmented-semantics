<script setup lang="ts">
/**
 * RdfView - main RDF browser layout.
 *
 * T4: connect prompt -> URI input bar + resource view, with ?resource kept in
 * the URL for deep-linking (com04). T3 adds a type-list sidebar; T5 the
 * instance list.
 *
 * @see /spec/ae-rdf
 */
import { ref, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import { useEndpointStore, useBrowseStore, useUIStore } from '../stores'
import { useGraphMode } from '../composables'
import { URL_PARAMS } from '../router'
import { endpointForUri } from '../utils/endpointMatch'
import ResourceView from '../components/rdf/ResourceView.vue'
import InstanceList from '../components/rdf/InstanceList.vue'
import TypeList from '../components/rdf/TypeList.vue'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const endpointStore = useEndpointStore()
const browseStore = useBrowseStore()
const uiStore = useUIStore()

// Detect once per endpoint whether it uses named graphs (gates query shape).
useGraphMode()

const hasEndpoint = computed(() => !!endpointStore.current)
const uriInput = ref('')

/**
 * URL-aware endpoint auto-switch. A resource URI that belongs to a DIFFERENT
 * configured endpoint (by its declared resourceNamespaces / prefixes / host)
 * activates that endpoint, then loads the resource there.
 *
 * Sequencing (the SELECTION-INVALIDATION gotcha): switching endpoints fires the
 * currentId watcher below, which strips ?resource/?type so the old selection
 * never queries the new endpoint. So we must switch FIRST, let that watcher
 * settle, THEN re-apply ?resource — otherwise the resource either loads against
 * the old endpoint or gets stripped away. We re-apply on nextTick (after the
 * pre-flush currentId watcher has run its strip) so the load fires against the
 * NEW endpoint. Returns true when a switch was initiated (caller must NOT set
 * the resource on the current endpoint).
 *
 * @see /Users/.../ae-rdf/CLAUDE.md — "Selection changes must invalidate…"
 */
function maybeSwitchEndpoint(uri: string): boolean {
  // A single configured endpoint owns everything — never switch.
  if (endpointStore.isSingleEndpoint) return false
  const owner = endpointForUri(uri, endpointStore.endpoints)
  // No confident owner, or the current endpoint already owns it → load as usual.
  if (!owner || owner.id === endpointStore.currentId) return false

  endpointStore.selectEndpoint(owner.id)
  // Secured target with no in-memory credentials: selectEndpoint opened the
  // credential prompt instead of switching. Let that flow own it — don't load
  // the resource against the old (still-current) endpoint.
  if (endpointStore.currentId !== owner.id) return true

  toast.add({ severity: 'info', summary: `Switched to ${owner.name}`, life: 2500 })
  uiStore.announceSuccess(`Switched to ${owner.name}`)
  // The currentId watcher (pre-flush) strips ?resource/?type on switch; re-apply
  // the resource after it runs so the load keys on the NEW endpoint. Drop ?type —
  // it belonged to the previous endpoint.
  const { [URL_PARAMS.TYPE]: _t, ...rest } = route.query
  nextTick(() => {
    void router.replace({ query: { ...rest, [URL_PARAMS.RESOURCE]: uri } })
  })
  return true
}

// Keep the browse store in sync with the URL (?resource, ?type)
watch(
  () => route.query[URL_PARAMS.RESOURCE],
  (r) => {
    const uri = typeof r === 'string' ? r : null
    // Foreign resource URI (Go submit OR ?resource deep link) → switch endpoints
    // and reload there instead of setting it on the current one.
    if (uri && maybeSwitchEndpoint(uri)) return
    browseStore.setResource(uri)
    uriInput.value = uri ?? '' // clear stale input when ?resource is dropped (R34)
  },
  { immediate: true }
)

watch(
  () => route.query[URL_PARAMS.TYPE],
  (t) => {
    browseStore.setType(typeof t === 'string' ? t : null)
    // Do NOT clear the resource here. selectType() already drops ?resource when you
    // pick a type, and the resource watcher syncs currentResource from ?resource
    // (null when absent). Clearing it unconditionally clobbered a valid
    // ?type+?resource load — clicking an instance keeps ?type, so on (re)load both
    // `immediate` watchers run and this wiped the resource the other just set, showing
    // the instance list instead of the resource. Resource has precedence (template). (R33)
  },
  { immediate: true }
)

// Switching endpoints invalidates the whole selection: drop ?resource/?type so
// the param watchers clear the browse store (and URI input) instead of querying
// the previous endpoint's selection against the new one. Guarded on a real
// switch (prev && next) so startup auto-select keeps deep links intact.
watch(
  () => endpointStore.currentId,
  (id, prev) => {
    if (!id || !prev || id === prev) return
    const { [URL_PARAMS.RESOURCE]: _r, [URL_PARAMS.TYPE]: _t, ...rest } = route.query
    router.replace({ query: rest })
  }
)

function go() {
  const uri = uriInput.value.trim()
  if (!uri) return
  router.push({ query: { ...route.query, [URL_PARAMS.RESOURCE]: uri } })
}
</script>

<template>
  <div class="rdf-view">
    <div v-if="!hasEndpoint" class="empty-state">
      <span class="material-symbols-outlined empty-icon">database</span>
      <h2>No endpoint selected</h2>
      <p>Pick or add a SPARQL endpoint from the menu in the header to start browsing.</p>
    </div>

    <template v-else>
      <!-- Keyed per endpoint so the sidebar's local state (collapse sets, type
           inventory) tears down on switch instead of leaking across endpoints. -->
      <TypeList :key="endpointStore.currentId ?? 'none'" />

      <div class="browser">
        <!-- Jump-to-URI: relevant on the landing screen and when viewing a
             resource (hop to another). Hidden while browsing an instance list —
             the list's own filter is the search there, and two stacked boxes
             read as "which do I type in?". -->
        <div v-if="browseStore.currentResource || !browseStore.currentType" class="uri-bar">
          <InputText
            v-model="uriInput"
            class="uri-input"
            placeholder="Enter a resource URI to inspect…"
            @keyup.enter="go"
          />
          <Button label="Go" icon="pi pi-arrow-right" :disabled="!uriInput.trim()" @click="go" />
        </div>

        <ResourceView v-if="browseStore.currentResource" />

        <InstanceList v-else-if="browseStore.currentType" />

        <div v-else class="empty-state">
          <span class="material-symbols-outlined empty-icon">travel_explore</span>
          <h2>Connected to {{ endpointStore.current?.name }}</h2>
          <p>Pick a type on the left, or paste a resource URI above.</p>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rdf-view {
  display: flex;
  flex: 1;
  width: 100%;
  overflow: hidden;
}

.browser {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.uri-bar {
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  border-bottom: 1px solid var(--ae-border-color);
  flex-shrink: 0;
}

.uri-input {
  flex: 1;
  font-family: var(--ae-font-mono);
  font-size: 0.8125rem;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  text-align: center;
  color: var(--ae-text-secondary);
  flex: 1;
  padding: 2rem;
}

.empty-icon {
  font-size: 56px;
  color: var(--ae-text-muted);
}

.empty-state h2 {
  margin: 0;
  font-size: 1.125rem;
  color: var(--ae-text-primary);
}

.empty-state p {
  margin: 0;
  font-size: 0.875rem;
  max-width: 420px;
}
</style>
