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
 * Extract the last meaningful segment from a URI
 * Handles trailing slashes and hash fragments properly
 * @param uri - The URI to extract from
 * @returns The last segment, or the full URI if extraction fails
 */
export function getUriFragment(uri: string): string {
  if (!uri) return ''
  // Remove trailing slash, then split and get last segment
  const cleaned = uri.endsWith('/') ? uri.slice(0, -1) : uri
  // Handle hash fragments first, then path segments
  const hashPart = cleaned.split('#').pop() || ''
  if (hashPart && hashPart !== cleaned) {
    return hashPart
  }
  return cleaned.split('/').pop() || uri
}

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
 * Format temporal values (date, dateTime, time) based on datatype
 * @param value - The temporal value string to format
 * @param datatype - The XSD datatype (xsd:date, xsd:dateTime, xsd:time, or full URI)
 * @returns The formatted temporal string
 */
export function formatTemporalValue(value: string, datatype?: string): string {
  if (!value) return ''

  // Normalize datatype to short form (date, dateTime, time)
  const dtype = datatype?.includes('#')
    ? datatype.split('#').pop()
    : datatype?.replace('xsd:', '')

  try {
    if (dtype === 'time') {
      // xsd:time - strip milliseconds if present
      const parts = value.split('.')
      return parts[0] ?? value
    }

    const date = new Date(value)
    if (isNaN(date.getTime())) return value

    if (dtype === 'dateTime') {
      // xsd:dateTime - return full ISO without milliseconds
      return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
    }

    // xsd:date or default - return date only
    const dateParts = date.toISOString().split('T')
    return dateParts[0] ?? value
  } catch {
    return value
  }
}

/**
 * Format a property value with special handling for xsd:boolean and temporal types
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

  // Handle xsd:date, xsd:dateTime, xsd:time - format appropriately, datatype shown separately
  if (datatype === 'xsd:date' || datatype?.endsWith('#date') ||
      datatype === 'xsd:dateTime' || datatype?.endsWith('#dateTime') ||
      datatype === 'xsd:time' || datatype?.endsWith('#time')) {
    return formatTemporalValue(value, datatype)
  }

  return value
}

/**
 * Format a datatype URI to short prefixed form
 * @param datatype - Full URI or short form
 * @returns Short prefixed form (e.g., "xsd:decimal")
 */
export function formatDatatype(datatype: string): string {
  if (!datatype) return ''
  // Already short form
  if (datatype.startsWith('xsd:') || datatype.startsWith('rdf:')) return datatype
  // XSD namespace
  if (datatype.includes('XMLSchema#')) {
    return 'xsd:' + datatype.split('#').pop()
  }
  // RDF namespace
  if (datatype.includes('rdf-syntax-ns#')) {
    return 'rdf:' + datatype.split('#').pop()
  }
  // Fallback: extract fragment
  if (datatype.includes('#')) {
    return datatype.split('#').pop() || datatype
  }
  return datatype
}

/**
 * Get display label for a ConceptRef (notation + label if both exist)
 * @param ref - The concept reference
 * @returns The formatted display label
 */
export function getRefLabel(ref: ConceptRef, options?: { includeNotation?: boolean }): string {
  const includeNotation = options?.includeNotation !== false
  const label = ref.label || getUriFragment(ref.uri) || ref.uri
  if (!includeNotation) {
    return label
  }
  if (ref.notation && ref.label) {
    return `${ref.notation} - ${label}`
  }
  return ref.notation || label
}
