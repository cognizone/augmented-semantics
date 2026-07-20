/**
 * HTTP fetch selector — browser fetch on the web, native fetch in the
 * Tauri desktop app.
 *
 * The desktop webview enforces CORS like any browser (origin
 * tauri://localhost), so SPARQL endpoints without permissive CORS headers
 * (e.g. ERA's dev GraphDB) reject it. The Tauri HTTP plugin sends the
 * request from the Rust side instead — no origin, no preflight, no CORS.
 * Same fetch signature either way.
 *
 * Every SPARQL request in the app funnels through `sparqlFetch`, so it is also
 * where we cap concurrency PER ENDPOINT: a type load fans out a burst of facet /
 * list / embed / label queries at once, and firing them all makes heavy aggregate
 * scans compete for the same DB (each finishes slower, timeout risk rises). The
 * browser only self-limits to ~6 connections/host on HTTP/1.1 — over HTTP/2 it
 * multiplexes freely — so we can't rely on it. At most SPARQL_MAX_CONCURRENT
 * requests to one origin run at once; the rest queue.
 *
 * The queue is TWO-TIER, not plain FIFO: foreground queries (the instance list, facet
 * counts, an open resource — what the user is waiting on) drain before background ones
 * (type-tree discovery: composition / orphan / subclass counts, and the heavy facet
 * range/"no value" scans). Callers opt a query into the background lane with `background: true`;
 * everything defaults to foreground. Within a lane it's still FIFO.
 *
 * Background is also CAPACITY-CAPPED, not just lower priority: it may occupy at most
 * cap − FG_RESERVE slots (min 1). Priority alone can't help a foreground burst that
 * arrives a tick LATE — on a type click the facet watcher fires before the list's, so
 * without the reserve the heavy date scans would grab every free slot and hold them for
 * up to a full timeout while the list query queues behind them. The reserve guarantees
 * admission headroom for what the user is looking at. Side benefit: at most 2 heavy
 * scans pound the endpoint concurrently. No preemption and no starvation: the reserve
 * only bounds background parallelism; once foreground goes quiet, background drains.
 */

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const rawFetch: typeof fetch = isTauri
  ? async (input, init) => {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
      return tauriFetch(input, init)
    }
  : (input, init) => fetch(input, init)

/** Hard CEILING for in-flight requests to a single endpoint origin. Nothing — not the
 *  per-endpoint config, not the global Settings knob — can push the effective cap above
 *  this; acquireSlot clamps to it. The knob only dials DOWN from here. */
export const SPARQL_MAX_CONCURRENT = 8

/** Default cap when nothing is configured (the out-of-box "auto" value). Below the
 *  ceiling on purpose — conservative by default, opt into more up to the ceiling. */
export const SPARQL_DEFAULT_CONCURRENT = 4

/** Slots RESERVED for foreground: background requests may occupy at most
 *  cap − FG_RESERVE slots (min 1), so the instance list / counts always find a free
 *  slot instead of waiting a full timeout behind a running heavy scan. */
const FG_RESERVE = 2

type Gate = { active: number; waiters: Array<() => void>; low: Array<() => void> }
const gates = new Map<string, Gate>()
/** Per-origin overrides of the concurrency cap (from endpoint config maxConcurrency). */
const limits = new Map<string, number>()
/** Global override (user Settings). null = no override: fall back to the per-origin
 *  config value, else the default. When set it wins for EVERY origin, so a live Settings
 *  change tunes the whole app at once. Precedence: global > per-origin config > default. */
let globalCap: number | null = null

/** Set (or clear, with null) the global concurrency override. A value < 1 is ignored. */
export function setGlobalConcurrency(max: number | null): void {
  if (max == null) {
    globalCap = null
    return
  }
  if (!Number.isFinite(max) || max < 1) return
  globalCap = Math.floor(max)
}

/** Gate/limit key = the endpoint ORIGIN, so all requests to one DB share a budget (and
 *  two endpoints on the same host correctly share it too). Falls back to the raw string
 *  — in dev the URL is a relative proxy path (no origin), which is still per-endpoint. */
function originKey(input: Parameters<typeof fetch>[0]): string {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  try {
    return new URL(url).origin
  } catch {
    return String(url)
  }
}

