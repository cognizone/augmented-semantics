<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { RouterView } from 'vue-router'
import { useUIStore, useConceptStore, useSettingsStore, useLanguageStore, useEndpointStore } from './stores'
import type { SettingsSection } from './stores/ui'
import { useConfig } from './services'
import Toast from 'primevue/toast'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Checkbox from 'primevue/checkbox'
import Select from 'primevue/select'
import Menu from 'primevue/menu'
import EndpointManager from './components/common/EndpointManager.vue'
import ErrorBoundary from './components/common/ErrorBoundary.vue'
import ConceptBreadcrumb from './components/skos/ConceptBreadcrumb.vue'

const uiStore = useUIStore()
const conceptStore = useConceptStore()
const settingsStore = useSettingsStore()
const languageStore = useLanguageStore()
const endpointStore = useEndpointStore()
const config = useConfig()
const showEndpointManager = ref(false)

// Config-based computed properties
const appName = computed(() => config.value.config?.appName ?? 'AE SKOS')

// Update document title when appName changes
watch(appName, (name) => {
  document.title = name
}, { immediate: true })

const logoUrl = computed(() =>
  config.value.config?.logoUrl ?? (config.value.configMode ? `${import.meta.env.BASE_URL}config/logo.png` : null)
)
const docsUrl = computed(() =>
  config.value.config?.documentationUrl ??
  'https://github.com/cognizone/augmented-semantics/blob/main/docs/user-manual/README.md'
)

// Build info
const appVersion = __APP_VERSION__
const gitCommit = __GIT_COMMIT__
const buildDateFormatted = computed(() => {
  const date = new Date(__BUILD_DATE__)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
})

const endpointMenu = ref()
const languageMenu = ref()
const settingsLanguageMenu = ref()

// Endpoint menu items
const endpointMenuItems = computed(() => {
  const items = endpointStore.sortedEndpoints.map(ep => ({
    label: ep.name,
    icon: ep.id === endpointStore.currentId ? 'pi pi-check' : undefined,
    command: () => endpointStore.selectEndpoint(ep.id),
  }))

  // Only add "Manage endpoints" if NOT in config mode
  if (!endpointStore.configMode) {
    if (items.length > 0) {
      items.push({ separator: true } as any)
    }

    items.push({
      label: 'Manage endpoints...',
      icon: 'pi pi-cog',
      command: () => { showEndpointManager.value = true },
    })
  }

  return items
})

// Language options from current endpoint - use priorities order if available
const languageOptions = computed(() => {
  const endpoint = endpointStore.current
  const detected = endpoint?.analysis?.languages || []

  // Build a map of lang -> count for lookup
  const countMap = new Map(detected.map(l => [l.lang, l.count]))

  // Use saved priorities or default alphabetical with 'en' first
  let orderedLangs: string[]
  if (endpoint?.languagePriorities?.length) {
    orderedLangs = endpoint.languagePriorities
  } else {
    orderedLangs = [...detected.map(l => l.lang)].sort((a, b) => {
      if (a === 'en') return -1
      if (b === 'en') return 1
      return a.localeCompare(b)
    })
  }

  return orderedLangs.map(lang => ({
    label: `${getLanguageName(lang)} (${countMap.get(lang)?.toLocaleString() || 0})`,
    value: lang,
  }))
})

// Language menu items for header dropdown
const languageMenuItems = computed(() => {
  return languageOptions.value.map(opt => ({
    label: opt.label,
    icon: opt.value === languageStore.preferred ? 'pi pi-check' : undefined,
    command: () => languageStore.setPreferred(opt.value),
  }))
})

const settingsLanguageMenuItems = computed(() => {
  if (!languageOptions.value.length) {
    return [
      {
        label: 'No languages detected yet',
        disabled: true,
      },
    ]
  }
  return languageMenuItems.value
})

// Log level options for settings dropdown
const logLevelOptions = [
  { label: 'Debug (verbose)', value: 'debug' },
  { label: 'Info', value: 'info' },
  { label: 'Warn (default)', value: 'warn' },
  { label: 'Error', value: 'error' },
  { label: 'Fatal (critical only)', value: 'fatal' },
]

// Orphan detection strategy options for settings dropdown
const orphanDetectionStrategyOptions = [
  { label: 'Auto (recommended)', value: 'auto' },
  { label: 'Fast (single query)', value: 'fast' },
  { label: 'Slow (multi query)', value: 'slow' },
]

