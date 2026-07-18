/**
 * Facet selections <-> ?filters round-trip (the store half of B).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFacetStore, useEndpointStore, useBrowseStore } from '../index'
import { facetTermKey } from '../facets'

vi.mock('../../services', async (orig) => {
  const actual = await orig<typeof import('../../services')>()
  return {
    ...actual,
    executeSparql: vi.fn(async () => ({ results: { bindings: [] } })),
    resolveUris: vi.fn(async () => new Map()),
  }
})

const TYPE = 'http://t/Org'
const P_STATUS = 'http://p/status'
const P_COST = 'http://p/cost'

function setup() {
  const endpoint = useEndpointStore()
  endpoint.endpoints = [{
    id: 'e1', name: 'E', url: 'http://x/sparql',
    types: {
      [TYPE]: {
        facets: [
          { predicate: P_STATUS, label: 'Status' },
          { predicate: P_COST, label: 'Cost', ranges: [{ max: 100 }, { min: 100 }] },
        ],
      },
    },
  } as any]
  ;(endpoint as any).currentId = 'e1'
  useBrowseStore().setType(TYPE)
  return useFacetStore()
}

describe('facet ?filters round-trip', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('serializes value + range selections and restores them', () => {
    const store = setup()
    expect(store.serialize()).toBeNull()

    const term = { value: 'CLOSED', isUri: false }
    store.toggleValue(P_STATUS, { key: facetTermKey(term), term, label: 'CLOSED', count: 0 })
    store.toggleRange(P_COST, 1)

    const enc = store.serialize()
    expect(enc).not.toBeNull()
    const parsed = JSON.parse(enc!)
    expect(parsed).toContainEqual([0, 'v', [['l', 'CLOSED', '', '']]])
    expect(parsed).toContainEqual([1, 'r', [1]])

    store.clearAll()
    expect(store.serialize()).toBeNull()

    store.applyEncoded(enc!)
    expect(store.isValueSelected(P_STATUS, facetTermKey(term))).toBe(true)
    expect(store.isRangeSelected(P_COST, 1)).toBe(true)
    expect(store.serialize()).toBe(enc)
  })

  it('preserves URI value terms and language/datatype on literals', () => {
    const store = setup()
    const uri = { value: 'http://v/SME', isUri: true }
    store.toggleValue(P_STATUS, { key: facetTermKey(uri), term: uri, label: 'SME', count: 0 })
    const enc = store.serialize()!
    expect(JSON.parse(enc)).toContainEqual([0, 'v', [['u', 'http://v/SME']]])
    store.clearAll()
    store.applyEncoded(enc)
    expect(store.isValueSelected(P_STATUS, facetTermKey(uri))).toBe(true)
  })

  it('ignores malformed / out-of-range / kind-mismatched payloads', () => {
    const store = setup()
    expect(() => store.applyEncoded('not json')).not.toThrow()
    expect(store.serialize()).toBeNull()
    // index 9 doesn't exist; a range payload on a value facet (0) is a kind mismatch
    store.applyEncoded(JSON.stringify([[9, 'v', [['u', 'http://x']]], [0, 'r', [0]]]))
    expect(store.serialize()).toBeNull()
    // a range band index beyond the facet's bands is dropped
    store.applyEncoded(JSON.stringify([[1, 'r', [5]]]))
    expect(store.isRangeSelected(P_COST, 5)).toBe(false)
    expect(store.serialize()).toBeNull()
  })
})
