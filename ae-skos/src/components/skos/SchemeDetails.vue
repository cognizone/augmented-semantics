<script setup lang="ts">
/**
 * SchemeDetails - SKOS concept scheme property display
 *
 * Shows comprehensive scheme information organized in sections.
 * Uses shared components for consistent rendering.
 *
 * @see /spec/ae-skos/sko02-SchemeSelector.md
 */
import { ref, watch, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useConceptStore, useSchemeStore, useSettingsStore, ORPHAN_SCHEME_URI } from '../../stores'
import { isValidURI } from '../../services'
import { useDelayedLoading, useLabelResolver, useElapsedTime, useResourceExport, useSchemeData, useDeprecation } from '../../composables'
import { getUriFragment, formatTemporalValue, formatDatatype, isStringDatatype } from '../../utils/displayUtils'
import { useToast } from 'primevue/usetoast'
import RawRdfDialog from '../common/RawRdfDialog.vue'
import DetailsStates from '../common/DetailsStates.vue'
import DetailsHeader from '../common/DetailsHeader.vue'
import LabelsSection from '../common/LabelsSection.vue'
import DocumentationSection from '../common/DocumentationSection.vue'
import OtherPropertiesSection from '../common/OtherPropertiesSection.vue'

const schemeStore = useSchemeStore()
const conceptStore = useConceptStore()
const { orphanProgress } = storeToRefs(conceptStore)
const settingsStore = useSettingsStore()
const toast = useToast()
const { selectSchemeLabel, sortLabels, shouldShowLangTag } = useLabelResolver()
const { exportAsTurtle, downloadFile } = useResourceExport()
const { details, loading, error, resolvedPredicates, loadDetails } = useSchemeData()
const { showIndicator: showDeprecationIndicator } = useDeprecation()

// Local state
const showRawRdfDialog = ref(false)

// Track elapsed time when loading
const loadingElapsed = useElapsedTime(loading)

// Export menu items
const exportMenuItems = [
  { label: 'Export as JSON', icon: 'pi pi-file', command: () => exportAsJson() },
  { label: 'Export as Turtle', icon: 'pi pi-code', command: () => details.value && exportAsTurtle(details.value.uri) },
]

// Delayed loading
const showLoading = useDelayedLoading(loading)

const isOrphanView = computed(() => schemeStore.viewingSchemeUri === ORPHAN_SCHEME_URI)
const orphanPhase = computed(() => {
  const phase = orphanProgress.value?.phase ?? 'idle'
  const hasCounts = (orphanProgress.value?.totalConcepts ?? 0) > 0
    || (orphanProgress.value?.remainingCandidates ?? 0) > 0
    || (orphanProgress.value?.orphanCollections ?? 0) > 0

  if (phase === 'idle' && hasCounts) {
    return 'complete'
  }

  return phase
})
const orphanPhaseLabel = computed(() => getPhaseLabel(orphanPhase.value, orphanProgress.value?.currentQueryName ?? null))
const orphanTotal = computed(() => (orphanProgress.value?.remainingCandidates ?? 0) + (orphanProgress.value?.orphanCollections ?? 0))
const orphanStrategyLabel = computed(() => settingsStore.orphanDetectionStrategy || 'auto')
const showDatatypeTag = computed(() => settingsStore.showDatatypes)
const showStringDatatype = computed(() => settingsStore.showStringDatatypes)

// Preferred label for header
const preferredLabelObj = computed(() => {
  if (!details.value) return null
  return selectSchemeLabel({
    prefLabels: details.value.prefLabels,
    prefLabelsXL: details.value.prefLabelsXL,
    dctTitles: details.value.dctTitles,
    dcTitles: details.value.dcTitles,
    rdfsLabels: details.value.rdfsLabels,
  })
})

const preferredLabel = computed(() => preferredLabelObj.value?.value || '…')
const displayLang = computed(() => preferredLabelObj.value?.lang || null)
const showHeaderLangTag = computed(() => displayLang.value ? shouldShowLangTag(displayLang.value) : false)

// Helper to create sorted computed properties
const getSorted = (field: keyof NonNullable<typeof details.value>) =>
  computed(() => {
    const value = details.value?.[field]
    return value && Array.isArray(value) ? sortLabels(value as any) : []
  })

