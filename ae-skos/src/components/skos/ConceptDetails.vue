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
import { useConceptStore, useSettingsStore, useSchemeStore } from '../../stores'
import type { ConceptRef } from '../../types'
import { isValidURI } from '../../services'
import { useDelayedLoading, useLabelResolver, useConceptData, useConceptNavigation, useResourceExport, useDeprecation, useElapsedTime } from '../../composables'
import { getRefLabel, getUriFragment, formatDatatype, formatTemporalValue, isStringDatatype } from '../../utils/displayUtils'
import RawRdfDialog from '../common/RawRdfDialog.vue'
import DetailsStates from '../common/DetailsStates.vue'
import DetailsHeader from '../common/DetailsHeader.vue'
import LabelsSection from '../common/LabelsSection.vue'
import DocumentationSection from '../common/DocumentationSection.vue'
import OtherPropertiesSection from '../common/OtherPropertiesSection.vue'

const emit = defineEmits<{
  selectConcept: [uri: string]
}>()

const conceptStore = useConceptStore()
const settingsStore = useSettingsStore()
const schemeStore = useSchemeStore()
const { selectLabelWithXL, sortLabels, shouldShowLangTag } = useLabelResolver()
const { details, loading, error, resolvedPredicates, loadDetails } = useConceptData()
const { navigateTo, handleSchemeClick, isLocalScheme, navigateToCollection } = useConceptNavigation(emit)
const { exportAsJson, exportAsTurtle, exportAsCsv } = useResourceExport()
const { showIndicator: showDeprecationIndicator } = useDeprecation()

// Local state
const showRawRdfDialog = ref(false)

// Track elapsed time when loading
const loadingElapsed = useElapsedTime(loading)

// Export menu items
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
  return displayLang.value ? shouldShowLangTag(displayLang.value) : false
})

const includeNotation = computed(() => settingsStore.showNotationInLabels)
const showDatatypeTag = computed(() => settingsStore.showDatatypes)
const showStringDatatype = computed(() => settingsStore.showStringDatatypes)

// Get display title (notation + label if both exist)
const displayTitle = computed(() => {
  if (!details.value) return ''
  const label = preferredLabel.value
  const notation = details.value.notations[0]?.value
  const fallback = label || '…'
  if (!includeNotation.value) {
    return fallback
  }
  if (notation && label) {
    return `${notation} - ${label}`
  }
  return notation || fallback
})

