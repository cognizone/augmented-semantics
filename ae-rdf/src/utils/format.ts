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

// Path segments too generic to make a useful prefix — skip them when guessing.
const GENERIC_NS_SEG = new Set([
  'terms', 'term', 'ontology', 'ontologies', 'schema', 'vocab', 'vocabulary',
  'ns', 'core', 'rdf', 'owl', 'def', 'resource', 'id', 'data', 'meta', 'model',
])

/**
 * Guess a short, human-ish prefix from an IRI's namespace, for when no registered
 * prefix (config / common list / prefix.cc) exists — so an exotic vocab still gets
 * an orientation tag instead of nothing. Last meaningful path segment, else the
 * first host label; lowercased, alphanumerics only, capped at 12 chars.
 * Orientation only — NOT a real qname (don't use for copy/serialization).
 */
export function guessPrefix(uri: string): string {
  let host: string, path: string
  try { const u = new URL(uri); host = u.hostname.replace(/^www\./, ''); path = u.pathname }
  catch { return '' }
  let segs = path.split('/').filter(Boolean)
  // For '/'-separated IRIs the last segment is the local name — drop it. For
  // '#'-separated the local name is in the fragment, so the last path seg is the ns.
  if (!uri.includes('#') && segs.length) segs = segs.slice(0, -1)
  for (let i = segs.length - 1; i >= 0; i--) {
    const raw = segs[i]!
    if (!raw.replace(/[^a-zA-Z0-9]/g, '') || GENERIC_NS_SEG.has(raw.toLowerCase())) continue
    return shorten(raw)
  }
  return (host.split('.')[0] ?? '').slice(0, 12)
}

// A long CamelCase segment (ClassificationUnit) reads better as its initials
// (cu) than a mid-word truncation (classificati); short segments pass through.
function shorten(seg: string): string {
  const caps = seg.match(/[A-Z]/g)
  if (seg.length > 8 && caps && caps.length >= 2) return caps.join('').toLowerCase().slice(0, 12)
  return seg.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 12)
}

export type MediaKind = 'image' | 'video' | 'audio'
const MEDIA_EXT: Record<string, MediaKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', bmp: 'image', svg: 'image',
  mp4: 'video', webm: 'video', ogv: 'video', mov: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio', aac: 'audio',
}

/**
 * Media kind implied by a URL's file extension (query/fragment ignored), or null
 * if it's not a recognised media file. Extension-only by design: a `Content-Type`
 * HEAD is CORS-gated and unreliable across file hosts. The CALLER must restrict to
 * http(s) and validate the URL before binding it to a src.
 */
export function mediaKind(url: string): MediaKind | null {
  const m = /\.([a-z0-9]{2,5})(?:[?#].*)?$/i.exec(url)
  return m ? (MEDIA_EXT[m[1]!.toLowerCase()] ?? null) : null
}

/**
 * Extract a bare DOI (`10.5281/zenodo.255473`) from a value in any of its common
 * shapes — resolver URL (`https://doi.org/…`, `dx.doi.org`), CURIE literal
 * (`doi:…`), or bare literal — or null if it isn't a DOI. Anchored end-to-end so a
 * bare `10.x/y` only matches when it's the whole value (avoids false positives).
 */
export function doiId(value: string): string | null {
  const v = value.trim()
  return (
    /^https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/\S+)$/i.exec(v)?.[1] ??
    /^doi:(10\.\d{4,9}\/\S+)$/i.exec(v)?.[1] ??
    /^(10\.\d{4,9}\/\S+)$/.exec(v)?.[1] ??
    null
  )
}

/** Canonical resolver URL for a bare DOI. */
export function doiUrl(id: string): string {
  return `https://doi.org/${id}`
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

/** Predicate label per display mode. A `^`-prefixed IRI is an INVERSE (incoming)
 *  predicate — an inverse-embedded referrer's synthetic group — shown with an
 *  incoming marker before the base predicate's label. */
export function displayPredicate(uri: string, resolved: ResolvedMap, mode: UriDisplayMode): string {
  if (uri.startsWith('^')) return `↤ ${displayPredicate(uri.slice(1), resolved, mode)}`
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

/**
 * Group a number's digits with thousands separators for display — `312500` →
 * `312,500`, sign and any fractional part preserved exactly (`1234.50` →
 * `1,234.50`). Returns null (caller keeps the raw value) when the string isn't a
 * plain decimal — scientific notation, non-numeric, empty — so a field ticked by
 * mistake never mangles text. Lossless: the integer part is grouped via BigInt,
 * so large values don't hit float precision limits.
 *
 * Datatype-BLIND on purpose: grouping is opt-in per field (TypeConfig.number),
 * because the source data types amounts inconsistently (xsd:decimal on some
 * MonetaryAmounts, plain xsd:string on others). We group by explicit choice, not
 * by datatype — so it works regardless of how the value happens to be typed, and
 * raw values in un-ticked fields (RCN, ids) are never touched.
 */
export function groupNumber(value: string): string | null {
  const m = /^([+-]?)(\d+)(\.\d+)?$/.exec(value.trim())
  if (!m) return null
  const [, sign, int, frac = ''] = m
  return sign + BigInt(int!).toLocaleString('en-US') + frac
}

/**
 * ISO 8601 dateTime → readable: drop the `T` date/time separator and the `Z`
 * UTC marker (the "extra letters"), keeping the numbers. `2024-01-15T10:30:00Z`
 * → `2024-01-15 10:30:00`; a numeric zone offset is kept, space-separated
 * (`…T10:30:00+01:00` → `… 10:30:00 +01:00`). Returns null (caller keeps the raw
 * value) when the string isn't an ISO dateTime — a plain `xsd:date`
 * (`2024-01-15`) has no `T`, so it never matches and renders untouched.
 *
 * Datatype-BLIND like groupNumber: the `T…` shape is specific enough that no
 * ordinary text matches, so it works regardless of how the value is typed.
 */
export function formatDateTime(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T([\d:.]+)(?:Z|([+-]\d{2}:\d{2}))?$/.exec(value.trim())
  if (!m) return null
  return `${m[1]} ${m[2]}${m[3] ? ' ' + m[3] : ''}`
}

/**
 * Display a literal value: thousands-group it when its field is ticked `number`,
 * else humanize an ISO dateTime. The two are mutually exclusive (a dateTime is
 * never a plain number), so one call covers every literal sink — table cell,
 * heading, composed label, via-label.
 */
export function formatLiteral(value: string, group: boolean): string {
  return (group ? groupNumber(value) : formatDateTime(value)) ?? value
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
