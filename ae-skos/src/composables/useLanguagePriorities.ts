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
    clearPriorities,
  }
}