const searchMatchModeOptions = [
  { label: 'Contains', value: 'contains' },
  { label: 'Starts with', value: 'startsWith' },
  { label: 'Exact match', value: 'exact' },
  { label: 'Regular expression', value: 'regex' },
]

const settingsNavItems: { id: SettingsSection; label: string; icon: string; hint: string }[] = [
  { id: 'display', label: 'Display', icon: 'palette', hint: 'Labels, tags, notation' },
  { id: 'language', label: 'Language', icon: 'language', hint: 'Preferred label language' },
  { id: 'deprecation', label: 'Deprecation', icon: 'warning', hint: 'Indicators & rules' },
  { id: 'search', label: 'Search', icon: 'manage_search', hint: 'Match & scope' },
  { id: 'developer', label: 'Developer', icon: 'code', hint: 'Diagnostics & tools' },
  { id: 'about', label: 'About', icon: 'info', hint: 'Build info' },
]

const settingsSection = computed({
  get: () => uiStore.settingsSection,
  set: (value) => uiStore.setSettingsSection(value),
})

// Language display names
const languageNames: Record<string, string> = {
  en: 'English', nl: 'Nederlands', fr: 'Français', de: 'Deutsch',
  es: 'Español', it: 'Italiano', pt: 'Português', pl: 'Polski',
  ru: 'Русский', ja: '日本語', zh: '中文', ar: 'العربية', ko: '한국어',
  sv: 'Svenska', da: 'Dansk', fi: 'Suomi', no: 'Norsk', cs: 'Čeština',
  el: 'Ελληνικά', hu: 'Magyar', ro: 'Română', sk: 'Slovenčina',
  bg: 'Български', hr: 'Hrvatski', sl: 'Slovenščina', et: 'Eesti',
  lv: 'Latviešu', lt: 'Lietuvių', mt: 'Malti', ga: 'Gaeilge', rm: 'Rumantsch',
}

function getLanguageName(code: string): string {
  return languageNames[code] || code.toUpperCase()
}

function selectConcept(uri: string) {
  if (uri) {
    conceptStore.selectConcept(uri)
  } else {
    conceptStore.selectConcept(null)
  }
}

// Global keyboard shortcuts
function handleKeydown(event: KeyboardEvent) {
  // Don't trigger if user is typing in an input
  const target = event.target as HTMLElement
  const isInputField = target.tagName === 'INPUT' ||
                       target.tagName === 'TEXTAREA' ||
                       target.contentEditable === 'true'

  // "/" - Focus search (only when not in input field)
  if (event.key === '/' && !isInputField) {
    event.preventDefault()
    uiStore.triggerSearchFocus()
  }

  // "Escape" - Close dialogs
  if (event.key === 'Escape') {
    if (showEndpointManager.value) {
      showEndpointManager.value = false
    } else {
      uiStore.closeAllDialogs()
    }
  }
}

onMounted(() => {
  uiStore.initResponsive()
  window.addEventListener('keydown', handleKeydown)

  // Auto-open endpoint manager if no endpoints configured (not in config mode)
  if (!endpointStore.configMode && endpointStore.endpoints.length === 0) {
    showEndpointManager.value = true
  }
})

