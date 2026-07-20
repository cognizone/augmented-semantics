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

/** Max in-flight requests to a single endpoint origin. */
export const SPARQL_MAX_CONCURRENT = 4

type Gate = { active: number; waiters: Array<() => void> }
const gates = new Map<string, Gate>()

/**
 * Acquire a slot on `key`'s gate; await the result, then call the returned release
 * when the request settles (resolve / reject / abort). Idempotent release so a
 * double-call can't push a gate below zero and over-admit. Exported for the unit
 * test — production code acquires via sparqlFetch, never directly.
 * ponytail: idle gates are left in the map (one tiny object per endpoint, bounded).
 */
export function acquireSlot(key: string): Promise<() => void> {
  let gate = gates.get(key)
  if (!gate) {
    gate = { active: 0, waiters: [] }
    gates.set(key, gate)
  }
  const g = gate
  let released = false
  const release = () => {
    if (released) return
    released = true
    g.active--
    g.waiters.shift()?.()
  }
  if (g.active < SPARQL_MAX_CONCURRENT) {
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

/** Gate key = the endpoint ORIGIN, so all requests to one DB share a budget (and two
 *  endpoints on the same host correctly share it too). Falls back to the raw string. */
function gateKey(input: Parameters<typeof fetch>[0]): string {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  try {
    return new URL(url).origin
  } catch {
    return String(url)
  }
}

export const sparqlFetch: typeof fetch = async (input, init) => {
  const release = await acquireSlot(gateKey(input))
  try {
    return await rawFetch(input, init)
  } finally {
    release()
  }
}
