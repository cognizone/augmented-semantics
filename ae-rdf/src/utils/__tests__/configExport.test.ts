import { describe, it, expect } from 'vitest'
import { buildAppConfig } from '../configExport'
import type { SPARQLEndpoint } from '../../types'

function ep(overrides: Partial<SPARQLEndpoint> = {}): SPARQLEndpoint {
  return { id: 'x', name: 'E', url: 'https://e.org/sparql', createdAt: '', accessCount: 0, ...overrides }
}

describe('buildAppConfig', () => {
  it('omits empty sections', () => {
    expect(buildAppConfig({ endpoints: [] })).toEqual({})
  })

  it('maps endpoints to name+url with per-endpoint types and inventory', () => {
    const config = buildAppConfig({
      endpoints: [
        ep({
          name: 'CORDIS',
          url: 'https://cordis/sparql',
          types: { 'http://x#Amount': { render: 'embed' } },
          typeInventory: [{ uri: 'http://x#Project', count: 42 }],
        }),
      ],
    })
    expect(config.endpoints![0]).toEqual({
      name: 'CORDIS',
      url: 'https://cordis/sparql',
      types: { 'http://x#Amount': { render: 'embed' } },
      typeInventory: [{ uri: 'http://x#Project', count: 42 }],
    })
    // no app-level types/typeInventory anymore
    expect((config as Record<string, unknown>).types).toBeUndefined()
    expect((config as Record<string, unknown>).typeInventory).toBeUndefined()
  })

  it('omits empty per-endpoint types / inventory', () => {
    const config = buildAppConfig({ endpoints: [ep({ types: {}, typeInventory: [] })] })
    expect(config.endpoints![0].types).toBeUndefined()
    expect(config.endpoints![0].typeInventory).toBeUndefined()
  })

  it('preserves the sidebar group on a type', () => {
    const config = buildAppConfig({
      endpoints: [ep({ types: { 'http://x#Class': { group: 'Ontology', sidebar: 'hide' } } })],
    })
    expect(config.endpoints![0].types).toEqual({ 'http://x#Class': { group: 'Ontology', sidebar: 'hide' } })
  })

  it('exports auth type but NEVER credentials', () => {
    const config = buildAppConfig({
      endpoints: [ep({ auth: { type: 'basic', credentials: { username: 'u', password: 'p' } } })],
    })
    expect(config.endpoints![0].auth).toEqual({ type: 'basic' })
    expect(JSON.stringify(config)).not.toContain('password')
    expect(JSON.stringify(config)).not.toContain('"u"')
  })

  it('exports the endpoint graph config, omitting when empty', () => {
    expect(buildAppConfig({ endpoints: [ep({ graph: { quads: true, defaultView: 'merged' } })] }).endpoints![0].graph)
      .toEqual({ quads: true, defaultView: 'merged' })
    expect(buildAppConfig({ endpoints: [ep({ graph: {} })] }).endpoints![0].graph).toBeUndefined()
  })

  it('includes global prefixes when present, omits when empty', () => {
    const p = { eurio: 'http://data.europa.eu/s66#' }
    expect(buildAppConfig({ endpoints: [], prefixes: p }).prefixes).toEqual(p)
    expect(buildAppConfig({ endpoints: [], prefixes: {} }).prefixes).toBeUndefined()
  })

  it('includes app-level fields when present', () => {
    const config = buildAppConfig({ endpoints: [], appName: 'My RDF', documentationUrl: 'https://d' })
    expect(config.appName).toBe('My RDF')
    expect(config.documentationUrl).toBe('https://d')
  })
})
