<script setup lang="ts">
/**
 * LanguageSelector - Per-endpoint language preference management
 *
 * Provides:
 * - Quick language selection dropdown
 * - Priority ordering dialog
 * - Add/remove languages from priorities
 * - Current override option
 *
 * @see /spec/ae-skos/sko01-LanguageSelector.md
 */
import { ref, computed, watch } from 'vue'
import { useLanguageStore, useEndpointStore } from '../../stores'
import { executeSparql, withPrefixes } from '../../services/sparql'
import Select from 'primevue/select'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Divider from 'primevue/divider'

const languageStore = useLanguageStore()
const endpointStore = useEndpointStore()

// Local state
const loading = ref(false)
const showSettings = ref(false)
const localPriorities = ref<string[]>([])

// Language display names
const languageNames: Record<string, string> = {
  en: 'English',
  nl: 'Nederlands',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  it: 'Italiano',
  pt: 'Português',
  pl: 'Polski',
  ru: 'Русский',
  ja: '日本語',
  zh: '中文',
  ar: 'العربية',
  ko: '한국어',
  sv: 'Svenska',
  da: 'Dansk',
  fi: 'Suomi',
  no: 'Norsk',
  cs: 'Čeština',
  el: 'Ελληνικά',
  hu: 'Magyar',
  ro: 'Română',
  sk: 'Slovenčina',
  bg: 'Български',
  hr: 'Hrvatski',
  sl: 'Slovenščina',
  et: 'Eesti',
  lv: 'Latviešu',
  lt: 'Lietuvių',
  mt: 'Malti',
  ga: 'Gaeilge',
  rm: 'Rumantsch',
}

function getLanguageName(code: string): string {
  return languageNames[code] || code.toUpperCase()
}

function getLanguageCount(code: string): number {
  const found = languageStore.detectedWithCount.find(d => d.lang === code)
  return found?.count || 0
}

// Dropdown options - all detected languages plus current override option
const dropdownOptions = computed(() => {
  const options: { label: string; value: string | null; count?: number }[] = []

  // Add "Use priority order" option
  options.push({
    label: '(Use priority order)',
    value: null,
  })

  // Add detected languages
  if (languageStore.detectedWithCount.length > 0) {
    for (const lc of languageStore.detectedWithCount) {
      options.push({
        label: `${getLanguageName(lc.lang)} (${lc.count.toLocaleString()})`,
        value: lc.lang,
        count: lc.count,
      })
    }
  } else if (languageStore.detected.length > 0) {
    for (const lang of languageStore.detected) {
      options.push({
        label: getLanguageName(lang),
        value: lang,
      })
    }
  }

  return options
})

// Available languages (detected but not in priorities)
const availableLanguages = computed(() => {
  return languageStore.detected.filter(
    lang => !localPriorities.value.includes(lang)
  )
})

// Priority items with display info
const priorityItems = computed(() => {
  return localPriorities.value.map(lang => ({
    lang,
    name: getLanguageName(lang),
    count: getLanguageCount(lang),
  }))
})

const selectedLanguage = computed({
  get: () => languageStore.current,
  set: (lang: string | null) => languageStore.setCurrent(lang),
})

const displayLabel = computed(() => {
  if (languageStore.current) {
    return getLanguageName(languageStore.current)
  }
  const firstPriority = languageStore.priorities[0]
  if (firstPriority) {
    return getLanguageName(firstPriority)
  }
  return 'Language'
})

const hasLanguages = computed(() =>
  languageStore.detectedWithCount.length > 0 || languageStore.detected.length > 0
)

