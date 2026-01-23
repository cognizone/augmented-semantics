<script setup lang="ts">
/**
 * OtherPropertiesSection - Non-SKOS predicate rendering
 *
 * Renders properties that don't have dedicated sections (e.g., custom
 * predicates from other vocabularies). Shows predicate as a link and
 * values with appropriate lang/datatype tags.
 *
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import { isValidURI } from '../../services'
import { getPredicateName, getUriFragment, formatPropertyValue, formatDatatype, isStringDatatype } from '../../utils/displayUtils'
import { useSettingsStore } from '../../stores'
import { computed } from 'vue'

interface PropertyValue {
  value: string
  lang?: string
  datatype?: string
  isUri: boolean
}

interface OtherProperty {
  predicate: string
  values: PropertyValue[]
}

interface Props {
  properties: OtherProperty[]
  resolvedPredicates: Map<string, { prefix: string; localName: string }>
  title?: string
  icon?: string
}

withDefaults(defineProps<Props>(), {
  title: 'Other Properties',
  icon: 'more_horiz',
})

const settingsStore = useSettingsStore()
const showDatatypeTag = computed(() => settingsStore.showDatatypes)
const showStringDatatype = computed(() => settingsStore.showStringDatatypes)

function shouldShowDatatypeTag(datatype?: string): boolean {
  if (!showDatatypeTag.value || !datatype) return false
  if (!showStringDatatype.value && isStringDatatype(datatype)) return false
  return true
}

function getDatatypeTag(datatype?: string, lang?: string): string | undefined {
  if (datatype) return datatype
  if (lang) return undefined
  return 'xsd:string'
}
</script>

<template>
  <section v-if="properties.length" class="details-section">
    <h3 class="section-title">
      <span class="material-symbols-outlined section-icon">{{ icon }}</span>
      {{ title }}
    </h3>
    <div v-for="prop in properties" :key="prop.predicate" class="property-row">
      <label class="predicate-label">
        <a
          v-if="isValidURI(prop.predicate)"
          :href="prop.predicate"
          target="_blank"
          class="predicate-link"
        >
          {{ getPredicateName(prop.predicate, resolvedPredicates.get(prop.predicate)) }}
          <span class="material-symbols-outlined link-icon">open_in_new</span>
        </a>
        <span v-else>{{ getPredicateName(prop.predicate, resolvedPredicates.get(prop.predicate)) }}</span>
      </label>
      <div class="other-values">
        <template v-for="(val, i) in prop.values" :key="i">
          <a
            v-if="val.isUri && isValidURI(val.value)"
            :href="val.value"
            target="_blank"
            class="other-value uri-value"
          >
            {{ getUriFragment(val.value) }}
            <span class="material-symbols-outlined link-icon">open_in_new</span>
          </a>
            <span v-else class="other-value">
              {{ formatPropertyValue(val.value, val.datatype) }}
              <span v-if="val.lang" class="lang-tag">{{ val.lang }}</span>
              <span v-else-if="shouldShowDatatypeTag(getDatatypeTag(val.datatype, val.lang))" class="datatype-tag">
                {{ formatDatatype(getDatatypeTag(val.datatype, val.lang)) }}
              </span>
            </span>
        </template>
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

.predicate-label {
  font-family: var(--ae-font-mono);
  font-size: 0.8125rem;
}

.predicate-link {
  color: var(--ae-accent);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.predicate-link:hover {
  text-decoration: underline;
}

.link-icon {
  font-size: 14px;
}

.other-values {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.other-value {
  font-size: 0.875rem;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.other-value.uri-value {
  color: var(--ae-accent);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.other-value.uri-value:hover {
  text-decoration: underline;
}
</style>
