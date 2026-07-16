/**
 * profile-endpoint.ts — offline endpoint schema profiler.
 *
 * Runs LOCALLY (Node CLI), never in the browser app. Several schema-discovery
 * queries are too unreliable to run at runtime, so we run them once here — with
 * timeouts, retries and a sampled fallback — and bake the result into the
 * endpoint config JSON so the app reads it instead of querying:
 *   - `graph`          — endpoint graph shape (`quads`, `defaultView`) via the
 *                        same probes the app runs at connect, baked so the app
 *                        skips them
 *   - `typeProperties` — distinct properties per type (+ `ok`/`sampled` flags),
 *                        each measured individually for its occurrence count and
 *                        per-instance `min`/`max` cardinality (`sampled` means the
 *                        property LIST fell back to a sample, so it may be missing
 *                        rare predicates — the measured counts are still full).
 *                        Each property also carries value FACTS: `nodeKinds`
 *                        (iri/literal/bnode counts over its distinct (s,o) pairs —
 *                        Σ === count, and its PRESENCE is the "facts measured" marker),
 *                        `datatypes` (literal datatype counts; an rdf:langString entry
 *                        ⇒ language-tagged text), `languages` (lang-tag distribution),
 *                        `ranges` (object classes of IRI values — distinct (s,o)-pair
 *                        count per class, top RANGES_MAX) and `untyped` (pairs whose IRI
 *                        object has no rdf:type; written even when 0 once ranges were
 *                        measured, so its presence marks "ranges measured" vs "timed out").
 *                        Facts skipped under `--fast`.
 *                        Also `embed` — per-type EMBED CANDIDACY: the max instances
 *                        of the type that inline under ONE owner through each edge,
 *                        `forward` (as an object → `embedVia:"<p>"`) and `inverse`
 *                        (as a subject → `embedVia:"^<p>"`). Low max ⇒ safe to embed
 *                        via that edge. This is the fan-in check you'd otherwise run
 *                        by hand per candidate. Skipped for types > EMBED_PROFILE_MAX.
 *                        Each hint also carries `selfMax` (the type's own biggest
 *                        property fan-out): a HIGH selfMax is a flood trap — a wall of
 *                        rows when inlined even at fan-in 1 (LegalAnalysis: 1/owner but
 *                        8016 impact links) — so treat high-selfMax as NOT embeddable
 *                        despite a low fan-in.
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
 * Also `maxLen` per property — the max length of its LITERAL values — a display-
 * config size hint: high maxLen ⇒ long prose (suggest `capWidth`); many short
 * repeated values ⇒ suggest `columns`.
 *
 * SAFE BY DESIGN: only `graph`, `typeProperties`, `subclasses`, `composition`,
 * `orphanCounts` and `profiledAt` are (re)written. Hand-authored `types` is preserved,
 * as is an existing `typeInventory` — but an ABSENT `typeInventory` is discovered and
 * seeded (with counts) so a fresh config-endpoint gets one. A per-type property query
 * that fails keeps its previously-profiled entry, and an inconclusive graph probe keeps
 * that axis' prior value — so a flaky run never destroys good data.
 *
 * Usage:
 *   node scripts/profile-endpoint.ts [path-to-endpoint.json]
 *   node scripts/profile-endpoint.ts                      # defaults to cordis
 *   SPARQL_USER=… SPARQL_PASS=… node scripts/profile-endpoint.ts <cfg>  # secured (Basic auth)
 *   node scripts/profile-endpoint.ts <cfg> --fast         # skip heavy scans (huge endpoints)
 *   node scripts/profile-endpoint.ts <cfg> --resume       # continue an interrupted run
 * The config is CHECKPOINTED to disk (ATOMICally: write .tmp, rename over — a kill
 * mid-write can't truncate the config) after every measured PROPERTY and every facts
 * step, and after every type (which covers list-only / --fast runs), so a killed run
 * loses at most the step in flight. --resume is PER-PROPERTY: it reuses each type's
 * prior property LIST (no re-listing) and re-queries ONLY the properties still missing
 * a count OR the facts marker (an old counts-only config gets facts-only queries).
 * Per-property counts + cardinality and embed fan-in are computed by default for all
 * backends, on types up to HEAVY_TYPE_MAX instances; `--fast` skips them entirely.
 * The config's `backend` ("graphdb" | "virtuoso", default virtuoso) picks the query
 * SHAPE. GraphDB (e.g. ERA RINF) lists properties with the FLAT join and skips the
 * heavy per-subject scans (cardinality / embed fan-in / defaultView) that time out on
 * its gateway — fewer facts, but COMPLETE property LISTS and it finishes. Virtuoso
 * (Fedlex/Cordis) uses the nested quad-safe shape and profiles everything.
 * Non-URI type values (bnode/literal) are always logged and skipped, never queried.
 * Node 23.6+ runs .ts directly (type stripping) — no build step.
 *
 * @see /spec/ae-rdf  — mirrors the typeInventory caching pattern (useRdfTypes.ts)
 */
import { readFile, writeFile, rename } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CONFIG = resolve(HERE, '../public/config/endpoints/cordis-datalab.json')

const TIMEOUT_MS = 90_000 // per request; a full GROUP BY over a big type is slow
// The property listing now walks DISTINCT subjects, so it's fast unless a type has
// genuinely huge DISTINCT-subject count (millions). Give it a short leash and fall
// back to a distinct-subject sample rather than waiting out the full TIMEOUT_MS.
const LIST_TIMEOUT_MS = 30_000
const SAMPLE_SIZE = 2000 // distinct-subject cap when the full listing times out

// The config's `backend` picks the query SHAPE (set from cfg.backend in main).
// GraphDB (e.g. ERA RINF) is fast on the FLAT `?s a T . ?s ?p ?o` join but times out
// on the nested DISTINCT-?s subquery AND on the heavy per-subject scans; Virtuoso
// (Fedlex/Cordis) graph-multiplies the flat join, so it needs the nested quad-safe
// shape and can afford the full scans. GraphDB → flat COMPLETE property LISTS, and we
// skip cardinality / embed fan-in / defaultView (they time out on its gateway).
let GRAPHDB = false
// GraphDB: send `infer=<value>` with every query (set from cfg.infer in main) —
// false disables inferred triples. undefined → send nothing.
let INFER: boolean | undefined
// Heavy per-subject scans (per-property count + cardinality, embed fan-in) run for
// EVERY backend by default. Types are processed SMALLEST-first, and once the heavy
// scan has TIMED OUT on HEAVY_TIMEOUT_LIMIT types in a row we stop attempting it
// (everything bigger will time out too) — the remaining types keep their complete
// property LIST and reuse their PRIOR counts. `--fast` skips the heavy scans
// entirely; `--heavy-max=N` caps by instance count (default off — the adaptive
// timeout cutoff is the real limiter); `--heavy-timeouts=N` tunes the streak.
const argNum = (name: string, def: number): number => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`))
  const n = a ? Number(a.slice(a.indexOf('=') + 1)) : NaN
  return Number.isFinite(n) && n > 0 ? n : def
}
const SKIP_HEAVY = process.argv.includes('--fast')
const RESUME = process.argv.includes('--resume')
// Optional hard ceiling on instance count for heavy scans (default: no cap — let
// the timeout streak decide). Consecutive-timeout budget before we stop scanning.
const HEAVY_TYPE_MAX = argNum('heavy-max', Infinity)
const HEAVY_TIMEOUT_LIMIT = argNum('heavy-timeouts', 5)
const RETRIES = 2
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Atomic checkpoint write: write a sibling .tmp then rename over the target, so a
// kill mid-write can't leave a truncated (unparseable) config on disk.
const atomicWrite = async (p: string, data: string) => {
  const tmp = `${p}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, p)
}