// Sorted arrays
const sortedPrefLabels = getSorted('prefLabels')
const sortedAltLabels = getSorted('altLabels')
const sortedHiddenLabels = getSorted('hiddenLabels')
const sortedRdfsLabels = getSorted('rdfsLabels')
const sortedDefinitions = getSorted('definitions')
const sortedDescriptions = getSorted('description')
const sortedComments = getSorted('comments')
const sortedScopeNotes = getSorted('scopeNotes')
const sortedHistoryNotes = getSorted('historyNotes')
const sortedChangeNotes = getSorted('changeNotes')
const sortedEditorialNotes = getSorted('editorialNotes')
const sortedNotes = getSorted('notes')
const sortedExamples = getSorted('examples')
const sortedDctTitles = getSorted('dctTitles')
const sortedDcTitles = getSorted('dcTitles')

// Sorted other properties
const sortedOtherProperties = computed(() => {
  if (!details.value) return []
  return [...details.value.otherProperties].sort((a, b) => {
    const aResolved = resolvedPredicates.value.get(a.predicate)
    const bResolved = resolvedPredicates.value.get(b.predicate)
    const aName = aResolved?.localName || a.predicate
    const bName = bResolved?.localName || b.predicate
    return aName.localeCompare(bName)
  })
})

// Label config for LabelsSection (SKOS labels only - rdfs:label has its own section)
const labelConfig = computed(() => {
  if (!details.value) return []
  const config = []
  if (details.value.prefLabels.length || details.value.prefLabelsXL.length) {
    config.push({
      label: 'Preferred',
      values: sortedPrefLabels.value,
      hasXL: (details.value.prefLabelsXL?.length ?? 0) > 0,
      xlLabels: details.value.prefLabelsXL ?? [],
      regularLabels: details.value.prefLabels ?? []
    })
  }
  if (details.value.altLabels.length || details.value.altLabelsXL.length) {
    config.push({
      label: 'Alternative',
      values: sortedAltLabels.value,
      hasXL: (details.value.altLabelsXL?.length ?? 0) > 0,
      xlLabels: details.value.altLabelsXL ?? [],
      regularLabels: details.value.altLabels ?? []
    })
  }
  if (details.value.hiddenLabels.length || details.value.hiddenLabelsXL.length) {
    config.push({
      label: 'Hidden',
      values: sortedHiddenLabels.value,
      hasXL: (details.value.hiddenLabelsXL?.length ?? 0) > 0,
      xlLabels: details.value.hiddenLabelsXL ?? [],
      regularLabels: details.value.hiddenLabels ?? [],
      isHidden: true
    })
  }
  return config
})

// Has any labels to show (for section visibility including notation)
const hasLabels = computed(() =>
  labelConfig.value.length > 0 || (details.value?.notations?.length ?? 0) > 0
)

// Documentation config for DocumentationSection
const documentationConfig = computed(() => [
  { label: 'Definition', values: sortedDefinitions.value },
  { label: 'Description', values: sortedDescriptions.value },
  { label: 'Comment', values: sortedComments.value },
  { label: 'Scope Note', values: sortedScopeNotes.value },
  { label: 'History Note', values: sortedHistoryNotes.value },
  { label: 'Change Note', values: sortedChangeNotes.value },
  { label: 'Editorial Note', values: sortedEditorialNotes.value },
  { label: 'Note', values: sortedNotes.value },
  { label: 'Example', values: sortedExamples.value, class: 'example' },
].filter(prop => prop.values.length > 0))

// Metadata links config
const metadataLinksConfig = computed(() => [
  { label: 'Creator', values: details.value?.creator || [] },
  { label: 'Publisher', values: details.value?.publisher || [] },
  { label: 'See Also', values: details.value?.seeAlso || [] },
  { label: 'Rights', values: details.value?.rights || [] },
  { label: 'License', values: details.value?.license || [] },
  { label: 'License (CC)', values: details.value?.ccLicense || [] },
].filter(m => m.values.length > 0))

// Export as JSON
function exportAsJson() {
  if (!details.value) return

  const jsonData = {
    uri: details.value.uri,
    prefLabels: details.value.prefLabels,
    altLabels: details.value.altLabels,
    definitions: details.value.definitions,
    scopeNotes: details.value.scopeNotes,
    dctTitles: details.value.dctTitles,
    dcTitles: details.value.dcTitles,
    description: details.value.description,
    creator: details.value.creator,
    created: details.value.created,
    modified: details.value.modified,
  }

  const content = JSON.stringify(jsonData, null, 2)
  const filename = `scheme-${details.value.uri.split('/').pop() || 'export'}.json`
  downloadFile(content, filename, 'application/json')

  toast.add({
    severity: 'success',
    summary: 'Exported',
    detail: 'Scheme exported as JSON',
    life: 2000
  })
}

