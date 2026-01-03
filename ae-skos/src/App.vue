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
    label: `${lang} (${countMap.get(lang)?.toLocaleString() || 0})`,
    value: lang,
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
          class="connection-badge"
          :class="endpointStore.status"
          aria-label="Select endpoint"
          @click="(e) => endpointMenu.toggle(e)"
        >
          <span class="status-dot"></span>
          <span class="connection-name">{{ endpointStore.current?.name || 'No endpoint' }}</span>
          <span class="material-symbols-outlined badge-arrow">arrow_drop_down</span>
        </button>
        <Menu ref="endpointMenu" :model="endpointMenuItems" :popup="true" class="endpoint-menu" />
      </div>
      <div class="header-right">
        <button class="header-btn" @click="showSettingsDialog = true" aria-label="Language and settings">
          <span class="material-symbols-outlined icon-sm">language</span>
          <span class="btn-label">{{ getLanguageName(languageStore.preferred) }}</span>
          <span class="material-symbols-outlined icon-sm">arrow_drop_down</span>
        </button>
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
      :style="{ width: '400px' }"
      :modal="true"
    >
      <div class="settings-content">
        <!-- Language Section -->
        <div class="setting-section">
          <div class="setting-section-label">Preferred Language</div>

          <div class="setting-group">
            <Select
              v-model="languageStore.preferred"
              :options="languageOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="Select language"
              class="language-select"
              @change="(e: any) => languageStore.setPreferred(e.value)"
            />
            <span class="setting-description">
              Labels and descriptions will be shown in this language when available
            </span>
            <span v-if="!languageOptions.length" class="setting-hint">
              Connect to an endpoint and run analysis to detect languages
            </span>
          </div>
        </div>

        <!-- Display Section -->
        <div class="setting-section">
          <div class="setting-section-label">Display</div>

          <div class="setting-item">
            <Checkbox
              v-model="settingsStore.darkMode"
              inputId="darkMode"
              :binary="true"
            />
            <label for="darkMode" class="setting-label">
              Dark mode
              <span class="setting-description">Use dark color scheme</span>
            </label>
          </div>

          <div class="setting-item">
            <Checkbox
              v-model="settingsStore.showDatatypes"
              inputId="showDatatypes"
              :binary="true"
            />
            <label for="showDatatypes" class="setting-label">
              Show datatypes
              <span class="setting-description">Display datatype tags (e.g., xsd:date) on property values</span>
            </label>
          </div>

          <div class="setting-item">
            <Checkbox
              v-model="settingsStore.showLanguageTags"
              inputId="showLanguageTags"
              :binary="true"
            />
            <label for="showLanguageTags" class="setting-label">
              Show language tags
              <span class="setting-description">Display language tags on labels when different from preferred</span>
            </label>
          </div>

          <div v-if="settingsStore.showLanguageTags" class="setting-item nested">
            <Checkbox
              v-model="settingsStore.showPreferredLanguageTag"
              inputId="showPreferredLanguageTag"
              :binary="true"
            />
            <label for="showPreferredLanguageTag" class="setting-label">
              Include preferred language
              <span class="setting-description">Also show tag when label matches preferred language</span>
            </label>
          </div>
        </div>

        <!-- Deprecation Section -->
        <div class="setting-section">
          <div class="setting-section-label">Deprecation</div>

          <div class="setting-item">
            <Checkbox
              v-model="settingsStore.showDeprecationIndicator"
              inputId="showDeprecationIndicator"
              :binary="true"
            />
            <label for="showDeprecationIndicator" class="setting-label">
              Show deprecation indicators
              <span class="setting-description">Display visual indicators for deprecated concepts</span>
            </label>
          </div>

          <div v-if="settingsStore.showDeprecationIndicator" class="deprecation-rules">
            <div class="setting-section-label">Detection Rules</div>
            <div v-for="rule in settingsStore.deprecationRules" :key="rule.id" class="setting-item nested">
              <Checkbox
                v-model="rule.enabled"
                :inputId="`rule-${rule.id}`"
                :binary="true"
              />
              <label :for="`rule-${rule.id}`" class="setting-label">
                {{ rule.label }}
                <span class="setting-description rule-description">
                  {{ rule.condition === 'equals' ? '=' :
                     rule.condition === 'not-equals' ? '≠' : 'exists' }}
                  {{ rule.value ? rule.value.split('/').pop() : '' }}
                </span>
              </label>
            </div>
          </div>
        </div>
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

.connection-badge {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
}

.connection-badge:hover {
  background: var(--ae-bg-hover);
  border-color: var(--ae-text-secondary);
}

.badge-arrow {
  font-size: 18px;
  margin-left: -0.125rem;
  color: var(--ae-text-secondary);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ae-text-muted);
}

.connection-badge.connected .status-dot {
  background: var(--ae-status-success);
}

.connection-badge.connecting .status-dot {
  background: var(--ae-status-warning);
  animation: pulse 1s infinite;
}

.connection-badge.error .status-dot {
  background: var(--ae-status-error);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.connection-name {
  color: var(--ae-text-secondary);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.header-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.375rem 0.5rem;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--ae-text-primary);
  transition: background-color 0.15s;
}

.header-btn:hover {
  background: var(--ae-bg-hover);
}

.header-btn .btn-label {
  margin: 0 0.125rem;
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
  gap: 0.75rem;
}

.setting-section {
  background: var(--ae-bg-elevated);
  border-radius: 6px;
  padding: 0.75rem;
}

.setting-section-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--ae-text-secondary);
  margin-bottom: 0.75rem;
  letter-spacing: 0.5px;
}

.setting-item {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.setting-item + .setting-item {
  margin-top: 0.75rem;
}

.setting-item.nested {
  margin-left: 1.75rem;
  margin-top: 0.75rem;
}

.setting-label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  cursor: pointer;
}

.setting-description {
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.setting-group-label {
  font-weight: 600;
  font-size: 0.875rem;
}

.language-select {
  width: 100%;
}

.deprecation-rules {
  margin-top: 0.5rem;
  margin-left: 1.75rem;
}

.deprecation-rules .setting-item.nested {
  margin-left: 0;
}

.rule-description {
  font-family: monospace;
  font-size: 0.7rem;
}

.setting-hint {
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
  font-style: italic;
}
</style>
