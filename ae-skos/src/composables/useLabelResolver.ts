/**
 * useLabelResolver - Label resolution and sorting composable
 *
 * Provides consistent label selection and ordering based on language priorities.
 * Supports per-endpoint configuration with priority list and current override.
 *
 * @see /spec/ae-skos/sko01-LanguageSelector.md
 */
import { useLanguageStore } from '../stores'
import type { LabelValue } from '../types'

export function useLabelResolver() {
  const languageStore = useLanguageStore()

  /**
   * Select the best label from an array based on language priority.
   * If current override is set, use only that language.
   * Otherwise, walk priority list in order, first match wins.
   * Fallback: no-lang label, then first available.
   */
  function selectLabel(labels: LabelValue[]): LabelValue | null {
    if (!labels || labels.length === 0) return null

    // If current override is set, prefer that language
    if (languageStore.current) {
      const current = labels.find(l => l.lang === languageStore.current)
      if (current) return current
    }

    // Walk priority list in order
    for (const lang of languageStore.priorities) {
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
   * Sort labels by priority position:
   * 1. Languages in priority list (in order)
   * 2. Labels without language tag
   * 3. Remaining languages alphabetically
   */
  function sortLabels(labels: LabelValue[]): LabelValue[] {
    if (!labels || labels.length === 0) return []

    const priorities = languageStore.priorities

    return [...labels].sort((a, b) => {
      const aLang = a.lang || ''
      const bLang = b.lang || ''

      const aIndex = priorities.indexOf(aLang)
      const bIndex = priorities.indexOf(bLang)

      // Both in priority list - sort by position
      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex
      }

      // Only one in priority list - prioritized first
      if (aIndex !== -1) return -1
      if (bIndex !== -1) return 1

      // No-lang labels come before non-prioritized languages
      if (!aLang && bLang) return -1
      if (aLang && !bLang) return 1

      // Rest alphabetically by language code
      return aLang.localeCompare(bLang)
    })
  }

  /**
   * Check if language tag should be shown.
   * Returns true if lang differs from the display language
   * (current override or first priority).
   */
  function shouldShowLangTag(lang?: string): boolean {
    if (!lang) return false
    return lang !== languageStore.displayLanguage
  }

  /**
   * Get the display language (current override or first priority).
   */
  function getDisplayLanguage(): string {
    return languageStore.displayLanguage
  }

  /**
   * Get the priority list.
   */
  function getPriorities(): string[] {
    return languageStore.priorities
  }

  /**
   * Get the current override language.
   */
  function getCurrent(): string | null {
    return languageStore.current
  }

  // Backward compatibility
  function getPreferred(): string {
    return languageStore.preferred
  }

  function getFallback(): string {
    return languageStore.fallback
  }

  return {
    selectLabel,
    sortLabels,
    shouldShowLangTag,
    getDisplayLanguage,
    getPriorities,
    getCurrent,
    // Backward compatibility
    getPreferred,
    getFallback,
  }
}
