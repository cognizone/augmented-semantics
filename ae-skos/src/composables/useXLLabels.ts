/**
 * Shared composable for loading SKOS-XL extended labels.
 * Used by both useConceptData and useSchemeData to avoid code duplication.
 *
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */

import type { XLLabelTarget } from '../types/skos'
import { useEndpointStore } from '../stores'
import { executeSparql, withPrefixes, logger } from '../services'

interface LoadXLLabelsOptions {
  /** Source identifier for logging */
  source?: string
}

export function useXLLabels() {
  const endpointStore = useEndpointStore()

  /**
   * Load SKOS-XL extended labels for a resource and populate the target object.
   * Works with any type that has prefLabelsXL, altLabelsXL, and hiddenLabelsXL arrays.
   */
  async function loadXLLabels<T extends XLLabelTarget>(
    uri: string,
    target: T,
    options: LoadXLLabelsOptions = {}
  ): Promise<void> {
    const { source = 'useXLLabels' } = options
    const endpoint = endpointStore.current
    if (!endpoint) return

    const query = withPrefixes(`
      SELECT ?xlLabel ?labelType ?literalForm ?literalLang
      WHERE {
        {
          <${uri}> skosxl:prefLabel ?xlLabel .
          BIND("prefLabel" AS ?labelType)
        } UNION {
          <${uri}> skosxl:altLabel ?xlLabel .
          BIND("altLabel" AS ?labelType)
        } UNION {
          <${uri}> skosxl:hiddenLabel ?xlLabel .
          BIND("hiddenLabel" AS ?labelType)
        }
        ?xlLabel skosxl:literalForm ?literalForm .
        BIND(LANG(?literalForm) AS ?literalLang)
      }
    `)

    try {
      const results = await executeSparql(endpoint, query, { retries: 0 })

      // Track seen URIs to deduplicate
      const seenXLUris = new Set<string>()

      for (const binding of results.results.bindings) {
        const xlUri = binding.xlLabel?.value
        const labelType = binding.labelType?.value
        const literalForm = binding.literalForm?.value
        const literalLang = binding.literalLang?.value

        if (!xlUri || !literalForm) continue

        // Deduplicate by XL label URI
        if (seenXLUris.has(xlUri)) continue
        seenXLUris.add(xlUri)

        const xlLabel = {
          uri: xlUri,
          literalForm: {
            value: literalForm,
            lang: literalLang || undefined,
          },
        }

        if (labelType === 'prefLabel') {
          target.prefLabelsXL.push(xlLabel)
        } else if (labelType === 'altLabel') {
          target.altLabelsXL.push(xlLabel)
        } else if (labelType === 'hiddenLabel') {
          target.hiddenLabelsXL.push(xlLabel)
        }
      }

      logger.debug(source, 'Loaded XL labels', {
        prefLabelsXL: target.prefLabelsXL.length,
        altLabelsXL: target.altLabelsXL.length,
        hiddenLabelsXL: target.hiddenLabelsXL.length,
      })
    } catch (e: unknown) {
      // SKOS-XL may not be supported by all endpoints, silently skip
      logger.debug(source, 'SKOS-XL labels not available or query failed', { error: e })
    }
  }

  return { loadXLLabels }
}
