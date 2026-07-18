/**
 * endpointMatch - URL-aware endpoint ownership.
 *
 * Given a resource URI, decide which configured endpoint OWNS it (serves its
 * resources), so the app can auto-switch the active endpoint when a foreign
 * resource URI is entered/opened. Pure + deterministic — no store, no I/O.
 *
 * @see /spec/ae-rdf
 */
import type { SPARQLEndpoint } from '../types'
import { validateURI } from '../services'

/**
 * Signal tiers, strongest first. An endpoint's ownership of a URI is scored by
 * the STRONGEST tier that yields a prefix match, and within a tier by the
 * LONGEST matching prefix (classic longest-prefix routing). Higher tier always
 * beats a longer match in a weaker tier.
 */
const TIER = {
  /** (a) Explicitly declared resource namespaces — the endpoint says "these are mine". */
  RESOURCE_NS: 4,
  /** (b) Namespaces of the endpoint's declared prefix map values. */
  PREFIX_NS: 3,
  /** (c) The endpoint's own SPARQL URL host (origin). */
  URL_HOST: 2,
  /** (d) Namespaces derived from the endpoint's typeInventory URIs (host + first path segment). */
  TYPE_INVENTORY: 1,
} as const

interface Score {
  tier: number
  len: number
}

/** A URI is a stronger score than another when its tier is higher, or same tier
 *  but a longer matching prefix. */
function stronger(a: Score, b: Score): boolean {
  return a.tier > b.tier || (a.tier === b.tier && a.len > b.len)
}

function sameScore(a: Score, b: Score): boolean {
  return a.tier === b.tier && a.len === b.len
}

/** Origin (`scheme://host`) of a URI, or null if unparseable. */
function origin(uri: string): string | null {
  try {
    return new URL(uri).origin
  } catch {
    return null
  }
}

/** Namespace derived from a type/vocabulary URI: origin + first path segment
 *  (e.g. `http://data.europa.eu/s66#Project` → `http://data.europa.eu/s66`,
 *  `https://cube.link/Observation` → `https://cube.link/Observation`). */
function namespaceOfTypeUri(uri: string): string | null {
  try {
    const u = new URL(uri)
    const seg = u.pathname.split('/').filter(Boolean)[0]
    return seg ? `${u.origin}/${seg}` : `${u.origin}/`
  } catch {
    return null
  }
}

/** The best (strongest) ownership score an endpoint has for `uri`, or null when
 *  none of its signals match. `uri` is assumed already validated http(s). */
function scoreEndpoint(uri: string, endpoint: SPARQLEndpoint): Score | null {
  let best: Score | null = null
  const consider = (tier: number, ns: string | null | undefined) => {
    if (!ns) return
    if (!uri.startsWith(ns)) return
    const candidate: Score = { tier, len: ns.length }
    if (!best || stronger(candidate, best)) best = candidate
  }

  // (a) declared resource namespaces
  for (const ns of endpoint.resourceNamespaces ?? []) consider(TIER.RESOURCE_NS, ns)
  // (b) declared prefix namespaces (values)
  for (const ns of Object.values(endpoint.prefixes ?? {})) consider(TIER.PREFIX_NS, ns)
  // (c) endpoint's own SPARQL URL host
  const host = origin(endpoint.url)
  if (host) consider(TIER.URL_HOST, `${host}/`)
  // (d) namespaces derived from typeInventory URIs
  for (const t of endpoint.typeInventory ?? []) consider(TIER.TYPE_INVENTORY, namespaceOfTypeUri(t.uri))

  return best
}

/**
 * The single endpoint that owns `uri`, or null when nothing matches, the URI is
 * not an http(s) URI, or the best score is a TIE between two endpoints (never
 * guess). Deterministic: given the same inputs it always returns the same result.
 */
export function endpointForUri(
  uri: string,
  endpoints: SPARQLEndpoint[]
): SPARQLEndpoint | null {
  const validated = validateURI(uri)
  if (!validated) return null
  // http(s) only — validateURI also passes urn:, which has no host to match.
  if (!/^https?:\/\//i.test(validated)) return null

  let winner: SPARQLEndpoint | null = null
  let winnerScore: Score | null = null
  let tied = false

  for (const endpoint of endpoints) {
    const score = scoreEndpoint(validated, endpoint)
    if (!score) continue
    if (!winnerScore || stronger(score, winnerScore)) {
      winner = endpoint
      winnerScore = score
      tied = false
    } else if (sameScore(score, winnerScore)) {
      tied = true
    }
  }

  return tied ? null : winner
}
