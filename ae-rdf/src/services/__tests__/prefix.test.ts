import { describe, it, expect, beforeEach } from 'vitest'
import { setConfigPrefixes, setEndpointPrefixes, getKnownPrefixes, getDisplayPrefixes, getEndpointDisplayPrefixes, resolveUris, clearPrefixCache } from '../prefix'

beforeEach(() => {
  clearPrefixCache()
  setConfigPrefixes({})
  setEndpointPrefixes(undefined)
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

  it('getEndpointDisplayPrefixes: common + global-config prefixes only when the endpoint USES the namespace', () => {
    setConfigPrefixes({ eurio: 'http://data.europa.eu/s66#' })     // global (app.json) list
    const used = new Set(['http://www.w3.org/2001/XMLSchema#'])    // xsd used; skos/foaf/eurio not
    const legend = getEndpointDisplayPrefixes(used)
    expect(legend.xsd).toBe('http://www.w3.org/2001/XMLSchema#')   // used common → kept
    expect(legend.skos).toBeUndefined()                           // unused common → dropped
    expect(legend.foaf).toBeUndefined()
    expect(legend.eurio).toBeUndefined()                          // unused global-config → dropped (no cross-endpoint bleed)
  })

  it('getEndpointDisplayPrefixes: used global-config prefix shows; endpoint-declared always shows', () => {
    setConfigPrefixes({ eurio: 'http://data.europa.eu/s66#' })
    setEndpointPrefixes({ era: 'http://data.europa.eu/949/' })
    const used = new Set(['http://data.europa.eu/s66#'])           // s66 now referenced here
    const legend = getEndpointDisplayPrefixes(used)
    expect(legend.eurio).toBe('http://data.europa.eu/s66#')        // used → shown
    expect(legend.era).toBe('http://data.europa.eu/949/')          // endpoint-declared → shown even though ns not in `used`
  })
})
