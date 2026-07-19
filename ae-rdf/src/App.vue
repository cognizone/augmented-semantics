<script setup lang="ts">
/**
 * Root application component.
 * Header shell + endpoint menu wrapping the routed RDF browser.
 *
 * @see /spec/ae-rdf
 * ponytail: trimmed from ae-skos App.vue — dropped language selector,
 * concept breadcrumb and SKOS settings sections (display/search/deprecation).
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import Toast from 'primevue/toast'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Checkbox from 'primevue/checkbox'
import Select from 'primevue/select'
import Menu from 'primevue/menu'
import { useUIStore, useSettingsStore, useEndpointStore } from './stores'
import { useConfig, validateURI } from './services'
import { buildAppConfig, buildEndpointConfig, endpointSlug, downloadJson } from './utils/configExport'
import { getKnownPrefixes, getEndpointDisplayPrefixes } from './services'
import EndpointManager from './components/common/EndpointManager.vue'
import CredentialsPrompt from './components/common/CredentialsPrompt.vue'
import ErrorBoundary from './components/common/ErrorBoundary.vue'

const uiStore = useUIStore()
const settingsStore = useSettingsStore()
const endpointStore = useEndpointStore()
const config = useConfig()
const route = useRoute()
const router = useRouter()

// SPARQL panel toggle: to /sparql from the browser, back to / from the panel.
const onSparql = computed(() => route.path === '/sparql')
function toggleSparql() {
  router.push(onSparql.value ? '/' : '/sparql')
}

function exportConfig() {
  const appConfig = buildAppConfig({
    endpoints: endpointStore.endpoints, // each carries its own graph / types / typeInventory
    prefixes: getKnownPrefixes(),
    doi: config.value.config?.doi,
    appName: config.value.config?.appName,
    logoUrl: config.value.config?.logoUrl,
    documentationUrl: config.value.config?.documentationUrl,
  })
  downloadJson(appConfig, 'app.json')
}

function exportEndpoint() {
  const ep = endpointStore.current
  if (!ep) return
  downloadJson(buildEndpointConfig(ep), `${endpointSlug(ep.name)}.json`)
}

const showPrefixes = ref(false)
const prefixList = ref<{ prefix: string; namespace: string }[]>([])

// Namespace of a URI (up to and including the last # or /).
function nsOf(uri: string): string {
  const h = uri.lastIndexOf('#')
  if (h >= 0) return uri.slice(0, h + 1)
  const s = uri.lastIndexOf('/')
  return s >= 0 ? uri.slice(0, s + 1) : uri
}
// Structural vocab present on essentially every graph, shown even if the profile
// didn't surface them explicitly.
const CORE_NS = [
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  'http://www.w3.org/2000/01/rdf-schema#',
  'http://www.w3.org/2002/07/owl#',
  'http://www.w3.org/2001/XMLSchema#',
  'http://www.w3.org/2004/02/skos/core#',
]

/** Namespaces the active endpoint actually references — from its profiled types,
 *  predicates, datatypes and object-class ranges, plus its declared prefixes and
 *  the structural core. Scopes the prefix legend to what's relevant here. */
function usedNamespaces(): Set<string> {
  const used = new Set<string>(CORE_NS)
  const ep = endpointStore.current
  if (!ep) return used
  for (const t of ep.typeInventory ?? []) used.add(nsOf(t.uri))
  for (const tp of Object.values(ep.typeProperties ?? {})) {
    for (const p of tp.properties ?? []) {
      used.add(nsOf(p.uri))
      for (const d of p.datatypes ?? []) used.add(nsOf(d.uri))
      for (const r of p.ranges ?? []) used.add(nsOf(r.uri))
    }
  }
  for (const ns of Object.values(ep.prefixes ?? {})) used.add(ns)
  return used
}

function openPrefixes() {
  prefixList.value = Object.entries(getEndpointDisplayPrefixes(usedNamespaces()))
    .map(([prefix, namespace]) => ({ prefix, namespace }))
    .sort((a, b) => a.prefix.localeCompare(b.prefix))
  showPrefixes.value = true
}

