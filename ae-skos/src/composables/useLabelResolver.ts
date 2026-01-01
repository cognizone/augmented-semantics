/**
 * useLabelResolver - Label resolution and sorting composable
 *
 * Provides consistent label selection and ordering based on language preferences.
 * Used by ResourceLabel and other components for unified label display.
 *
 * @see /spec/ae-skos/sko01-LanguageSelector.md
 */
import { useLanguageStore } from '../stores'
import type { LabelValue } from '../types'

export function useLabelResolver() {
  const languageStore = useLanguageStore()

  /**
   * Select the best label from an array based on language priority.
   * Priority: preferred > fallback > no-lang > first available
   */
  function selectLabel(labels: LabelValue[]): LabelValue | null {
    if (!labels || labels.length === 0) return null

    // Try preferred language
    const preferred = labels.find(l => l.lang === languageStore.preferred)
    if (preferred) return preferred

    // Try fallback language
    const fallback = labels.find(l => l.lang === languageStore.fallback)
    if (fallback) return fallback

    // Try labels without language tag
    const noLang = labels.find(l => !l.lang)
    if (noLang) return noLang

    // Return first available
    return labels[0]
  }

  /**
   * Sort labels consistently:
   * 1. Preferred language first
   * 2. Fallback language
   * 3. Labels without language tag
   * 4. Remaining languages alphabetically
   */
  function sortLabels(labels: LabelValue[]): LabelValue[] {
    if (!labels || labels.length === 0) return []

    const preferred = languageStore.preferred
    const fallback = languageStore.fallback

    return [...labels].sort((a, b) => {
      const aLang = a.lang || ''
      const bLang = b.lang || ''

      // Preferred language comes first
      if (aLang === preferred && bLang !== preferred) return -1
      if (bLang === preferred && aLang !== preferred) return 1

      // Fallback language comes second
      if (aLang === fallback && bLang !== fallback) return -1
      if (bLang === fallback && aLang !== fallback) return 1

      // No-lang labels come third
      if (!aLang && bLang) return -1
      if (aLang && !bLang) return 1

      // Rest alphabetically by language code
      return aLang.localeCompare(bLang)
    })
  }

  /**
   * Check if language tag should be shown.
   * Returns true if lang differs from preferred language.
   */
  function shouldShowLangTag(lang?: string): boolean {
    if (!lang) return false
    return lang !== languageStore.preferred
  }

  /**
   * Get the preferred language code.
   */
  function getPreferred(): string {
    return languageStore.preferred
  }

  /**
   * Get the fallback language code.
   */
  function getFallback(): string {
    return languageStore.fallback
  }

  return {
    selectLabel,
    sortLabels,
    shouldShowLangTag,
    getPreferred,
    getFallback,
  }
}
