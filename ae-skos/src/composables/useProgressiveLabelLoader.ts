/**
 * useProgressiveLabelLoader - Progressive label loading by language priority
 *
 * Fetches labels progressively by language priority to minimize query size and latency.
 *
 * Strategy:
 * 1. Query for preferred language only
 * 2. Remove resolved concepts from list
 * 3. Query remaining concepts for next priority language
 * 4. When list <= threshold, do full query for rest
 *
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import { useLanguageStore, useEndpointStore } from '../stores'
import { executeSparql, withPrefixes, logger } from '../services'
import {
  buildSingleLanguageLabelClause,
  buildCapabilityAwareLabelUnionClause,
} from '../constants'
import type { LabelPredicateCapabilities, SkosResourceType, LabelValue } from '../types'

/**
 * Configuration for progressive label loading
 */
export interface ProgressiveLabelConfig {
  /** Switch to full query when remaining count drops below this threshold (default: 5) */
  threshold?: number
  /** Maximum number of languages to iterate through before falling back to full query (default: 5) */
  maxLanguageIterations?: number
  /** AbortSignal for cancellation support */
  signal?: AbortSignal
}

/**
 * Result from a label query - maps concept URI to its resolved label
 */
export type LabelResult = Map<string, LabelValue>

/**
 * Callback invoked when labels are resolved for a batch of concepts
 */
export type OnLabelsResolvedCallback = (resolved: LabelResult) => void

/**
 * Progressive label loader composable
 */