onUnmounted(() => {
  uiStore.destroyResponsive()
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="app-container">
    <!-- Header / Toolbar -->
    <header class="app-header">
      <div class="header-left">
        <button
          v-if="!uiStore.isDesktop"
          class="menu-button"
          aria-label="Toggle menu"
          @click="uiStore.toggleSidebar()"
        >
          <span class="material-symbols-outlined">menu</span>
        </button>
        <img
          v-if="logoUrl"
          :src="logoUrl"
          alt=""
          class="app-logo"
          @error="($event.target as HTMLImageElement).style.display = 'none'"
        />
        <h1 class="app-title">{{ appName }}</h1>
        <!-- Endpoint selector badge (hidden in single endpoint mode) -->
        <button
          v-if="!endpointStore.isSingleEndpoint"
          class="dropdown-trigger"
          :class="endpointStore.status"
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
        <button class="dropdown-trigger" @click="(e) => languageMenu.toggle(e)" aria-label="Select language">
          <span class="material-symbols-outlined">language</span>
          <span>{{ getLanguageName(languageStore.preferred) }}</span>
          <span class="material-symbols-outlined dropdown-arrow">arrow_drop_down</span>
        </button>
        <Menu ref="languageMenu" :model="languageMenuItems" :popup="true" />
        <div class="header-icons">
          <a
            :href="docsUrl"
            target="_blank"
            class="header-icon-btn"
            aria-label="Documentation"
            title="Documentation"
          >
            <span class="material-symbols-outlined">help_outline</span>
          </a>
          <button
            class="header-icon-btn"
            aria-label="Toggle dark mode"
            :title="settingsStore.darkMode ? 'Switch to light mode' : 'Switch to dark mode'"
            @click="settingsStore.setDarkMode(!settingsStore.darkMode)"
          >
            <span class="material-symbols-outlined">
              {{ settingsStore.darkMode ? 'light_mode' : 'dark_mode' }}
            </span>
          </button>
          <button class="header-icon-btn" aria-label="Settings" @click="uiStore.openSettingsDialog()">
            <span class="material-symbols-outlined">settings</span>
          </button>
        </div>
      </div>
    </header>

    <!-- Breadcrumb -->
    <ConceptBreadcrumb @select-concept="selectConcept" />

    <!-- Config error banner -->
    <div v-if="config.error" class="config-error-banner">
      <span class="material-symbols-outlined">error</span>
      <span>Failed to load config: {{ config.error }}</span>
    </div>

    <!-- Main Content -->
    <main class="app-main">
      <ErrorBoundary>
        <RouterView />
      </ErrorBoundary>
    </main>

    <!-- Toast notifications -->
    <Toast />

    <!-- Endpoint Manager Dialog (hidden in config mode) -->
    <EndpointManager v-if="!endpointStore.configMode" v-model:visible="showEndpointManager" />

    <!-- Settings Dialog -->
    <Dialog
      v-model:visible="uiStore.settingsDialogOpen"
      header="Settings"
      :style="{ width: '820px' }"
      :modal="true"
      position="top"
      class="settings-dialog"
    >
      <div class="settings-shell">
        <aside class="settings-nav">
          <div class="settings-nav-title">Settings</div>
          <button
            v-for="item in settingsNavItems"
            :key="item.id"
            class="settings-nav-item"
            :class="{ active: settingsSection === item.id }"
            @click="settingsSection = item.id"
          >
            <span class="material-symbols-outlined">{{ item.icon }}</span>
            <span class="settings-nav-label">{{ item.label }}</span>
            <span class="settings-nav-hint">{{ item.hint }}</span>
          </button>
        </aside>
        <section class="settings-panel">
          <div v-if="settingsSection === 'search'" class="settings-panel-content">
            <div class="panel-header">
              <h3 class="panel-title">Search</h3>
              <p class="panel-subtitle">Tune match behavior, scope, and label targets.</p>
            </div>
            <div class="settings-group">
              <div class="settings-group-title">Match mode</div>
              <div class="setting-row">
                <Select
                  v-model="settingsStore.searchMatchMode"
                  :options="searchMatchModeOptions"
                  optionLabel="label"
                  optionValue="value"
                  class="select-compact full-width"
                />
                <p class="setting-hint">
                  Regular expression mode uses case-insensitive SPARQL regex.
                </p>
              </div>
            </div>
            <div class="settings-group">
              <div class="settings-group-title">Search in</div>
              <div class="setting-row">
                <label class="checkbox-label">
                  <Checkbox v-model="settingsStore.searchInPrefLabel" :binary="true" />
                  <span class="checkbox-text">
                    Preferred labels
                    <small>Match concepts by prefLabel</small>
                  </span>
                </label>
              </div>
              <div class="setting-row">
                <label class="checkbox-label">
                  <Checkbox v-model="settingsStore.searchInAltLabel" :binary="true" />
                  <span class="checkbox-text">
                    Alternative labels
                    <small>Match concepts by altLabel</small>
                  </span>
                </label>
              </div>
              <div class="setting-row">
                <label class="checkbox-label">
                  <Checkbox v-model="settingsStore.searchInDefinition" :binary="true" />
                  <span class="checkbox-text">
                    Definitions
                    <small>Search inside skos:definition</small>
                  </span>
                </label>
              </div>
            </div>
            <div class="settings-group">
              <div class="settings-group-title">Scope</div>
              <div class="setting-row">
                <label class="checkbox-label">
                  <Checkbox v-model="settingsStore.searchAllSchemes" :binary="true" />
                  <span class="checkbox-text">
                    Search all schemes
                    <small>Ignore the current scheme filter</small>
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div v-if="settingsSection === 'language'" class="settings-panel-content">
            <div class="panel-header">
              <h3 class="panel-title">Language</h3>
              <p class="panel-subtitle">Choose the preferred language for labels and descriptions.</p>
            </div>
            <div class="settings-group">
              <div class="setting-row">
                <button
                  class="dropdown-trigger settings-language-trigger"
                  @click="(e) => settingsLanguageMenu.toggle(e)"
                  aria-label="Select language"
                >
                  <span class="material-symbols-outlined">language</span>
                  <span>{{ getLanguageName(languageStore.preferred) }}</span>
                  <span class="material-symbols-outlined dropdown-arrow">arrow_drop_down</span>
                </button>
                <Menu
                  ref="settingsLanguageMenu"
                  :model="settingsLanguageMenuItems"
                  :popup="true"
                  appendTo="body"
                  :baseZIndex="2000"
                />
                <p class="setting-hint">
                  Labels and descriptions will be shown in this language when available.
                </p>
                <p v-if="!languageOptions.length" class="setting-hint warning">
                  Connect to an endpoint and run analysis to detect languages.
                </p>
              </div>
            </div>
          </div>

          <div v-if="settingsSection === 'display'" class="settings-panel-content">
            <div class="panel-header">
              <h3 class="panel-title">Display</h3>
              <p class="panel-subtitle">Control label formatting and data tags.</p>
            </div>
            <div class="settings-group">
              <div class="setting-row">
                <label class="checkbox-label">
                  <Checkbox v-model="settingsStore.showDatatypes" :binary="true" />
                  <span class="checkbox-text">
                    Show datatypes
                    <small>Display datatype tags (e.g., xsd:date) on property values</small>
                  </span>
                </label>
              </div>
              <div v-if="settingsStore.showDatatypes" class="setting-row nested">
                <label class="checkbox-label">
                  <Checkbox v-model="settingsStore.showStringDatatypes" :binary="true" />
                  <span class="checkbox-text">
                    Show xsd:string
                    <small>Display xsd:string datatype tags explicitly</small>
                  </span>
                </label>
              </div>
              <div class="setting-row">
                <label class="checkbox-label">
                  <Checkbox v-model="settingsStore.showLanguageTags" :binary="true" />
                  <span class="checkbox-text">
                    Show language tags
                    <small>Display language tags on labels when different from preferred</small>
                  </span>
                </label>
              </div>
              <div v-if="settingsStore.showLanguageTags" class="setting-row nested">
                <label class="checkbox-label">
                  <Checkbox v-model="settingsStore.showPreferredLanguageTag" :binary="true" />
                  <span class="checkbox-text">
                    Include preferred language
                    <small>Also show tag when label matches preferred language</small>
                  </span>
                </label>
              </div>
              <div class="setting-row">
                <label class="checkbox-label">
                  <Checkbox v-model="settingsStore.showNotationInLabels" :binary="true" />
                  <span class="checkbox-text">
                    Show notation in labels
                    <small>Include notation prefixes in labels and sorting</small>
                  </span>
                </label>
              </div>
              <div class="setting-row">
                <label class="checkbox-label">
                  <Checkbox v-model="settingsStore.showOrphansSelector" :binary="true" />
                  <span class="checkbox-text">
                    Show orphans selector
                    <small>Display "Orphan Concepts" option in scheme dropdown</small>
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div v-if="settingsSection === 'deprecation'" class="settings-panel-content">
            <div class="panel-header">
              <h3 class="panel-title">Deprecation</h3>
              <p class="panel-subtitle">Highlight deprecated concepts and tune the rules.</p>
            </div>
            <div class="settings-group">
              <div class="setting-row">
                <label class="checkbox-label">
                  <Checkbox v-model="settingsStore.showDeprecationIndicator" :binary="true" />
                  <span class="checkbox-text">
                    Show deprecation indicators
                    <small>Display visual indicators for deprecated concepts</small>
                  </span>
                </label>
              </div>
              <div v-if="settingsStore.showDeprecationIndicator" class="detection-rules">
                <div class="rules-label">Detection Rules</div>
                <div v-for="rule in settingsStore.deprecationRules" :key="rule.id" class="setting-row nested">
                  <label class="checkbox-label">
                    <Checkbox v-model="rule.enabled" :binary="true" />
                    <span class="checkbox-text">
                      {{ rule.label }}
                      <small class="rule-value">
                        {{ rule.condition === 'equals' ? '=' : rule.condition === 'not-equals' ? '≠' : 'exists' }}
                        {{ rule.value ? rule.value.split('/').pop() : '' }}
                      </small>
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div v-if="settingsSection === 'developer'" class="settings-panel-content">
            <div class="panel-header">
              <h3 class="panel-title">Developer</h3>
              <p class="panel-subtitle">Diagnostics and endpoint tooling options.</p>
            </div>
            <div class="settings-group">
              <div v-if="!config.configMode" class="setting-row">
                <label class="checkbox-label">
                  <Checkbox v-model="settingsStore.developerMode" :binary="true" />
                  <span class="checkbox-text">
                    Developer mode
                    <small>Enable developer tools like JSON export in endpoint manager</small>
                  </span>
                </label>
              </div>
              <div class="setting-row">
                <label class="setting-label">Log level</label>
                <Select
                  v-model="settingsStore.logLevel"
                  :options="logLevelOptions"
                  optionLabel="label"
                  optionValue="value"
                  class="select-compact full-width"
                />
                <p class="setting-hint">
                  Minimum log level shown in browser console (F12). All logs are stored in history.
                </p>
              </div>
              <div class="setting-row">
                <label class="setting-label">Orphan detection strategy</label>
                <Select
                  v-model="settingsStore.orphanDetectionStrategy"
                  :options="orphanDetectionStrategyOptions"
                  optionLabel="label"
                  optionValue="value"
                  class="select-compact full-width"
                />
                <p class="setting-hint">
                  Auto tries fast single-query with fallback to slow multi-query.
                </p>
              </div>
              <div class="setting-row">
                <label class="checkbox-label">
                  <Checkbox v-model="settingsStore.orphanFastPrefilter" :binary="true" />
                  <span class="checkbox-text">
                    Prefilter orphan candidates (fast mode)
                    <small>Excludes direct scheme links first, then runs hierarchy checks on remaining concepts.</small>
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div v-if="settingsSection === 'about'" class="settings-panel-content">
            <div class="panel-header">
              <h3 class="panel-title">About</h3>
              <p class="panel-subtitle">Build information and source links.</p>
            </div>
            <div class="settings-group">
              <div class="about-info">
                <div class="about-row">
                  <span class="about-label">Version</span>
                  <span class="about-value">{{ appVersion }}</span>
                </div>
                <div class="about-row">
                  <span class="about-label">Build</span>
                  <span class="about-value mono">{{ gitCommit }}</span>
                </div>
                <div class="about-row">
                  <span class="about-label">Built</span>
                  <span class="about-value">{{ buildDateFormatted }}</span>
                </div>
                <div class="about-row">
                  <span class="about-label">Source</span>
                  <a href="https://github.com/cognizone/augmented-semantics/tree/main/ae-skos" target="_blank" class="about-link">
                    GitHub
                    <span class="material-symbols-outlined link-icon">open_in_new</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <template #footer>
        <Button
          label="Reset to defaults"
          severity="secondary"
          text
          @click="settingsStore.resetToDefaults()"
        />
        <Button
          label="Close"
          @click="uiStore.setSettingsDialogOpen(false)"
        />
      </template>
    </Dialog>

    <!-- ARIA live regions for screen readers -->
    <div class="sr-only" role="status" aria-live="polite">
      {{ uiStore.loadingAnnouncement }}
    </div>
    <div class="sr-only" role="alert" aria-live="assertive">
      {{ uiStore.errorAnnouncement }}
    </div>
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

.menu-button {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  color: var(--ae-text-secondary);
  border-radius: 4px;
  transition: background-color 0.15s, color 0.15s;
}

.menu-button:hover {
  background: var(--ae-bg-hover);
  color: var(--ae-text-primary);
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

/* Status dot for endpoint connection */
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ae-text-muted);
}

.dropdown-trigger.connected .status-dot {
  background: var(--ae-status-success);
}

.dropdown-trigger.connecting .status-dot {
  background: var(--ae-status-warning);
  animation: pulse 1s infinite;
}

.dropdown-trigger.error .status-dot {
  background: var(--ae-status-error);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
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
  transition: background-color 0.15s, color 0.15s;
}

.header-icon-btn:hover {
  background: var(--ae-bg-hover);
  color: var(--ae-text-primary);
}

.header-icon-btn .material-symbols-outlined {
  font-size: 18px;
}

.header-icons {
  display: flex;
}

.header-icons .header-icon-btn {
  text-decoration: none;
}

.app-main {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Mobile adjustments */
@media (max-width: 767px) {
  .header-right {
    display: none;
  }
}

/* Settings dialog */
.settings-dialog :deep(.p-dialog-content) {
  padding: 0;
}

.settings-shell {
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 520px;
  background: var(--ae-bg-base);
}

.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem 0.75rem;
  background: linear-gradient(180deg, var(--ae-bg-elevated), var(--ae-bg-base));
  border-right: 1px solid var(--ae-border-color);
}

.settings-nav-title {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ae-text-secondary);
  margin-bottom: 0.5rem;
  padding: 0 0.5rem;
}

