import { describe, it, expect } from 'vitest'
import { acquireSlot, SPARQL_MAX_CONCURRENT } from '../http'

describe('acquireSlot (per-endpoint concurrency gate)', () => {
  it(`admits ${SPARQL_MAX_CONCURRENT} at once and queues the rest until a slot frees`, async () => {
    const key = 'http://gate-a.example' // its own gate, isolated from other tests
    const releases: Array<() => void> = []
    for (let i = 0; i < SPARQL_MAX_CONCURRENT; i++) releases.push(await acquireSlot(key))

    // The (MAX+1)th must WAIT — its promise stays pending until a slot is released.
    let admitted = false
    const extra = acquireSlot(key).then(r => { admitted = true; return r })
    await Promise.resolve() // flush microtasks: still blocked
    expect(admitted).toBe(false)

    releases[0]!()           // free one slot → the waiter runs
    const extraRelease = await extra
    expect(admitted).toBe(true)

    extraRelease()
    for (let i = 1; i < releases.length; i++) releases[i]!()
  })

  it('release is idempotent — a double-call never over-admits', async () => {
    const key = 'http://gate-b.example'
    const r = await acquireSlot(key)
    r(); r() // must leave active at 0, not -1

    const held: Array<() => void> = []
    for (let i = 0; i < SPARQL_MAX_CONCURRENT; i++) held.push(await acquireSlot(key))
    // If the double-release had corrupted the count, this extra would admit immediately.
    let admitted = false
    const extra = acquireSlot(key).then(rel => { admitted = true; return rel })
    await Promise.resolve()
    expect(admitted).toBe(false)

    held[0]!()
    const extraRelease = await extra
    extraRelease()
    for (let i = 1; i < held.length; i++) held[i]!()
  })
})
