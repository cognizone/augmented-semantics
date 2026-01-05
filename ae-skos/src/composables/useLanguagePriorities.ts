/**
 * useLanguagePriorities - Language priority management composable
 *
 * Handles language priority configuration for SPARQL endpoints,
 * including default priority ordering and language count display.
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import { ref, computed, type Ref } from 'vue'
import type { SPARQLEndpoint } from '../types'

/**
 * ISO 639-1 language code to name mapping
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  ru: 'Russian',
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
  ar: 'Arabic',
  hi: 'Hindi',
  sv: 'Swedish',
  da: 'Danish',
  fi: 'Finnish',
  no: 'Norwegian',
  cs: 'Czech',
  sk: 'Slovak',
  hu: 'Hungarian',
  ro: 'Romanian',
  bg: 'Bulgarian',
  el: 'Greek',
  tr: 'Turkish',
  he: 'Hebrew',
  th: 'Thai',
  vi: 'Vietnamese',
  uk: 'Ukrainian',
  ca: 'Catalan',
  eu: 'Basque',
  gl: 'Galician',
  hr: 'Croatian',
  sl: 'Slovenian',
  lt: 'Lithuanian',
  lv: 'Latvian',
  et: 'Estonian',
  mt: 'Maltese',
  ga: 'Irish',
  cy: 'Welsh',
  la: 'Latin',
}

/**
 * Color palette for language badges
 */
const BADGE_COLORS = [
  { bg: 'bg-blue', text: 'text-blue' },
  { bg: 'bg-purple', text: 'text-purple' },
  { bg: 'bg-orange', text: 'text-orange' },
  { bg: 'bg-green', text: 'text-green' },
  { bg: 'bg-pink', text: 'text-pink' },
  { bg: 'bg-cyan', text: 'text-cyan' },
]

export function useLanguagePriorities(endpoint: Ref<SPARQLEndpoint | null>) {
  const priorities: Ref<string[]> = ref([])

  /**
   * Languages detected in the endpoint's analysis
   */
  const endpointLanguages = computed(() => {
    return endpoint.value?.analysis?.languages || []
  })

  /**
   * Load priorities from endpoint or generate defaults
   */
  function loadPriorities(ep: SPARQLEndpoint) {
    const detected = ep.analysis?.languages?.map(l => l.lang) || []

    if (ep.languagePriorities?.length) {
      // Use existing priorities
      priorities.value = [...ep.languagePriorities]
    } else {
      // Default: alphabetical, but 'en' always first
      const sorted = [...detected].sort((a, b) => {
        if (a === 'en') return -1
        if (b === 'en') return 1
        return a.localeCompare(b)
      })
      priorities.value = sorted
    }
  }

  /**
   * Save priorities to endpoint (returns updated endpoint data)
   */
  function savePriorities(ep: SPARQLEndpoint): { id: string; languagePriorities: string[] } {
    return {
      id: ep.id,
      languagePriorities: [...priorities.value],
    }
  }

  /**
   * Handle reorder event from OrderList component
   */
  function onReorder(event: { value: string[] }) {
    priorities.value = event.value
  }

  /**
   * Get count for a specific language code
   */
  function getLanguageCount(lang: string): number | undefined {
    return endpointLanguages.value.find(l => l.lang === lang)?.count
  }

  /**
   * Get human-readable language name
   */
  function getLanguageName(lang: string): string {
    return LANGUAGE_NAMES[lang] || lang.toUpperCase()
  }

  /**
   * Get priority label for position (e.g., "Default fallback", "2nd priority")
   */
  function getPriorityLabel(index: number): string {
    if (index === 0) return 'Default fallback'
    const ordinal = index === 1 ? '2nd' : index === 2 ? '3rd' : `${index + 1}th`
    return `${ordinal} priority`
  }

  /**
   * Get badge color class for a language based on its index
   */
  function getBadgeColor(index: number): { bg: string; text: string } {
    return BADGE_COLORS[index % BADGE_COLORS.length]!
  }

  /**
   * Remove a language from priorities
   */
  function removeLanguage(lang: string) {
    priorities.value = priorities.value.filter(l => l !== lang)
  }

  /**
   * Clear priorities
   */
  function clearPriorities() {
    priorities.value = []
  }

  return {
    priorities,
    endpointLanguages,
    loadPriorities,
    savePriorities,
    onReorder,
    getLanguageCount,
    getLanguageName,
    getPriorityLabel,
    getBadgeColor,
    removeLanguage,
    clearPriorities,
  }
}