function clearError() {
  error.value = null
}

function getPhaseLabel(phase: string | undefined, currentQueryName: string | null): string {
  const isSingleQuery = currentQueryName === 'single-query-orphan-detection'

  switch (phase) {
    case 'fetching-all':
      return 'Phase 1/4: Fetching Concepts'
    case 'running-exclusions':
      return isSingleQuery ? 'Detecting Orphan Concepts' : 'Phase 2/4: Running Exclusion Queries'
    case 'calculating':
      return 'Phase 3/4: Calculating Orphans'
    case 'detecting-collections':
      return 'Phase 4/4: Detecting Orphan Collections'
    case 'complete':
      return 'Complete'
    default:
      return 'Waiting to start...'
  }
}

function formatQueryName(name: string): string {
  return name
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' → ')
}

function shouldShowDatatypeTag(datatype?: string): boolean {
  if (!showDatatypeTag.value || !datatype) return false
  if (!showStringDatatype.value && isStringDatatype(datatype)) return false
  return true
}

function formatTemporalDisplay(value?: { value: string; datatype?: string }): string {
  if (!value) return ''
  if (!value.datatype) return value.value
  const datatypeLabel = formatDatatype(value.datatype)
  if (datatypeLabel === 'xsd:date' || datatypeLabel === 'xsd:dateTime' || datatypeLabel === 'xsd:time') {
    return formatTemporalValue(value.value, value.datatype)
  }
  return value.value
}

function getDatatypeTag(value?: { value: string; datatype?: string }): string | undefined {
  if (!value) return undefined
  return value.datatype || 'xsd:string'
}

function getDatatypeLabel(value?: { value: string; datatype?: string }): string {
  const datatype = getDatatypeTag(value)
  return datatype ? formatDatatype(datatype) : ''
}