.settings-nav-item {
  display: grid;
  grid-template-columns: 20px 1fr;
  grid-template-rows: auto auto;
  column-gap: 0.5rem;
  row-gap: 0.125rem;
  align-items: center;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--ae-text-secondary);
  padding: 0.5rem 0.5rem;
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s, transform 0.15s;
}

.settings-nav-item .material-symbols-outlined {
  grid-row: 1 / span 2;
  font-size: 18px;
}

.settings-nav-item:hover {
  background: var(--ae-bg-hover);
  color: var(--ae-text-primary);
  transform: translateX(2px);
}

.settings-nav-item.active {
  background: var(--ae-bg-base);
  color: var(--ae-text-primary);
  box-shadow: 0 0 0 1px var(--ae-border-color) inset;
}

.settings-nav-label {
  font-size: 0.875rem;
  font-weight: 600;
}

.settings-nav-hint {
  font-size: 0.7rem;
  color: var(--ae-text-secondary);
}

.settings-panel {
  padding: 1.25rem 1.5rem 1.5rem;
  overflow: auto;
}

.settings-panel-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.panel-header {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.25rem;
}

.panel-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
}

.panel-subtitle {
  margin: 0;
  font-size: 0.8rem;
  color: var(--ae-text-secondary);
}

.settings-group {
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 12px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.settings-group-title {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ae-text-secondary);
  margin-bottom: 0.25rem;
}

