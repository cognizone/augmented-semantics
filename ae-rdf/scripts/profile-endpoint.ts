/**
 * profile-endpoint.ts — offline endpoint schema profiler.
 *
 * Runs LOCALLY (Node CLI), never in the browser app. Several schema-discovery
 * queries are too unreliable to run at runtime, so we run them once here — with
 * timeouts, retries and a sampled fallback — and bake the result into the
 * endpoint config JSON so the app reads it instead of querying:
 *   - `typeProperties` — distinct properties per type (+ `ok`/`sampled` flags),
 *                        each with per-instance `min`/`max` cardinality on a full
 *                        (non-sampled) scan
 *   - `subclasses`     — rdfs:subClassOf hierarchy among inventory types
 *   - `composition`    — which classes embed which value-types (+ counts)
 * Plus a `profiledAt` stamp. If a section is missing the app falls back to its
 * normal live behaviour.
 *
 * Planned uses for the `min`/`max` cardinality (not yet consumed by the app):
 *   - OWL/SHACL generation (AE OWL / AE SHACL): min≥1 → owl:minCardinality /
 *     sh:minCount; max=1 → functional / sh:maxCount 1.
 *   - Auto-suggesting `search`/`label` fields (prefer single-valued required text).
 *   - PropertyTable rendering hints: max=1 → single value, max>1 → list.
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

interface PropEntry { uri: string; count: number; min?: number; max?: number }
interface TypeProfile { ok: boolean; sampled?: boolean; properties: PropEntry[] }
interface CompEntry { uri: string; count: number }

const RDFS_SUBCLASS = 'http://www.w3.org/2000/01/rdf-schema#subClassOf'
const values = (uris: string[]) => uris.map(u => `<${u}>`).join(' ')

// ponytail: default-graph triples only (`?s a <T> . ?s ?p ?o`) — matches what
// this app's target endpoints expose. A quad-only store would need GRAPH
// wrapping; add that (reading cfg.graph) if/when such an endpoint needs it.
//
// Full scan: nested aggregation gives BOTH the occurrence count and per-instance
// cardinality in one query. Inner groups per (?s ?p) → ?c = how many times ?s has
// ?p; outer rolls up per ?p:
//   ?n      = SUM(?c)      total occurrences (== the old COUNT(*))
//   ?havers = COUNT(?s)    distinct instances that have ?p at least once
//   ?lo/?hi = MIN/MAX(?c)  per-instance occurrence range (both ≥1, over havers)
// min cardinality = havers < typeTotal ? 0 : lo (some instance lacks ?p ⇒ optional);
// max cardinality = hi. Heavier than a flat GROUP BY, so it's the full path only —
// the sampled fallback stays cheap and omits cardinality (a sample can't prove min=0).
const fullQuery = (t: string) =>
  `SELECT ?p (SUM(?c) AS ?n) (COUNT(?s) AS ?havers) (MIN(?c) AS ?lo) (MAX(?c) AS ?hi) WHERE { SELECT ?s ?p (COUNT(?o) AS ?c) WHERE { ?s a <${t}> . ?s ?p ?o } GROUP BY ?s ?p } GROUP BY ?p ORDER BY DESC(?n)`
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

/**
 * Profile one type: full scan first, sampled fallback on failure. `total` is the
 * type's distinct-instance count (from the inventory) — needed to tell "min=0,
 * some instance lacks it" from "min≥1, every instance has it". 0/unknown ⇒ skip
 * the min derivation (leave min undefined rather than assert a wrong required-ness).
 */