// Detect languages from SKOS concepts
async function detectSkosLanguages() {
  const endpoint = endpointStore.current
  if (!endpoint) return

  loading.value = true

  const query = withPrefixes(`
    SELECT DISTINCT (LANG(?label) AS ?lang) (COUNT(?label) AS ?count)
    WHERE {
      ?concept a skos:Concept ;
               skos:prefLabel ?label .
      FILTER (LANG(?label) != "")
    }
    GROUP BY (LANG(?label))
    ORDER BY DESC(?count)
    LIMIT 50
  `)

  try {
    const results = await executeSparql(endpoint, query, { retries: 1 })
    const detected = results.results.bindings
      .map(b => ({
        lang: b.lang?.value || '',
        count: parseInt(b.count?.value || '0', 10),
      }))
      .filter(lc => lc.lang.length > 0)

    languageStore.setDetectedWithCount(detected)

    // Initialize priorities if empty
    const firstDetected = detected[0]
    if (languageStore.priorities.length === 0 && firstDetected) {
      languageStore.setPriorities([firstDetected.lang])
    }

    // Auto-add unknown detected languages to priorities (sorted alphabetically)
    const detectedLangs = detected.map(d => d.lang)
    const unknownLangs = detectedLangs.filter(
      lang => !languageStore.priorities.includes(lang)
    )
    if (unknownLangs.length > 0) {
      const sorted = unknownLangs.sort((a, b) => a.localeCompare(b))
      languageStore.setPriorities([...languageStore.priorities, ...sorted])
    }
  } catch (error) {
    console.error('Failed to detect languages:', error)
  } finally {
    loading.value = false
  }
}

// Open settings dialog
function openSettings() {
  localPriorities.value = [...languageStore.priorities]
  showSettings.value = true
}

// Save settings
function saveSettings() {
  languageStore.setPriorities(localPriorities.value)
  showSettings.value = false
}

// Add language to priorities
function addToPriorities(lang: string) {
  if (!localPriorities.value.includes(lang)) {
    localPriorities.value.push(lang)
  }
}

// Remove language from priorities
function removeFromPriorities(lang: string) {
  if (localPriorities.value.length > 1) {
    localPriorities.value = localPriorities.value.filter(l => l !== lang)
  }
}

// Move priority up
function movePriorityUp(index: number) {
  if (index > 0) {
    const newPriorities = [...localPriorities.value]
    const removed = newPriorities.splice(index, 1)
    if (removed[0]) {
      newPriorities.splice(index - 1, 0, removed[0])
      localPriorities.value = newPriorities
    }
  }
}

// Move priority down
function movePriorityDown(index: number) {
  if (index < localPriorities.value.length - 1) {
    const newPriorities = [...localPriorities.value]
    const removed = newPriorities.splice(index, 1)
    if (removed[0]) {
      newPriorities.splice(index + 1, 0, removed[0])
      localPriorities.value = newPriorities
    }
  }
}

