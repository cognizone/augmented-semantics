import { describe, it, expect } from 'vitest'
import { orderedByConfig, moveInOrder, toggleInList } from '../propertyOrder'

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
