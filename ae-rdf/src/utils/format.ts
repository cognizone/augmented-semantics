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
 * Human-friendly predicate label from an IRI: split camelCase and `_`/`-`,
 * then sentence-case. `dateEndApplicability` → "Date end applicability",
 * `inForceStatus` → "In force status". The qname/URI stays available on hover.
 */
export function humanizeLocalName(uri: string): string {
  const s = localName(uri)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // ACRONYMWord boundary
    .trim()
    .toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}
