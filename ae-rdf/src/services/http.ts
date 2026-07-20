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
 * requests to one origin run at once; the rest queue FIFO.
 */

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const rawFetch: typeof fetch = isTauri
  ? async (input, init) => {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
      return tauriFetch(input, init)
    }
  : (input, init) => fetch(input, init)

/** Default max in-flight requests to a single endpoint origin, when the endpoint
 *  config sets no `maxConcurrency`. Per-endpoint overrides via setEndpointConcurrency. */
export const SPARQL_MAX_CONCURRENT = 4

type Gate = { active: number; waiters: Array<() => void> }
const gates = new Map<string, Gate>()
/** Per-origin overrides of the concurrency cap (from endpoint config maxConcurrency). */
const limits = new Map<string, number>()

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
 * when the request settles (resolve / reject / abort). Idempotent release so a
 * double-call can't push a gate below zero and over-admit. The cap is read at
 * admission time, so a config change applies to the next queued request. Exported for
 * the unit test — production code acquires via sparqlFetch, never directly.
 * ponytail: idle gates are left in the map (one tiny object per endpoint, bounded).
 */
export function acquireSlot(key: string): Promise<() => void> {
  let gate = gates.get(key)
  if (!gate) {
    gate = { active: 0, waiters: [] }
    gates.set(key, gate)
  }
  const g = gate
  const cap = limits.get(key) ?? SPARQL_MAX_CONCURRENT
  let released = false
  const release = () => {
    if (released) return
    released = true
    g.active--
    g.waiters.shift()?.()
  }
  if (g.active < cap) {
    g.active++
    return Promise.resolve(release)
  }
  return new Promise<() => void>(resolve => {
    g.waiters.push(() => {
      g.active++
      resolve(release)
    })
  })
}

export const sparqlFetch: typeof fetch = async (input, init) => {
  const release = await acquireSlot(originKey(input))
  try {
    return await rawFetch(input, init)
  } finally {
    release()
  }
}
