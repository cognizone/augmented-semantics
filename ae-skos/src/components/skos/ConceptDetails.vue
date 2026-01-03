<script setup lang="ts">
/**
 * ConceptDetails - SKOS concept property display
 *
 * Shows comprehensive concept information organized in sections.
 * Each section and property is only displayed if values exist.
 *
 * Sections:
 * - Labels: prefLabel, altLabel, notation (if any exist)
 * - Documentation: definition, scopeNote, historyNote, changeNote,
 *   editorialNote, example (if any exist)
 * - Hierarchy: broader, narrower (if any exist)
 * - Relations: related (if any exist)
 * - Mappings: exactMatch, closeMatch, broadMatch, narrowMatch,
 *   relatedMatch (if any exist)
 * - Schemes: inScheme (if any exist)
 *
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import { ref, watch, computed } from 'vue'
import { useConceptStore, useSettingsStore } from '../../stores'
import { isValidURI } from '../../services'
import { useDelayedLoading, useLabelResolver, useConceptData, useConceptNavigation, useClipboard, useResourceExport, useDeprecation } from '../../composables'
import { getPredicateName, formatPropertyValue, getRefLabel } from '../../utils/displayUtils'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'
import Menu from 'primevue/menu'
import XLLabelsGroup from '../common/XLLabelsGroup.vue'
import RawRdfDialog from '../common/RawRdfDialog.vue'

const emit = defineEmits<{
  selectConcept: [uri: string]
}>()

const conceptStore = useConceptStore()
const settingsStore = useSettingsStore()
const { selectLabelWithXL, sortLabels, shouldShowLangTag } = useLabelResolver()
const { details, loading, error, resolvedPredicates, loadDetails } = useConceptData()
const { navigateTo, handleSchemeClick, isLocalScheme } = useConceptNavigation(emit)
const { copyToClipboard } = useClipboard()
const { exportAsJson, exportAsTurtle, exportAsCsv } = useResourceExport()
const { showIndicator: showDeprecationIndicator } = useDeprecation()

// Local state
const showRawRdfDialog = ref(false)

// Export menu
const exportMenu = ref()
const exportMenuItems = [
  { label: 'Export as JSON', icon: 'pi pi-file', command: () => details.value && exportAsJson(details.value) },
  { label: 'Export as Turtle', icon: 'pi pi-code', command: () => details.value && exportAsTurtle(details.value.uri) },
  { label: 'Export as CSV', icon: 'pi pi-table', command: () => details.value && exportAsCsv(details.value) },
]

// Delayed loading - show spinner only after 300ms to prevent flicker
const showLoading = useDelayedLoading(loading)

// Get preferred label (full LabelValue for language info)
// Uses SKOS-XL prefLabel as fallback if regular prefLabel not available
const preferredLabelObj = computed(() => {
  if (!details.value) return null
  return selectLabelWithXL(details.value.prefLabels, details.value.prefLabelsXL)
})

// Get preferred label string
const preferredLabel = computed(() => {
  return preferredLabelObj.value?.value || null
})

// Get language of displayed label (for showing lang tag)
const displayLang = computed(() => {
  return preferredLabelObj.value?.lang || null
})

// Should we show the language tag in header?
const showHeaderLangTag = computed(() => {
  return displayLang.value && shouldShowLangTag(displayLang.value)
})

// Get display title (notation + label if both exist)
const displayTitle = computed(() => {
  if (!details.value) return null
  const label = preferredLabel.value
  const notation = details.value.notations[0]?.value

  if (notation && label) {
    return `${notation} - ${label}`
  }
  return notation || label || 'Unnamed Concept'
})

// Sorted label arrays (preferred lang first, then fallback, then rest alphabetically)
const sortedPrefLabels = computed(() => {
  return details.value ? sortLabels(details.value.prefLabels) : []
})

const sortedAltLabels = computed(() => {
  return details.value ? sortLabels(details.value.altLabels) : []
})

const sortedHiddenLabels = computed(() => {
  return details.value ? sortLabels(details.value.hiddenLabels) : []
})

const sortedDefinitions = computed(() => {
  return details.value ? sortLabels(details.value.definitions) : []
})

const sortedScopeNotes = computed(() => {
  return details.value ? sortLabels(details.value.scopeNotes) : []
})

const sortedHistoryNotes = computed(() => {
  return details.value ? sortLabels(details.value.historyNotes) : []
})

const sortedChangeNotes = computed(() => {
  return details.value ? sortLabels(details.value.changeNotes) : []
})

const sortedEditorialNotes = computed(() => {
  return details.value ? sortLabels(details.value.editorialNotes) : []
})

const sortedExamples = computed(() => {
  return details.value ? sortLabels(details.value.examples) : []
})

// Sorted other properties (alphabetically by qualified name)
const sortedOtherProperties = computed(() => {
  if (!details.value) return []
  return [...details.value.otherProperties].sort((a, b) => {
    const aResolved = resolvedPredicates.value.get(a.predicate)
    const bResolved = resolvedPredicates.value.get(b.predicate)
    const aName = getPredicateName(a.predicate, aResolved)
    const bName = getPredicateName(b.predicate, bResolved)
    return aName.localeCompare(bName)
  })
})

// Watch for selected concept changes
watch(
  () => conceptStore.selectedUri,
  (uri) => {
    if (uri) {
      loadDetails(uri)
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="concept-details">
    <!-- Loading state (delayed to prevent flicker) -->
    <div v-if="showLoading" class="loading-container">
      <ProgressSpinner style="width: 40px; height: 40px" />
      <span>Loading details...</span>
    </div>

    <!-- Empty state -->
    <div v-else-if="!loading && !details && !error" class="empty-state">
      <span class="material-symbols-outlined empty-icon">info</span>
      <p>No concept selected</p>
      <small>Select a concept from the tree or search</small>
    </div>

    <!-- Error state -->
    <Message v-else-if="error" severity="error" :closable="true" @close="error = null">
      {{ error }}
    </Message>

    <!-- Details -->
    <div v-else-if="details" class="details-content">
      <!-- Header -->
      <div class="details-header">
        <div class="header-icon-wrapper" :class="{ 'wrapper-leaf': !details.narrower.length }">
          <span v-if="details.narrower.length" class="material-symbols-outlined header-icon icon-label">label</span>
          <span v-else class="material-symbols-outlined header-icon icon-leaf">circle</span>
        </div>
        <div class="header-content">
          <h2 class="concept-label">
            {{ displayTitle }}
            <span v-if="showHeaderLangTag" class="header-lang-tag">{{ displayLang }}</span>
            <span v-if="details?.deprecated && showDeprecationIndicator" class="deprecation-badge" v-tooltip="'This concept is deprecated'">Deprecated</span>
          </h2>
          <div class="concept-uri">
            <span class="uri-text mono">{{ details.uri }}</span>
            <button
              class="copy-btn"
              title="Copy URI"
              @click="copyToClipboard(details.uri, 'URI')"
            >
              <span class="material-symbols-outlined icon-sm">content_copy</span>
            </button>
          </div>
        </div>
        <div class="header-actions">
          <button class="action-btn" title="View RDF" @click="showRawRdfDialog = true">
            <span class="material-symbols-outlined">code</span>
          </button>
          <button class="action-btn" title="Export" @click="(event: Event) => exportMenu.toggle(event)">
            <span class="material-symbols-outlined">download</span>
          </button>
          <a v-if="isValidURI(details.uri)" :href="details.uri" target="_blank" class="action-btn" title="Open in new tab">
            <span class="material-symbols-outlined">open_in_new</span>
          </a>
          <Menu ref="exportMenu" :model="exportMenuItems" :popup="true" />
        </div>
      </div>

      <!-- Labels Section - only shown if any label or notation exists -->
      <section v-if="details.prefLabels.length || details.altLabels.length || details.hiddenLabels.length || details.notations.length || details.prefLabelsXL.length || details.altLabelsXL.length || details.hiddenLabelsXL.length" class="details-section">
        <h3 class="section-title">
          <span class="material-symbols-outlined section-icon">translate</span>
          Labels
        </h3>

        <div v-if="details.prefLabels.length || details.prefLabelsXL.length" class="property-row">
          <label>Preferred</label>
          <div class="label-values">
            <span
              v-for="(label, i) in sortedPrefLabels"
              :key="i"
              class="label-value"
            >
              {{ label.value }}
              <span v-if="label.lang" class="lang-tag">{{ label.lang }}</span>
            </span>
          </div>
          <XLLabelsGroup
            v-if="details.prefLabelsXL.length"
            :labels="details.prefLabelsXL"
            :regular-labels="details.prefLabels"
          />
        </div>

        <div v-if="details.altLabels.length || details.altLabelsXL.length" class="property-row">
          <label>Alternative</label>
          <div class="label-values">
            <span
              v-for="(label, i) in sortedAltLabels"
              :key="i"
              class="label-value"
            >
              {{ label.value }}
              <span v-if="label.lang" class="lang-tag">{{ label.lang }}</span>
            </span>
          </div>
          <XLLabelsGroup
            v-if="details.altLabelsXL.length"
            :labels="details.altLabelsXL"
            :regular-labels="details.altLabels"
          />
        </div>

        <div v-if="details.hiddenLabels.length || details.hiddenLabelsXL.length" class="property-row">
          <label>Hidden</label>
          <div class="label-values">
            <span
              v-for="(label, i) in sortedHiddenLabels"
              :key="i"
              class="label-value hidden-label"
            >
              {{ label.value }}
              <span v-if="label.lang" class="lang-tag">{{ label.lang }}</span>
            </span>
          </div>
          <XLLabelsGroup
            v-if="details.hiddenLabelsXL.length"
            :labels="details.hiddenLabelsXL"
            :regular-labels="details.hiddenLabels"
          />
        </div>

        <div v-if="details.notations.length" class="property-row">
          <label>Notation</label>
          <div class="label-values">
            <span v-for="(n, i) in details.notations" :key="i" class="notation-wrapper">
              <code class="notation">{{ n.value }}</code>
              <span v-if="settingsStore.showDatatypes && n.datatype" class="datatype-tag">{{ n.datatype }}</span>
            </span>
          </div>
        </div>
      </section>

      <!-- Documentation Section -->
      <section v-if="details.definitions.length || details.scopeNotes.length || details.historyNotes.length || details.changeNotes.length || details.editorialNotes.length || details.examples.length" class="details-section">
        <h3 class="section-title">
          <span class="material-symbols-outlined section-icon">description</span>
          Documentation
        </h3>

        <div v-if="details.definitions.length" class="property-row">
          <label>Definition</label>
          <div class="doc-values">
            <p
              v-for="(def, i) in sortedDefinitions"
              :key="i"
              class="doc-value"
            >
              <span v-if="def.lang" class="lang-tag lang-tag-first">{{ def.lang }}</span>
              <span class="doc-text">{{ def.value }}</span>
            </p>
          </div>
        </div>

        <div v-if="details.scopeNotes.length" class="property-row">
          <label>Scope Note</label>
          <div class="doc-values">
            <p
              v-for="(note, i) in sortedScopeNotes"
              :key="i"
              class="doc-value"
            >
              <span v-if="note.lang" class="lang-tag lang-tag-first">{{ note.lang }}</span>
              <span class="doc-text">{{ note.value }}</span>
            </p>
          </div>
        </div>

        <div v-if="details.historyNotes.length" class="property-row">
          <label>History Note</label>
          <div class="doc-values">
            <p
              v-for="(note, i) in sortedHistoryNotes"
              :key="i"
              class="doc-value"
            >
              <span v-if="note.lang" class="lang-tag lang-tag-first">{{ note.lang }}</span>
              <span class="doc-text">{{ note.value }}</span>
            </p>
          </div>
        </div>

        <div v-if="details.changeNotes.length" class="property-row">
          <label>Change Note</label>
          <div class="doc-values">
            <p
              v-for="(note, i) in sortedChangeNotes"
              :key="i"
              class="doc-value"
            >
              <span v-if="note.lang" class="lang-tag lang-tag-first">{{ note.lang }}</span>
              <span class="doc-text">{{ note.value }}</span>
            </p>
          </div>
        </div>

        <div v-if="details.editorialNotes.length" class="property-row">
          <label>Editorial Note</label>
          <div class="doc-values">
            <p
              v-for="(note, i) in sortedEditorialNotes"
              :key="i"
              class="doc-value"
            >
              <span v-if="note.lang" class="lang-tag lang-tag-first">{{ note.lang }}</span>
              <span class="doc-text">{{ note.value }}</span>
            </p>
          </div>
        </div>

        <div v-if="details.examples.length" class="property-row">
          <label>Example</label>
          <div class="doc-values">
            <p
              v-for="(ex, i) in sortedExamples"
              :key="i"
              class="doc-value example"
            >
              <span v-if="ex.lang" class="lang-tag lang-tag-first">{{ ex.lang }}</span>
              <span class="doc-text">{{ ex.value }}</span>
            </p>
          </div>
        </div>
      </section>

      <!-- Hierarchy Section -->
      <section v-if="details.broader.length || details.narrower.length" class="details-section">
        <h3 class="section-title">
          <span class="material-symbols-outlined section-icon">account_tree</span>
          Hierarchy
        </h3>

        <div v-if="details.broader.length" class="property-row">
          <label>Broader</label>
          <div class="concept-chips">
            <span
              v-for="ref in details.broader"
              :key="ref.uri"
              class="concept-chip clickable"
              @click="navigateTo(ref)"
            >
              {{ getRefLabel(ref) }}<span v-if="ref.lang && shouldShowLangTag(ref.lang)" class="lang-tag">{{ ref.lang }}</span>
            </span>
          </div>
        </div>

        <div v-if="details.narrower.length" class="property-row">
          <label>Narrower</label>
          <div class="concept-chips">
            <span
              v-for="ref in details.narrower"
              :key="ref.uri"
              class="concept-chip clickable"
              @click="navigateTo(ref)"
            >
              {{ getRefLabel(ref) }}<span v-if="ref.lang && shouldShowLangTag(ref.lang)" class="lang-tag">{{ ref.lang }}</span>
            </span>
          </div>
        </div>
      </section>

      <!-- Relations Section -->
      <section v-if="details.related.length" class="details-section">
        <h3 class="section-title">
          <span class="material-symbols-outlined section-icon">link</span>
          Relations
        </h3>

        <div class="property-row">
          <label>Related</label>
          <div class="concept-chips">
            <span
              v-for="ref in details.related"
              :key="ref.uri"
              class="concept-chip clickable"
              @click="navigateTo(ref)"
            >
              {{ getRefLabel(ref) }}<span v-if="ref.lang && shouldShowLangTag(ref.lang)" class="lang-tag">{{ ref.lang }}</span>
            </span>
          </div>
        </div>
      </section>

      <!-- Mappings Section -->
      <section v-if="details.exactMatch.length || details.closeMatch.length || details.broadMatch.length || details.narrowMatch.length || details.relatedMatch.length" class="details-section">
        <h3 class="section-title">
          <span class="material-symbols-outlined section-icon">swap_horiz</span>
          Mappings
        </h3>

        <div v-if="details.exactMatch.length" class="property-row">
          <label>Exact Match</label>
          <div class="mapping-links">
            <template v-for="uri in details.exactMatch" :key="uri">
              <a v-if="isValidURI(uri)" :href="uri" target="_blank" class="mapping-link">
                {{ uri.split('/').pop() }}
                <span class="material-symbols-outlined link-icon">open_in_new</span>
              </a>
              <span v-else class="mapping-text">{{ uri.split('/').pop() }}</span>
            </template>
          </div>
        </div>

        <div v-if="details.closeMatch.length" class="property-row">
          <label>Close Match</label>
          <div class="mapping-links">
            <template v-for="uri in details.closeMatch" :key="uri">
              <a v-if="isValidURI(uri)" :href="uri" target="_blank" class="mapping-link">
                {{ uri.split('/').pop() }}
                <span class="material-symbols-outlined link-icon">open_in_new</span>
              </a>
              <span v-else class="mapping-text">{{ uri.split('/').pop() }}</span>
            </template>
          </div>
        </div>

        <div v-if="details.broadMatch.length" class="property-row">
          <label>Broad Match</label>
          <div class="mapping-links">
            <template v-for="uri in details.broadMatch" :key="uri">
              <a v-if="isValidURI(uri)" :href="uri" target="_blank" class="mapping-link">
                {{ uri.split('/').pop() }}
                <span class="material-symbols-outlined link-icon">open_in_new</span>
              </a>
              <span v-else class="mapping-text">{{ uri.split('/').pop() }}</span>
            </template>
          </div>
        </div>

        <div v-if="details.narrowMatch.length" class="property-row">
          <label>Narrow Match</label>
          <div class="mapping-links">
            <template v-for="uri in details.narrowMatch" :key="uri">
              <a v-if="isValidURI(uri)" :href="uri" target="_blank" class="mapping-link">
                {{ uri.split('/').pop() }}
                <span class="material-symbols-outlined link-icon">open_in_new</span>
              </a>
              <span v-else class="mapping-text">{{ uri.split('/').pop() }}</span>
            </template>
          </div>
        </div>

        <div v-if="details.relatedMatch.length" class="property-row">
          <label>Related Match</label>
          <div class="mapping-links">
            <template v-for="uri in details.relatedMatch" :key="uri">
              <a v-if="isValidURI(uri)" :href="uri" target="_blank" class="mapping-link">
                {{ uri.split('/').pop() }}
                <span class="material-symbols-outlined link-icon">open_in_new</span>
              </a>
              <span v-else class="mapping-text">{{ uri.split('/').pop() }}</span>
            </template>
          </div>
        </div>
      </section>

      <!-- Scheme Section -->
      <section v-if="details.inScheme.length" class="details-section">
        <h3 class="section-title">
          <span class="material-symbols-outlined section-icon">schema</span>
          Schemes
        </h3>
        <div class="property-row">
          <label>In Scheme</label>
          <div class="concept-chips">
            <span
              v-for="ref in details.inScheme"
              :key="ref.uri"
              :class="['concept-chip', { clickable: isLocalScheme(ref.uri) }]"
              @click="handleSchemeClick(ref)"
            >
              {{ getRefLabel(ref) }}<span v-if="ref.lang && shouldShowLangTag(ref.lang)" class="lang-tag">{{ ref.lang }}</span>
            </span>
          </div>
        </div>
      </section>

      <!-- Other Properties Section -->
      <section v-if="details.otherProperties.length" class="details-section">
        <h3 class="section-title">
          <span class="material-symbols-outlined section-icon">info</span>
          Other Properties
        </h3>
        <div v-for="prop in sortedOtherProperties" :key="prop.predicate" class="property-row">
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
                {{ val.value.split('/').pop()?.split('#').pop() }}
                <span class="material-symbols-outlined link-icon">open_in_new</span>
              </a>
              <span v-else class="other-value">
                {{ formatPropertyValue(val.value, val.datatype) }}
                <span v-if="val.lang" class="lang-tag">{{ val.lang }}</span>
                <span v-if="settingsStore.showDatatypes && val.datatype" class="datatype-tag">{{ val.datatype }}</span>
              </span>
            </template>
          </div>
        </div>
      </section>
    </div>

    <!-- Raw RDF Dialog -->
    <RawRdfDialog
      v-if="details"
      v-model:visible="showRawRdfDialog"
      :resource-uri="details.uri"
    />
  </div>
</template>

<style scoped>
.concept-details {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.loading-container,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 2rem;
  color: var(--ae-text-secondary);
  flex: 1;
}

.empty-icon {
  font-size: 2.5rem;
  opacity: 0.5;
}

.empty-state p {
  margin: 0;
  font-weight: 500;
}

.empty-state small {
  font-size: 0.75rem;
}

.details-content {
  flex: 1;
  overflow: auto;
  padding: 2rem;
  max-width: 900px;
}

/* Header */
.details-header {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 2rem;
}

