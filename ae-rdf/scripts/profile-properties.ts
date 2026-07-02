/**
 * profile-properties.ts — offline endpoint property profiler.
 *
 * Runs LOCALLY (Node CLI), never in the browser app. Per-type "distinct
 * properties" queries are too unreliable to run at runtime, so we run them once
 * here — with timeouts, retries and a sampled fallback — and bake the result
 * into the endpoint config JSON under `typeProperties` (+ a `profiledAt` stamp).
 * The app then reads that instead of querying; if it's missing/`ok:false` for a
 * type, the app falls back to its normal live behaviour.
 *
 * SAFE BY DESIGN: only `typeProperties` and `profiledAt` are (re)written. Your
 * hand-authored `types` / `typeInventory` / everything else is preserved. A type
 * whose query fails keeps its previously-profiled entry (if any) rather than
 * being downgraded, so a flaky run never destroys good data.
 *
 * Usage:
 *   node scripts/profile-properties.ts [path-to-endpoint.json]
 *   node scripts/profile-properties.ts                      # defaults to cordis
 * Node 23.6+ runs .ts directly (type stripping) — no build step.
 *
 * @see /spec/ae-rdf  — mirrors the typeInventory caching pattern (useRdfTypes.ts)
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CONFIG = resolve(HERE, '../public/config/endpoints/cordis-datalab.json')

const TIMEOUT_MS = 90_000 // per request; a full GROUP BY over a big type is slow
const RETRIES = 2
const SAMPLE_SIZE = 2000 // fallback when the full scan times out / errors

interface PropEntry { uri: string; count: number }
interface TypeProfile { ok: boolean; sampled?: boolean; properties: PropEntry[] }

// ponytail: default-graph triples only (`?s a <T> . ?s ?p ?o`) — matches what
// this app's target endpoints expose. A quad-only store would need GRAPH
// wrapping; add that (reading cfg.graph) if/when such an endpoint needs it.
const fullQuery = (t: string) =>
  `SELECT ?p (COUNT(*) AS ?n) WHERE { ?s a <${t}> . ?s ?p ?o } GROUP BY ?p ORDER BY DESC(?n)`
const sampledQuery = (t: string) =>
  `SELECT ?p (COUNT(*) AS ?n) WHERE { { SELECT ?s WHERE { ?s a <${t}> } LIMIT ${SAMPLE_SIZE} } ?s ?p ?o } GROUP BY ?p ORDER BY DESC(?n)`
const typesQuery = () => `SELECT DISTINCT ?t WHERE { ?s a ?t }`

async function sparql(url: string, query: string): Promise<Record<string, { value: string }>[]> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(`${url}?query=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/sparql-results+json' },
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      return json.results?.bindings ?? []
    } catch (e) {
      lastErr = e
      if (attempt < RETRIES) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr
}

/** Profile one type: full scan first, sampled fallback on failure. */
async function profileType(url: string, type: string): Promise<TypeProfile | null> {
  const toEntries = (rows: Record<string, { value: string }>[]): PropEntry[] =>
    rows
      .map(b => ({ uri: b.p?.value ?? '', count: parseInt(b.n?.value ?? '0', 10) }))
      .filter(e => e.uri)
      .sort((a, b) => b.count - a.count)
  try {
    return { ok: true, properties: toEntries(await sparql(url, fullQuery(type))) }
  } catch {
    // full scan failed (usually a server-side timeout) — try a sample
  }
  try {
    return { ok: true, sampled: true, properties: toEntries(await sparql(url, sampledQuery(type))) }
  } catch (e) {
    console.error(`  ✗ ${type} — ${(e as Error).message}`)
    return null
  }
}

async function main() {
  const path = resolve(process.cwd(), process.argv[2] ?? DEFAULT_CONFIG)
  const cfg = JSON.parse(await readFile(path, 'utf8'))
  const url: string = cfg.url
  if (!url) throw new Error(`No "url" in ${path}`)

  // Type list: prefer the cached inventory; else discover it live.
  let typeUris: string[] = (cfg.typeInventory ?? []).map((t: { uri: string }) => t.uri).filter(Boolean)
  if (!typeUris.length) {
    console.error('No typeInventory — discovering types live…')
    typeUris = (await sparql(url, typesQuery())).map(b => b.t?.value ?? '').filter(Boolean)
  }
  console.error(`Profiling ${typeUris.length} types against ${url}`)

  const out: Record<string, TypeProfile> = { ...(cfg.typeProperties ?? {}) }
  let okCount = 0
  for (const [i, type] of typeUris.entries()) {
    const profile = await profileType(url, type)
    if (profile) {
      out[type] = profile
      okCount++
      console.error(`  [${i + 1}/${typeUris.length}] ${profile.sampled ? '~' : '✓'} ${type} (${profile.properties.length} props)`)
    } else if (!out[type]) {
      // keep any prior good entry; only record a failure if we have nothing
      out[type] = { ok: false, properties: [] }
    }
  }

  cfg.typeProperties = out
  cfg.profiledAt = new Date().toISOString()
  await writeFile(path, JSON.stringify(cfg, null, 2) + '\n')
  console.error(`\nDone: ${okCount}/${typeUris.length} profiled OK → ${path}`)
}

main().catch(e => { console.error(e); process.exit(1) })
