/**
 * Prefix Resolution Service
 *
 * Resolves URIs to qualified names (e.g., http://purl.org/dc/terms/title → dct:title)
 * using prefix.cc API with localStorage caching.
 *
 * @see /spec/ideas.md
 */
import { logger } from './logger'
// The single, committed namespace→prefix map — the ONE source of truth shared by
// the app (rendering / legend / injection), the gen-prefixes script, and the
// endpoint profiler, so a namespace resolves to the SAME prefix everywhere.
// Edit prefix-map.json to add a prefix; never hard-code one here.
import prefixMap from './prefix-map.json'

const STORAGE_KEY = 'ae-prefixes'
const PREFIX_CC_API = 'https://prefix.cc/reverse'

const COMMON_PREFIXES: Record<string, string> = prefixMap

interface PrefixCache {
  [namespace: string]: string | null // namespace → prefix (null = not found)
}

interface ResolvedUri {
  prefix: string
  localName: string
}

// In-memory cache (loaded from localStorage)
let cache: PrefixCache = {}
let cacheLoaded = false

// Config-declared prefixes (namespace → prefix), highest precedence. Seeded from
// app.json at boot (setConfigPrefixes), so deployments render custom-vocab qnames
// correctly and without depending on prefix.cc at runtime.
let configNsToPrefix: Record<string, string> = {}
// Prefixes declared by the ACTIVE endpoint (namespace → prefix), highest
// precedence. Swapped whenever the current endpoint changes, so prefix display
// is dynamic per endpoint instead of bloating the global app.json.
let endpointNsToPrefix: Record<string, string> = {}

function invert(prefixToNs: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [prefix, ns] of Object.entries(prefixToNs ?? {})) if (prefix && ns) out[ns] = prefix
  return out
}

/** Seed config-declared prefixes (prefix → namespace) from app.json. */
export function setConfigPrefixes(prefixToNs: Record<string, string> | undefined): void {
  configNsToPrefix = invert(prefixToNs)
}

/** Seed the active endpoint's declared prefixes (prefix → namespace). Replaces
 *  the previous endpoint's set — call on every endpoint switch. */
export function setEndpointPrefixes(prefixToNs: Record<string, string> | undefined): void {
  endpointNsToPrefix = invert(prefixToNs)
}

/**
 * Load cache from localStorage
 */
function loadCache(): void {
  if (cacheLoaded) return

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      cache = JSON.parse(stored)
      logger.debug('PrefixService', 'Loaded prefix cache', { count: Object.keys(cache).length })
    }
  } catch (e) {
    logger.warn('PrefixService', 'Failed to load prefix cache', { error: e })
    cache = {}
  }
  cacheLoaded = true
}

/**
 * Save cache to localStorage
 */
function saveCache(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch (e) {
    logger.warn('PrefixService', 'Failed to save prefix cache', { error: e })
  }
}

/**
 * Extract namespace from URI (everything up to last / or #)
 */
function extractNamespace(uri: string): { namespace: string; localName: string } | null {
  // Find last # or / position
  const hashIndex = uri.lastIndexOf('#')
  const slashIndex = uri.lastIndexOf('/')

  const splitIndex = Math.max(hashIndex, slashIndex)
  if (splitIndex === -1 || splitIndex === uri.length - 1) {
    return null
  }

  return {
    namespace: uri.substring(0, splitIndex + 1),
    localName: uri.substring(splitIndex + 1),
  }
}

/**
 * Get a declared prefix for a namespace. Precedence: active-endpoint prefixes >
 * app.json config prefixes > built-in common prefixes.
 */
function getCommonPrefix(namespace: string): string | null {
  return endpointNsToPrefix[namespace] ?? configNsToPrefix[namespace] ?? COMMON_PREFIXES[namespace] ?? null
}

/**
 * Fetch prefix from prefix.cc API (with common prefixes fallback)
 */
async function fetchPrefix(namespace: string): Promise<string | null> {
  // Check common prefixes first
  const commonPrefix = getCommonPrefix(namespace)
  if (commonPrefix) {
    logger.debug('PrefixService', 'Using common prefix', { namespace, prefix: commonPrefix })
    return commonPrefix
  }

  // Try prefix.cc API
  try {
    const url = `${PREFIX_CC_API}?uri=${encodeURIComponent(namespace)}&format=json`
    logger.debug('PrefixService', 'Fetching prefix', { namespace, url })

    const response = await fetch(url)
    if (!response.ok) {
      logger.debug('PrefixService', 'prefix.cc returned error', { status: response.status })
      return null
    }

    const data = await response.json()
    // Response format: { "prefix": "namespace" } - we want the key
    const prefixes = Object.keys(data)
    if (prefixes.length > 0) {
      const prefix = prefixes[0]!
      logger.debug('PrefixService', 'Resolved prefix', { namespace, prefix })
      return prefix
    }

    return null
  } catch (e) {
    logger.warn('PrefixService', 'Failed to fetch prefix', { namespace, error: e })
    return null
  }
}

/**
 * Resolve a single URI to qualified name
 */