.header-icon-wrapper {
  padding: 0.75rem;
  background: color-mix(in srgb, var(--ae-icon-label) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--ae-icon-label) 25%, transparent);
  border-radius: 0.75rem;
}

.header-icon-wrapper.wrapper-leaf {
  background: color-mix(in srgb, var(--ae-icon-leaf) 15%, transparent);
  border-color: color-mix(in srgb, var(--ae-icon-leaf) 25%, transparent);
}

.header-icon {
  font-size: 2.5rem;
}

.header-content {
  flex: 1;
  min-width: 0;
}

.concept-label {
  margin: 0 0 0.5rem 0;
  font-size: 1.75rem;
  font-weight: 600;
  color: var(--ae-text-primary);
  word-break: break-word;
}

.header-lang-tag {
  font-size: 0.625rem;
  font-weight: normal;
  background: var(--ae-bg-hover);
  color: var(--ae-text-secondary);
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  margin-left: 0.5rem;
  vertical-align: middle;
}

.deprecation-badge {
  font-size: 0.65rem;
  font-weight: 600;
  background: color-mix(in srgb, var(--ae-status-warning) 20%, transparent);
  color: var(--ae-status-warning);
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  margin-left: 0.5rem;
  vertical-align: middle;
  text-transform: uppercase;
}

