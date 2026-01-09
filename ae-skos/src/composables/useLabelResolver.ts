/**
 * useLabelResolver - Label resolution and sorting composable
 *
 * Provides consistent label selection based on user's preferred language,
 * with fallback to endpoint's language priorities.
 *
 * @see /spec/ae-skos/sko01-LanguageSelector.md
 */
import { useLanguageStore, useSettingsStore, useEndpointStore } from '../stores'
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
   * Priority: prefLabel > xlPrefLabel > title > rdfsLabel
   */
  function selectSchemeLabel(labels: {
    prefLabels?: LabelValue[]
    prefLabelsXL?: XLLabel[]
    titles?: LabelValue[]
    rdfsLabels?: LabelValue[]
  }): LabelValue | null {
    // 1. Try prefLabel (with XL fallback)
    const prefLabel = selectLabelWithXL(labels.prefLabels || [], labels.prefLabelsXL || [])
    if (prefLabel) return prefLabel

    // 2. Try title (dct:title)
    if (labels.titles?.length) {
      const title = selectLabel(labels.titles)
      if (title) return title
    }

    // 3. Try rdfsLabel
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
      const key = `${label.value}|${label.lang || ''}`
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

  return {
    selectLabel,
    selectLabelWithXL,
    selectConceptLabel,
    selectSchemeLabel,
    sortLabels,
    shouldShowLangTag,
  }
}