const showEndpointManager = ref(false)
const showSettings = ref(false)
const endpointMenu = ref()

const uriDisplayOptions = [
  { label: 'Humanized names', value: 'humanized' },
  { label: 'Prefixed (skos:Concept)', value: 'prefixed' },
  { label: 'Full URI', value: 'full' },
]

const appName = computed(() => config.value.config?.appName ?? 'AE RDF Browser')
watch(appName, (name) => { document.title = name }, { immediate: true })
// Shrink the "E" in the "AE" prefix so the title reads more like "A RDF Browser".
const titleParts = computed(() => {
  const n = appName.value
  return n[1] === 'E' ? { a: n[0], e: n[1], rest: n.slice(2) } : { a: n, e: '', rest: '' }
})

// Config values reach DOM URL sinks (<a href>, <img src>); a hostile/misconfigured
// config could inject a `javascript:` URL. Vet absolute URLs via validateURI; pass
// relative paths through (same-origin, e.g. the default config/logo.png). (R26)
function safeConfigUrl(u?: string | null): string | null {
  if (!u) return null
  return /^[a-z][a-z0-9+.-]*:/i.test(u) ? validateURI(u) : u
}
const logoUrl = computed(() =>
  safeConfigUrl(config.value.config?.logoUrl) ?? (config.value.configMode ? `${import.meta.env.BASE_URL}config/logo.png` : null)
)
const docsUrl = computed(() =>
  safeConfigUrl(config.value.config?.documentationUrl) ??
  'https://cognizone.github.io/augmented-semantics/ae-rdf/'
)

// Build info
const appVersion = __APP_VERSION__
const gitCommit = __GIT_COMMIT__
const buildDateFormatted = computed(() => {
  const date = new Date(__BUILD_DATE__)
  return date.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
})

const endpointMenuItems = computed(() => {
  const items = endpointStore.sortedEndpoints.map(ep => ({
    label: ep.name,
    icon: ep.id === endpointStore.currentId ? 'pi pi-check' : undefined,
    command: () => endpointStore.selectEndpoint(ep.id),
  }))

  if (!endpointStore.configMode) {
    if (items.length > 0) items.push({ separator: true } as any)
    items.push({
      label: 'Manage endpoints...',
      icon: 'pi pi-cog',
      command: () => { showEndpointManager.value = true },
    })
  }

  return items
})

const endpointStatusClass = computed(() => {
  if (endpointStore.status === 'connecting' || endpointStore.status === 'error') {
    return endpointStore.status
  }
  return endpointStore.current ? 'connected' : 'disconnected'
})

// In the Tauri desktop app the webview ignores <a target="_blank"> (no browser
// tab to open into), so every external link — docs, GitHub, resource URIs —
// silently does nothing. Intercept those clicks once, at the document level, and
// hand the URL to the OS via the opener plugin. No-op on the web build.
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
async function handleExternalLink(event: MouseEvent) {
  const anchor = (event.target as HTMLElement)?.closest?.('a[target="_blank"]') as HTMLAnchorElement | null
  const href = anchor?.href
  if (!href || !/^https?:/i.test(href)) return
  event.preventDefault()
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(href)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (showEndpointManager.value) showEndpointManager.value = false
    else if (showSettings.value) showSettings.value = false
    else if (showPrefixes.value) showPrefixes.value = false
  }
}

onMounted(() => {
  uiStore.initResponsive()
  window.addEventListener('keydown', handleKeydown)
  if (isTauri) document.addEventListener('click', handleExternalLink)
  // Auto-open endpoint manager when nothing is configured (and not in config mode)
  if (!endpointStore.configMode && endpointStore.endpoints.length === 0) {
    showEndpointManager.value = true
  }
})

onUnmounted(() => {
  uiStore.destroyResponsive()
  window.removeEventListener('keydown', handleKeydown)
  if (isTauri) document.removeEventListener('click', handleExternalLink)
})
</script>