// Watch for viewing scheme changes
watch(
  () => schemeStore.viewingSchemeUri,
  (uri) => {
    if (uri) {
      // Handle orphan pseudo-scheme specially (no SPARQL data to load)
      if (uri === ORPHAN_SCHEME_URI) {
        details.value = null
        error.value = null
        return
      }
      loadDetails(uri)
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="scheme-details">
    <DetailsStates
      :loading="!isOrphanView && loading"
      :show-loading="!isOrphanView && showLoading"
      :has-data="isOrphanView || !!details"
      :error="error"
      loading-text="Loading scheme..."
      empty-icon="schema"
      empty-title="No scheme selected"
      empty-subtitle="Select a scheme from the dropdown or click 'In Scheme' on a concept"
      :elapsed="loadingElapsed"
      @clear-error="clearError"
    >
      <div v-if="isOrphanView" class="details-content orphan-details">
        <div class="orphan-header">
          <div class="orphan-header-icon">
            <span class="material-symbols-outlined">link_off</span>
          </div>
          <div class="orphan-header-content">
            <h2 class="orphan-title">Orphan Concepts &amp; Collections</h2>
            <span class="orphan-subtitle">Not linked to any concept scheme</span>
          </div>
        </div>

        <section class="orphan-info">
          <div class="orphan-info-header">
            <div class="orphan-info-title">
              <span class="material-symbols-outlined info-icon">info</span>
              <span>Orphan Detection</span>
            </div>
            <span class="orphan-strategy">Strategy: {{ orphanStrategyLabel }}</span>
            <span class="orphan-phase">{{ orphanPhaseLabel }}</span>
          </div>

          <div v-if="orphanPhase === 'fetching-all'" class="orphan-progress-block">
            <div v-if="orphanProgress.totalConcepts > 0" class="progress-row">
              <span class="progress-label">Fetching:</span>
              <span class="progress-value">
                {{ orphanProgress.fetchedConcepts.toLocaleString() }} / {{ orphanProgress.totalConcepts.toLocaleString() }} concepts
                ({{ Math.round((orphanProgress.fetchedConcepts / orphanProgress.totalConcepts) * 100) }}%)
              </span>
            </div>
            <div v-else class="progress-row">
              <span class="progress-label">Fetching all SKOS concepts...</span>
            </div>
            <div v-if="orphanProgress.totalConcepts > 0 && orphanProgress.fetchedConcepts > 0" class="progress-bar">
              <div
                class="progress-bar-fill"
                :style="{ width: `${(orphanProgress.fetchedConcepts / orphanProgress.totalConcepts) * 100}%` }"
              ></div>
            </div>
          </div>

          <div v-else-if="orphanPhase === 'running-exclusions'" class="orphan-progress-block">
            <template v-if="orphanProgress.currentQueryName === 'single-query-orphan-detection'">
              <div class="progress-row">
                <span class="progress-label">All concepts in endpoint:</span>
                <span class="progress-value">{{ orphanProgress.totalConcepts.toLocaleString() }}</span>
              </div>
              <div class="progress-row">
                <span class="progress-label">Orphans found:</span>
                <span class="progress-value">{{ orphanProgress.remainingCandidates.toLocaleString() }}</span>
              </div>
              <div class="progress-note">Fetching orphan concepts with optimized single query...</div>
            </template>

            <template v-else>
              <div class="progress-row">
                <span class="progress-label">Starting:</span>
                <span class="progress-value">{{ orphanProgress.totalConcepts.toLocaleString() }} concepts</span>
              </div>
              <div class="progress-row">
                <span class="progress-label">Remaining:</span>
                <span class="progress-value">{{ orphanProgress.remainingCandidates.toLocaleString() }} candidates</span>
              </div>
              <div v-if="orphanProgress.currentQueryName" class="progress-note">
                Running: {{ formatQueryName(orphanProgress.currentQueryName) }}
              </div>
            </template>
          </div>

          <div v-else-if="orphanPhase === 'calculating'" class="orphan-progress-block">
            <div class="progress-note">Performing final calculation...</div>
          </div>

          <div v-else-if="orphanPhase === 'detecting-collections'" class="orphan-progress-block">
            <div class="progress-row">
              <span class="progress-label">Orphan concepts:</span>
              <span class="progress-value">{{ orphanProgress.remainingCandidates.toLocaleString() }}</span>
            </div>
            <div class="progress-row">
              <span class="progress-label">Orphan collections:</span>
              <span class="progress-value">{{ orphanProgress.orphanCollections.toLocaleString() }} found...</span>
            </div>
            <div class="progress-note">Scanning for collections with no members in any scheme...</div>
          </div>

          <div v-else-if="orphanPhase === 'complete'" class="orphan-progress-block">
            <div class="progress-row">
              <span class="progress-label">Orphans found:</span>
              <span class="progress-value">{{ orphanTotal.toLocaleString() }}</span>
            </div>
          </div>
          <div v-else class="orphan-progress-block">
            <div class="progress-note">Waiting for orphan detection to start...</div>
          </div>

          <div v-if="orphanProgress.completedQueries.length > 0" class="orphan-queries">
            <h4 class="queries-title">Exclusion Queries ({{ orphanProgress.completedQueries.length }})</h4>
            <ul class="query-list">
              <li v-for="q in orphanProgress.completedQueries" :key="q.name" class="query-item">
                <span class="query-name">{{ formatQueryName(q.name) }}</span>
                <span class="query-stats">
                  <span class="query-excluded">-{{ q.excludedCount.toLocaleString() }}</span>
                  <span class="query-separator">|</span>
                  <span class="query-cumulative">{{ q.cumulativeExcluded.toLocaleString() }} removed</span>
                  <span class="query-separator">|</span>
                  <span class="query-remaining">{{ q.remainingAfter.toLocaleString() }} left</span>
                </span>
              </li>
            </ul>
          </div>

          <div v-if="orphanProgress.skippedQueries.length > 0" class="orphan-queries">
            <h4 class="queries-title">Skipped Queries ({{ orphanProgress.skippedQueries.length }})</h4>
            <ul class="query-list">
              <li v-for="name in orphanProgress.skippedQueries" :key="name" class="query-item skipped-item">
                <span class="query-name">{{ formatQueryName(name) }}</span>
                <span class="query-skipped">skipped (0 candidates)</span>
              </li>
            </ul>
          </div>

          <div v-if="orphanProgress.totalConcepts > 0" class="orphan-summary">
            <div class="summary-item">
              <span class="summary-label">Total Concepts:</span>
              <span class="summary-value">{{ orphanProgress.totalConcepts.toLocaleString() }}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Orphan Concepts:</span>
              <span class="summary-value">{{ orphanProgress.remainingCandidates.toLocaleString() }}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Orphan Collections:</span>
              <span class="summary-value">{{ orphanProgress.orphanCollections.toLocaleString() }}</span>
            </div>
          </div>
        </section>
      </div>

      <!-- Details content - wrapped in v-if because Vue evaluates slot expressions before child renders -->
      <div v-else-if="details" class="details-content">
        <DetailsHeader
          icon="folder"
          icon-class="icon-folder"
          :title="preferredLabel"
          :uri="details.uri"
          :lang-tag="displayLang || undefined"
          :show-lang-tag="showHeaderLangTag"
          :deprecated="details.deprecated && showDeprecationIndicator"
          deprecated-tooltip="This concept scheme is deprecated"
          :export-menu-items="exportMenuItems"
          @show-raw-rdf="showRawRdfDialog = true"
        />

        <!-- Dublin Core Terms Title (dct:title) -->
        <section v-if="sortedDctTitles.length" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">title</span>
            Title (dct:title)
          </h3>
          <div class="property-row">
            <div class="doc-values">
              <p v-for="(title, i) in sortedDctTitles" :key="i" class="doc-value">
                <span v-if="title.lang" class="lang-tag lang-tag-first">{{ title.lang }}</span>
                <span class="doc-text">{{ title.value }}</span>
              </p>
            </div>
          </div>
        </section>

        <!-- Dublin Core Elements Title (dc:title) -->
        <section v-if="sortedDcTitles.length" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">title</span>
            Title (dc:title)
          </h3>
          <div class="property-row">
            <div class="doc-values">
              <p v-for="(title, i) in sortedDcTitles" :key="i" class="doc-value">
                <span v-if="title.lang" class="lang-tag lang-tag-first">{{ title.lang }}</span>
                <span class="doc-text">{{ title.value }}</span>
              </p>
            </div>
          </div>
        </section>

        <!-- RDFS Label (rdfs:label) - separate section for consistency with Concept/Collection -->
        <section v-if="sortedRdfsLabels.length" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">label</span>
            Label (rdfs:label)
          </h3>
          <div class="property-row">
            <div class="doc-values">
              <p v-for="(lbl, i) in sortedRdfsLabels" :key="i" class="doc-value">
                <span v-if="lbl.lang && shouldShowLangTag(lbl.lang)" class="lang-tag lang-tag-first">{{ lbl.lang }}</span>
                <span class="doc-text">{{ lbl.value }}</span>
              </p>
            </div>
          </div>
        </section>

        <LabelsSection v-if="hasLabels" :items="labelConfig">
          <div v-if="details.notations?.length" class="property-row">
            <label>Notation</label>
            <div class="label-values">
              <span v-for="(n, i) in details.notations" :key="i" class="notation-wrapper">
                <code class="notation">{{ n.value }}</code>
                <span v-if="n.datatype && shouldShowDatatypeTag(n.datatype)" class="datatype-tag">{{ formatDatatype(n.datatype) }}</span>
              </span>
            </div>
          </div>
        </LabelsSection>

        <DocumentationSection :items="documentationConfig" />

        <!-- Metadata Section (scheme-specific) -->
        <section v-if="metadataLinksConfig.length || details.identifier?.length || details.status || details.versionInfo || details.created || details.modified || details.issued || details.deprecated !== undefined" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">info</span>
            Metadata
          </h3>

          <div v-for="meta in metadataLinksConfig" :key="meta.label" class="property-row">
            <label>{{ meta.label }}</label>
            <div class="metadata-values">
              <template v-for="(val, i) in meta.values" :key="i">
                <a v-if="isValidURI(val)" :href="val" target="_blank" class="metadata-link">
                  {{ getUriFragment(val) }}
                  <span class="material-symbols-outlined link-icon">open_in_new</span>
                </a>
                <span v-else class="metadata-value">{{ val }}</span>
              </template>
            </div>
          </div>

          <div v-if="details.identifier?.length" class="property-row">
            <label>Identifier</label>
            <div class="metadata-values">
              <span v-for="(id, i) in details.identifier" :key="i" class="metadata-value">{{ id }}</span>
            </div>
          </div>

          <div v-if="details.status" class="property-row">
            <label>Status</label>
            <span class="metadata-value">{{ details.status }}</span>
          </div>

          <div v-if="details.versionInfo" class="property-row">
            <label>Version</label>
            <span class="metadata-value">
              {{ details.versionInfo.value }}
              <span v-if="shouldShowDatatypeTag(getDatatypeTag(details.versionInfo))" class="datatype-tag">
                {{ getDatatypeLabel(details.versionInfo) }}
              </span>
            </span>
          </div>

          <div v-if="details.issued" class="property-row">
            <label>Issued</label>
            <span class="metadata-value">
              {{ formatTemporalDisplay(details.issued) }}
              <span v-if="shouldShowDatatypeTag(getDatatypeTag(details.issued))" class="datatype-tag">
                {{ getDatatypeLabel(details.issued) }}
              </span>
            </span>
          </div>

          <div v-if="details.created" class="property-row">
            <label>Created</label>
            <span class="metadata-value">
              {{ formatTemporalDisplay(details.created) }}
              <span v-if="shouldShowDatatypeTag(getDatatypeTag(details.created))" class="datatype-tag">
                {{ getDatatypeLabel(details.created) }}
              </span>
            </span>
          </div>

          <div v-if="details.modified" class="property-row">
            <label>Modified</label>
            <span class="metadata-value">
              {{ formatTemporalDisplay(details.modified) }}
              <span v-if="shouldShowDatatypeTag(getDatatypeTag(details.modified))" class="datatype-tag">
                {{ getDatatypeLabel(details.modified) }}
              </span>
            </span>
          </div>

          <div v-if="details.deprecated !== undefined" class="property-row">
            <label>Deprecated</label>
            <span class="metadata-value">{{ details.deprecated ? 'true' : 'false' }}</span>
          </div>
        </section>

        <OtherPropertiesSection
          :properties="sortedOtherProperties"
          :resolved-predicates="resolvedPredicates"
        />
      </div>
    </DetailsStates>

    <!-- Raw RDF Dialog -->
    <RawRdfDialog
      v-if="details"
      v-model:visible="showRawRdfDialog"
      :resource-uri="details.uri"
    />
  </div>
</template>

<style scoped>
.scheme-details {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.details-content {
  flex: 1;
  overflow: auto;
  padding: 2rem;
  max-width: 900px;
}

.orphan-details {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.orphan-header {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.orphan-header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--ae-icon-leaf) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--ae-icon-leaf) 25%, transparent);
  color: var(--ae-icon-leaf);
}

.orphan-header-icon .material-symbols-outlined {
  font-size: 1.75rem;
}

.orphan-title {
  margin: 0;
  font-size: 1.375rem;
  font-weight: 600;
  color: var(--ae-text-primary);
}

.orphan-subtitle {
  font-size: 0.8125rem;
  color: var(--ae-text-secondary);
}

.orphan-info {
  border: 1px solid var(--ae-border-color);
  border-radius: 10px;
  padding: 1rem 1.25rem;
  background: var(--ae-bg-elevated);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.orphan-info-header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
}

.orphan-info-title {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  color: var(--ae-text-primary);
}

.orphan-info-title .info-icon {
  font-size: 1.1rem;
  color: var(--ae-accent);
}

.orphan-strategy,
.orphan-phase {
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
}

.orphan-progress-block {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.progress-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  font-size: 0.8125rem;
  color: var(--ae-text-primary);
}

.progress-label {
  color: var(--ae-text-secondary);
}

.progress-note {
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
}

.progress-bar {
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ae-accent) 12%, transparent);
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: var(--ae-accent);
}

