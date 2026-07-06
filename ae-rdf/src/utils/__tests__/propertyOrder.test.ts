import { describe, it, expect } from 'vitest'
import { orderedByConfig, moveInOrder, toggleInList, composeLabel, isAlwaysLast, sinkAlwaysLast, ALWAYS_LAST, headingParts } from '../propertyOrder'

const id = (s: string) => s
// fallback: plain alphabetical, to prove unlisted items keep a stable order
const alpha = (a: string, b: string) => a.localeCompare(b)

describe('orderedByConfig', () => {
  it('puts configured keys first in configured order, rest by fallback', () => {
    const items = ['title', 'date', 'name', 'id']
    expect(orderedByConfig(items, id, ['name', 'id'], alpha)).toEqual(['name', 'id', 'date', 'title'])
  })

  it('keeps fallback order when nothing is configured', () => {
    const items = ['c', 'a', 'b']
    expect(orderedByConfig(items, id, [], alpha)).toEqual(['a', 'b', 'c'])
  })

  it('ignores configured keys that are not present', () => {
    expect(orderedByConfig(['a', 'b'], id, ['z', 'b'], alpha)).toEqual(['b', 'a'])
  })

  it('does not mutate the input', () => {
    const items = ['b', 'a']
    orderedByConfig(items, id, ['a'], alpha)
    expect(items).toEqual(['b', 'a'])
  })
})

describe('headingParts', () => {
  const lit = (value: string) => ({ value, linked: false })
  const link = (value: string) => ({ value, linked: true })

  it('keeps all literals + only the FIRST linked entity by default', () => {
    // OrganisationRole = role (linked) + org (linked): default drops the org.
    expect(headingParts([link('Role'), link('Org')], false)).toEqual(['Role'])
    // literals always kept; extra linked entities dropped after the first.
    expect(headingParts([lit('AAPSL'), link('Org'), link('Project')], false)).toEqual(['AAPSL', 'Org'])
  })

  it('keeps every part when full (reified relationship: role + org)', () => {
    expect(headingParts([link('Role'), link('Org')], true)).toEqual(['Role', 'Org'])
  })

  it('is a no-op on all-literal parts', () => {
    expect(headingParts([lit('1902.6'), lit('EUR')], false)).toEqual(['1902.6', 'EUR'])
  })
})

describe('sinkAlwaysLast', () => {
  const REALIZED = ALWAYS_LAST[0]! // isRealizedBy
  const EMBODIED = ALWAYS_LAST[1]! // isEmbodiedBy

  it('flags configured predicates', () => {
    expect(isAlwaysLast(REALIZED)).toBe(true)
    expect(isAlwaysLast('http://example.org/other')).toBe(false)
  })

  it('sinks always-last predicates to the bottom even when order is empty', () => {
    const items = [REALIZED, 'a', EMBODIED, 'b']
    expect(orderedByConfig(items, id, [], sinkAlwaysLast(id))).toEqual(['a', 'b', REALIZED, EMBODIED])
  })

  it('keeps configured keys first, still sinks always-last below the rest', () => {
    const items = [REALIZED, 'a', 'b']
    expect(orderedByConfig(items, id, ['b'], sinkAlwaysLast(id))).toEqual(['b', 'a', REALIZED])
  })
})

describe('composeLabel', () => {
  const vals: Record<string, string> = { org: 'CHALMERS', role: 'associatedPartner', proj: '' }
  it('joins values in predicate order, skipping blanks', () => {
    expect(composeLabel(['org', 'role', 'proj'], p => vals[p])).toBe('CHALMERS · associatedPartner')
  })
  it('respects the given order', () => {
    expect(composeLabel(['role', 'org'], p => vals[p])).toBe('associatedPartner · CHALMERS')
  })
  it('returns empty string when nothing resolves', () => {
    expect(composeLabel(['proj', 'missing'], p => vals[p])).toBe('')
  })
})

describe('toggleInList', () => {
  it('adds when absent, removes when present, without mutating', () => {
    const list = ['a']
    expect(toggleInList(list, 'b')).toEqual(['a', 'b'])
    expect(toggleInList(list, 'a')).toEqual([])
    expect(list).toEqual(['a'])
  })
})

describe('moveInOrder', () => {
  it('moves an item down', () => {
    expect(moveInOrder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })
  it('moves an item up', () => {
    expect(moveInOrder(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })
  it('is a no-op for same / out-of-range indices and does not mutate', () => {
    const keys = ['a', 'b']
    expect(moveInOrder(keys, 1, 1)).toBe(keys)
    expect(moveInOrder(keys, 0, 5)).toBe(keys)
    expect(keys).toEqual(['a', 'b'])
  })
})