<template>
  <div class="app-container">
    <header class="app-header">
      <div class="header-left">
        <img
          v-if="logoUrl"
          :src="logoUrl"
          alt=""
          class="app-logo"
          @error="($event.target as HTMLImageElement).style.display = 'none'"
        />
        <h1 class="app-title">{{ titleParts.a }}<span class="app-title-e">{{ titleParts.e }}</span>{{ titleParts.rest }}</h1>
        <button
          v-if="!endpointStore.isSingleEndpoint"
          class="dropdown-trigger"
          :class="endpointStatusClass"
          aria-label="Select endpoint"
          @click="(e) => endpointMenu.toggle(e)"
        >
          <span class="status-dot"></span>
          <span>{{ endpointStore.current?.name || 'No endpoint' }}</span>
          <span class="material-symbols-outlined dropdown-arrow">arrow_drop_down</span>
        </button>
        <Menu v-if="!endpointStore.isSingleEndpoint" ref="endpointMenu" :model="endpointMenuItems" :popup="true" />
      </div>

      <div class="header-right">
        <div class="header-icons">
          <button
            class="header-icon-btn"
            :class="{ active: onSparql }"
            :aria-label="onSparql ? 'Back to browser' : 'SPARQL query panel'"
            :aria-pressed="onSparql"
            :title="onSparql ? 'Back to browser' : 'SPARQL query panel'"
            @click="toggleSparql"
          >
            <span class="material-symbols-outlined">terminal</span>
          </button>
          <a :href="docsUrl" target="_blank" class="header-icon-btn" aria-label="Documentation" title="Documentation">
            <span class="material-symbols-outlined">help_outline</span>
          </a>
          <button
            class="header-icon-btn"
            aria-label="Toggle dark mode"
            :title="settingsStore.darkMode ? 'Switch to light mode' : 'Switch to dark mode'"
            @click="settingsStore.setDarkMode(!settingsStore.darkMode)"
          >
            <span class="material-symbols-outlined">{{ settingsStore.darkMode ? 'light_mode' : 'dark_mode' }}</span>
          </button>
          <button class="header-icon-btn" aria-label="Prefixes" title="Prefixes" @click="openPrefixes">
            <span class="material-symbols-outlined">sell</span>
          </button>
          <button class="header-icon-btn" aria-label="Settings" @click="showSettings = true">
            <span class="material-symbols-outlined">settings</span>
          </button>
        </div>
      </div>
    </header>

    <main class="app-main">
      <ErrorBoundary>
        <RouterView />
      </ErrorBoundary>
    </main>

    <Toast />

    <EndpointManager v-if="!endpointStore.configMode" v-model:visible="showEndpointManager" />
    <CredentialsPrompt />

    <!-- Settings (minimal: dark mode + build info) -->
    <Dialog v-model:visible="showSettings" header="Settings" :modal="true" :style="{ width: '420px' }" position="top">
      <div class="settings-body">
        <section class="settings-section">
          <h3 class="settings-section-title">Appearance</h3>
          <label class="checkbox-label">
            <Checkbox v-model="settingsStore.darkMode" :binary="true" />
            <span class="checkbox-text">Dark mode</span>
          </label>

          <div class="setting-field">
            <span class="setting-label">URI display</span>
            <Select
              v-model="settingsStore.uriDisplay"
              :options="uriDisplayOptions"
              optionLabel="label"
              optionValue="value"
              class="full-width"
            />
            <small class="setting-hint">How predicates and resource links are shown.</small>
          </div>
        </section>

        <section class="settings-section">
          <h3 class="settings-section-title">Sidebar</h3>
          <label class="checkbox-label">
            <Checkbox v-model="settingsStore.showHidden" :binary="true" />
            <span class="checkbox-text">Show hidden fields<small>Reveal properties hidden by the endpoint config (greyed), without entering edit mode</small></span>
          </label>

          <label class="checkbox-label">
            <Checkbox v-model="settingsStore.groupsCollapsed" :binary="true" />
            <span class="checkbox-text">Collapse groups by default<small>Named sidebar groups (e.g. Ontology) start collapsed. “Hidden” always starts collapsed, “Embedded” expanded.</small></span>
          </label>

          <label class="checkbox-label">
            <Checkbox v-model="settingsStore.showEmbedsNested" :binary="true" />
            <span class="checkbox-text">Nest embedded types<small>Show embedded value-object types inline under their composing class in the Types tree (also toggled by the <code>{}</code> button). Off → they appear only in the collapsed “Embedded” group.</small></span>
          </label>
        </section>

        <section class="settings-section">
          <h3 class="settings-section-title">Results</h3>
          <label class="checkbox-label">
            <Checkbox :binary="true" :modelValue="settingsStore.listView === 'cards'" @update:modelValue="settingsStore.listView = $event ? 'cards' : 'list'" />
            <span class="checkbox-text">Card view for search results<small>Show a type's instances as cards instead of a table (for types with configured columns). Also toggled from the list header.</small></span>
          </label>

          <label class="checkbox-label">
            <Checkbox v-model="settingsStore.sparqlAutoLimit" :binary="true" />
            <span class="checkbox-text">Auto-limit SPARQL results<small>Append a <code>LIMIT</code> to an unbounded <code>SELECT</code> in the SPARQL panel. Off → run the full result set.</small></span>
          </label>
        </section>

        <section class="settings-section">
          <h3 class="settings-section-title">Rich content</h3>
          <p class="settings-section-hint">Off by default — each fetches from an external service on demand as you scroll.</p>
          <label class="checkbox-label">
            <Checkbox v-model="settingsStore.doiCitations" :binary="true" />
            <span class="checkbox-text">DOI citations<small>Fetch citation metadata (title, authors, year) from doi.org for DOI values — an external request per DOI, on demand.</small></span>
          </label>

          <label class="checkbox-label">
            <Checkbox v-model="settingsStore.wktMaps" :binary="true" />
            <span class="checkbox-text">Geometry maps<small>Show an embedded map (Leaflet + swisstopo tiles) for WGS84 WKT geometry values — loads map tiles from geo.admin.ch on demand.</small></span>
          </label>
        </section>

        <section class="settings-section">
          <h3 class="settings-section-title">Curation</h3>
          <label class="checkbox-label">
            <Checkbox v-model="settingsStore.editMode" :binary="true" />
            <span class="checkbox-text">Config authoring mode<small>Show per-type gears and the export button — works even on a deployed config, so you can tweak and re-export</small></span>
          </label>

          <div v-if="settingsStore.editMode" class="setting-field">
            <span class="setting-label">Deployment</span>
            <Button label="Export app.json" icon="pi pi-download" severity="secondary" outlined @click="exportConfig" />
            <Button v-if="endpointStore.current" :label="`Export ${endpointStore.current.name} endpoint`" icon="pi pi-download" severity="secondary" outlined @click="exportEndpoint" />
            <small class="setting-hint">Export app.json (the manifest) or a single endpoint file → drop it in <code>config/endpoints/</code> and add its slug to the manifest. Credentials are never included.</small>
          </div>
        </section>

        <section class="settings-section">
          <h3 class="settings-section-title">About</h3>
          <div class="about-info">
            <div class="about-row"><span class="about-label">Version</span><span class="about-value">{{ appVersion }}</span></div>
            <div class="about-row"><span class="about-label">Build</span><span class="about-value mono">{{ gitCommit }}</span></div>
            <div class="about-row"><span class="about-label">Built</span><span class="about-value">{{ buildDateFormatted }}</span></div>
            <div class="about-row">
              <span class="about-label">Source</span>
              <a href="https://github.com/cognizone/augmented-semantics/tree/main/ae-rdf" target="_blank" class="about-link">GitHub</a>
            </div>
          </div>
        </section>
      </div>
      <template #footer>
        <Button label="Close" @click="showSettings = false" />
      </template>
    </Dialog>

    <!-- Prefixes legend -->
    <Dialog v-model:visible="showPrefixes" header="Prefixes" :modal="true" :style="{ width: '560px' }" position="top">
      <p class="prefixes-hint">Prefix → namespace mappings used to render qnames — scoped to <strong>{{ endpointStore.current?.name ?? 'this endpoint' }}</strong>: the vocabularies it actually uses, plus any it declares and any resolved while browsing.</p>
      <table class="prefixes-table">
        <tbody>
          <tr v-for="p in prefixList" :key="p.prefix + p.namespace">
            <td class="prefix-key">{{ p.prefix }}</td>
            <td class="prefix-ns">{{ p.namespace }}</td>
          </tr>
        </tbody>
      </table>
      <template #footer>
        <Button label="Close" @click="showPrefixes = false" />
      </template>
    </Dialog>

    <!-- ARIA live regions for screen readers -->
    <div class="sr-only" role="status" aria-live="polite">{{ uiStore.loadingAnnouncement }}</div>
    <div class="sr-only" role="alert" aria-live="assertive">{{ uiStore.errorAnnouncement }}</div>
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 1rem;
  background: var(--ae-header-bg);
  border-bottom: 1px solid var(--ae-border-color);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

