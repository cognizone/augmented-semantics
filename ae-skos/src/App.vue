<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { RouterView } from 'vue-router'
import { useUIStore, useConceptStore, useSettingsStore, useLanguageStore, useEndpointStore } from './stores'
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
const showEndpointManager = ref(false)
const showSettingsDialog = ref(false)
const endpointMenu = ref()
const languageMenu = ref()

// Endpoint menu items
const endpointMenuItems = computed(() => {
  const items = endpointStore.sortedEndpoints.map(ep => ({
    label: ep.name,
    icon: ep.id === endpointStore.currentId ? 'pi pi-check' : undefined,
    command: () => endpointStore.selectEndpoint(ep.id),
  }))

  if (items.length > 0) {
    items.push({ separator: true } as any)
  }

  items.push({
    label: 'Manage endpoints...',
    icon: 'pi pi-cog',
    command: () => { showEndpointManager.value = true },
  })

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
        <h1 class="app-title">AE SKOS</h1>
        <!-- Endpoint selector badge -->
        <button
          class="dropdown-trigger"
          :class="endpointStore.status"
          aria-label="Select endpoint"
          @click="(e) => endpointMenu.toggle(e)"
        >
          <span class="status-dot"></span>
          <span>{{ endpointStore.current?.name || 'No endpoint' }}</span>
          <span class="material-symbols-outlined dropdown-arrow">arrow_drop_down</span>
        </button>
        <Menu ref="endpointMenu" :model="endpointMenuItems" :popup="true" />
      </div>
      <div class="header-right">
        <button class="dropdown-trigger" @click="(e) => languageMenu.toggle(e)" aria-label="Select language">
          <span class="material-symbols-outlined">language</span>
          <span>{{ getLanguageName(languageStore.preferred) }}</span>
          <span class="material-symbols-outlined dropdown-arrow">arrow_drop_down</span>
        </button>
        <Menu ref="languageMenu" :model="languageMenuItems" :popup="true" />
        <button class="header-icon-btn" aria-label="Settings" @click="showSettingsDialog = true">
          <span class="material-symbols-outlined">settings</span>
        </button>
      </div>
    </header>

    <!-- Breadcrumb -->
    <ConceptBreadcrumb @select-concept="selectConcept" />

    <!-- Main Content -->
    <main class="app-main">
      <ErrorBoundary>
        <RouterView />
      </ErrorBoundary>
    </main>

    <!-- Toast notifications -->
    <Toast />

    <!-- Endpoint Manager Dialog -->
    <EndpointManager v-model:visible="showEndpointManager" />

    <!-- Settings Dialog -->
    <Dialog
      v-model:visible="showSettingsDialog"
      header="Settings"
      :style="{ width: '420px' }"
      :modal="true"
    >
      <div class="settings-content">
        <!-- Language Section -->
        <section class="settings-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">language</span>
            Language
          </h3>
          <div class="setting-row">
            <Select
              v-model="languageStore.preferred"
              :options="languageOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="Select language"
              class="language-select"
              @change="(e: any) => languageStore.setPreferred(e.value)"
            />
            <p class="setting-hint">
              Labels and descriptions will be shown in this language when available
            </p>
            <p v-if="!languageOptions.length" class="setting-hint warning">
              Connect to an endpoint and run analysis to detect languages
            </p>
          </div>
        </section>

        <!-- Display Section -->
        <section class="settings-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">palette</span>
            Display
          </h3>

          <div class="setting-row">
            <label class="checkbox-label">
              <Checkbox v-model="settingsStore.darkMode" :binary="true" />
              <span class="checkbox-text">
                Dark mode
                <small>Use dark color scheme</small>
              </span>
            </label>
          </div>

          <div class="setting-row">
            <label class="checkbox-label">
              <Checkbox v-model="settingsStore.showDatatypes" :binary="true" />
              <span class="checkbox-text">
                Show datatypes
                <small>Display datatype tags (e.g., xsd:date) on property values</small>
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
        </section>

        <!-- Deprecation Section -->
        <section class="settings-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">warning</span>
            Deprecation
          </h3>

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
          @click="showSettingsDialog = false"
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

  .connection-badge {
    display: none;
  }
}

/* Settings dialog */
.settings-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.settings-section:first-child {
  margin-top: 1.25rem;
}

.settings-section .section-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.75rem 0;
  padding-bottom: 0.375rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ae-text-secondary);
  border-bottom: 1px solid var(--ae-border-color);
}

.settings-section .section-icon {
  font-size: 18px;
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

.language-select {
  width: 100%;
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
  font-family: monospace;
}
</style>
