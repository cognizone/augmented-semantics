/**
 * useConceptBindings - Process SPARQL bindings into ConceptNode[]
 *
 * Shared logic for processing concept query results with:
 * - Label selection (prefLabel > xlPrefLabel > title > rdfsLabel)
 * - Language priority handling
 * - Notation selection
 * - Deprecation detection
 *
 * Extracted from ConceptTree.vue to reduce duplication.
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { useLabelResolver } from './useLabelResolver'
import { useDeprecation } from './useDeprecation'
import { pickBestNotation, compareNodes } from '../utils/concept-tree'
import type { ConceptNode } from '../types'
import type { SPARQLBinding } from '../services/sparql'

/**
 * Extended SPARQL binding with concept-specific fields
 */
export interface ConceptBinding extends SPARQLBinding {
  concept?: { type: string; value: string }
  label?: { type: string; value: string }
  labelLang?: { type: string; value: string }
  labelType?: { type: string; value: string }
  notation?: { type: string; value: string }
  narrowerCount?: { type: string; value: string }
}

export function useConceptBindings() {
  const { selectLabel } = useLabelResolver()
  const { isDeprecatedFromBinding } = useDeprecation()

  /**
   * Process SPARQL bindings into ConceptNode[]
   *
   * Groups bindings by concept URI, picks best label/notation,
   * and returns sorted ConceptNode array.
   */
  function processBindings(bindings: ConceptBinding[]): ConceptNode[] {
    // Group by concept URI
    const conceptMap = new Map<string, {
      labels: { value: string; lang: string; type: string }[]
      notations: string[]
      hasNarrower: boolean
      deprecated: boolean
    }>()

    for (const b of bindings) {
      const uri = b.concept?.value
      if (!uri) continue

      if (!conceptMap.has(uri)) {
        conceptMap.set(uri, {
          labels: [],
          notations: [],
          hasNarrower: parseInt(b.narrowerCount?.value || '0', 10) > 0,
          deprecated: isDeprecatedFromBinding(b),
        })
      }

      const entry = conceptMap.get(uri)!

      // Collect all notations (we'll pick the best one later)
      if (b.notation?.value && !entry.notations.includes(b.notation.value)) {
        entry.notations.push(b.notation.value)
      }

      if (b.label?.value) {
        entry.labels.push({
          value: b.label.value,
          lang: b.labelLang?.value || '',
          type: b.labelType?.value || 'prefLabel'
        })
      }
    }

    // Convert to ConceptNode[] with best label selection
    const concepts: ConceptNode[] = Array.from(conceptMap.entries()).map(([uri, data]) => {
      // Pick best label: prefLabel > xlPrefLabel > title > rdfsLabel, with language priority
      const labelPriority = ['prefLabel', 'xlPrefLabel', 'title', 'rdfsLabel']
      let bestLabel: string | undefined
      let bestLabelLang: string | undefined

      for (const labelType of labelPriority) {
        const labelsOfType = data.labels.filter(l => l.type === labelType)
        if (!labelsOfType.length) continue

        const selected = selectLabel(labelsOfType)
        if (selected) {
          bestLabel = selected.value
          bestLabelLang = selected.lang || undefined
          break
        }
      }

      return {
        uri,
        label: bestLabel,
        lang: bestLabelLang,
        notation: pickBestNotation(data.notations),
        hasNarrower: data.hasNarrower,
        expanded: false,
        deprecated: data.deprecated,
      }
    })

    // Sort by notation then label
    concepts.sort(compareNodes)

    return concepts
  }

  return { processBindings }
}