.app-logo {
  height: 28px;
  width: auto;
  object-fit: contain;
}

.app-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--ae-text-primary);
  letter-spacing: 0.02em;
}

.app-title-e {
  font-size: 0.5em;
  font-weight: 600;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ae-text-muted);
}

.dropdown-trigger.connected .status-dot { background: var(--ae-status-success); }
.dropdown-trigger.connecting .status-dot { background: var(--ae-status-warning); animation: pulse 1s infinite; }
.dropdown-trigger.error .status-dot { background: var(--ae-status-error); }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.header-icons {
  display: flex;
}

.header-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  color: var(--ae-text-secondary);
  text-decoration: none;
  transition: background-color 0.15s, color 0.15s;
}

.header-icon-btn:hover {
  background: var(--ae-bg-hover);
  color: var(--ae-text-primary);
}

.header-icon-btn.active {
  background: var(--ae-bg-hover);
  color: var(--ae-accent);
}

.header-icon-btn .material-symbols-outlined {
  font-size: 18px;
}

.app-main {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.settings-body {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding-top: 0.5rem;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.settings-section-title {
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ae-text-secondary);
  padding-bottom: 0.375rem;
  border-bottom: 1px solid var(--ae-border-color);
}

.settings-section-hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  cursor: pointer;
}