.concept-uri {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 4px;
}

.uri-text {
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
  word-break: break-all;
}

.copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  color: var(--ae-text-secondary);
  transition: color 0.15s;
}

.copy-btn:hover {
  color: var(--ae-text-primary);
}

.header-actions {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--ae-text-secondary);
  text-decoration: none;
  transition: background-color 0.15s, color 0.15s;
}

.action-btn:hover {
  background: var(--ae-bg-hover);
  color: var(--ae-text-primary);
}

/* Sections */
.details-section {
  margin-bottom: 2rem;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 1rem 0;
  padding-bottom: 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ae-text-secondary);
  border-bottom: 1px solid var(--ae-border-color);
}

.section-icon {
  font-size: 18px;
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
  font-size: 1rem;
}

.label-value:not(:last-child)::after {
  content: '·';
  margin-left: 0.5rem;
  color: var(--ae-text-muted);
}

.label-value.hidden-label {
  font-style: italic;
  color: var(--ae-text-secondary);
}

.lang-tag {
  font-size: 0.625rem;
  background: var(--ae-bg-hover);
  color: var(--ae-text-secondary);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  margin-left: 0.25rem;
  vertical-align: middle;
}

.datatype-tag {
  font-size: 0.625rem;
  font-family: monospace;
  background: var(--ae-bg-hover);
  color: var(--ae-text-secondary);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  margin-left: 0.25rem;
  vertical-align: middle;
}