.full-width {
  width: 100%;
}

.settings-language-trigger {
  width: 100%;
  justify-content: space-between;
}


.setting-row {
  margin-bottom: 0.75rem;
}

.setting-row.nested {
  margin-left: 1.75rem;
}

.checkbox-label {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  cursor: pointer;
}

.checkbox-text {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  font-size: 0.8125rem;
  color: var(--ae-text-primary);
  line-height: 1.4;
}

.checkbox-text small {
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
}

.setting-hint {
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
  margin: 0.5rem 0 0 0;
}

.setting-hint.warning {
  font-style: italic;
}

.detection-rules {
  margin-top: 0.75rem;
  margin-left: 1.75rem;
}

.rules-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ae-text-secondary);
  margin-bottom: 0.5rem;
}

.detection-rules .setting-row.nested {
  margin-left: 0;
}

.rule-value {
  font-family: var(--ae-font-mono);
}

.setting-label {
  display: block;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--ae-text-primary);
  margin-bottom: 0.5rem;
}

.config-error-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: #d32f2f;
  color: white;
  font-size: 0.875rem;
}

.config-error-banner .material-symbols-outlined {
  font-size: 1.25rem;
}

/* About section */
.about-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.about-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8125rem;
}

.about-label {
  color: var(--ae-text-secondary);
}

.about-value {
  color: var(--ae-text-primary);
}

.about-value.mono {
  font-family: var(--ae-font-mono);
  font-size: 0.75rem;
}

.about-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--ae-accent);
  text-decoration: none;
}

.about-link:hover {
  text-decoration: underline;
}

.about-link .link-icon {
  font-size: 0.875rem;
}

@media (max-width: 900px) {
  .settings-shell {
    grid-template-columns: 1fr;
  }

  .settings-nav {
    flex-direction: row;
    overflow-x: auto;
    border-right: none;
    border-bottom: 1px solid var(--ae-border-color);
    padding: 0.75rem;
  }

  .settings-nav-title {
    display: none;
  }

  .settings-nav-item {
    min-width: 160px;
  }
}
</style>
