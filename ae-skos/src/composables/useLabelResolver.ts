/**
 * useLabelResolver - Label resolution and sorting composable
 *
 * Provides consistent label selection based on user's preferred language,
 * with fallback to endpoint's language priorities.
 *
 * @see /spec/ae-skos/sko01-LanguageSelector.md
 */
import { useLanguageStore, useSettingsStore, useEndpointStore } from '../stores'
import { LABEL_PRIORITY } from '../constants'
import type { LabelValue, XLLabel } from '../types'

export function useLabelResolver() {
  const languageStore = useLanguageStore()
  const settingsStore = useSettingsStore()
  const endpointStore = useEndpointStore()

  /**
   * Select the best label from an array based on language priorities.
   * Priority:
   * 1. Preferred language (global setting)
   * 2. Endpoint's language priorities (in order)
   * 3. Labels without language tag
   * 4. First available
   */
  function selectLabel(labels: LabelValue[]): LabelValue | null {
    if (!labels || labels.length === 0) return null

    // Try preferred language first
    const preferred = labels.find(l => l.lang === languageStore.preferred)
    if (preferred) return preferred

    // Try endpoint's language priorities in order
    const priorities = endpointStore.current?.languagePriorities || []
    for (const lang of priorities) {
      const match = labels.find(l => l.lang === lang)
      if (match) return match
    }

    // Try labels without language tag
    const noLang = labels.find(l => !l.lang)
    if (noLang) return noLang

    // Return first available
    return labels[0] ?? null
  }

  /**
   * Select the best label with SKOS-XL fallback.
   * Priority:
   * 1. skos:prefLabel (in preferred language)
   * 2. skosxl:prefLabel literalForm (in preferred language)
   * 3. Other fallbacks (no-lang, first available)
   */
  function selectLabelWithXL(
    labels: LabelValue[],
    xlLabels: XLLabel[]
  ): LabelValue | null {
    // First try regular labels
    const regularLabel = selectLabel(labels)
    if (regularLabel) return regularLabel

    // Fall back to XL labels
    if (xlLabels && xlLabels.length > 0) {
      // Convert XL labels to LabelValue for consistent selection
      const xlLabelValues = xlLabels.map(xl => xl.literalForm)
      return selectLabel(xlLabelValues)
    }

    return null
  }

  /**
   * Select best label for a concept.
   * Priority: prefLabel > xlPrefLabel > rdfsLabel
   */
  function selectConceptLabel(labels: {
    prefLabels?: LabelValue[]
    prefLabelsXL?: XLLabel[]
    rdfsLabels?: LabelValue[]
  }): LabelValue | null {
    // 1. Try prefLabel (with XL fallback)
    const prefLabel = selectLabelWithXL(labels.prefLabels || [], labels.prefLabelsXL || [])
    if (prefLabel) return prefLabel

    // 2. Try rdfsLabel
    if (labels.rdfsLabels?.length) {
      const rdfsLabel = selectLabel(labels.rdfsLabels)
      if (rdfsLabel) return rdfsLabel
    }

    return null
  }

  /**
   * Select best label for a scheme.
   * Priority: prefLabel > xlPrefLabel > dctTitle > dcTitle > rdfsLabel
   */
  function selectSchemeLabel(labels: {
    prefLabels?: LabelValue[]
    prefLabelsXL?: XLLabel[]
    dctTitles?: LabelValue[]
    dcTitles?: LabelValue[]
    rdfsLabels?: LabelValue[]
  }): LabelValue | null {
    // 1. Try prefLabel (with XL fallback)
    const prefLabel = selectLabelWithXL(labels.prefLabels || [], labels.prefLabelsXL || [])
    if (prefLabel) return prefLabel

    // 2. Try dct:title (Dublin Core Terms - preferred)
    if (labels.dctTitles?.length) {
      const dctTitle = selectLabel(labels.dctTitles)
      if (dctTitle) return dctTitle
    }

    // 3. Try dc:title (Dublin Core Elements - legacy)
    if (labels.dcTitles?.length) {
      const dcTitle = selectLabel(labels.dcTitles)
      if (dcTitle) return dcTitle
    }

    // 4. Try rdfsLabel
    if (labels.rdfsLabels?.length) {
      const rdfsLabel = selectLabel(labels.rdfsLabels)
      if (rdfsLabel) return rdfsLabel
    }

    return null
  }

  /**
   * Select best label for a collection.
   * Priority: prefLabel > xlPrefLabel > dctTitle > dcTitle > rdfsLabel
   * (Same priority as schemes since collections can also have title properties)
   */
  function selectCollectionLabel(labels: {
    prefLabels?: LabelValue[]
    prefLabelsXL?: XLLabel[]
    dctTitles?: LabelValue[]
    dcTitles?: LabelValue[]
    rdfsLabels?: LabelValue[]
  }): LabelValue | null {
    // 1. Try prefLabel (with XL fallback)
    const prefLabel = selectLabelWithXL(labels.prefLabels || [], labels.prefLabelsXL || [])
    if (prefLabel) return prefLabel

    // 2. Try dct:title (Dublin Core Terms - preferred)
    if (labels.dctTitles?.length) {
      const dctTitle = selectLabel(labels.dctTitles)
      if (dctTitle) return dctTitle
    }

    // 3. Try dc:title (Dublin Core Elements - legacy)
    if (labels.dcTitles?.length) {
      const dcTitle = selectLabel(labels.dcTitles)
      if (dcTitle) return dcTitle
    }

    // 4. Try rdfsLabel
    if (labels.rdfsLabels?.length) {
      const rdfsLabel = selectLabel(labels.rdfsLabels)
      if (rdfsLabel) return rdfsLabel
    }

    return null
  }

  /**
   * Sort and deduplicate labels:
   * 1. Deduplicate by value+lang combination
   * 2. xsd:string (no language tag) first
   * 3. Preferred language
   * 4. Endpoint's language priorities (in order)
   * 5. Remaining languages alphabetically
   */
  function sortLabels(labels: LabelValue[]): LabelValue[] {
    if (!labels || labels.length === 0) return []

    // Deduplicate by value+lang combination
    const seen = new Set<string>()
    const deduplicated = labels.filter(label => {
      const key = `${label.value}|${label.lang || ''}|${label.datatype || ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const preferred = languageStore.preferred
    const priorities = endpointStore.current?.languagePriorities || []

    return deduplicated.sort((a, b) => {
      const aLang = a.lang || ''
      const bLang = b.lang || ''

      // xsd:string (no-lang) labels come first
      if (!aLang && bLang) return -1
      if (aLang && !bLang) return 1

      // Preferred language comes next
      if (aLang === preferred && bLang !== preferred) return -1
      if (bLang === preferred && aLang !== preferred) return 1

      // Then by endpoint's language priorities
      const aIdx = priorities.indexOf(aLang)
      const bIdx = priorities.indexOf(bLang)
      if (aIdx !== -1 && bIdx === -1) return -1
      if (bIdx !== -1 && aIdx === -1) return 1
      if (aIdx !== -1 && bIdx !== -1 && aIdx !== bIdx) return aIdx - bIdx

      // Rest alphabetically by language code
      return aLang.localeCompare(bLang)
    })
  }

  /**
   * Check if language tag should be shown.
   * Returns true if lang differs from the preferred language,
   * or if showPreferredLanguageTag is enabled.
   */
  function shouldShowLangTag(lang?: string): boolean {
    if (!settingsStore.showLanguageTags) return false
    if (!lang) return false
    if (settingsStore.showPreferredLanguageTag) return true
    return lang !== languageStore.preferred
  }

  /**
   * Select best label from typed labels using LABEL_PRIORITY order.
   *
   * This function is used when labels come from SPARQL queries with ?labelType bindings.
   * It tries each label type in priority order: prefLabel > xlPrefLabel > dctTitle > dcTitle > rdfsLabel
   *
   * @param labels - Array of labels with type information
   * @param priority - Optional custom priority order (defaults to LABEL_PRIORITY)
   * @returns Best label with its language, or undefined if no labels
   */
  function selectLabelByPriority(
    labels: { value: string; lang: string; type: string }[],
    priority: readonly string[] = LABEL_PRIORITY
  ): { value: string; lang: string } | undefined {
    if (!labels.length) return undefined

    // Try each label type in priority order
    for (const labelType of priority) {
      const labelsOfType = labels.filter(l => l.type === labelType)
      if (!labelsOfType.length) continue

      // Apply language selection within this type
      const selected = selectLabel(labelsOfType)
      if (selected) {
        return { value: selected.value, lang: selected.lang || '' }
      }
    }

    // Fallback: return first available label if no priority match
    const first = labels[0]
    return first ? { value: first.value, lang: first.lang || '' } : undefined
  }

  return {
    selectLabel,
    selectLabelWithXL,
    selectConceptLabel,
    selectSchemeLabel,
    selectCollectionLabel,
    selectLabelByPriority,
    sortLabels,
    shouldShowLangTag,
  }
}
