/**
 * Pure display formatting helpers for RDF terms.
 *
 * @see /spec/ae-rdf/rdf-overview.md (readability)
 */

/** Prefix-resolution map: IRI → { prefix, localName } (from `resolveUris`). */
export type ResolvedMap = Map<string, { prefix: string; localName: string }>

/** Local name of an IRI: the part after the last `#` or `/`. */
export function localName(uri: string): string {
  const seg = uri.split(/[#/]/).filter(Boolean).pop()
  return seg || uri
}

/** Qualified name (`prefix:local`) from a resolution map, falling back to the IRI. */
export function qname(uri: string, resolved: ResolvedMap): string {
  const r = resolved.get(uri)
  if (r?.prefix) return `${r.prefix}:${r.localName}`
  if (r?.localName) return r.localName
  return uri
}

/**
 * How URIs render, a user setting:
 * - 'humanized' (default): friendly — predicates humanized, objects show their label.
 * - 'prefixed':  technical — `prefix:local` qnames everywhere.
 * - 'full':      raw IRIs everywhere.
 */
export type UriDisplayMode = 'humanized' | 'prefixed' | 'full'

/** Predicate label per display mode. */
export function displayPredicate(uri: string, resolved: ResolvedMap, mode: UriDisplayMode): string {
  if (mode === 'full') return uri
  if (mode === 'prefixed') return qname(uri, resolved)
  return humanizeLocalName(uri)
}

/** Object IRI per display mode; in 'humanized' the fetched label wins when present. */
export function displayObject(uri: string, resolved: ResolvedMap, mode: UriDisplayMode, label?: string): string {
  if (mode === 'full') return uri
  if (mode === 'prefixed') return qname(uri, resolved)
  return label || qname(uri, resolved)
}

/** Type/class name per display mode (compact local name when humanized). */
export function displayType(uri: string, resolved: ResolvedMap, mode: UriDisplayMode): string {
  if (mode === 'full') return uri
  if (mode === 'prefixed') return qname(uri, resolved)
  return localName(uri)
}

// Tokens to keep upper-cased even when the source is lower/mixed case, so e.g.
// `rcn` → "RCN" rather than "Rcn".
const ACRONYMS = new Set([
  'rcn', 'id', 'uri', 'iri', 'url', 'isbn', 'issn', 'doi', 'api', 'html', 'xml',
  'rdf', 'owl', 'eli', 'pdf', 'uuid', 'eu', 'ec', 'gps',
])

/**
 * Human-friendly predicate label from an IRI: split camelCase and `_`/`-`, then
 * sentence-case — but preserve acronyms. `dateEndApplicability` → "Date end
 * applicability", `inForceStatus` → "In force status", `rcn`/`RCN` → "RCN",
 * `hasISBN` → "Has ISBN". The qname/URI stays available on hover.
 */
export function humanizeLocalName(uri: string): string {
  const words = localName(uri)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // ACRONYMWord boundary
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return localName(uri)
  return words
    .map((w, i) => {
      if (w.length > 1 && w === w.toUpperCase()) return w // already an acronym (RCN, ISBN)
      if (ACRONYMS.has(w.toLowerCase())) return w.toUpperCase() // known acronym
      const lower = w.toLowerCase()
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
    })
    .join(' ')
}