function formatRefLabel(ref: ConceptRef): string {
  if (ref.label || ref.notation) {
    return getRefLabel(ref, { includeNotation: includeNotation.value })
  }
  return '…'
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

// Icon props based on whether concept has children
const headerIcon = computed(() => details.value?.narrower?.length ? 'label' : 'circle')
const headerIconClass = computed(() => details.value?.narrower?.length ? 'icon-label' : 'icon-leaf')
const headerWrapperClass = computed(() => details.value?.narrower?.length ? 'wrapper-label' : 'wrapper-leaf')

// Factory for sorted label computeds
const getSorted = <K extends keyof NonNullable<typeof details.value>>(field: K) =>
  computed(() => details.value ? sortLabels(details.value[field] as any) : [])

// Sorted label arrays
const sortedPrefLabels = getSorted('prefLabels')
const sortedAltLabels = getSorted('altLabels')
const sortedHiddenLabels = getSorted('hiddenLabels')
const sortedDctTitles = getSorted('dctTitles')
const sortedDcTitles = getSorted('dcTitles')
const sortedRdfsLabels = getSorted('rdfsLabels')
const sortedComments = getSorted('comments')
const sortedDescription = getSorted('description')
const sortedDefinitions = getSorted('definitions')
const sortedScopeNotes = getSorted('scopeNotes')
const sortedHistoryNotes = getSorted('historyNotes')
const sortedChangeNotes = getSorted('changeNotes')
const sortedEditorialNotes = getSorted('editorialNotes')
const sortedNotes = getSorted('notes')
const sortedExamples = getSorted('examples')

// Label config for LabelsSection
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

// Has any labels to show (for section visibility)
const hasLabels = computed(() =>
  labelConfig.value.length > 0 || (details.value?.notations?.length ?? 0) > 0
)

// Documentation config for DocumentationSection
const documentationConfig = computed(() => [
  { label: 'Definition', values: sortedDefinitions.value },
  { label: 'Comment', values: sortedComments.value },
  { label: 'Description', values: sortedDescription.value },
  { label: 'Scope Note', values: sortedScopeNotes.value },
  { label: 'History Note', values: sortedHistoryNotes.value },
  { label: 'Change Note', values: sortedChangeNotes.value },
  { label: 'Editorial Note', values: sortedEditorialNotes.value },
  { label: 'Note', values: sortedNotes.value },
  { label: 'Example', values: sortedExamples.value, class: 'example' },
].filter(d => d.values.length > 0))

// Mappings config for DRY template rendering
const mappingsConfig = computed(() => [
  { label: 'Exact Match', uris: details.value?.exactMatch || [] },
  { label: 'Close Match', uris: details.value?.closeMatch || [] },
  { label: 'Broad Match', uris: details.value?.broadMatch || [] },
  { label: 'Narrow Match', uris: details.value?.narrowMatch || [] },
  { label: 'Related Match', uris: details.value?.relatedMatch || [] },
].filter(m => m.uris.length > 0))

// Has any metadata to show
const hasMetadata = computed(() =>
  (details.value?.identifier?.length ?? 0) > 0 ||
  details.value?.deprecated !== undefined ||
  details.value?.created ||
  details.value?.modified ||
  details.value?.issued ||
  details.value?.versionInfo ||
  details.value?.status ||
  (details.value?.creator?.length ?? 0) > 0 ||
  (details.value?.publisher?.length ?? 0) > 0 ||
  (details.value?.rights?.length ?? 0) > 0 ||
  (details.value?.license?.length ?? 0) > 0 ||
  (details.value?.ccLicense?.length ?? 0) > 0 ||
  (details.value?.seeAlso?.length ?? 0) > 0
)

// Metadata links config (for properties that can be URIs)
const metadataLinksConfig = computed(() => [
  { label: 'Creator', values: details.value?.creator || [] },
  { label: 'Publisher', values: details.value?.publisher || [] },
  { label: 'See Also', values: details.value?.seeAlso || [] },
  { label: 'Rights', values: details.value?.rights || [] },
  { label: 'License', values: details.value?.license || [] },
  { label: 'License (CC)', values: details.value?.ccLicense || [] },
].filter(m => m.values.length > 0))

// Sorted other properties (alphabetically by qualified name)
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

function clearError() {
  error.value = null
}

/**
 * Check if a concept ref belongs to a different scheme than the current selection
 * Uses inCurrentScheme boolean from EXISTS check - concept is external if NOT in current scheme
 */
function isExternalScheme(ref: ConceptRef): boolean {
  // Skip if no scheme selected (no badges shown)
  if (!schemeStore.selectedUri) return false
  // Schemes and collections don't show external indicator
  if (ref.type === 'scheme' || ref.type === 'collection') return false
  // External if inCurrentScheme is explicitly false (undefined means we didn't check)
  return ref.inCurrentScheme === false
}

/**
 * Extract short name from scheme URI for display
 * e.g., "http://www.yso.fi/onto/afo/" → "afo"
 */
function getSchemeShortName(schemeUri: string): string {
  const match = schemeUri.match(/\/([^/]+)\/?$/)
  return match?.[1] ?? schemeUri
}

/**
 * Group for displaying refs organized by scheme
 */
interface RefGroup {
  schemeUri: string | null  // null = current scheme (default group)
  schemeLabel: string       // short name for header display
  refs: ConceptRef[]
}

/**
 * Group refs by scheme: current scheme first, then external schemes
 * Items within each group are already sorted by the composable
 */
function groupRefsByScheme(refs: ConceptRef[]): RefGroup[] {
  if (!refs.length) return []

  // Separate current scheme from external
  const currentSchemeRefs: ConceptRef[] = []
  const externalByScheme = new Map<string, ConceptRef[]>()

  for (const ref of refs) {
    if (ref.inCurrentScheme !== false) {
      // Current scheme or unknown (treat as current)
      currentSchemeRefs.push(ref)
    } else if (ref.displayScheme) {
      // External with known scheme
      const existing = externalByScheme.get(ref.displayScheme)
      if (existing) {
        existing.push(ref)
      } else {
        externalByScheme.set(ref.displayScheme, [ref])
      }
    } else {
      // External but no scheme info - treat as current
      currentSchemeRefs.push(ref)
    }
  }

  const groups: RefGroup[] = []

  // Current scheme group (no header needed)
  if (currentSchemeRefs.length) {
    groups.push({
      schemeUri: null,
      schemeLabel: '',
      refs: currentSchemeRefs
    })
  }

  // External scheme groups (sorted by scheme URI for consistent order)
  const sortedSchemes = [...externalByScheme.keys()].sort()
  for (const schemeUri of sortedSchemes) {
    groups.push({
      schemeUri,
      schemeLabel: getSchemeShortName(schemeUri),
      refs: externalByScheme.get(schemeUri)!
    })
  }

  return groups
}

// Grouped refs for hierarchy and relations
// Note: narrower concepts are always same-scheme by SKOS semantics, so no grouping needed
const groupedBroader = computed(() => details.value ? groupRefsByScheme(details.value.broader) : [])
const groupedRelated = computed(() => details.value ? groupRefsByScheme(details.value.related) : [])

// Watch for selected concept changes
watch(
  () => conceptStore.selectedUri,
  (uri) => {
    if (uri) {
      loadDetails(uri)
    } else {
      // Clear details when no concept selected (e.g., endpoint switch)
      details.value = null
      error.value = null
    }
  },
  { immediate: true }
)

// Reload when scheme URI fix setting changes
watch(
  () => settingsStore.enableSchemeUriSlashFix,
  () => {
    const uri = conceptStore.selectedUri
    if (uri) {
      loadDetails(uri)
    }
  }
)

</script>

<template>
  <div class="concept-details">
    <DetailsStates
      :loading="loading"
      :show-loading="showLoading"
      :has-data="!!details"
      :error="error"
      loading-text="Loading details..."
      empty-icon="info"
      empty-title="No concept selected"
      empty-subtitle="Select a concept from the tree or search"
      :elapsed="loadingElapsed"
      @clear-error="clearError"
    >
      <!-- Details content - wrapped in v-if because Vue evaluates slot expressions before child renders -->
      <div v-if="details" class="details-content">
        <DetailsHeader
          :icon="headerIcon"
          :icon-class="headerIconClass"
          :wrapper-class="headerWrapperClass"
          :title="displayTitle"
          :uri="details.uri"
          :lang-tag="displayLang || undefined"
          :show-lang-tag="showHeaderLangTag"
          :deprecated="details.deprecated && showDeprecationIndicator"
          deprecated-tooltip="This concept is deprecated"
          :export-menu-items="exportMenuItems"
          @show-raw-rdf="showRawRdfDialog = true"
        />

        <!-- Labels Section with Notation slot -->
        <LabelsSection v-if="hasLabels" :items="labelConfig">
          <div v-if="details.notations.length" class="property-row">
            <label>Notation</label>
            <div class="label-values">
              <span v-for="(n, i) in details.notations" :key="i" class="notation-wrapper">
                <code class="notation">{{ n.value }}</code>
                <span v-if="n.datatype && shouldShowDatatypeTag(n.datatype)" class="datatype-tag">{{ formatDatatype(n.datatype) }}</span>
              </span>
            </div>
          </div>
        </LabelsSection>

        <!-- Title/Label Sections (displayed separately by predicate) -->
        <section v-if="sortedDctTitles.length" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">title</span>
            Title (dct:title)
          </h3>
          <div class="property-row">
            <div class="doc-values">
              <p v-for="(title, i) in sortedDctTitles" :key="i" class="doc-value">
                <span v-if="title.lang && shouldShowLangTag(title.lang)" class="lang-tag lang-tag-first">{{ title.lang }}</span>
                <span class="doc-text">{{ title.value }}</span>
              </p>
            </div>
          </div>
        </section>

        <section v-if="sortedDcTitles.length" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">title</span>
            Title (dc:title)
          </h3>
          <div class="property-row">
            <div class="doc-values">
              <p v-for="(title, i) in sortedDcTitles" :key="i" class="doc-value">
                <span v-if="title.lang && shouldShowLangTag(title.lang)" class="lang-tag lang-tag-first">{{ title.lang }}</span>
                <span class="doc-text">{{ title.value }}</span>
              </p>
            </div>
          </div>
        </section>

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

        <DocumentationSection :items="documentationConfig" />

        <!-- Hierarchy Section (concept-specific) -->
        <section v-if="details.broader.length || details.narrower.length" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">account_tree</span>
            Hierarchy
          </h3>

          <div v-if="details.broader.length" class="property-row">
            <label>Broader</label>
            <div class="grouped-refs">
              <div v-for="group in groupedBroader" :key="group.schemeUri || 'current'" class="ref-group">
                <span v-if="group.schemeUri" class="group-label" :title="group.schemeUri">{{ group.schemeLabel }}:</span>
                <div class="concept-chips">
                  <span
                    v-for="ref in group.refs"
                    :key="ref.uri"
                    :class="['concept-chip', 'clickable', { deprecated: ref.deprecated && showDeprecationIndicator }]"
                    @click="navigateTo(ref)"
                  >
                    <span class="material-symbols-outlined chip-icon" :class="ref.hasNarrower ? 'icon-label' : 'icon-leaf'">{{ ref.hasNarrower ? 'label' : 'circle' }}</span>
                    {{ formatRefLabel(ref) }}<span v-if="ref.lang && shouldShowLangTag(ref.lang)" class="lang-tag">{{ ref.lang }}</span>
                    <span v-if="ref.deprecated && showDeprecationIndicator" class="deprecated-badge">deprecated</span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Narrower concepts - rendered directly without scheme grouping (always same-scheme by SKOS semantics) -->
          <div v-if="details.narrower.length" class="property-row">
            <label>Narrower</label>
            <div class="concept-chips">
              <span
                v-for="ref in details.narrower"
                :key="ref.uri"
                :class="['concept-chip', 'clickable', { deprecated: ref.deprecated && showDeprecationIndicator }]"
                @click="navigateTo(ref)"
              >
                <span class="material-symbols-outlined chip-icon" :class="ref.hasNarrower ? 'icon-label' : 'icon-leaf'">{{ ref.hasNarrower ? 'label' : 'circle' }}</span>
                {{ formatRefLabel(ref) }}<span v-if="ref.lang && shouldShowLangTag(ref.lang)" class="lang-tag">{{ ref.lang }}</span>
                <span v-if="ref.deprecated && showDeprecationIndicator" class="deprecated-badge">deprecated</span>
              </span>
            </div>
          </div>
        </section>

        <!-- Relations Section (concept-specific) -->
        <section v-if="details.related.length" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">link</span>
            Relations
          </h3>

          <div class="property-row">
            <label>Related</label>
            <div class="grouped-refs">
              <div v-for="group in groupedRelated" :key="group.schemeUri || 'current'" class="ref-group">
                <span v-if="group.schemeUri" class="group-label" :title="group.schemeUri">{{ group.schemeLabel }}:</span>
                <div class="concept-chips">
                  <span
                    v-for="ref in group.refs"
                    :key="ref.uri"
                    :class="['concept-chip', 'clickable', { deprecated: ref.deprecated && showDeprecationIndicator }]"
                    @click="navigateTo(ref)"
                  >
                    <span class="material-symbols-outlined chip-icon" :class="ref.hasNarrower ? 'icon-label' : 'icon-leaf'">{{ ref.hasNarrower ? 'label' : 'circle' }}</span>
                    {{ formatRefLabel(ref) }}<span v-if="ref.lang && shouldShowLangTag(ref.lang)" class="lang-tag">{{ ref.lang }}</span>
                    <span v-if="ref.deprecated && showDeprecationIndicator" class="deprecated-badge">deprecated</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Mappings Section (concept-specific) -->
        <section v-if="mappingsConfig.length" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">swap_horiz</span>
            Mappings
          </h3>

          <div v-for="mapping in mappingsConfig" :key="mapping.label" class="property-row">
            <label>{{ mapping.label }}</label>
            <div class="mapping-links">
              <template v-for="uri in mapping.uris" :key="uri">
                <a v-if="isValidURI(uri)" :href="uri" target="_blank" class="mapping-link">
                  {{ getUriFragment(uri) }}
                  <span class="material-symbols-outlined link-icon">open_in_new</span>
                </a>
                <span v-else class="mapping-text">{{ getUriFragment(uri) }}</span>
              </template>
            </div>
          </div>
        </section>

        <!-- Collections Section (concept-specific) -->
        <section v-if="details.collections.length" class="details-section">
          <h3 class="section-title">
            <span class="material-symbols-outlined section-icon">collections_bookmark</span>
            Collections
          </h3>
          <div class="property-row">
            <label>Member of</label>
            <div class="concept-chips">
              <span
                v-for="ref in details.collections"
                :key="ref.uri"
                :class="['concept-chip', 'clickable', { deprecated: ref.deprecated && showDeprecationIndicator }]"
                @click="navigateToCollection(ref)"
              >
                <span class="material-symbols-outlined chip-icon icon-collection">collections_bookmark</span>
                {{ formatRefLabel(ref) }}<span v-if="ref.lang && shouldShowLangTag(ref.lang)" class="lang-tag">{{ ref.lang }}</span>
                <span v-if="isExternalScheme(ref)" class="scheme-badge" :title="ref.displayScheme">{{ getSchemeShortName(ref.displayScheme!) }}</span>
                <span v-if="ref.deprecated && showDeprecationIndicator" class="deprecated-badge">deprecated</span>
              </span>
            </div>
          </div>
        </section>

        <!-- Scheme Section (concept-specific) -->
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
                :class="['concept-chip', { clickable: isLocalScheme(ref.uri), deprecated: ref.deprecated && showDeprecationIndicator }]"
                @click="handleSchemeClick(ref)"
              >
                <span class="material-symbols-outlined chip-icon icon-folder">folder</span>
                {{ formatRefLabel(ref) }}<span v-if="ref.lang && shouldShowLangTag(ref.lang)" class="lang-tag">{{ ref.lang }}</span>
                <span v-if="ref.deprecated && showDeprecationIndicator" class="deprecated-badge">deprecated</span>
              </span>
            </div>
          </div>
        </section>

        <!-- Metadata Section (concept-specific) -->
        <section v-if="hasMetadata" class="details-section">
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
.concept-details {
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

/* Concept-specific sections */
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

.notation-wrapper {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.notation {
  font-size: 0.875rem;
  font-family: inherit;
  background: var(--ae-bg-hover);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  border: 1px solid var(--ae-border-color);
}

.grouped-refs {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.ref-group {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.5rem;
}

.group-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--ae-text-secondary);
  background: var(--ae-bg-hover);
  padding: 0.375rem 0.5rem;
  border-radius: 4px;
  white-space: nowrap;
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

.concept-chip.deprecated {
  opacity: 0.6;
}

.chip-icon {
  font-size: 14px;
  margin-right: 0.25rem;
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
</style>