/** Set the concurrency cap for an endpoint URL's origin (curator-configured). A value
 *  < 1 is ignored; raise it for a DB that handles parallelism well, lower it for a
 *  fragile one. Takes effect for requests admitted after the call. */
export function setEndpointConcurrency(url: string, max: number): void {
  if (!Number.isFinite(max) || max < 1) return
  limits.set(originKey(url), Math.floor(max))
}

/**
 * Acquire a slot on `key`'s gate; await the result, then call the returned release
 * when the request settles (resolve / reject / abort). `lowPriority` queues the waiter
 * in the background lane — served only when the foreground lane is empty (see the
 * two-tier note above). A `signal` that aborts WHILE QUEUED removes the waiter and
 * rejects with an AbortError — the request never reaches the endpoint. Without this, a
 * superseded burst (user navigated away mid-load) still drains through the gate and
 * pounds the DB for results nobody will read. Idempotent release so a double-call can't
 * push a gate below zero and over-admit. The cap is read at admission time, so a config
 * change applies to the next queued request. Exported for the unit test — production
 * code acquires via sparqlFetch, never directly.
 * ponytail: idle gates are left in the map (one tiny object per endpoint, bounded).
 */
/** Effective cap for `key` right now (global setting > per-origin config > default),
 *  clamped to the hard ceiling — read fresh so a live config change applies. */
function capNow(key: string): number {
  return Math.min(globalCap ?? limits.get(key) ?? SPARQL_DEFAULT_CONCURRENT, SPARQL_MAX_CONCURRENT)
}

/** Admit as many waiters as fit: foreground up to the full cap, then background up to
 *  its reserved-down budget. Loops (not one-per-release) so a cap increase or a burst
 *  of releases fills every admissible slot. */
function pump(g: Gate, key: string): void {
  const cap = capNow(key)
  const bgCap = Math.max(1, cap - FG_RESERVE)
  while (g.active < cap && g.waiters.length) {
    g.active++
    g.waiters.shift()!()
  }
  while (g.active < bgCap && g.low.length) {
    g.active++
    g.low.shift()!()
  }
}

export function acquireSlot(key: string, lowPriority = false, signal?: AbortSignal): Promise<() => void> {
  let gate = gates.get(key)
  if (!gate) {
    gate = { active: 0, waiters: [], low: [] }
    gates.set(key, gate)
  }
  const g = gate
  const cap = capNow(key)
  // Background admission is capped BELOW the full cap — free slots are not enough, the
  // reserve must stay open for foreground bursts that arrive a tick later.
  const myCap = lowPriority ? Math.max(1, cap - FG_RESERVE) : cap
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted while queued', 'AbortError'))
  let released = false
  const release = () => {
    if (released) return
    released = true
    g.active--
    pump(g, key)
  }
  if (g.active < myCap) {
    g.active++
    return Promise.resolve(release)
  }
  return new Promise<() => void>((resolve, reject) => {
    const lane = lowPriority ? g.low : g.waiters
    // pump() increments g.active BEFORE calling the waiter — the closure only settles.
    const waiter = () => {
      signal?.removeEventListener('abort', onAbort)
      resolve(release)
    }
    const onAbort = () => {
      const i = lane.indexOf(waiter)
      if (i >= 0) lane.splice(i, 1)
      reject(new DOMException('Aborted while queued', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    lane.push(waiter)
  })
}

/**
 * Gated fetch. `onAcquire` fires the instant a slot is granted — right before the
 * request goes to the wire — so callers arm their timeout THEN, not while the request
 * is still queued (a query starved in the queue must not burn its timeout budget
 * before it has even been sent). Third param instead of `typeof fetch` for that hook.
 * `lowPriority` puts this request in the background lane of the per-origin queue.
 * `init.signal` also cancels the QUEUE wait: aborting while queued rejects without
 * ever sending the request (see acquireSlot).
 */
export async function sparqlFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  onAcquire?: () => void,
  lowPriority?: boolean,
): Promise<Response> {
  const release = await acquireSlot(originKey(input), lowPriority, init?.signal ?? undefined)
  onAcquire?.()
  try {
    return await rawFetch(input, init)
  } finally {
    release()
  }
}