.orphan-queries {
  border-top: 1px dashed var(--ae-border-color);
  padding-top: 0.75rem;
}

.queries-title {
  margin: 0 0 0.5rem 0;
  font-size: 0.8125rem;
  color: var(--ae-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.query-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.query-item {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: var(--ae-text-primary);
}

.query-name {
  font-weight: 600;
}

.query-stats,
.query-skipped {
  color: var(--ae-text-secondary);
}

.query-separator {
  margin: 0 0.2rem;
}

.orphan-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.5rem;
  border-top: 1px dashed var(--ae-border-color);
  padding-top: 0.75rem;
}

.summary-item {
  display: flex;
  justify-content: space-between;
  font-size: 0.8125rem;
  color: var(--ae-text-primary);
}

.summary-label {
  color: var(--ae-text-secondary);
}

/* Scheme-specific sections */
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
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0;
}

.doc-value .lang-tag-first {
  grid-column: 1;
  align-self: start;
  margin-top: 0.1rem;
  margin-right: 0.5rem;
}

.doc-value .doc-text {
  grid-column: 2;
}

.metadata-values {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.metadata-value {
  font-size: 0.875rem;
}

.metadata-link {
  font-size: 0.875rem;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--ae-accent);
}

.link-icon {
  font-size: 14px;
}

.label-values {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
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
</style>