.setting-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.setting-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--ae-text-primary);
}

.setting-hint {
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
}

.full-width {
  width: 100%;
}

.checkbox-text {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  font-size: 0.8125rem;
  color: var(--ae-text-primary);
}

.checkbox-text small {
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
}

.checkbox-label {
  align-items: flex-start;
}

.prefixes-hint {
  margin: 0 0 0.75rem;
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
}

.prefixes-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.prefixes-table tr {
  border-bottom: 1px solid var(--ae-border-color);
}

.prefix-key {
  font-family: var(--ae-font-mono);
  font-weight: 600;
  color: var(--ae-accent);
  padding: 0.3rem 1rem 0.3rem 0;
  white-space: nowrap;
  vertical-align: top;
}

.prefix-ns {
  font-family: var(--ae-font-mono);
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
  word-break: break-all;
  padding: 0.3rem 0;
}

.about-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border-top: 1px solid var(--ae-border-color);
  padding-top: 1rem;
}

.about-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8125rem;
}

.about-label { color: var(--ae-text-secondary); }
.about-value { color: var(--ae-text-primary); }
.about-value.mono { font-family: var(--ae-font-mono); font-size: 0.75rem; }

.about-link {
  color: var(--ae-accent);
  text-decoration: none;
}

.about-link:hover { text-decoration: underline; }
</style>
