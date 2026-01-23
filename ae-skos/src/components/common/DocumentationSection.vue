<script setup lang="ts">
/**
 * DocumentationSection - Config-driven documentation rendering
 *
 * Renders documentation properties (definition, notes, examples) using
 * a config-driven approach. Each item in the config specifies a label
 * and array of values to display.
 *
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import { useLabelResolver } from '../../composables'
import { useSettingsStore } from '../../stores'
import { formatDatatype, isStringDatatype } from '../../utils/displayUtils'
import type { LabelValue } from '../../types'

interface DocItem {
  label: string
  values: LabelValue[]
  class?: string  // e.g., 'example' for italic styling
}

interface Props {
  items: DocItem[]
  title?: string
  icon?: string
}

withDefaults(defineProps<Props>(), {
  title: 'Documentation',
  icon: 'description',
})

const { shouldShowLangTag } = useLabelResolver()
const settingsStore = useSettingsStore()

function shouldShowDatatypeTag(datatype?: string): boolean {
  if (!settingsStore.showDatatypes || !datatype) return false
  if (!settingsStore.showStringDatatypes && isStringDatatype(datatype)) return false
  return true
}

function getDatatypeTag(datatype?: string, lang?: string): string | undefined {
  if (datatype) return datatype
  if (lang) return undefined
  return 'xsd:string'
}

function getDatatypeLabel(datatype?: string): string {
  if (!datatype) return ''
  return formatDatatype(datatype)
}
</script>

<template>
  <section v-if="items.length > 0" class="details-section">
    <h3 class="section-title">
      <span class="material-symbols-outlined section-icon">{{ icon }}</span>
      {{ title }}
    </h3>
    <div v-for="doc in items" :key="doc.label" class="property-row">
      <label>{{ doc.label }}</label>
      <div class="doc-values">
        <p
          v-for="(item, i) in doc.values"
          :key="i"
          class="doc-value"
          :class="doc.class"
        >
          <span v-if="item.lang && shouldShowLangTag(item.lang)" class="lang-tag lang-tag-first">{{ item.lang }}</span>
          <span class="doc-text">{{ item.value }}</span>
          <span v-if="shouldShowDatatypeTag(getDatatypeTag(item.datatype, item.lang))" class="datatype-tag">
            {{ getDatatypeLabel(getDatatypeTag(item.datatype, item.lang)) }}
          </span>
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.details-section {
  margin-bottom: 2rem;
}

.property-row {
  margin-bottom: 1rem;
}

.property-row label {
  display: block;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--ae-text-secondary);
  margin-bottom: 0.25rem;
}

.doc-values {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.doc-value {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.5;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: baseline;
}

.doc-value .lang-tag-first {
  margin-right: 0.25rem;
}

.doc-value .doc-text {
  flex: 1 1 auto;
  min-width: 0;
}

.doc-value.example {
  font-style: italic;
  color: var(--ae-text-secondary);
}
</style>
