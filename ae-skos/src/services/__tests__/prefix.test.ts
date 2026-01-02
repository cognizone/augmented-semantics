/**
 * Prefix Service Tests
 *
 * Tests for URI to qualified name resolution using common prefixes and prefix.cc
 * @see /spec/common/com05-SPARQLPatterns.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  resolveUri,
  resolveUris,
  formatQualifiedName,
  clearPrefixCache,
} from '../prefix'

// Mock fetch for prefix.cc API calls
global.fetch = vi.fn()

// Mock localStorage
const localStorageMock = {
  store: {} as Record<string, string>,
  getItem: vi.fn((key: string) => localStorageMock.store[key] || null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageMock.store[key] = value
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageMock.store[key]
  }),
  clear: vi.fn(() => {
    localStorageMock.store = {}
  }),
}
Object.defineProperty(global, 'localStorage', { value: localStorageMock })

describe('formatQualifiedName', () => {
  it('formats prefix:localName when prefix exists', () => {
    expect(formatQualifiedName({ prefix: 'dct', localName: 'created' })).toBe('dct:created')
  })

  it('returns just localName when prefix is empty', () => {
    expect(formatQualifiedName({ prefix: '', localName: 'created' })).toBe('created')
  })
})

describe('resolveUri', () => {
  beforeEach(() => {
    clearPrefixCache()
    vi.mocked(fetch).mockReset()
    localStorageMock.clear()
  })

  it('resolves common prefixes without API call', async () => {
    const result = await resolveUri('http://purl.org/dc/terms/created')
    expect(result).toEqual({ prefix: 'dct', localName: 'created' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('resolves skos namespace', async () => {
    const result = await resolveUri('http://www.w3.org/2004/02/skos/core#prefLabel')
    expect(result).toEqual({ prefix: 'skos', localName: 'prefLabel' })
  })

  it('resolves rdfs namespace', async () => {
    const result = await resolveUri('http://www.w3.org/2000/01/rdf-schema#label')
    expect(result).toEqual({ prefix: 'rdfs', localName: 'label' })
  })

  it('resolves skosxl namespace', async () => {
    const result = await resolveUri('http://www.w3.org/2008/05/skos-xl#literalForm')
    expect(result).toEqual({ prefix: 'skosxl', localName: 'literalForm' })
  })

  it('resolves schema.org (http)', async () => {
    const result = await resolveUri('http://schema.org/name')
    expect(result).toEqual({ prefix: 'schema', localName: 'name' })
  })

  it('resolves schema.org (https)', async () => {
    const result = await resolveUri('https://schema.org/name')
    expect(result).toEqual({ prefix: 'schema', localName: 'name' })
  })

  it('returns null for invalid URI without namespace', async () => {
    const result = await resolveUri('notauri')
    expect(result).toBeNull()
  })

  it('handles hash-separated namespaces', async () => {
    const result = await resolveUri('http://www.w3.org/2002/07/owl#Class')
    expect(result).toEqual({ prefix: 'owl', localName: 'Class' })
  })

  it('handles slash-separated namespaces', async () => {
    const result = await resolveUri('http://xmlns.com/foaf/0.1/name')
    expect(result).toEqual({ prefix: 'foaf', localName: 'name' })
  })

  it('falls back to prefix.cc for unknown namespaces', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ 'custom': 'http://custom.org/' }),
    } as Response)

    const result = await resolveUri('http://custom.org/property')
    expect(result).toEqual({ prefix: 'custom', localName: 'property' })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('prefix.cc/reverse')
    )
  })

  it('returns empty prefix when prefix.cc fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'))

    const result = await resolveUri('http://unknown.org/property')
    expect(result).toEqual({ prefix: '', localName: 'property' })
  })

  it('caches results in localStorage', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ 'cached': 'http://cached.org/' }),
    } as Response)

    await resolveUri('http://cached.org/property')
    expect(localStorageMock.setItem).toHaveBeenCalled()
  })
})

describe('resolveUris', () => {
  beforeEach(() => {
    clearPrefixCache()
    vi.mocked(fetch).mockReset()
    localStorageMock.clear()
  })

  it('resolves multiple URIs in batch', async () => {
    const uris = [
      'http://purl.org/dc/terms/created',
      'http://purl.org/dc/terms/modified',
      'http://www.w3.org/2000/01/rdf-schema#label',
    ]

    const results = await resolveUris(uris)

    expect(results.get('http://purl.org/dc/terms/created')).toEqual({
      prefix: 'dct',
      localName: 'created',
    })
    expect(results.get('http://purl.org/dc/terms/modified')).toEqual({
      prefix: 'dct',
      localName: 'modified',
    })
    expect(results.get('http://www.w3.org/2000/01/rdf-schema#label')).toEqual({
      prefix: 'rdfs',
      localName: 'label',
    })
  })

  it('does not call API for common prefixes', async () => {
    const uris = [
      'http://purl.org/dc/terms/created',
      'http://www.w3.org/2004/02/skos/core#prefLabel',
    ]

    await resolveUris(uris)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('prioritizes common prefixes over cache', async () => {
    // Simulate a stale cache entry with null value
    localStorageMock.store['ae-prefixes'] = JSON.stringify({
      'http://purl.org/dc/terms/': null, // Stale null from failed lookup
    })

    const result = await resolveUris(['http://purl.org/dc/terms/created'])

    // Should still resolve from COMMON_PREFIXES, not cache
    expect(result.get('http://purl.org/dc/terms/created')).toEqual({
      prefix: 'dct',
      localName: 'created',
    })
  })

  it('handles mixed known and unknown namespaces', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ 'unknown': 'http://unknown.org/' }),
    } as Response)

    const uris = [
      'http://purl.org/dc/terms/created',
      'http://unknown.org/property',
    ]

    const results = await resolveUris(uris)

    expect(results.get('http://purl.org/dc/terms/created')).toEqual({
      prefix: 'dct',
      localName: 'created',
    })
    expect(results.get('http://unknown.org/property')).toEqual({
      prefix: 'unknown',
      localName: 'property',
    })
  })

  it('returns empty map for empty input', async () => {
    const results = await resolveUris([])
    expect(results.size).toBe(0)
  })
})

describe('COMMON_PREFIXES coverage', () => {
  beforeEach(() => {
    clearPrefixCache()
  })

  const testCases = [
    ['http://www.w3.org/2000/01/rdf-schema#', 'rdfs'],
    ['http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'rdf'],
    ['http://www.w3.org/2002/07/owl#', 'owl'],
    ['http://www.w3.org/2001/XMLSchema#', 'xsd'],
    ['http://www.w3.org/2004/02/skos/core#', 'skos'],
    ['http://www.w3.org/2008/05/skos-xl#', 'skosxl'],
    ['http://www.w3.org/ns/shacl#', 'sh'],
    ['http://www.w3.org/ns/prov#', 'prov'],
    ['http://www.w3.org/ns/dcat#', 'dcat'],
    ['http://purl.org/dc/terms/', 'dct'],
    ['http://purl.org/dc/elements/1.1/', 'dc'],
    ['http://xmlns.com/foaf/0.1/', 'foaf'],
    ['http://schema.org/', 'schema'],
    ['http://rdfs.org/ns/void#', 'void'],
    ['http://publications.europa.eu/ontology/euvoc#', 'euvoc'],
    ['http://data.europa.eu/eli/ontology#', 'eli'],
  ]

  it.each(testCases)('resolves %s to %s', async (namespace, expectedPrefix) => {
    const result = await resolveUri(`${namespace}testProperty`)
    expect(result?.prefix).toBe(expectedPrefix)
  })
})