async function profileType(url: string, type: string, total: number): Promise<TypeProfile | null> {
  // Sampled rows: occurrence count only (no cardinality — a sample can't prove min=0).
  const sampledEntries = (rows: Record<string, { value: string }>[]): PropEntry[] =>
    rows.map(b => ({ uri: b.p?.value ?? '', count: parseInt(b.n?.value ?? '0', 10) }))
      .filter(e => e.uri).sort((a, b) => b.count - a.count)
  // Full rows: also carry per-instance cardinality (havers/lo/hi → min/max).
  const fullEntries = (rows: Record<string, { value: string }>[]): PropEntry[] =>
    rows.map(b => {
      const havers = parseInt(b.havers?.value ?? '0', 10)
      const lo = parseInt(b.lo?.value ?? '0', 10)
      const hi = parseInt(b.hi?.value ?? '0', 10)
      const e: PropEntry = { uri: b.p?.value ?? '', count: parseInt(b.n?.value ?? '0', 10) }
      if (hi > 0) e.max = hi
      if (total > 0 && havers > 0) e.min = havers < total ? 0 : lo
      return e
    }).filter(e => e.uri).sort((a, b) => b.count - a.count)
  try {
    return { ok: true, properties: fullEntries(await sparql(url, fullQuery(type))) }
  } catch {
    // full scan failed (usually a server-side timeout) — try a sample
  }
  try {
    return { ok: true, sampled: true, properties: sampledEntries(await sparql(url, sampledQuery(type))) }
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

// Wall-clock helpers for phase logging (mirrors ae-skos' profiler output style).
const t0 = Date.now()
const secs = (from: number) => `${((Date.now() - from) / 1000).toFixed(1)}s`
const phase = (label: string) => { console.error(`\n▸ ${label}  (+${secs(t0)})`); return Date.now() }

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
  // Distinct-instance total per type (from the inventory) — needed to derive
  // min=0 (some instance lacks the property) from the per-instance cardinality.
  const totals: Record<string, number> = {}
  for (const t of (cfg.typeInventory ?? []) as { uri: string; count: number }[]) totals[t.uri] = t.count
  console.error(`Endpoint: ${url}\nTypes: ${typeUris.length}`)

  // ── Properties + per-instance cardinality ──────────────────────────────
  let p = phase(`Properties + cardinality — ${typeUris.length} types`)
  const out: Record<string, TypeProfile> = { ...(cfg.typeProperties ?? {}) }
  let okCount = 0, sampledCount = 0
  for (const [i, type] of typeUris.entries()) {
    const tt = Date.now()
    const profile = await profileType(url, type, totals[type] ?? 0)
    if (profile) {
      out[type] = profile
      okCount++
      if (profile.sampled) sampledCount++
      const card = profile.properties.some(pr => pr.max !== undefined) ? ', card' : ''
      console.error(`  [${i + 1}/${typeUris.length}] ${profile.sampled ? '~' : '✓'} ${type} (${profile.properties.length} props${card}, ${secs(tt)})`)
    } else if (!out[type]) {
      // keep any prior good entry; only record a failure if we have nothing
      out[type] = { ok: false, properties: [] }
    }
  }
  cfg.typeProperties = out
  console.error(`  → ${okCount}/${typeUris.length} OK (${sampledCount} sampled, no cardinality) in ${secs(p)}`)

  // ── Subclass hierarchy (for the nested sidebar tree) ───────────────────
  p = phase('Subclasses')
  const subs = await profileSubclasses(url, typeUris)
  if (subs) { cfg.subclasses = subs; console.error(`  → ${Object.keys(subs).length} superclasses in ${secs(p)}`) }

  // ── Embed composition — only over types configured as render:embed ─────
  const embeds = Object.entries(cfg.types ?? {})
    .filter(([, c]) => (c as { render?: string }).render === 'embed')
    .map(([uri]) => uri)
  p = phase(`Composition — ${embeds.length} embed types`)
  const comp = await profileComposition(url, embeds)
  if (comp) { cfg.composition = comp; console.error(`  → ${Object.keys(comp).length} composing classes in ${secs(p)}`) }

  // ── Embed-orphan counts — embed types that pin an owning predicate ─────
  const orphanPairs = Object.entries(cfg.types ?? {})
    .filter(([, c]) => (c as { render?: string; embedVia?: string }).render === 'embed' && (c as { embedVia?: string }).embedVia)
    .map(([uri, c]) => ({ type: uri, via: (c as { embedVia: string }).embedVia, total: totals[uri] ?? 0 }))
  p = phase(`Orphan counts — ${orphanPairs.length} pinned embed types`)
  const orphans = await profileOrphanCounts(url, orphanPairs)
  if (orphans) { cfg.orphanCounts = orphans; console.error(`  → ${Object.keys(orphans).length} types with orphans in ${secs(p)}`) }

  cfg.profiledAt = new Date().toISOString()
  await writeFile(path, JSON.stringify(cfg, null, 2) + '\n')
  console.error(`\n✓ Done in ${secs(t0)}: ${okCount}/${typeUris.length} types → ${path}`)
}

main().catch(e => { console.error(e); process.exit(1) })
