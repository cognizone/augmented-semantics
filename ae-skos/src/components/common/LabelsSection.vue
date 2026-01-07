<script setup lang="ts">
/**
 * LabelsSection - Config-driven label rendering with SKOS-XL support
 *
 * Renders labels (prefLabel, altLabel, hiddenLabel) using a config-driven
 * approach. Supports SKOS-XL extended labels via XLLabelsGroup.
 *
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import XLLabelsGroup from './XLLabelsGroup.vue'
import type { XLLabel, LabelValue } from '../../types'

interface LabelConfig {
  label: string                 // 'Preferred' | 'Alternative' | 'Hidden'
  values: LabelValue[]          // Sorted label values
  hasXL?: boolean               // Whether XL labels exist
  xlLabels?: XLLabel[]          // SKOS-XL labels
  regularLabels?: LabelValue[]  // Regular labels (for XLLabelsGroup)
  isHidden?: boolean            // Apply hidden-label styling
}

interface Props {
  items: LabelConfig[]
  title?: string
  icon?: string
}

withDefaults(defineProps<Props>(), {
  title: 'Labels',
  icon: 'translate',
})
</script>

<template>
  <section v-if="items.length > 0" class="details-section">
    <h3 class="section-title">
      <span class="material-symbols-outlined section-icon">{{ icon }}</span>
      {{ title }}
    </h3>

    <div v-for="prop in items" :key="prop.label" class="property-row">
      <label>{{ prop.label }}</label>
      <div class="label-values">
        <span
          v-for="(label, i) in prop.values"
          :key="i"
          class="label-value"
          :class="{ 'hidden-label': prop.isHidden }"
        >
          {{ label.value }}
          <span v-if="label.lang" class="lang-tag">{{ label.lang }}</span>
        </span>
      </div>
      <XLLabelsGroup
        v-if="prop.hasXL && prop.xlLabels?.length"
        :labels="prop.xlLabels"
        :regular-labels="prop.regularLabels || []"
      />
    </div>

    <!-- Slot for additional content like Notation -->
    <slot />
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

.label-values {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.label-value {
  font-size: 0.875rem;
}

.label-value:not(:last-child)::after {
  content: '·';
  margin-left: 0.5rem;
  color: var(--ae-text-muted);
}

.label-value.hidden-label {
  color: var(--ae-text-secondary);
  font-style: italic;
}
</style>
