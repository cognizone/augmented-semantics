import { describe, it, expect } from 'vitest'
import { useTypeConfigStore } from '../typeConfig'
import { useEndpointStore } from '../endpoint'

const T = 'http://data.europa.eu/s66#MonetaryAmount'

function connect() {
  const ep = useEndpointStore()
  const created = ep.addEndpoint({ name: 'E', url: 'https://e.org/sparql' })
  ep.selectEndpoint(created!.id)
  return ep
}

describe('useTypeConfigStore (per-endpoint)', () => {
  it('returns {} when there is no endpoint or the type is unconfigured', () => {
    expect(useTypeConfigStore().get(T)).toEqual({})
  })

  it('sets and merges on the current endpoint', () => {
    const ep = connect()
    const s = useTypeConfigStore()
    s.set(T, { render: 'embed' })
    expect(s.get(T)).toEqual({ render: 'embed' })
    expect(ep.current?.types?.[T]).toEqual({ render: 'embed' }) // persisted on the endpoint
    s.set(T, { sidebar: 'pin' })
    expect(s.get(T)).toEqual({ render: 'embed', sidebar: 'pin' })
  })

  it('drops a key set to undefined, and the entry when it becomes empty', () => {
    connect()
    const s = useTypeConfigStore()
    s.set(T, { render: 'embed' })
    s.set(T, { render: undefined })
    expect(s.get(T)).toEqual({})
  })
})
