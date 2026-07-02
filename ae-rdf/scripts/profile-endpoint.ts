/**
 * profile-endpoint.ts — offline endpoint schema profiler.
 *
 * Runs LOCALLY (Node CLI), never in the browser app. Several schema-discovery
 * queries are too unreliable to run at runtime, so we run them once here — with
 * timeouts, retries and a sampled fallback — and bake the result into the
 * endpoint config JSON so the app reads it instead of querying:
 *   - `typeProperties` — distinct properties per type (+ `ok`/`sampled` flags)
 *   - `subclasses`     — rdfs:subClassOf hierarchy among inventory types
 *   - `composition`    — which classes embed which value-types (+ counts)
 * Plus a `profiledAt` stamp. If a section is missing the app falls back to its
 * normal live behaviour.
 *
 * SAFE BY DESIGN: only `typeProperties`, `subclasses`, `composition` and
 * `profiledAt` are (re)written. Hand-authored `types` / `typeInventory` /
 * everything else is preserved. A per-type property query that fails keeps its
 * previously-profiled entry, so a flaky run never destroys good data.
 *
 * Usage:
 *   node scripts/profile-endpoint.ts [path-to-endpoint.json]
 *   node scripts/profile-endpoint.ts                      # defaults to cordis
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
interface CompEntry { uri: string; count: number }

const RDFS_SUBCLASS = 'http://www.w3.org/2000/01/rdf-schema#subClassOf'
const values = (uris: string[]) => uris.map(u => `<${u}>`).join(' ')

// ponytail: default-graph triples only (`?s a <T> . ?s ?p ?o`) — matches what
// this app's target endpoints expose. A quad-only store would need GRAPH
// wrapping; add that (reading cfg.graph) if/when such an endpoint needs it.
const fullQuery = (t: string) =>
  `SELECT ?p (COUNT(*) AS ?n) WHERE { ?s a <${t}> . ?s ?p ?o } GROUP BY ?p ORDER BY DESC(?n)`
const sampledQuery = (t: string) =>
  `SELECT ?p (COUNT(*) AS ?n) WHERE { { SELECT ?s WHERE { ?s a <${t}> } LIMIT ${SAMPLE_SIZE} } ?s ?p ?o } GROUP BY ?p ORDER BY DESC(?n)`
const typesQuery = () => `SELECT DISTINCT ?t WHERE { ?s a ?t }`
// subClassOf among inventory types (both ends filtered to the inventory below).
const subclassQuery = (uris: string[]) =>
  `SELECT DISTINCT ?sub ?super WHERE { VALUES ?sub { ${values(uris)} } ?sub <${RDFS_SUBCLASS}> ?super . FILTER(?sub != ?super) }`
// Which classes ?c compose each embed value-type ?e (count scoped to the class).
const compositionQuery = (embeds: string[]) =>
  `SELECT ?c ?e (COUNT(DISTINCT ?o) AS ?n) WHERE { VALUES ?e { ${values(embeds)} } ?o a ?e . ?s ?p ?o . ?s a ?c . FILTER(?c != ?e) } GROUP BY ?c ?e`
// How many instances of each embed type ARE linked via their owning predicate
// (orphans = type total − this).
const orphanLinkedQuery = (pairs: { type: string; via: string }[]) =>
  `SELECT ?e (COUNT(DISTINCT ?o) AS ?linked) WHERE { VALUES (?e ?via) { ${pairs.map(p => `(<${p.type}> <${p.via}>)`).join(' ')} } ?o a ?e . ?s ?via ?o . } GROUP BY ?e`

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

/** rdfs:subClassOf hierarchy among the inventory types → { super: [subs] }. */
async function profileSubclasses(url: string, typeUris: string[]): Promise<Record<string, string[]> | null> {
  const inv = new Set(typeUris)
  try {
    const rows = await sparql(url, subclassQuery(typeUris))
    const map: Record<string, string[]> = {}
    for (const b of rows) {
      const sub = b.sub?.value, sup = b.super?.value
      if (!sub || !sup || !inv.has(sub) || !inv.has(sup)) continue // both ends must be browsable
      ;(map[sup] ??= []).includes(sub) || map[sup].push(sub)
    }
    return map
  } catch (e) {
    console.error(`  ✗ subclasses — ${(e as Error).message}`)
    return null
  }
}

/** Embed composition: composing class → embed types it contains, with counts. */
async function profileComposition(url: string, embeds: string[]): Promise<Record<string, CompEntry[]> | null> {
  if (!embeds.length) return {}
  try {
    const rows = await sparql(url, compositionQuery(embeds))
    const map: Record<string, CompEntry[]> = {}
    for (const b of rows) {
      const c = b.c?.value, e = b.e?.value
      if (!c || !e) continue
      const arr = (map[c] ??= [])
      if (!arr.some(x => x.uri === e)) arr.push({ uri: e, count: parseInt(b.n?.value ?? '0', 10) })
    }
    return map
  } catch (e) {
    console.error(`  ✗ composition — ${(e as Error).message}`)
    return null
  }
}

/** Embed-orphan counts: embed type → instances with NO owner via its embedVia. */
async function profileOrphanCounts(url: string, pairs: { type: string; via: string; total: number }[]): Promise<Record<string, number> | null> {
  if (!pairs.length) return {}
  try {
    const rows = await sparql(url, orphanLinkedQuery(pairs))
    const linked: Record<string, number> = {}
    for (const b of rows) { const e = b.e?.value; if (e) linked[e] = parseInt(b.linked?.value ?? '0', 10) }
    const out: Record<string, number> = {}
    for (const p of pairs) {
      const orphans = p.total - (linked[p.type] ?? 0)
      if (orphans > 0) out[p.type] = orphans // only types that actually have orphans
    }
    return out
  } catch (e) {
    console.error(`  ✗ orphanCounts — ${(e as Error).message}`)
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

  // Subclass hierarchy (for the nested sidebar tree).
  const subs = await profileSubclasses(url, typeUris)
  if (subs) { cfg.subclasses = subs; console.error(`Subclasses: ${Object.keys(subs).length} superclasses`) }

  // Embed composition — only over types configured as render:embed.
  const embeds = Object.entries(cfg.types ?? {})
    .filter(([, c]) => (c as { render?: string }).render === 'embed')
    .map(([uri]) => uri)
  const comp = await profileComposition(url, embeds)
  if (comp) { cfg.composition = comp; console.error(`Composition: ${embeds.length} embed types → ${Object.keys(comp).length} composing classes`) }

  // Embed-orphan counts — embed types that pin an owning predicate (embedVia).
  const totals: Record<string, number> = {}
  for (const t of (cfg.typeInventory ?? []) as { uri: string; count: number }[]) totals[t.uri] = t.count
  const orphanPairs = Object.entries(cfg.types ?? {})
    .filter(([, c]) => (c as { render?: string; embedVia?: string }).render === 'embed' && (c as { embedVia?: string }).embedVia)
    .map(([uri, c]) => ({ type: uri, via: (c as { embedVia: string }).embedVia, total: totals[uri] ?? 0 }))
  const orphans = await profileOrphanCounts(url, orphanPairs)
  if (orphans) { cfg.orphanCounts = orphans; console.error(`Orphan counts: ${Object.keys(orphans).length} embed types with orphans`) }

  cfg.profiledAt = new Date().toISOString()
  await writeFile(path, JSON.stringify(cfg, null, 2) + '\n')
  console.error(`\nDone: ${okCount}/${typeUris.length} types profiled OK → ${path}`)
}

main().catch(e => { console.error(e); process.exit(1) })