// Watch for endpoint changes - initialize language config
watch(
  () => endpointStore.current?.id,
  (newId, oldId) => {
    if (newId && newId !== oldId) {
      languageStore.setEndpoint(newId)
      detectSkosLanguages()
    } else if (!newId) {
      languageStore.clearEndpoint()
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="language-selector">
    <Select
      v-model="selectedLanguage"
      :options="dropdownOptions"
      optionLabel="label"
      optionValue="value"
      :placeholder="loading ? 'Detecting...' : 'Language'"
      :loading="loading"
      :disabled="!hasLanguages && !loading"
      class="language-dropdown"
    >
      <template #value>
        <div class="selected-lang">
          <i class="pi pi-globe"></i>
          <span v-if="loading">Detecting...</span>
          <span v-else>{{ displayLabel }}</span>
          <span v-if="!languageStore.current && languageStore.priorities.length > 1" class="priority-indicator">
            (priority)
          </span>
        </div>
      </template>
      <template #option="slotProps">
        <div class="lang-option">
          <span class="lang-name">
            <i v-if="slotProps.option.value === null" class="pi pi-list option-icon"></i>
            <i v-else-if="slotProps.option.value === languageStore.current" class="pi pi-check option-icon"></i>
            {{ slotProps.option.value === null ? slotProps.option.label : getLanguageName(slotProps.option.value) }}
          </span>
          <span v-if="slotProps.option.count" class="lang-count">
            {{ slotProps.option.count.toLocaleString() }}
          </span>
        </div>
      </template>
      <template #footer>
        <Divider class="dropdown-divider" />
        <div class="dropdown-footer">
          <Button
            label="Language settings"
            icon="pi pi-cog"
            text
            size="small"
            class="settings-button"
            @click="openSettings"
          />
        </div>
      </template>
    </Select>

    <!-- Settings Dialog -->
    <Dialog
      v-model:visible="showSettings"
      header="Language Settings"
      :style="{ width: '450px' }"
      :modal="true"
    >
      <div class="settings-content">
        <!-- Current Override -->
        <div class="setting-field">
          <label>Current Language Override</label>
          <p class="setting-help">Select a specific language to display, or use priority order</p>
          <Select
            v-model="selectedLanguage"
            :options="dropdownOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="Select language"
            class="w-full"
          />
        </div>

        <Divider />

        <!-- Priority List -->
        <div class="setting-field">
          <label>Priority Order</label>
          <p class="setting-help">Languages are checked in this order when no override is set</p>

          <div class="priority-list">
            <div
              v-for="(item, index) in priorityItems"
              :key="item.lang"
              class="priority-item"
            >
              <div class="priority-rank">{{ index + 1 }}</div>
              <div class="priority-info">
                <span class="priority-name">{{ item.name }}</span>
                <span v-if="item.count" class="priority-count">({{ item.count.toLocaleString() }})</span>
              </div>
              <div class="priority-actions">
                <Button
                  icon="pi pi-arrow-up"
                  text
                  rounded
                  size="small"
                  :disabled="index === 0"
                  @click="movePriorityUp(index)"
                  v-tooltip.top="'Move up'"
                />
                <Button
                  icon="pi pi-arrow-down"
                  text
                  rounded
                  size="small"
                  :disabled="index === localPriorities.length - 1"
                  @click="movePriorityDown(index)"
                  v-tooltip.top="'Move down'"
                />
                <Button
                  icon="pi pi-times"
                  text
                  rounded
                  size="small"
                  severity="danger"
                  :disabled="localPriorities.length <= 1"
                  @click="removeFromPriorities(item.lang)"
                  v-tooltip.top="'Remove'"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Available Languages -->
        <div v-if="availableLanguages.length > 0" class="setting-field">
          <label>Available Languages</label>
          <p class="setting-help">Click to add to priority list</p>
          <div class="available-list">
            <Button
              v-for="lang in availableLanguages"
              :key="lang"
              :label="`${getLanguageName(lang)} (${getLanguageCount(lang).toLocaleString()})`"
              icon="pi pi-plus"
              text
              size="small"
              class="available-item"
              @click="addToPriorities(lang)"
            />
          </div>
        </div>
      </div>

      <template #footer>
        <Button
          label="Refresh"
          icon="pi pi-refresh"
          severity="secondary"
          outlined
          :loading="loading"
          @click="detectSkosLanguages"
        />
        <Button
          label="Save"
          icon="pi pi-check"
          @click="saveSettings"
        />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.language-selector {
  display: flex;
  align-items: center;
}

.language-dropdown {
  min-width: 180px;
}

.selected-lang {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.selected-lang i {
  color: var(--p-primary-color);
}

.priority-indicator {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
}

.lang-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.lang-name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
}

.option-icon {
  font-size: 0.75rem;
  color: var(--p-primary-color);
}

.lang-count {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.dropdown-divider {
  margin: 0.25rem 0;
}

.dropdown-footer {
  padding: 0.25rem;
}

.settings-button {
  width: 100%;
  justify-content: flex-start;
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.setting-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.setting-field label {
  font-weight: 600;
  font-size: 0.875rem;
}

.setting-help {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  margin: 0 0 0.5rem 0;
}

.w-full {
  width: 100%;
}

.priority-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 200px;
  overflow-y: auto;
}

.priority-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem;
  background: var(--p-surface-50);
  border: 1px solid var(--p-surface-200);
  border-radius: 6px;
}

.priority-rank {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--p-primary-100);
  color: var(--p-primary-color);
  border-radius: 50%;
  font-size: 0.75rem;
  font-weight: 600;
}

.priority-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.priority-name {
  font-weight: 500;
}

.priority-count {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.priority-actions {
  display: flex;
  gap: 0.25rem;
}

.available-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  max-height: 150px;
  overflow-y: auto;
}

.available-item {
  font-size: 0.875rem;
}
</style>
