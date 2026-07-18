import { describe, it, expect } from 'vitest'
import { endpointForUri } from '../endpointMatch'
import type { SPARQLEndpoint } from '../../types'

function ep(overrides: Partial<SPARQLEndpoint> = {}): SPARQLEndpoint {
  return {
    id: 'x',
    name: 'E',
    url: 'https://e.org/sparql',
    createdAt: '',
    accessCount: 0,
    ...overrides,
  }
}

const lindas = ep({
  id: 'lindas',
  name: 'LINDAS',
  url: 'https://lindas.admin.ch/query',
  resourceNamespaces: ['https://ld.admin.ch/', 'https://energy.ld.admin.ch/'],
  prefixes: { schema: 'http://schema.org/' },
  typeInventory: [{ uri: 'https://cube.link/Observation', count: 1 }],
})

const cordis = ep({
  id: 'cordis',
  name: 'Cordis Datalab',
  url: 'https://cordis.europa.eu/datalab/sparql',
  resourceNamespaces: ['http://data.europa.eu/s66/'],
  typeInventory: [{ uri: 'http://data.europa.eu/s66#Project', count: 1 }],
})

describe('endpointForUri', () => {
  it('matches on an exact declared resourceNamespace (the flagship example)', () => {
    const uri = 'https://energy.ld.admin.ch/elcom/electricityprice/operator/258'
    expect(endpointForUri(uri, [cordis, lindas])?.id).toBe('lindas')
  })

  it('resourceNamespace (tier a) wins over another endpoint`s weaker signals', () => {
    // A URI that CORDIS only reaches via its URL host, but LINDAS declares.
    const both = ep({
      id: 'other',
      name: 'Other',
      // URL host origin match (tier c) on the same host, longer literal but weaker tier.
      url: 'https://energy.ld.admin.ch/sparql',
    })
    const uri = 'https://energy.ld.admin.ch/elcom/operator/1'
    // LINDAS matches via resourceNamespace (tier a); `other` only via URL host (tier c).
    expect(endpointForUri(uri, [both, lindas])?.id).toBe('lindas')
  })

  it('falls back to the endpoint`s own SPARQL URL host', () => {
    const uri = 'https://cordis.europa.eu/datalab/some/resource'
    // Not under any resourceNamespace/prefix/typeInventory — only the URL host matches.
    expect(endpointForUri(uri, [lindas, cordis])?.id).toBe('cordis')
  })

  it('derives a namespace from typeInventory URIs (host + first path segment)', () => {
    const uri = 'http://data.europa.eu/s66/project/12345'
    // Matches CORDIS both via resourceNamespace and typeInventory-derived ns.
    expect(endpointForUri(uri, [lindas, cordis])?.id).toBe('cordis')
  })

  it('returns null on an ambiguous tie between two endpoints', () => {
    const a = ep({ id: 'a', resourceNamespaces: ['https://shared.example/'] })
    const b = ep({ id: 'b', resourceNamespaces: ['https://shared.example/'] })
    expect(endpointForUri('https://shared.example/thing/1', [a, b])).toBeNull()
  })

  it('breaks a would-be tie by longest matching prefix within the same tier', () => {
    const broad = ep({ id: 'broad', resourceNamespaces: ['https://shared.example/'] })
    const narrow = ep({ id: 'narrow', resourceNamespaces: ['https://shared.example/energy/'] })
    expect(endpointForUri('https://shared.example/energy/x', [broad, narrow])?.id).toBe('narrow')
  })

  it('returns null for a non-http(s) URI', () => {
    expect(endpointForUri('urn:isbn:0451450523', [lindas, cordis])).toBeNull()
    expect(endpointForUri('ftp://energy.ld.admin.ch/x', [lindas])).toBeNull()
  })

  it('returns null for a malformed / non-URI string', () => {
    expect(endpointForUri('not a uri', [lindas, cordis])).toBeNull()
    expect(endpointForUri('', [lindas])).toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(endpointForUri('https://unrelated.example/thing', [lindas, cordis])).toBeNull()
  })

  it('the current endpoint also matching is fine — the best owner is still returned', () => {
    // `cordis` matches the URI (its own host) AND `lindas` matches via resourceNamespace;
    // the LINDAS URI must resolve to LINDAS regardless of list order / which is "current".
    const uri = 'https://ld.admin.ch/canton/1'
    expect(endpointForUri(uri, [cordis, lindas])?.id).toBe('lindas')
    expect(endpointForUri(uri, [lindas, cordis])?.id).toBe('lindas')
  })
})
