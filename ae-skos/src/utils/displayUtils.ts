/**
 * Display Utilities - Shared formatting functions
 *
 * Provides consistent formatting for property names, values, and labels
 * across different detail views.
 *
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import type { ConceptRef } from '../types'
import { formatQualifiedName } from '../services'

/**
 * Get a human-readable predicate name from a URI
 * @param predicate - The predicate URI
 * @param resolved - Optional resolved prefix/localName
 * @returns The formatted predicate name
 */
export function getPredicateName(
  predicate: string,
  resolved?: { prefix: string; localName: string }
): string {
  if (resolved) {
    // Show qualified name if prefix exists, otherwise just localName
    return resolved.prefix
      ? formatQualifiedName(resolved)
      : resolved.localName
  }
  // Fallback: extract local name from URI
  return predicate.split('/').pop()?.split('#').pop() || predicate
}

/**
 * Format a property value with special handling for xsd:boolean
 * @param value - The value to format
 * @param datatype - Optional datatype URI
 * @returns The formatted value
 */
export function formatPropertyValue(value: string, datatype?: string): string {
  // Handle xsd:boolean with 0/1 values (Virtuoso quirk)
  if (datatype === 'xsd:boolean' || datatype?.endsWith('#boolean')) {
    if (value === '0' || value === 'false') {
      return '0 (false)'
    }
    if (value === '1' || value === 'true') {
      return '1 (true)'
    }
  }
  return value
}

/**
 * Get display label for a ConceptRef (notation + label if both exist)
 * @param ref - The concept reference
 * @returns The formatted display label
 */
export function getRefLabel(ref: ConceptRef): string {
  const label = ref.label || ref.uri.split('/').pop() || ref.uri
  if (ref.notation && ref.label) {
    return `${ref.notation} - ${label}`
  }
  return ref.notation || label
}
