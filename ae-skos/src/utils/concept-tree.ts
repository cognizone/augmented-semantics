/**
 * ConceptTree utility functions
 *
 * Pure functions for concept node processing.
 * Extracted from ConceptTree.vue to reduce duplication and enable testing.
 *
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import type { ConceptNode } from '../types'

/**
 * Pick the best notation from a list.
 * Prefers the smallest numeric notation for consistent sorting.
 */
export function pickBestNotation(notations: string[]): string | undefined {
  if (!notations.length) return undefined
  if (notations.length === 1) return notations[0]

  // Find all numeric notations and pick the smallest
  const numericNotations = notations
    .map(n => ({ value: n, num: parseFloat(n) }))
    .filter(n => !isNaN(n.num))
    .sort((a, b) => a.num - b.num)

  if (numericNotations.length > 0 && numericNotations[0]) {
    return numericNotations[0].value
  }

  // No numeric notations, return first alphabetically
  const sorted = [...notations].sort()
  return sorted[0]
}

/**
 * Compare tree nodes for sorting.
 * Priority: notation (numeric if possible) > label (alphabetical)
 */
export function compareNodes(
  a: ConceptNode,
  b: ConceptNode,
  options?: { useNotation?: boolean }
): number {
  const useNotation = options?.useNotation !== false
  const aNotation = useNotation ? a.notation : undefined
  const bNotation = useNotation ? b.notation : undefined

  // If both have notation, try numeric sort
  if (aNotation && bNotation) {
    const aNum = parseFloat(aNotation)
    const bNum = parseFloat(bNotation)

    // Both are valid numbers → numeric sort
    if (!isNaN(aNum) && !isNaN(bNum)) {
      return aNum - bNum
    }

    // Otherwise → string comparison on notation
    return aNotation.localeCompare(bNotation)
  }

  // One has notation, one doesn't → notation first
  if (aNotation) return -1
  if (bNotation) return 1

  // Neither has notation → sort by label
  return (a.label || a.uri).localeCompare(b.label || b.uri)
}
