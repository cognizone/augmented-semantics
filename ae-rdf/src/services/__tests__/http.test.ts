import { describe, it, expect } from 'vitest'
import { acquireSlot, SPARQL_DEFAULT_CONCURRENT } from '../http'

describe('acquireSlot (per-endpoint concurrency gate)', () => {
  it(`admits ${SPARQL_DEFAULT_CONCURRENT} at once and queues the rest until a slot frees`, async () => {
    const key = 'http://gate-a.example' // its own gate, isolated from other tests
    const releases: Array<() => void> = []
    for (let i = 0; i < SPARQL_DEFAULT_CONCURRENT; i++) releases.push(await acquireSlot(key))

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

  it('drains foreground before background even when background queued first', async () => {
    const key = 'http://gate-c.example'
    const held: Array<() => void> = []
    for (let i = 0; i < SPARQL_DEFAULT_CONCURRENT; i++) held.push(await acquireSlot(key))

    // Background waiter enqueues FIRST, foreground SECOND — plain FIFO would admit
    // the background one; the two-tier gate must admit the foreground one.
    let bgAdmitted = false, fgAdmitted = false
    const bg = acquireSlot(key, true).then(r => { bgAdmitted = true; return r })
    const fg = acquireSlot(key).then(r => { fgAdmitted = true; return r })
    await Promise.resolve()
    expect(bgAdmitted).toBe(false)
    expect(fgAdmitted).toBe(false)

    held[0]!()               // one slot frees → foreground jumps the queue
    const fgRelease = await fg
    expect(fgAdmitted).toBe(true)
    expect(bgAdmitted).toBe(false)

    // Background only admits once active drops BELOW its reserved-down budget
    // (cap − 2): freeing one slot isn't enough while 3 are still held.
    fgRelease()
    held[1]!()
    await Promise.resolve()
    expect(bgAdmitted).toBe(false)
    held[2]!()               // active 1 < bgCap 2 → background finally runs
    const bgRelease = await bg
    expect(bgAdmitted).toBe(true)

    bgRelease()
    held[3]!()
  })

  it('background never takes the reserved slots — foreground always finds room', async () => {
    const key = 'http://gate-e.example'
    const bg1 = await acquireSlot(key, true)
    const bg2 = await acquireSlot(key, true)
    // bgCap = default(4) − reserve(2) = 2 → a third background QUEUES even though
    // two slots are technically free…
    let bg3Admitted = false
    const bg3 = acquireSlot(key, true).then(r => { bg3Admitted = true; return r })
    await Promise.resolve()
    expect(bg3Admitted).toBe(false)
    // …while a foreground request admits instantly into the reserve.
    const fgRelease = await acquireSlot(key)
    fgRelease()
    bg1() // active drops below bgCap → the queued background admits
    const bg3Release = await bg3
    expect(bg3Admitted).toBe(true)
    bg3Release()
    bg2()
  })

  it('aborting a queued waiter removes it — the slot goes to the next waiter', async () => {
    const key = 'http://gate-d.example'
    const held: Array<() => void> = []
    for (let i = 0; i < SPARQL_DEFAULT_CONCURRENT; i++) held.push(await acquireSlot(key))

    const ac = new AbortController()
    const doomed = acquireSlot(key, false, ac.signal)
    let nextAdmitted = false
    const next = acquireSlot(key).then(r => { nextAdmitted = true; return r })

    ac.abort() // doomed leaves the queue WITHOUT ever being admitted
    await expect(doomed).rejects.toMatchObject({ name: 'AbortError' })

    held[0]!() // freed slot must go to `next`, not the aborted waiter
    const nextRelease = await next
    expect(nextAdmitted).toBe(true)

    nextRelease()
    for (let i = 1; i < held.length; i++) held[i]!()

    // Already-aborted signal rejects immediately, nothing enqueued.
    await expect(acquireSlot(key, false, ac.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('release is idempotent — a double-call never over-admits', async () => {
    const key = 'http://gate-b.example'
    const r = await acquireSlot(key)
    r(); r() // must leave active at 0, not -1

    const held: Array<() => void> = []
    for (let i = 0; i < SPARQL_DEFAULT_CONCURRENT; i++) held.push(await acquireSlot(key))
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
