<script setup lang="ts">
/**
 * LanguageSelector - Language preference management
 *
 * Detects available languages from SKOS data and allows
 * setting preferred and fallback languages for label display.
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
const languagesWithCount = ref<{ lang: string; count: number }[]>([])

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
}

function getLanguageName(code: string): string {
  return languageNames[code] || code.toUpperCase()
}

// Computed
const dropdownOptions = computed(() => {
  if (languagesWithCount.value.length > 0) {
    return languagesWithCount.value.map(lc => ({
      label: `${getLanguageName(lc.lang)} (${lc.count.toLocaleString()})`,
      value: lc.lang,
      count: lc.count,
    }))
  }

  // Fall back to detected languages without count
  return languageStore.detected.map(lang => ({
    label: getLanguageName(lang),
    value: lang,
    count: 0,
  }))
})

const selectedLanguage = computed({
  get: () => languageStore.preferred,
  set: (lang: string) => languageStore.setPreferred(lang),
})

const fallbackLanguage = computed({
  get: () => languageStore.fallback,
  set: (lang: string) => languageStore.setFallback(lang),
})

const hasLanguages = computed(() =>
  languagesWithCount.value.length > 0 || languageStore.detected.length > 0
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

    languagesWithCount.value = detected
    languageStore.setDetected(detected.map(lc => lc.lang))

    // Auto-select first language if none set
    const firstLang = detected[0]
    if (firstLang && !languageStore.detected.includes(languageStore.preferred)) {
      languageStore.setPreferred(firstLang.lang)
    }
  } catch (error) {
    console.error('Failed to detect languages:', error)
    languagesWithCount.value = []
  } finally {
    loading.value = false
  }
}

// Watch for endpoint changes
watch(
  () => endpointStore.current?.id,
  (newId, oldId) => {
    if (newId && newId !== oldId) {
      detectSkosLanguages()
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
      <template #value="slotProps">
        <div class="selected-lang">
          <i class="pi pi-globe"></i>
          <span v-if="slotProps.value">{{ getLanguageName(slotProps.value) }}</span>
          <span v-else-if="loading">Detecting...</span>
          <span v-else>Language</span>
        </div>
      </template>
      <template #option="slotProps">
        <div class="lang-option">
          <span class="lang-name">{{ getLanguageName(slotProps.option.value) }}</span>
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
            @click="showSettings = true"
          />
        </div>
      </template>
    </Select>

    <!-- Settings Dialog -->
    <Dialog
      v-model:visible="showSettings"
      header="Language Settings"
      :style="{ width: '400px' }"
      :modal="true"
    >
      <div class="settings-content">
        <div class="setting-field">
          <label>Preferred Language</label>
          <p class="setting-help">Primary language for labels and descriptions</p>
          <Select
            v-model="selectedLanguage"
            :options="dropdownOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="Select language"
            class="w-full"
          />
        </div>

        <div class="setting-field">
          <label>Fallback Language</label>
          <p class="setting-help">Used when preferred language is not available</p>
          <Select
            v-model="fallbackLanguage"
            :options="dropdownOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="Select fallback"
            class="w-full"
          />
        </div>

        <div v-if="languageStore.detected.length > 0" class="detected-info">
          <label>Detected Languages</label>
          <p class="detected-list">
            {{ languageStore.detected.join(', ') }}
          </p>
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
          label="Close"
          @click="showSettings = false"
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
  min-width: 150px;
}

.selected-lang {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.selected-lang i {
  color: var(--p-primary-color);
}

.lang-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.lang-name {
  font-weight: 500;
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
  gap: 1.5rem;
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

.detected-info {
  padding: 1rem;
  background: var(--p-surface-50);
  border-radius: 6px;
}

.detected-info label {
  font-weight: 600;
  font-size: 0.875rem;
}

.detected-list {
  margin: 0.5rem 0 0 0;
  font-size: 0.875rem;
  color: var(--p-text-muted-color);
}
</style>