.lang-tag.lang-tag-first {
  margin-left: 0;
  margin-right: 0.5rem;
}

.notation-wrapper {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.notation {
  font-size: 0.875rem;
  background: var(--ae-bg-hover);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  border: 1px solid var(--ae-border-color);
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
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0;
}

.doc-value .lang-tag-first {
  grid-column: 1;
  align-self: start;
  margin-top: 0.1rem;
}

.doc-value .doc-text {
  grid-column: 2;
}

.doc-value.example {
  font-style: italic;
  color: var(--ae-text-secondary);
}

.concept-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.concept-chip {
  display: inline-flex;
  align-items: center;
  font-size: 0.875rem;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 4px;
  padding: 0.375rem 0.75rem;
}

.concept-chip.clickable {
  cursor: pointer;
}

.concept-chip.clickable:hover {
  background: var(--ae-bg-hover);
  color: var(--ae-accent);
}

.mapping-links {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.mapping-link {
  font-size: 0.875rem;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--ae-accent);
}

.link-icon {
  font-size: 14px;
}

/* Other Properties */
.predicate-label {
  font-family: monospace;
  font-size: 0.8rem;
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

.other-values {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.other-value {
  font-size: 0.875rem;
}

.other-value:not(:last-child)::after {
  content: ' · ';
  color: var(--ae-text-muted);
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
