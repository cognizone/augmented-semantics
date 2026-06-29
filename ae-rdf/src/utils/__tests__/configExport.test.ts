import { describe, it, expect } from 'vitest'
import { buildAppConfig } from '../configExport'
import type { SPARQLEndpoint } from '../../types'

function ep(overrides: Partial<SPARQLEndpoint> = {}): SPARQLEndpoint {
  return { id: 'x', name: 'E', url: 'https://e.org/sparql', createdAt: '', accessCount: 0, ...overrides }
}

describe('buildAppConfig', () => {
  it('omits empty sections', () => {
    expect(buildAppConfig({ endpoints: [], types: {} })).toEqual({})
  })

  it('maps endpoints to name+url and includes types', () => {
    const config = buildAppConfig({
      endpoints: [ep({ name: 'CORDIS', url: 'https://cordis/sparql' })],
      types: { 'http://x#Amount': { render: 'embed' } },
    })
    expect(config.endpoints).toEqual([{ name: 'CORDIS', url: 'https://cordis/sparql' }])
    expect(config.types).toEqual({ 'http://x#Amount': { render: 'embed' } })
  })

  it('exports auth type but NEVER credentials', () => {
    const config = buildAppConfig({
      endpoints: [ep({ auth: { type: 'basic', credentials: { username: 'u', password: 'p' } } })],
      types: {},
    })
    expect(config.endpoints![0].auth).toEqual({ type: 'basic' })
    expect(JSON.stringify(config)).not.toContain('password')
    expect(JSON.stringify(config)).not.toContain('"u"')
  })

  it('drops auth entirely when type is none', () => {
    const config = buildAppConfig({ endpoints: [ep({ auth: { type: 'none' } })], types: {} })
    expect(config.endpoints![0].auth).toBeUndefined()
  })

  it('exports the endpoint graph config when set', () => {
    const config = buildAppConfig({
      endpoints: [ep({ graph: { quads: true, defaultView: 'merged' } })],
      types: {},
    })
    expect(config.endpoints![0].graph).toEqual({ quads: true, defaultView: 'merged' })
  })

  it('omits an empty graph config', () => {
    const config = buildAppConfig({ endpoints: [ep({ graph: {} })], types: {} })
    expect(config.endpoints![0].graph).toBeUndefined()
  })

  it('caches the type inventory when present, omits when empty', () => {
    const inv = [{ uri: 'http://x#Project', count: 42 }]
    expect(buildAppConfig({ endpoints: [], types: {}, typeInventory: inv }).typeInventory).toEqual(inv)
    expect(buildAppConfig({ endpoints: [], types: {}, typeInventory: [] }).typeInventory).toBeUndefined()
    expect(buildAppConfig({ endpoints: [], types: {} }).typeInventory).toBeUndefined()
  })

  it('includes app-level fields when present', () => {
    const config = buildAppConfig({ endpoints: [], types: {}, appName: 'My RDF', documentationUrl: 'https://d' })
    expect(config.appName).toBe('My RDF')
    expect(config.documentationUrl).toBe('https://d')
  })
})
