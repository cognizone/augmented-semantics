/**
 * HTTP fetch selector — browser fetch on the web, native fetch in the
 * Tauri desktop app.
 *
 * The desktop webview enforces CORS like any browser (origin
 * tauri://localhost), so SPARQL endpoints without permissive CORS headers
 * (e.g. ERA's dev GraphDB) reject it. The Tauri HTTP plugin sends the
 * request from the Rust side instead — no origin, no preflight, no CORS.
 * Same fetch signature either way.
 */

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const sparqlFetch: typeof fetch = isTauri
  ? async (input, init) => {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
      return tauriFetch(input, init)
    }
  : (input, init) => fetch(input, init)
