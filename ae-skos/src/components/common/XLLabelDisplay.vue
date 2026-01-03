<script setup lang="ts">
/**
 * XLLabelDisplay - SKOS-XL extended label display component
 *
 * Displays a SKOS-XL label with expandable details showing:
 * - Label URI
 * - literalForm with language tag
 * - Label relations (if any)
 *
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import { ref } from 'vue'
import { useLabelResolver } from '../../composables'
import { isValidURI } from '../../services'
import type { XLLabel } from '../../types'
import Button from 'primevue/button'

const props = defineProps<{
  label: XLLabel
}>()

const { shouldShowLangTag } = useLabelResolver()
const expanded = ref(false)

function toggleExpand() {
  expanded.value = !expanded.value
}
</script>

<template>
  <div class="xl-label">
    <div class="xl-label-header" @click="toggleExpand">
      <span class="xl-indicator">[XL]</span>
      <span class="xl-literal">
        {{ label.literalForm.value }}
        <span v-if="label.literalForm.lang && shouldShowLangTag(label.literalForm.lang)" class="lang-tag">
          {{ label.literalForm.lang }}
        </span>
      </span>
      <Button
        :icon="expanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
        severity="secondary"
        text
        rounded
        size="small"
        class="expand-btn"
      />
    </div>
    <div v-if="expanded" class="xl-label-details">
      <div class="xl-detail-row">
        <span class="detail-label">URI:</span>
        <a
          v-if="isValidURI(label.uri)"
          :href="label.uri"
          target="_blank"
          rel="noopener noreferrer"
          class="detail-value uri-link"
        >
          {{ label.uri }}
          <i class="pi pi-external-link"></i>
        </a>
        <span v-else class="detail-value">{{ label.uri }}</span>
      </div>
      <div class="xl-detail-row">
        <span class="detail-label">literalForm:</span>
        <span class="detail-value">
          {{ label.literalForm.value }}
          <span v-if="label.literalForm.lang" class="lang-tag">{{ label.literalForm.lang }}</span>
        </span>
      </div>
      <div v-if="label.labelRelations && label.labelRelations.length > 0" class="xl-relations">
        <span class="detail-label">Relations:</span>
        <div v-for="(rel, index) in label.labelRelations" :key="index" class="relation-item">
          <span class="relation-type">{{ rel.type }}:</span>
          <span class="relation-target">{{ rel.target.literalForm.value }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.xl-label {
  background: var(--p-content-hover-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 4px;
  overflow: hidden;
}

.xl-label-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  cursor: pointer;
}

.xl-label-header:hover {
  background: var(--p-content-hover-background);
}

.xl-indicator {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--p-primary-color);
  background: var(--p-primary-100);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
}

.xl-literal {
  flex: 1;
}

.lang-tag {
  font-size: 0.625rem;
  font-weight: normal;
  background: var(--p-content-hover-background);
  color: var(--p-text-muted-color);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  margin-left: 0.25rem;
}

.expand-btn {
  flex-shrink: 0;
}

.xl-label-details {
  padding: 0.5rem;
  background: var(--p-content-background);
  border-top: 1px solid var(--p-content-border-color);
}

.xl-detail-row {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  margin-bottom: 0.5rem;
}

.xl-detail-row:last-child {
  margin-bottom: 0;
}

.detail-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--p-text-muted-color);
}

.detail-value {
  font-size: 0.875rem;
  word-break: break-all;
}

.uri-link {
  color: var(--p-primary-color);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.uri-link:hover {
  text-decoration: underline;
}

.uri-link .pi {
  font-size: 0.625rem;
}

.xl-relations {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px dashed var(--p-content-border-color);
}

.relation-item {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.relation-type {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.relation-target {
  font-size: 0.875rem;
}
</style>
