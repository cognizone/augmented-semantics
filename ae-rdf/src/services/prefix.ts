/**
 * Prefix Resolution Service
 *
 * Resolves URIs to qualified names (e.g., http://purl.org/dc/terms/title → dct:title)
 * using prefix.cc API with localStorage caching.
 *
 * @see /spec/ideas.md
 */
import { logger } from './logger'

const STORAGE_KEY = 'ae-prefixes'
const PREFIX_CC_API = 'https://prefix.cc/reverse'

// Common RDF prefixes (fallback when prefix.cc is unavailable)
const COMMON_PREFIXES: Record<string, string> = {
  // W3C standards
  'http://www.w3.org/2000/01/rdf-schema#': 'rdfs',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#': 'rdf',
  'http://www.w3.org/2002/07/owl#': 'owl',
  'http://www.w3.org/2001/XMLSchema#': 'xsd',
  'http://www.w3.org/2004/02/skos/core#': 'skos',
  'http://www.w3.org/2008/05/skos-xl#': 'skosxl',
  'http://www.w3.org/ns/shacl#': 'sh',
  'http://www.w3.org/ns/prov#': 'prov',
  'http://www.w3.org/ns/dcat#': 'dcat',
  'http://www.w3.org/ns/adms#': 'adms',
  'http://www.w3.org/ns/org#': 'org',
  'http://www.w3.org/ns/locn#': 'locn',
  'http://www.w3.org/ns/person#': 'person',
  'http://www.w3.org/2006/vcard/ns#': 'vcard',
  'http://www.w3.org/ns/sparql-service-description#': 'sd',
  'http://www.w3.org/2007/05/powder-s#': 'wdrs',
  'http://www.w3.org/2003/01/geo/wgs84_pos#': 'geo',
  // Dublin Core
  'http://purl.org/dc/terms/': 'dct',
  'http://purl.org/dc/elements/1.1/': 'dc',
  // Common vocabularies
  'http://xmlns.com/foaf/0.1/': 'foaf',
  'http://schema.org/': 'schema',
  'https://schema.org/': 'schema',
  'http://rdfs.org/ns/void#': 'void',
  'http://purl.org/vocab/vann/': 'vann',
  'http://creativecommons.org/ns#': 'cc',
  'http://www.opengis.net/ont/geosparql#': 'gsp',
  'http://purl.org/linked-data/cube#': 'qb',
  // EU vocabularies
  'http://publications.europa.eu/ontology/euvoc#': 'euvoc',
  'http://data.europa.eu/eli/ontology#': 'eli',
  'http://data.europa.eu/m8g/': 'cv',
  'http://publications.europa.eu/resource/authority/': 'at',
  'http://eurovoc.europa.eu/': 'eurovoc',
  // Other common
  'http://purl.org/ontology/bibo/': 'bibo',
  'http://www.w3.org/2006/time#': 'time',
  'http://purl.org/NET/c4dm/event.owl#': 'event',
  'http://www.w3.org/ns/oa#': 'oa',
  'http://www.w3.org/ns/ldp#': 'ldp',
  'http://www.w3.org/ns/hydra/core#': 'hydra',
  'http://www.w3.org/ns/solid/terms#': 'solid',
}

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
 * Get prefix from common prefixes map
 */
function getCommonPrefix(namespace: string): string | null {
  return COMMON_PREFIXES[namespace] ?? null
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