// Optional HTTP Basic auth for secured endpoints (e.g. ERA EVR-KG). Credentials
// come from the environment ONLY — never the config file or the command line — so
// no secret is ever committed to the repo or captured in shell history / logs.
//   SPARQL_USER=… SPARQL_PASS=… node scripts/profile-endpoint.ts <config.json>
const AUTH_HEADER: Record<string, string> = (() => {
  const u = process.env.SPARQL_USER, p = process.env.SPARQL_PASS
  return u && p ? { Authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}` } : {}
})()
const HEADERS: Record<string, string> = {
  Accept: 'application/sparql-results+json',
  'Content-Type': 'application/x-www-form-urlencoded',
  ...AUTH_HEADER,
}

interface PropEntry {
  uri: string; count: number; min?: number; max?: number; maxLen?: number
  // Value facts (mirror TypeProperty in src/types/endpoint.ts — keep in sync).
  // nodeKinds counts distinct (s,o) pairs (Σ === count); its PRESENCE (even {}) marks
  // FACTS as measured. ranges counts distinct (s,o) pairs per object class (count-desc,
  // top RANGES_MAX): a multi-typed object counts once per class, so Σranges + untyped ≥
  // nodeKinds.iri, with equality when objects are single-typed. untyped = pairs whose IRI
  // object has NO rdf:type; always present (even 0) once ranges were measured — its
  // presence distinguishes "ranges measured" from "ranges timed out".
  nodeKinds?: { iri?: number; literal?: number; bnode?: number }
  datatypes?: { uri: string; count: number }[]
  languages?: Record<string, number>
  ranges?: { uri: string; count: number }[]
  untyped?: number
}
/** An owning edge + the max instances of a type that hang off ONE owner through it. */
interface FanEdge { via: string; max: number }
/** Embed candidacy: which edges this type can be embedded through, worst-case count.
 *  forward = type as an embedded OBJECT (owner ─via→ me): `render:embed` + `embedVia:"<via>"`.
 *  inverse = type as an embedded SUBJECT (me ─via→ owner): `embedVia:"^<via>"`.
 *  selfMax = the type's OWN biggest single-property fan-out — how many rows it renders
 *  when inlined; high ⇒ a wall even at fan-in 1, so NOT a real candidate. */
interface EmbedHints { selfMax?: number; forward?: FanEdge[]; inverse?: FanEdge[] }
interface TypeProfile { ok: boolean; sampled?: boolean; properties: PropEntry[]; embed?: EmbedHints; blank?: boolean; bnodeCount?: number }
interface CompEntry { uri: string; count: number }

const RDFS_SUBCLASS = 'http://www.w3.org/2000/01/rdf-schema#subClassOf'
const values = (uris: string[]) => uris.map(u => `<${u}>`).join(' ')

/** Re-key an object with its keys sorted — deterministic order for clean diffs. */
const sortKeys = <T,>(o: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]))

// Graph-shape probes — the same two the app runs at connect (sparql.ts
// detectGraphs / detectDefaultView), baked here so the app reads cfg.graph and
// skips the runtime probes.
//   1. named graphs present at all? → quads
//   2. is the default graph a redundant MERGE of the named graphs? Sample up to
//      DEFAULT_VIEW_SAMPLE default triples; ANY absent from every named graph ⇒
//      the default has its own data ('own'), else it's a merge ('merged').
const DEFAULT_VIEW_SAMPLE = 20000
const namedGraphAsk = () => `ASK { GRAPH ?g { ?s ?p ?o } }`
const defaultViewAsk = (n: number) =>
  `ASK { { SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT ${n} } FILTER NOT EXISTS { GRAPH ?g { ?s ?p ?o } } }`

// QUAD-SAFE. These endpoints are merged quad stores: the same triple is asserted
// in many named graphs, so a flat `?s a <T> . ?s ?p ?o` matches once PER GRAPH —
// e.g. Fedlex's ~126 Language resources show as 157k rows. That both explodes the
// query (a 126-instance type took 587s from the graph-multiplied join) and would
// inflate cardinality (a value in N graphs counted N times). The fix, everywhere:
//   - collapse to DISTINCT ?s in a subquery FIRST, then fetch props — turns the
//     quadratic graph-multiplied join into a linear walk over the real subjects
//     (587s → 0.9s), and forces a sane plan for the unbound-?p listing;
//   - COUNT(DISTINCT ?o) so a value repeated across graphs counts once.
//
// A type is profiled PER PROPERTY (list distinct predicates, then measure each) —
// that powers the "property N/total" progress and keeps each query small.
const propListQuery = (t: string) =>
  `SELECT DISTINCT ?p WHERE { { SELECT DISTINCT ?s WHERE { ?s a <${t}> } } ?s ?p ?o }`
const sampledPropListQuery = (t: string) =>
  `SELECT DISTINCT ?p WHERE { { SELECT DISTINCT ?s WHERE { ?s a <${t}> } LIMIT ${SAMPLE_SIZE} } ?s ?p ?o }`
// Flat, no nested subquery — GraphDB lists ALL properties fast this way (the nested
// shape times out there); on Virtuoso it graph-multiplies, so it's GraphDB-only.
const flatPropListQuery = (t: string) =>
  `SELECT DISTINCT ?p WHERE { ?s a <${t}> . ?s ?p ?o }`
// Per-property cardinality: inner counts DISTINCT ?p-values per instance → ?c;
// outer rolls up:
//   ?n      = SUM(?c)   total occurrences   ?havers = COUNT(?s) instances that have ?p
//   ?lo/?hi = MIN/MAX(?c) per-instance range (≥1, over havers)
//   ?maxlen = MAX string length over LITERAL values (0 for URI-only properties) —
//             a size hint for display config (long prose ⇒ suggest width-cap; short
//             repeated values ⇒ suggest columns). isLiteral guard keeps long URIs
//             from reading as prose; added as an aggregate so ?c stays unchanged.
// min = havers < typeTotal ? 0 : lo (some instance lacks it ⇒ optional); max = hi.
const propCardQuery = (t: string, p: string) =>
  `SELECT (SUM(?c) AS ?n) (COUNT(?s) AS ?havers) (MIN(?c) AS ?lo) (MAX(?c) AS ?hi) (MAX(?ml) AS ?maxlen) WHERE { SELECT ?s (COUNT(DISTINCT ?o) AS ?c) (MAX(IF(isLiteral(?o), STRLEN(STR(?o)), 0)) AS ?ml) WHERE { { SELECT DISTINCT ?s WHERE { ?s a <${t}> } } ?s <${p}> ?o } GROUP BY ?s }`
// Full datatype IRIs for the JS-side langString hardening (see profileType facts step).
const RDF_LANGSTRING = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString'
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string'
const RANGES_MAX = 20 // top object-type ranges kept per property (count-desc)
// Distinct (s,o) pairs for a type's property — the shared body of the facts + ranges
// queries. Nested DISTINCT-?s on Virtuoso (collapses the graph-multiplied join, same
// quad-safe trick as propCardQuery, so Σ node-kinds === count); flat on GraphDB (the
// nested subquery times out on its gateway).
const subjObjBlock = (t: string, p: string) =>
  GRAPHDB
    ? `{ SELECT DISTINCT ?s ?o WHERE { ?s a <${t}> . ?s <${p}> ?o } }`
    : `{ SELECT DISTINCT ?s ?o WHERE { { SELECT DISTINCT ?s WHERE { ?s a <${t}> } } ?s <${p}> ?o } }`
// Facts a+b+c in ONE query per property: node-kind (iri/literal/bnode), literal
// datatype, language tag — grouped counts over the distinct (s,o) pairs. Full TIMEOUT_MS
// like propCardQuery. JS side hardens langString bucketing + safeIri-filters datatypes.
const propFactsQuery = (t: string, p: string) =>
  `SELECT ?kind ?dt ?lang (COUNT(*) AS ?n) WHERE { ${subjObjBlock(t, p)} BIND(IF(isIRI(?o),"iri",IF(isBlank(?o),"bnode","literal")) AS ?kind) BIND(IF(isLiteral(?o), STR(DATATYPE(?o)), "") AS ?dt) BIND(IF(isLiteral(?o), LANG(?o), "") AS ?lang) } GROUP BY ?kind ?dt ?lang`
// Object classes of a property's IRI values — top RANGES_MAX by distinct (s,o)-pair
// count (SAME basis as `count`/`nodeKinds`, so directly comparable). The `?o a ?t2`
// join can graph-multiply, so dedupe over (s,o,t2) rows FIRST in the inner DISTINCT
// wrapper (with the isIRI FILTER + the type join outside subjObjBlock), then COUNT(*)
// per class counts distinct pairs — a multi-typed object counts once per class.
// Optional hint — run on the short leash, so a timeout just leaves ranges absent.
const propRangesQuery = (t: string, p: string) =>
  `SELECT ?t2 (COUNT(*) AS ?n) WHERE { { SELECT DISTINCT ?s ?o ?t2 WHERE { ${subjObjBlock(t, p)} FILTER(isIRI(?o)) ?o a ?t2 } } } GROUP BY ?t2 ORDER BY DESC(?n) LIMIT ${RANGES_MAX}`
// Distinct (s,o) pairs whose IRI object has NO rdf:type at all. subjObjBlock already
// collapses to distinct pairs, so counting its rows post-FILTER is pair-exact. Same
// short leash as ranges; its result is the ranges-step marker (written even when 0).
const propUntypedQuery = (t: string, p: string) =>
  `SELECT (COUNT(*) AS ?n) WHERE { ${subjObjBlock(t, p)} FILTER(isIRI(?o)) FILTER NOT EXISTS { ?o a ?t2 } }`
// Type discovery = the inventory query (types + instance counts). Count-based GROUP BY,
// NOT a bare `SELECT DISTINCT ?t` — that can 500 on big endpoints (RINF) — and it also
// yields the per-type totals the min=0 cardinality derivation needs.
const typeInventoryQuery = () => `SELECT ?t (COUNT(DISTINCT ?s) AS ?n) WHERE { ?s a ?t } GROUP BY ?t ORDER BY DESC(?n)`
// Blank-node instance count per type. A bnode has no dereferenceable id — reachable
// only inline via a parent. A type is only HIDDEN (blank:true) when ALL its instances
// are bnodes (exclusive); a mixed type keeps its named instances navigable but records
// the count. DISTINCT to match typeInventory's COUNT(DISTINCT ?s) so exclusivity
// (n >= total) compares like with like.
const blankTypesQuery = () => `SELECT ?t (COUNT(DISTINCT ?s) AS ?n) WHERE { ?s a ?t FILTER(isBlank(?s)) } GROUP BY ?t ORDER BY DESC(?n)`
// Reasonable seed of boolean deprecation flags to look for. The ones actually
// present (asserted `true` somewhere) are written to cfg.deprecatedPredicates and
// the app badges any resource asserting one. Predicate-indexed, so each probe is
// cheap. Extend this list as new flags turn up.
const DEPRECATION_CANDIDATES = [
  'http://www.w3.org/2002/07/owl#deprecated',
  'http://publications.europa.eu/ontology/authority/deprecated',
  'http://data.europa.eu/949/deprecated',
]
const deprecatedAskQuery = (p: string) => `ASK { ?s <${p}> ?v FILTER(str(?v) = "true") }`
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

async function sparql(url: string, query: string, retries = RETRIES, timeoutMs = TIMEOUT_MS): Promise<Record<string, { type?: string; value: string }>[]> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; ctrl.abort() }, timeoutMs)
    try {
      // POST, not GET: some managed gateways (ERA RINF) reject query-in-URL GET with
      // 500, and POST has no URL-length limit. Works everywhere (Virtuoso included).
      const res = await fetch(url, {
        method: 'POST',
        headers: HEADERS,
        body: `query=${encodeURIComponent(query)}${INFER !== undefined ? `&infer=${INFER}` : ''}`,
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      return json.results?.bindings ?? []
    } catch (e) {
      lastErr = e
      // A timeout means the query is too expensive — retrying just burns another
      // TIMEOUT_MS to fail identically. Stop and let the caller fall back (e.g. to
      // a sample). Tag it so callers can tell a timeout (query too big) from a
      // transient error. Transient errors (HTTP 5xx, connection reset) still retry.
      if (timedOut) { lastErr = Object.assign(new Error(`timeout after ${timeoutMs}ms`), { isTimeout: true }); break }
      if (attempt < retries) await sleep(1000 * (attempt + 1))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr
}

/** Run an ASK; returns the boolean, or undefined on error / non-boolean body. */
async function ask(url: string, query: string): Promise<boolean | undefined> {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const ctrl = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; ctrl.abort() }, TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: HEADERS,
        body: `query=${encodeURIComponent(query)}${INFER !== undefined ? `&infer=${INFER}` : ''}`,
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      return typeof json.boolean === 'boolean' ? json.boolean : undefined
    } catch {
      if (timedOut) break // a timeout won't finish on retry
      if (attempt < RETRIES) await sleep(1000 * (attempt + 1))
    } finally {
      clearTimeout(timer)
    }
  }
  return undefined
}

/**
 * Detect the endpoint's graph shape: whether named graphs exist (`quads`) and,
 * if so, whether the default graph is a redundant merge (`defaultView`). Either
 * axis is left undefined when its probe errors/is inconclusive, so the caller
 * keeps a hand-authored value rather than clobbering it.
 */
async function profileGraph(url: string): Promise<{ quads?: boolean; defaultView?: 'merged' | 'own' }> {
  const quads = await ask(url, namedGraphAsk())
  let defaultView: 'merged' | 'own' | undefined
  // The defaultView probe (FILTER NOT EXISTS over a 20k sample) is heavy — it times
  // out on GraphDB's gateway, so we skip it there (the app falls back at connect).
  if (quads === true && !GRAPHDB) {
    const someOwn = await ask(url, defaultViewAsk(DEFAULT_VIEW_SAMPLE))
    if (someOwn === false) defaultView = 'merged'
    else if (someOwn === true) defaultView = 'own'
  }
  return { quads, defaultView }
}

const shortIri = (u: string) => u.replace(/^.*[#/]/, '') || u
// Property IRIs come from live results (untrusted) — only interpolate ones that
// are plainly safe (http(s), no SPARQL/IRI metachars). Skips blank nodes & junk.
const safeIri = (u: string) => /^https?:\/\/[^\s<>"{}|\\^`]+$/.test(u)

/**
 * Profile one type PER PROPERTY: list its predicates, then measure each — so the
 * caller can tick "property N/total". `total` is the type's distinct-instance
 * count (from the inventory), needed to tell min=0 (some instance lacks it) from
 * min≥1 (every instance has it); 0/unknown ⇒ leave min undefined. `onStep` is
 * called with 'listing properties', 'sampled property list' (on list fallback),
 * and `property k/N: <name>` as each is measured.
 */
async function profileType(url: string, type: string, total: number, heavy: boolean, resume: boolean, onStep?: (step: string) => void, prior?: TypeProfile, onPartial?: (profile: TypeProfile) => Promise<void>): Promise<{ profile: TypeProfile | null; timedOut: boolean }> {
  // 1. List the type's distinct properties (over DISTINCT subjects — quad-safe).
  // Fast unless the type has a genuinely huge distinct-subject count, so give it a
  // short leash (no retry, LIST_TIMEOUT_MS) and fall back to a distinct-subject
  // sample rather than waiting out the full timeout ×3.
  onStep?.('listing properties')
  let sampled = false
  let props: string[] = []
  // RESUME: a prior OK profile already carries the full property LIST — reuse it and
  // skip the listing queries entirely (only the unmeasured properties re-query below).
  if (resume && prior?.ok && prior.properties.length > 0) {
    props = prior.properties.map(p => p.uri)
    sampled = prior.sampled ?? false
  } else {
    // GraphDB: the FLAT join lists all properties fast (the nested subquery times out
    // there) — give it the full TIMEOUT_MS since the biggest types run ~90s. Virtuoso:
    // the nested quad-safe shape on a short leash (LIST_TIMEOUT_MS). Either way, fall
    // back to the LIMITed sample below if the primary shape is too slow.
    try {
      props = (await sparql(
        url,
        GRAPHDB ? flatPropListQuery(type) : propListQuery(type),
        0,
        GRAPHDB ? TIMEOUT_MS : LIST_TIMEOUT_MS,
      )).map(b => b.p?.value ?? '')
    } catch { /* too big / slow to list fully — fall back to the sample below */ }
    if (!props.length) {
      onStep?.('sampled property list')
      try {
        props = (await sparql(url, sampledPropListQuery(type))).map(b => b.p?.value ?? '')
        sampled = true // list may be incomplete (rare properties missed)
      } catch (e) {
        console.error(`  ✗ ${type} — ${(e as Error).message}`)
        return { profile: null, timedOut: false }
      }
    }
  }
  props = props.filter(safeIri)

  // 2. Measure each property: occurrence count + per-instance min/max cardinality.
  // Attempted only when `heavy` (the caller stops asking once the timeout streak is
  // hit). If the FIRST measurement of this type times out, stop measuring the rest
  // (same subject set ⇒ they'd all time out) — remaining props keep their PRIOR
  // count. Report `timedOut` so the caller can grow the consecutive-timeout streak.
  let measure = heavy
  let measureFacts = heavy // facts ride the same heavy gate; --fast skips both
  let timedOut = false
  // Seed every entry from its PRIOR values up front, so the entries array shape is
  // complete for onPartial and a skipped/failed/timed-out property keeps good prior
  // data. A successful measurement below OVERWRITES the seeded fields from scratch.
  const entries: PropEntry[] = props.map(p => {
    const pe = prior?.properties.find(x => x.uri === p)
    return pe ? { ...pe } : { uri: p, count: 0 }
  })
  const profile: TypeProfile = { ok: true, sampled: sampled || undefined, properties: entries }
  // Bug A: carry PRIOR type-level hints into the freshly-built profile. onPartial saves
  // this object after every step, so without this the embed/blank hints computed on an
  // earlier run would vanish at the first checkpoint. The embed phase's resume skip
  // (RESUME && out[type].embed) then still fires; the blank phase recomputes when it runs.
  if (prior?.embed) profile.embed = prior.embed
  if (prior?.blank !== undefined) profile.blank = prior.blank
  if (prior?.bnodeCount !== undefined) profile.bnodeCount = prior.bnodeCount
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    // RESUME: an entry with a real count was already measured on a prior run — skip its
    // query and keep the seeded values (a listed property always occurs ≥1×, so
    // count>0 ⇒ measured). NON-resume runs re-measure every property.
    if (measure && !(resume && e.count > 0)) {
      onStep?.(`property ${i + 1}/${entries.length}: ${shortIri(e.uri)}`)
      try {
        const b = (await sparql(url, propCardQuery(type, e.uri)))[0] ?? {}
        const havers = parseInt(b.havers?.value ?? '0', 10)
        const lo = parseInt(b.lo?.value ?? '0', 10)
        const hi = parseInt(b.hi?.value ?? '0', 10)
        const maxlen = parseInt(b.maxlen?.value ?? '0', 10)
        // Build the measured fields FROM SCRATCH — clear the seeded prior min/max/maxLen
        // so a fresh result that lacks them doesn't leave stale values behind.
        e.count = parseInt(b.n?.value ?? '0', 10)
        delete e.min; delete e.max; delete e.maxLen
        if (hi > 0) e.max = hi
        if (total > 0 && havers > 0) e.min = havers < total ? 0 : lo
        if (maxlen > 0) e.maxLen = maxlen
        // Checkpoint after every measured property (in-progress profile; entries unsorted).
        await onPartial?.(profile)
      } catch (err) {
        // Timeout ⇒ this type is too big; stop BOTH the card and facts scans for its
        // remaining props (they'd time out too) and flag it so the caller counts the
        // streak. A non-timeout failure just leaves this property on its seeded prior
        // values and keeps going.
        if ((err as { isTimeout?: boolean }).isTimeout) { timedOut = true; measure = false; measureFacts = false }
      }
    }
    // A listed property always occurs ≥1×, so count 0 means "not measured THIS run"
    // (heavy skipped, --fast, this type timed out, or a measurement returned/failed 0) —
    // never a real zero. Reuse the previous profile's value so a re-run never downgrades
    // good counts to 0 (the recurring Virtuoso "counts went to 0" on big types).
    if (e.count === 0 && prior) {
      const pe = prior.properties.find(x => x.uri === e.uri)
      if (pe && pe.count > 0) {
        e.count = pe.count
        if (pe.min !== undefined) e.min = pe.min
        if (pe.max !== undefined) e.max = pe.max
        if (pe.maxLen !== undefined) e.maxLen = pe.maxLen
      }
    }
    // FACTS step: node-kind / datatype / language distribution (+ ranges/untyped when
    // IRI objects exist). Same heavy gate as the card scan. RESUME skips a property only
    // when the facts marker is present (nodeKinds !== undefined) AND the ranges marker
    // (untyped !== undefined) is present OR moot (no IRI values ⇒ the ranges step never
    // runs, so untyped can never appear — without the iri check literal-only properties
    // would re-measure on EVERY resume). non-resume, old counts-only configs (no
    // nodeKinds), and old ranges-basis configs (IRI-bearing nodeKinds but no untyped,
    // from before the pair-count basis) all re-enter and re-measure — the latter
    // migration is deliberate. A facts-query timeout drops both scans for the type's
    // remaining props and grows the shared streak.
    if (measureFacts && !(resume && e.nodeKinds !== undefined && (e.untyped !== undefined || !e.nodeKinds.iri))) {
      onStep?.(`facts ${i + 1}/${entries.length}: ${shortIri(e.uri)}`)
      try {
        const rows = await sparql(url, propFactsQuery(type, e.uri))
        // Rebuild all five facts fields FROM SCRATCH (mirrors the min/max/maxLen pattern).
        delete e.nodeKinds; delete e.datatypes; delete e.languages; delete e.ranges; delete e.untyped
        const kinds: { iri?: number; literal?: number; bnode?: number } = {}
        const dts: Record<string, number> = {}
        const langs: Record<string, number> = {}
        for (const r of rows) {
          const n = parseInt(r.n?.value ?? '0', 10)
          if (!n) continue
          const kind = r.kind?.value
          if (kind === 'iri' || kind === 'literal' || kind === 'bnode') kinds[kind] = (kinds[kind] ?? 0) + n
          if (kind !== 'literal') continue
          const lang = r.lang?.value ?? ''
          // langString hardening: a language tag ⇒ rdf:langString regardless of the
          // reported datatype; an untyped literal ⇒ xsd:string (RDF 1.1).
          let dt = r.dt?.value ?? ''
          if (lang !== '') { dt = RDF_LANGSTRING; langs[lang] = (langs[lang] ?? 0) + n }
          else if (dt === '') dt = XSD_STRING
          if (safeIri(dt)) dts[dt] = (dts[dt] ?? 0) + n
        }
        // Always record nodeKinds ({} = measured, genuinely empty) — the facts marker.
        e.nodeKinds = kinds
        const dtList = Object.entries(dts).map(([uri, count]) => ({ uri, count })).sort((a, b) => b.count - a.count)
        if (dtList.length) e.datatypes = dtList
        if (Object.keys(langs).length) e.languages = sortKeys(langs)
        // RANGES + UNTYPED: only when this property actually HAS IRI objects, and (on
        // resume) only when untyped isn't already recorded — an existing untyped marks the
        // ranges step done. Short leash (1 retry, LIST_TIMEOUT_MS) on BOTH queries: if
        // either times out/errors, leave ranges AND untyped absent (no marker) but still
        // commit nodeKinds + the other facts, and do NOT set timedOut / grow the streak.
        // On success ALWAYS write untyped (even 0 — the ranges-step marker); omit ranges
        // when empty. Both counts share `count`'s (s,o)-pair basis.
        if ((kinds.iri ?? 0) > 0 && !(resume && e.untyped !== undefined)) {
          onStep?.(`ranges ${i + 1}/${entries.length}: ${shortIri(e.uri)}`)
          try {
            const rr = (await sparql(url, propRangesQuery(type, e.uri), 1, LIST_TIMEOUT_MS))
              .map(r => ({ uri: r.t2?.value ?? '', count: parseInt(r.n?.value ?? '0', 10) }))
              .filter(r => safeIri(r.uri) && r.count > 0)
            const ut = (await sparql(url, propUntypedQuery(type, e.uri), 1, LIST_TIMEOUT_MS))[0] ?? {}
            if (rr.length) e.ranges = rr
            e.untyped = parseInt(ut.n?.value ?? '0', 10)
          } catch { /* optional hint — ranges+untyped both absent on timeout/error, the facts marker still commits */ }
        }
        // Checkpoint after every committed facts step (in-progress profile; entries unsorted).
        await onPartial?.(profile)
      } catch (err) {
        // A facts-query timeout ⇒ same verdict as a card timeout: stop BOTH scans for
        // this type's remaining props and flag it so the caller grows the shared streak.
        if ((err as { isTimeout?: boolean }).isTimeout) { timedOut = true; measure = false; measureFacts = false }
      }
    }
  }
  if (entries.some(e => e.count > 0)) entries.sort((a, b) => b.count - a.count)
  return { profile, timedOut }
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

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
// Above this per-owner count an embed just spills to links (mirrors the app's
// MAX_EMBED_TOTAL), so edges past it aren't embed candidates — dropped from hints.
const EMBED_CAP = 150
// Skip embed fan-in for types bigger than this: they're never embed targets, and the
// incoming scan over every instance is too costly. Raise if a real candidate exceeds it.
const EMBED_PROFILE_MAX = 50_000
// FLOOD SIGNAL: a low per-owner fan-in (few embeds per owner) is NOT enough — a type
// that itself holds a huge child list renders a wall of link rows when inlined. So each
// embed hint also carries `selfMax` = the type's OWN biggest single-property fan-out
// (max over its properties' `max`). A clean value object is ~1-5; a trap is hundreds+
// (Fedlex LegalAnalysis: 1 analysis per owner but 8016 impact links). Annotated, not
// hard-dropped — max is worst-case and over-flags types that are usually compact
// (PublicationProcess 178, TreatyDocument 221); this line only drives the ⚠ log flag.
const EMBED_SELF_MAX = 50

// Inverse fan-in: max distinct THIS-type SUBJECTS sharing one object, per outgoing
// IRI predicate. Low ⇒ safe to inverse-embed on the referent via `embedVia:"^<p>"`.
const inverseFanQuery = (t: string) =>
  `SELECT ?p (MAX(?c) AS ?hi) WHERE { SELECT ?p ?o (COUNT(DISTINCT ?s) AS ?c) WHERE { { SELECT DISTINCT ?s WHERE { ?s a <${t}> } } ?s ?p ?o . FILTER(isIRI(?o)) } GROUP BY ?p ?o } GROUP BY ?p`
// Forward fan-in: max distinct THIS-type OBJECTS per owner, per incoming predicate.
// Low ⇒ safe to embed under the owner via `embedVia:"<p>"`. DISTINCT ?o first keeps
// it quad-safe (an object in N graphs counts once), same trick as the property scan.
const forwardFanQuery = (t: string) =>
  `SELECT ?p (MAX(?c) AS ?hi) WHERE { SELECT ?p ?s (COUNT(DISTINCT ?o) AS ?c) WHERE { { SELECT DISTINCT ?o WHERE { ?o a <${t}> } } ?s ?p ?o } GROUP BY ?p ?s } GROUP BY ?p`

/**
 * Per-owner fan-in in both directions — the max instances of `t` that inline under
 * one owner through each edge. This is the embed-safety check we'd otherwise run by
 * hand per candidate; low max ⇒ embeddable. Optional hint, so a short leash + one
 * retry, and a blocked/slow query just yields no edge (no failure).
 */
async function profileEmbed(url: string, t: string, selfMax: number, onStep?: (s: string) => void): Promise<EmbedHints | null> {
  const edges = async (q: string): Promise<FanEdge[]> => {
    const rows = await sparql(url, q, 1, LIST_TIMEOUT_MS).catch(() => null)
    if (!rows) return []
    return rows
      .map(r => ({ via: r.p?.value ?? '', max: Number(r.hi?.value ?? 0) }))
      .filter(e => e.via && e.via !== RDF_TYPE && e.max > 0 && e.max <= EMBED_CAP)
      .sort((a, b) => a.max - b.max) // lowest fan-in (best embed candidate) first
  }
  onStep?.('forward'); const forward = await edges(forwardFanQuery(t))
  onStep?.('inverse'); const inverse = await edges(inverseFanQuery(t))
  if (!forward.length && !inverse.length) return null
  // selfMax rides along so a reader can spot a flood trap (safe fan-in, huge own list).
  const hints: EmbedHints = { selfMax }
  if (forward.length) hints.forward = forward
  if (inverse.length) hints.inverse = inverse
  return hints
}

// Wall-clock helpers for phase logging (mirrors ae-skos' profiler output style).
const t0 = Date.now()
const secs = (from: number) => `${((Date.now() - from) / 1000).toFixed(1)}s`
const phase = (label: string) => { console.error(`\n▸ ${label}  (+${secs(t0)})`); return Date.now() }
const isTTY = process.stderr.isTTY // live heartbeat only on a terminal, not a redirected log
const CLEAR = '\r\x1b[2K' // carriage-return + erase-line, to overwrite the heartbeat

async function main() {
  const arg = process.argv.slice(2).find(a => !a.startsWith('--')) // path is the non-flag arg
  const path = resolve(process.cwd(), arg ?? DEFAULT_CONFIG)
  const cfg = JSON.parse(await readFile(path, 'utf8'))
  const url: string = cfg.url
  if (!url) throw new Error(`No "url" in ${path}`)
  GRAPHDB = cfg.backend === 'graphdb'
  if (GRAPHDB) console.error(`backend: graphdb — flat COMPLETE property lists${SKIP_HEAVY ? ', skipping heavy scans (--fast)' : ''}`)
  INFER = cfg.infer
  if (INFER !== undefined) console.error(`inference: ${INFER ? 'ON' : 'OFF'} (infer=${INFER} sent with every query)`)
  if (AUTH_HEADER.Authorization) console.error(`auth: HTTP Basic (SPARQL_USER=${process.env.SPARQL_USER})`)

  // Type list: prefer the cached inventory; else discover it live AND cache it (with
  // counts) — so a fresh config-endpoint gets a persisted typeInventory the app can use,
  // and this run's `totals` (below) are populated for cardinality.
  let typeUris: string[] = (cfg.typeInventory ?? []).map((t: { uri: string }) => t.uri).filter(Boolean)
  if (!typeUris.length) {
    console.error('No typeInventory — discovering types + counts live…')
    const inv = (await sparql(url, typeInventoryQuery()))
      .filter(b => b.t?.type === 'uri') // only URI types — bnode/literal type values are skipped below
      .map(b => ({ uri: b.t!.value, count: parseInt(b.n?.value ?? '0', 10) }))
      .sort((a, b) => b.count - a.count)
    cfg.typeInventory = inv
    typeUris = inv.map(e => e.uri)
  }
  // Only profile REAL URI types — log and skip anything that isn't an http(s) IRI
  // (bnode/literal type values, junk), so we never build a query around a non-IRI.
  const nonUri = typeUris.filter(t => !safeIri(t))
  if (nonUri.length) console.error(`  ⚠ ${nonUri.length} non-URI type(s) logged & skipped: ${nonUri.slice(0, 8).join(', ')}${nonUri.length > 8 ? ' …' : ''}`)
  typeUris = typeUris.filter(safeIri)
  // Distinct-instance total per type (from the inventory) — needed to derive
  // min=0 (some instance lacks the property) from the per-instance cardinality.
  const totals: Record<string, number> = {}
  for (const t of (cfg.typeInventory ?? []) as { uri: string; count: number }[]) totals[t.uri] = t.count
  // Process SMALLEST-first: cheap types finish fast, and the heavy scan's timeout
  // streak trips only once we climb into the too-big types — so we measure as far up
  // as the endpoint can bear, then stop. (The on-disk typeProperties keys are sorted
  // by URI regardless — sortKeys below — so processing order doesn't dirty the diff.)
  typeUris.sort((a, b) => (totals[a] ?? 0) - (totals[b] ?? 0))
  console.error(`Endpoint: ${url}\nTypes: ${typeUris.length}`)

  // ── Graph shape (named graphs? merged default?) ────────────────────────
  let p = phase('Graph shape')
  const g = await profileGraph(url)
  const graph: { quads?: boolean; defaultView?: 'merged' | 'own' } = { ...(cfg.graph ?? {}) }
  if (g.quads !== undefined) graph.quads = g.quads
  if (g.defaultView) graph.defaultView = g.defaultView // only a confident merged/own
  cfg.graph = graph
  console.error(`  → quads=${graph.quads ?? '?'} defaultView=${graph.defaultView ?? '?'} in ${secs(p)}`)

  // ── Properties + per-instance cardinality ──────────────────────────────
  p = phase(`Properties${SKIP_HEAVY ? '' : ' + cardinality'} — ${typeUris.length} types`)
  const out: Record<string, TypeProfile> = { ...(cfg.typeProperties ?? {}) }
  // Checkpoint: persist everything gathered so far (inventory, graph, profiles)
  // after every type, so a killed run loses at most the type in flight.
  const save = () => {
    cfg.typeProperties = sortKeys(out)
    return atomicWrite(path, JSON.stringify(cfg, null, 2) + '\n')
  }
  // --resume skip test. Fully "measured" = EVERY listed property carries a real count
  // AND a facts marker (nodeKinds present) — a listed property always occurs ≥1×, so
  // count 0 means the heavy scan never ran on it (see profileType), and a missing
  // nodeKinds means its facts step never ran. A PARTIALLY-measured type re-enters
  // profileType and fills only the gaps (covers an old counts-only config → facts-only
  // resume, and a --fast → full --resume that measures both). Under --fast the property
  // LIST alone is done. A streak-stopped tail re-enters but heavy=false is a no-op that
  // keeps its priors.
  const done = (t: string) => {
    const e = out[t]
    if (!e?.ok) return false
    return SKIP_HEAVY || !e.properties.length || e.properties.every(pr => pr.count > 0 && pr.nodeKinds !== undefined)
  }
  let okCount = 0, sampledCount = 0
  // Heavy scans run smallest-first and stop for good once HEAVY_TIMEOUT_LIMIT types
  // in a row time out — past that ceiling every bigger type would too. Larger types
  // still get their property LIST refreshed and keep their prior counts (preserved
  // in profileType), so no data is lost — we just don't re-measure what can't finish.
  let timeoutStreak = 0
  let heavyStopped = false
  for (const [i, type] of typeUris.entries()) {
    const tt = Date.now()
    const tag = `[${i + 1}/${typeUris.length}]`
    const short = type.replace(/^.*[#/]/, '') || type
    const total = totals[type] ?? 0
    const nfmt = total.toLocaleString('en-US') // instance count — readable, and shows the ascending climb
    if (RESUME && done(type)) {
      okCount++
      if (out[type].sampled) sampledCount++
      console.error(`  ${tag} ↷ ${type} (${nfmt} instances — already profiled, skipped)`)
      continue
    }
    const heavy = !SKIP_HEAVY && !heavyStopped && total <= HEAVY_TYPE_MAX
    // Live progress: on a TTY, tick elapsed + current step (which property is
    // being measured) in place so a slow type isn't a silent gap. Off a TTY
    // (redirected to a file) the \r heartbeat would just spam lines, so we skip
    // the per-property ticks and only note the sampled-list fallback — one line
    // per type on the happy path.
    let step = 'listing properties'
    const beat = () => process.stderr.write(`${CLEAR}  ${tag} ⏳ ${short} (${nfmt}) — ${step} (${secs(tt)})`)
    let timer: ReturnType<typeof setInterval> | undefined
    if (isTTY) { beat(); timer = setInterval(beat, 1000) }
    // Checkpoint after every measured property — finer than the per-type save below
    // (which still covers list-only / --fast runs). Fired only on a real measurement,
    // so a heavy===false type (streak stopped / --fast) triggers no writes here.
    const onPartial = async (partial: TypeProfile) => { out[type] = partial; await save() }
    const { profile, timedOut } = await profileType(url, type, total, heavy, RESUME, (s) => {
      step = s
      if (isTTY) beat()
      else if (s === 'sampled property list') console.error(`  ${tag}   ↳ ${short}: ${s}`)
    }, out[type], onPartial)
    if (timer) clearInterval(timer)
    if (isTTY) process.stderr.write(CLEAR) // wipe the heartbeat before the result line
    // Grow / reset the consecutive-timeout streak (only while we're still measuring).
    if (heavy) {
      if (timedOut) {
        if (++timeoutStreak >= HEAVY_TIMEOUT_LIMIT) {
          heavyStopped = true
          console.error(`  ⚠ ${HEAVY_TIMEOUT_LIMIT} heavy-scan timeouts in a row — stopping measurement; larger types keep their prior counts`)
        }
      } else timeoutStreak = 0
    }
    if (profile) {
      out[type] = profile
      okCount++
      if (profile.sampled) sampledCount++
      const card = profile.properties.some(pr => pr.max !== undefined) ? ', card' : ''
      console.error(`  ${tag} ${profile.sampled ? '~' : '✓'}${timedOut ? ' ⏱' : ''} ${type} (${nfmt} instances, ${profile.properties.length} props${card}, ${secs(tt)})`)
    } else if (!out[type]) {
      // keep any prior good entry; only record a failure if we have nothing
      out[type] = { ok: false, properties: [] }
    }
    await save()
  }
  // Sort by type URI so key order is deterministic — clean git diffs across
  // runs, instead of tracking typeInventory's count-order (which drifts).
  cfg.typeProperties = sortKeys(out)
  console.error(`  → ${okCount}/${typeUris.length} OK (${sampledCount} sampled${SKIP_HEAVY ? ', no cardinality' : ''}) in ${secs(p)}`)

  // ── Embed fan-in — max instances per owner, both directions (embed hints) ──
  // Written onto each typeProperties entry (shared object ref, so already sorted).
  // Skips huge types (never embed targets; the incoming scan is costly). Each hint
  // also carries selfMax (the type's own biggest property fan-out) so a reader can
  // spot a flood trap — safe fan-in but a wall of own rows (LegalAnalysis: 1/owner,
  // 8016 impact links). selfMax is free (from the props already profiled).
  p = phase(`Embed fan-in — ${typeUris.length} types`)
  let embedCount = 0, floodFlag = 0
  for (const [i, type] of typeUris.entries()) {
    if (SKIP_HEAVY) break // --fast: skip the per-subject fan-in scans
    if (!out[type]?.ok || (totals[type] ?? 0) > EMBED_PROFILE_MAX) continue
    // ponytail: only types WITH an edge are marked done — no-edge types re-scan on
    // resume (2×30s leash each); add a done-marker if that ever dominates a resume.
    if (RESUME && out[type].embed) { embedCount++; continue }
    const selfMax = Math.max(0, ...out[type].properties.map(pr => pr.max ?? 0))
    const tt = Date.now()
    const tag = `[${i + 1}/${typeUris.length}]`
    const short = type.replace(/^.*[#/]/, '') || type
    let step = 'forward'
    const beat = () => process.stderr.write(`${CLEAR}  ${tag} ⏳ ${short} — ${step} fan-in (${secs(tt)})`)
    let timer: ReturnType<typeof setInterval> | undefined
    if (isTTY) { beat(); timer = setInterval(beat, 1000) }
    const embed = await profileEmbed(url, type, selfMax, (s) => { step = s; if (isTTY) beat() })
    if (timer) clearInterval(timer)
    if (isTTY) process.stderr.write(CLEAR)
    if (embed) {
      out[type].embed = embed
      embedCount++
      const f = embed.forward?.length ? ` fwd:${embed.forward[0]!.max}` : ''
      const inv = embed.inverse?.length ? ` inv:${embed.inverse[0]!.max}` : ''
      const warn = selfMax > EMBED_SELF_MAX ? ` ⚠selfMax:${selfMax}` : ''
      if (warn) floodFlag++
      console.error(`  ${tag} ✓ ${short} —${f}${inv}${warn} (${secs(tt)})`)
      await save()
    }
  }
  console.error(`  → ${SKIP_HEAVY ? 'skipped (--fast)' : `${embedCount} types with an embeddable edge (${floodFlag} flagged ⚠ flood-risk: selfMax > ${EMBED_SELF_MAX})`} in ${secs(p)}`)

  // ── Blank-node detection ────────────────────────────────────────────────
  // Count bnode instances per type. `bnodeCount` is recorded whenever non-zero;
  // `blank:true` (→ the app hides + inlines the type) is set ONLY when the type is
  // EXCLUSIVELY blank (every instance a bnode). A mixed type (some named, some bnode
  // — e.g. owl:Class, foaf:Document) keeps its named instances navigable. One grouped
  // scan; best-effort (skipped on --fast, tolerates error).
  if (!SKIP_HEAVY) {
    p = phase('Blank nodes')
    const blankRows = await sparql(url, blankTypesQuery()).catch(() => [])
    // Derived flags — clear before recompute so a re-profile drops stale marks (a type
    // that used to be all-bnode but now has named instances must lose blank:true).
    for (const e of Object.values(out)) { delete e.blank; delete e.bnodeCount }
    let exclusiveCount = 0, mixedCount = 0
    for (const b of blankRows) {
      const t = b.t?.value, n = parseInt(b.n?.value ?? '0', 10)
      if (!t || !n || !safeIri(t) || !out[t]) continue
      const total = totals[t] ?? 0
      const exclusive = total > 0 && n >= total
      out[t].bnodeCount = n
      if (exclusive) { out[t].blank = true; exclusiveCount++ } else mixedCount++
      console.error(`  ⬥ ${t.replace(/^.*[#/]/, '')}: ${n}${total ? `/${total}` : ''} blank-node instance(s)${exclusive ? ' (ALL — embed + sidebar:hide)' : ' (mixed — kept navigable)'}`)
    }
    console.error(`  → ${exclusiveCount} exclusive + ${mixedCount} mixed blank-node type(s) in ${secs(p)}`)
  }

  // ── Deprecation flags ───────────────────────────────────────────────────
  // Probe a seed of common boolean deprecation predicates; the ones actually
  // asserted `true` become cfg.deprecatedPredicates (the app badges resources
  // that assert any of them). Each ASK is predicate-indexed, so it's cheap.
  p = phase('Deprecation flags')
  const foundDep: string[] = []
  for (const pred of DEPRECATION_CANDIDATES) {
    if (await ask(url, deprecatedAskQuery(pred))) foundDep.push(pred)
  }
  if (foundDep.length) {
    cfg.deprecatedPredicates = foundDep
    console.error(`  → ${foundDep.length} deprecation flag(s): ${foundDep.map(p => p.replace(/^.*[#/]/, '')).join(', ')} in ${secs(p)}`)
  } else {
    delete cfg.deprecatedPredicates
    console.error(`  → none in ${secs(p)}`)
  }

  // ── Subclass hierarchy (for the nested sidebar tree) ───────────────────
  p = phase('Subclasses')
  const subs = await profileSubclasses(url, typeUris)
  if (subs) { cfg.subclasses = sortKeys(subs); console.error(`  → ${Object.keys(subs).length} superclasses in ${secs(p)}`) }

  // ── Embed composition — only over types configured as render:embed ─────
  const embeds = Object.entries(cfg.types ?? {})
    .filter(([, c]) => (c as { render?: string }).render === 'embed')
    .map(([uri]) => uri)
  p = phase(`Composition — ${embeds.length} embed types`)
  const comp = await profileComposition(url, embeds)
  if (comp) { cfg.composition = sortKeys(comp); console.error(`  → ${Object.keys(comp).length} composing classes in ${secs(p)}`) }

  // ── Embed-orphan counts — embed types that pin an owning predicate ─────
  const orphanPairs = Object.entries(cfg.types ?? {})
    .filter(([, c]) => (c as { render?: string; embedVia?: string }).render === 'embed' && (c as { embedVia?: string }).embedVia)
    .map(([uri, c]) => ({ type: uri, via: (c as { embedVia: string }).embedVia, total: totals[uri] ?? 0 }))
  p = phase(`Orphan counts — ${orphanPairs.length} pinned embed types`)
  const orphans = await profileOrphanCounts(url, orphanPairs)
  if (orphans) { cfg.orphanCounts = sortKeys(orphans); console.error(`  → ${Object.keys(orphans).length} types with orphans in ${secs(p)}`) }

  cfg.profiledAt = new Date().toISOString()
  await atomicWrite(path, JSON.stringify(cfg, null, 2) + '\n')
  console.error(`\n✓ Done in ${secs(t0)}: ${okCount}/${typeUris.length} types → ${path}`)
}

main().catch(e => { console.error(e); process.exit(1) })
