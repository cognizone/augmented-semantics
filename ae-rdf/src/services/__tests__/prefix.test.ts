import { describe, it, expect, beforeEach } from 'vitest'
import { setConfigPrefixes, getKnownPrefixes, getDisplayPrefixes, resolveUris, clearPrefixCache } from '../prefix'

beforeEach(() => {
  clearPrefixCache()
  setConfigPrefixes({})
})

describe('config-declared prefixes', () => {
  it('resolve to qnames without hitting prefix.cc (config namespaces only)', async () => {
    setConfigPrefixes({ eurio: 'http://data.europa.eu/s66#' })
    const m = await resolveUris(['http://data.europa.eu/s66#Project'])
    expect(m.get('http://data.europa.eu/s66#Project')).toEqual({ prefix: 'eurio', localName: 'Project' })
  })

  it('take precedence over the built-in common prefixes', async () => {
    // Re-map the xsd namespace to a custom prefix; config should win.
    setConfigPrefixes({ myxsd: 'http://www.w3.org/2001/XMLSchema#' })
    const m = await resolveUris(['http://www.w3.org/2001/XMLSchema#decimal'])
    expect(m.get('http://www.w3.org/2001/XMLSchema#decimal')?.prefix).toBe('myxsd')
  })

  it('getKnownPrefixes returns declared prefixes for export', () => {
    setConfigPrefixes({ eurio: 'http://data.europa.eu/s66#' })
    expect(getKnownPrefixes()).toMatchObject({ eurio: 'http://data.europa.eu/s66#' })
  })

  it('getDisplayPrefixes includes built-in common prefixes (e.g. xsd)', () => {
    expect(getDisplayPrefixes().xsd).toBe('http://www.w3.org/2001/XMLSchema#')
  })
})