export function useProgressiveLabelLoader() {
  const languageStore = useLanguageStore()
  const endpointStore = useEndpointStore()

  /**
   * Get ordered list of languages to try, based on user preference and endpoint priorities.
   * Limits to maxIterations to prevent excessive round-trips.
   */
  function getLanguagePriorities(maxIterations: number): string[] {
    const preferred = languageStore.preferred
    const priorities = endpointStore.current?.languagePriorities || []

    // Build ordered list: preferred first, then endpoint priorities (excluding preferred)
    const orderedLangs = [preferred, ...priorities.filter(l => l !== preferred)]

    // Limit to maxIterations
    return orderedLangs.slice(0, maxIterations)
  }

  /**
   * Get label predicate capabilities for a resource type
   */
  function getLabelCapabilities(resourceType: SkosResourceType): LabelPredicateCapabilities | undefined {
    return endpointStore.current?.analysis?.labelPredicates?.[resourceType]
  }

  /**
   * Query labels for a single language
   */
  async function queryLabelsForLanguage(
    uris: string[],
    language: string,
    resourceType: SkosResourceType,
    signal?: AbortSignal
  ): Promise<LabelResult> {
    const endpoint = endpointStore.current
    if (!endpoint || uris.length === 0) return new Map()

    const capabilities = getLabelCapabilities(resourceType)
    const valuesClause = uris.map(uri => `<${uri}>`).join(' ')
    const labelClause = buildSingleLanguageLabelClause('?concept', language, capabilities)

    const query = withPrefixes(`
      SELECT ?concept ?label ?labelLang ?labelType
      WHERE {
        VALUES ?concept { ${valuesClause} }
        ${labelClause}
      }
    `)

    try {
      const results = await executeSparql(endpoint, query, { retries: 0, signal })
      return processLabelResults(results.results.bindings)
    } catch (e) {
      // Log but don't fail - progressive loading is resilient to partial failures
      logger.warn('ProgressiveLabelLoader', `Single-language query failed for "${language}"`, { error: e })
      return new Map()
    }
  }

  /**
   * Query all labels (full query for remaining concepts)
   */
  async function queryAllLabels(
    uris: string[],
    resourceType: SkosResourceType,
    signal?: AbortSignal
  ): Promise<LabelResult> {
    const endpoint = endpointStore.current
    if (!endpoint || uris.length === 0) return new Map()

    const capabilities = getLabelCapabilities(resourceType)
    const valuesClause = uris.map(uri => `<${uri}>`).join(' ')
    const labelClause = buildCapabilityAwareLabelUnionClause('?concept', capabilities)

    const query = withPrefixes(`
      SELECT ?concept ?label ?labelLang ?labelType
      WHERE {
        VALUES ?concept { ${valuesClause} }
        OPTIONAL {
          ${labelClause}
        }
      }
    `)

    try {
      const results = await executeSparql(endpoint, query, { retries: 0, signal })
      return processLabelResults(results.results.bindings)
    } catch (e) {
      logger.warn('ProgressiveLabelLoader', 'Full query failed', { error: e })
      return new Map()
    }
  }

  /**
   * Process SPARQL bindings into a LabelResult map.
   * For each concept, picks the best label based on label type priority,
   * then language priority within each type.
   */
  function processLabelResults(
    bindings: Array<Record<string, { value: string; 'xml:lang'?: string }>>
  ): LabelResult {
    // Group labels by concept URI
    const conceptLabels = new Map<string, { value: string; lang: string; type: string }[]>()

    for (const b of bindings) {
      const uri = b.concept?.value
      const label = b.label?.value
      if (!uri || !label) continue

      if (!conceptLabels.has(uri)) {
        conceptLabels.set(uri, [])
      }

      conceptLabels.get(uri)!.push({
        value: label,
        lang: b.labelLang?.value || '',
        type: b.labelType?.value || 'prefLabel'
      })
    }

    // Select best label per concept using label type priority, then language priority
    const result: LabelResult = new Map()
    const LABEL_TYPE_PRIORITY = ['prefLabel', 'xlPrefLabel', 'dctTitle', 'dcTitle', 'rdfsLabel']
    const preferredLang = languageStore.preferred
    const langPriorities = endpointStore.current?.languagePriorities || []

    for (const [uri, labels] of conceptLabels) {
      // Try each label type in priority order
      for (const type of LABEL_TYPE_PRIORITY) {
        const labelsOfType = labels.filter(l => l.type === type)
        if (labelsOfType.length === 0) continue

        // Apply language priority within this type
        // 1. Preferred language
        const preferred = labelsOfType.find(l => l.lang === preferredLang)
        if (preferred) {
          result.set(uri, { value: preferred.value, lang: preferred.lang || undefined })
          break
        }

        // 2. Endpoint language priorities
        let found = false
        for (const lang of langPriorities) {
          const match = labelsOfType.find(l => l.lang === lang)
          if (match) {
            result.set(uri, { value: match.value, lang: match.lang || undefined })
            found = true
            break
          }
        }
        if (found) break

        // 3. No-lang label
        const noLang = labelsOfType.find(l => !l.lang)
        if (noLang) {
          result.set(uri, { value: noLang.value, lang: undefined })
          break
        }

        // 4. First available of this type
        result.set(uri, { value: labelsOfType[0]!.value, lang: labelsOfType[0]!.lang || undefined })
        break
      }

      // If no priority match, use first available
      if (!result.has(uri) && labels.length > 0) {
        const first = labels[0]!
        result.set(uri, { value: first.value, lang: first.lang || undefined })
      }
    }

    return result
  }

  /**
   * Load labels progressively by language priority.
   *
   * @param conceptUris - URIs of concepts to load labels for
   * @param resourceType - Type of resource (concept, scheme, collection)
   * @param onLabelsResolved - Callback invoked as labels are resolved
   * @param config - Optional configuration
   */
  async function loadLabelsProgressively(
    conceptUris: string[],
    resourceType: SkosResourceType,
    onLabelsResolved: OnLabelsResolvedCallback,
    config: ProgressiveLabelConfig = {}
  ): Promise<void> {
    const {
      threshold = 5,
      maxLanguageIterations = 5,
      signal
    } = config

    if (conceptUris.length === 0) return

    const startTime = performance.now()
    const languages = getLanguagePriorities(maxLanguageIterations)
    let remaining = [...conceptUris]
    let totalResolved = 0

    logger.debug('ProgressiveLabelLoader', 'Starting progressive load', {
      count: conceptUris.length,
      languages: languages.join(', '),
      threshold
    })

    // Iterate through languages
    for (const lang of languages) {
      // Check cancellation
      if (signal?.aborted) {
        logger.debug('ProgressiveLabelLoader', 'Aborted')
        return
      }

      // If remaining is small enough, switch to full query
      if (remaining.length <= threshold) break

      // Query for single language
      const results = await queryLabelsForLanguage(remaining, lang, resourceType, signal)

      // Notify resolved labels
      if (results.size > 0) {
        onLabelsResolved(results)
        totalResolved += results.size

        // Remove resolved concepts from remaining list
        remaining = remaining.filter(uri => !results.has(uri))

        logger.debug('ProgressiveLabelLoader', `Resolved ${results.size} with lang="${lang}"`, {
          remaining: remaining.length
        })
      }
    }

    // Final pass: full query for any remaining concepts
    if (remaining.length > 0 && !signal?.aborted) {
      const results = await queryAllLabels(remaining, resourceType, signal)

      if (results.size > 0) {
        onLabelsResolved(results)
        totalResolved += results.size
      }

      logger.debug('ProgressiveLabelLoader', `Final query resolved ${results.size}`, {
        unresolved: remaining.length - results.size
      })
    }

    const elapsed = performance.now() - startTime
    logger.info('ProgressiveLabelLoader', `Completed in ${elapsed.toFixed(0)}ms`, {
      total: conceptUris.length,
      resolved: totalResolved,
      languages: languages.length
    })
  }

  return {
    loadLabelsProgressively,
    queryLabelsForLanguage,
    queryAllLabels,
    getLanguagePriorities
  }
}