export async function resolveUri(uri: string): Promise<ResolvedUri | null> {
  loadCache()

  const parts = extractNamespace(uri)
  if (!parts) {
    return null
  }

  const { namespace, localName } = parts

  // Check common prefixes first (always takes priority)
  const commonPrefix = getCommonPrefix(namespace)
  if (commonPrefix) {
    return { prefix: commonPrefix, localName }
  }

  // Check cache
  if (namespace in cache) {
    const prefix = cache[namespace]
    if (prefix === null || prefix === undefined) {
      // Previously looked up but not found - return local name only
      return { prefix: '', localName }
    }
    return { prefix, localName }
  }

  // Fetch from prefix.cc
  const prefix = await fetchPrefix(namespace)
  cache[namespace] = prefix
  saveCache()

  if (prefix === null) {
    return { prefix: '', localName }
  }

  return { prefix, localName }
}

/**
 * Batch resolve multiple URIs
 * Returns a Map of URI → ResolvedUri
 */
export async function resolveUris(uris: string[]): Promise<Map<string, ResolvedUri>> {
  loadCache()

  const results = new Map<string, ResolvedUri>()
  const namespacesToFetch = new Set<string>()

  // First pass: extract namespaces, check common prefixes and cache
  const uriParts = new Map<string, { namespace: string; localName: string }>()

  for (const uri of uris) {
    const parts = extractNamespace(uri)
    if (!parts) continue

    uriParts.set(uri, parts)

    // Check common prefixes first (always takes priority)
    const commonPrefix = getCommonPrefix(parts.namespace)
    if (commonPrefix) {
      // Already have it from common prefixes, no need to fetch
      continue
    }

    // Check cache, if not there add to fetch list
    if (!(parts.namespace in cache)) {
      namespacesToFetch.add(parts.namespace)
    }
  }

  // Fetch missing prefixes in parallel (only for non-common namespaces)
  if (namespacesToFetch.size > 0) {
    logger.debug('PrefixService', 'Batch fetching prefixes', { count: namespacesToFetch.size })

    const fetchPromises = Array.from(namespacesToFetch).map(async namespace => {
      const prefix = await fetchPrefix(namespace)
      cache[namespace] = prefix
    })

    await Promise.all(fetchPromises)
    saveCache()
  }

  // Build results - check common prefixes first, then cache
  for (const [uri, parts] of uriParts) {
    const commonPrefix = getCommonPrefix(parts.namespace)
    if (commonPrefix) {
      results.set(uri, {
        prefix: commonPrefix,
        localName: parts.localName,
      })
    } else {
      const prefix = cache[parts.namespace]
      results.set(uri, {
        prefix: prefix ?? '',
        localName: parts.localName,
      })
    }
  }

  return results
}

/**
 * Format a resolved URI as qualified name (prefix:localName or just localName)
 */
export function formatQualifiedName(resolved: ResolvedUri): string {
  if (resolved.prefix) {
    return `${resolved.prefix}:${resolved.localName}`
  }
  return resolved.localName
}

/**
 * Prefixes worth baking into an exported app.json: config-declared + the ones
 * prefix.cc resolved (the "extras" beyond the built-in common set). Returned as
 * prefix → namespace. The built-in common prefixes are intentionally omitted —
 * a deployed app already has them.
 */
export function getKnownPrefixes(): Record<string, string> {
  loadCache()
  const out: Record<string, string> = {}
  for (const [ns, p] of Object.entries(cache)) if (p) out[p] = ns
  for (const [ns, p] of Object.entries(configNsToPrefix)) out[p] = ns // config wins
  return out
}

/** All active prefix → namespace mappings (common + config + endpoint + resolved). */
export function getDisplayPrefixes(): Record<string, string> {
  loadCache()
  const out: Record<string, string> = {}
  for (const [ns, p] of Object.entries(COMMON_PREFIXES)) out[p] = ns
  for (const [ns, p] of Object.entries(cache)) if (p) out[p] = ns
  for (const [ns, p] of Object.entries(configNsToPrefix)) out[p] = ns
  for (const [ns, p] of Object.entries(endpointNsToPrefix)) out[p] = ns // endpoint-declared wins
  return out
}

/**
 * Legend prefixes SCOPED to the active endpoint: the built-in common prefixes are
 * kept only when their namespace is in `used` — the set of namespaces the endpoint
 * actually references (derived by the caller from its profiled types/predicates/
 * datatypes/ranges, plus a structural core). Runtime-resolved prefixes (empirically
 * seen in data) and config/endpoint-declared prefixes are always kept. This avoids
 * dumping the ~40 generic common prefixes an endpoint never uses.
 */
export function getEndpointDisplayPrefixes(used: Set<string>): Record<string, string> {
  loadCache()
  const out: Record<string, string> = {}
  // Built-in, globally-configured, and prefix.cc-resolved prefixes only count when
  // THIS endpoint actually references the namespace — no global list bleeds across
  // endpoints (a prefix resolved while browsing another dataset stays out of here).
  for (const [ns, p] of Object.entries(COMMON_PREFIXES)) if (used.has(ns)) out[p] = ns
  for (const [ns, p] of Object.entries(cache)) if (p && used.has(ns)) out[p] = ns
  for (const [ns, p] of Object.entries(configNsToPrefix)) if (used.has(ns)) out[p] = ns
  // Prefixes the endpoint itself declares are always kept — they're intentional.
  for (const [ns, p] of Object.entries(endpointNsToPrefix)) out[p] = ns
  return out
}

/**
 * Clear the prefix cache (for testing)
 */
export function clearPrefixCache(): void {
  cache = {}
  cacheLoaded = false
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore
  }
}
