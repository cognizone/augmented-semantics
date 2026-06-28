import { describe, it, expect } from 'vitest'
import { useTypeConfigStore } from '../typeConfig'

const T = 'http://data.europa.eu/s66#MonetaryAmount'

describe('useTypeConfigStore', () => {
  it('returns {} for unconfigured types', () => {
    expect(useTypeConfigStore().get(T)).toEqual({})
  })

  it('sets and merges patches', () => {
    const s = useTypeConfigStore()
    s.set(T, { render: 'embed' })
    expect(s.get(T)).toEqual({ render: 'embed' })
    s.set(T, { sidebar: 'pin' })
    expect(s.get(T)).toEqual({ render: 'embed', sidebar: 'pin' })
  })

  it('drops a key set to undefined, and the entry when it becomes empty', () => {
    const s = useTypeConfigStore()
    s.set(T, { render: 'embed' })
    s.set(T, { render: undefined })
    expect(s.get(T)).toEqual({})
    expect(s.config[T]).toBeUndefined()
  })
})
