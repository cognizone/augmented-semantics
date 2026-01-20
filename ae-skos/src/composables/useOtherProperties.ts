/**
 * Shared composable for loading other (non-SKOS) properties.
 * Used by both useConceptData and useSchemeData to avoid code duplication.
 *
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */

import type { OtherPropertiesTarget } from '../types/skos'
import { useEndpointStore } from '../stores'
import { executeSparql, withPrefixes, resolveUris, formatQualifiedName, logger } from '../services'

interface LoadOtherPropertiesOptions {
  /** Additional predicates to exclude from the results (prefixed form) */
  excludedPredicates?: string[]
  /** Whether to resolve datatype URIs to short forms (default: false) */
  resolveDatatypes?: boolean
  /** Source identifier for logging */
  source?: string
}

/** Base predicates excluded from "other properties" for all resource types */
const BASE_EXCLUDED_PREDICATES = [
  'rdf:type',
  'skos:prefLabel', 'skos:altLabel', 'skos:hiddenLabel', 'skos:notation',
  'skos:definition', 'skos:scopeNote', 'skos:historyNote',
  'skos:changeNote', 'skos:editorialNote', 'skos:note', 'skos:example',
  'skosxl:prefLabel', 'skosxl:altLabel', 'skosxl:hiddenLabel',
]

export function useOtherProperties() {
  const endpointStore = useEndpointStore()

  /**
   * Load other (non-SKOS) properties for a resource and populate the target object.
   * Works with any type that has an otherProperties array.
   */
  async function loadOtherProperties<T extends OtherPropertiesTarget>(
    uri: string,
    target: T,
    options: LoadOtherPropertiesOptions = {}
  ): Promise<void> {
    const {
      excludedPredicates = [],
      resolveDatatypes = false,
      source = 'useOtherProperties',
    } = options
    const endpoint = endpointStore.current
    if (!endpoint) return

    // Combine base exclusions with caller-specific exclusions
    const allExcluded = [...BASE_EXCLUDED_PREDICATES, ...excludedPredicates]
    const filterClause = allExcluded.join(', ')

    const query = withPrefixes(`
      SELECT ?predicate ?value
      WHERE {
        <${uri}> ?predicate ?value .
        FILTER (?predicate NOT IN (
          ${filterClause}
        ))
      }
    `)

    try {
      const results = await executeSparql(endpoint, query, { retries: 0 })

      // Collect all datatypes for resolution if needed
      const datatypeUris = new Set<string>()

      // Group by predicate with deduplication
      const propMap = new Map<string, Map<string, { value: string; lang?: string; datatype?: string; isUri: boolean }>>()

      for (const binding of results.results.bindings) {
        const predicate = binding.predicate?.value
        const value = binding.value?.value
        const lang = binding.value?.['xml:lang']
        const datatype = binding.value?.datatype
        const isUri = binding.value?.type === 'uri'

        if (!predicate || !value) continue

        if (resolveDatatypes && datatype) {
          datatypeUris.add(datatype)
        }

        if (!propMap.has(predicate)) {
          propMap.set(predicate, new Map())
        }
        // Deduplicate by value+lang+datatype combination
        const key = `${value}|${lang || ''}|${datatype || ''}`
        if (!propMap.get(predicate)!.has(key)) {
          propMap.get(predicate)!.set(key, { value, lang, datatype, isUri })
        }
      }

      // Resolve datatype URIs to short forms if requested
      const datatypeMap = resolveDatatypes && datatypeUris.size > 0
        ? await resolveUris(Array.from(datatypeUris))
        : new Map<string, { prefix: string; localName: string }>()

      // Convert to OtherProperty array with resolved datatypes
      target.otherProperties = Array.from(propMap.entries()).map(([predicate, valuesMap]) => ({
        predicate,
        values: Array.from(valuesMap.values()).map(v => {
          if (resolveDatatypes && v.datatype) {
            const resolved = datatypeMap.get(v.datatype)
            if (resolved) {
              v.datatype = formatQualifiedName(resolved)
            }
          }
          return v
        }),
      }))

      logger.debug(source, 'Loaded other properties', {
        count: target.otherProperties.length,
      })
    } catch (e: unknown) {
      // Silently skip if query fails
      logger.debug(source, 'Failed to load other properties', { error: e })
    }
  }

  return { loadOtherProperties }
}

/** Predicates excluded for concept details (in addition to base) */
export const CONCEPT_EXCLUDED_PREDICATES = [
  'skos:broader', 'skos:narrower', 'skos:related',
  'skos:inScheme', 'skos:exactMatch', 'skos:closeMatch',
  'skos:broadMatch', 'skos:narrowMatch', 'skos:relatedMatch',
  'dc:identifier', 'dct:created', 'dct:modified', 'dct:status', 'rdfs:seeAlso',
  'rdfs:comment', 'dct:description',  // Documentation properties shown in dedicated section
]

/** Predicates excluded for scheme details (in addition to base) */
export const SCHEME_EXCLUDED_PREDICATES = [
  'skos:hasTopConcept',
  'rdfs:label', 'rdfs:comment', 'rdfs:seeAlso',
  'dct:title', 'dct:description',
  'dct:creator', 'dct:created', 'dct:modified', 'dct:issued',
  'dct:publisher', 'dct:rights', 'dct:license', 'cc:license',
  'owl:versionInfo',
]

/** Predicates excluded for collection details (in addition to base) */
export const COLLECTION_EXCLUDED_PREDICATES = [
  'skos:member',  // Members shown in dedicated section
  'skos:inScheme',
  'rdfs:comment', 'dct:description',  // Documentation properties shown in dedicated section
]
