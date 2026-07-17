#!/usr/bin/env node
// Assign sidebar groups to every class in an endpoint config's typeInventory.
//
//   node scripts/group-types.mjs public/config/endpoints/lindas.json [--dry-run] [--smart] [--force]
//
// Strategy (see TypeList.vue groupedRoots — the UI already renders types.<IRI>.group):
//   1. Well-known vocabularies get their canonical name (schema.org, OWL, QUDT, …).
//   2. Everything else is keyed by dataset: host + first 2 URI path segments.
//   3. Oversized dataset groups (> MAX_GROUP) split one path segment deeper.
//   4. Tiny fallback groups (≤ FOLD_MAX classes) fold into the group that
//      dominantly links to them, using typeProperties property ranges.
//
// --smart: send the inventory (class URIs, instance counts, property-range links)
//   to Claude (`claude -p`) for thematic clustering — classes group by what they
//   MEAN and LINK TO, not just their namespace (e.g. plazi Treatment joins
//   taxonomy + journal articles in a Biodiversity group). The mechanical pass
//   above remains the fallback for any class the model leaves unassigned.
// --force: overwrite existing `group` values (default: preserved).
//
// --embed: set render:'embed' (+ scoped embedVia) on the curated Tier-1 value
//   objects below. Gated by the profiler's `embed.selfMax` (max copies of the
//   class under any single parent): refuses to embed anything whose selfMax
//   exceeds EMBED_SELFMAX_CAP, so a re-profile that turns a value object into a
//   fan-out entity fails loud instead of hanging the resource loader.

import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const MAX_GROUP = 40
const FOLD_MAX = 2
const EMBED_SELFMAX_CAP = 10

// Tier-1 value objects → owning predicate to scope embedding (null = pure value
// object, safe to inline wherever it's an object). selfMax ≤ 5 for all of these
// (verified against the profiler); the two `address` types have no profiler
// selfMax so they're pinned to their owner predicate as a belt-and-braces guard.
const EMBED_TIER1 = {
  'http://schema.org/GeoCoordinates': null,
  'http://schema.org/GeoShape': null,
  'http://schema.org/QuantitativeValue': null,
  'http://schema.org/PostalAddress': 'http://schema.org/address',
  'http://www.w3.org/ns/locn#Address': 'http://schema.org/address',
  'http://schema.org/ContactPoint': 'http://schema.org/contactPoint',
  'http://www.w3.org/2006/time#Instant': null,
  'http://www.w3.org/2006/time#Interval': null,
  'http://www.w3.org/2006/time#ProperInterval': null,
  'http://www.w3.org/2006/time#DurationDescription': null,
  'http://qudt.org/schema/qudt/ConstantValue': null,
  'http://qudt.org/schema/qudt/QuantityKindDimensionVector': null,
  'http://qudt.org/schema/qudt/QuantityKindDimensionVector_SI': null,
  'http://qudt.org/schema/qudt/QuantityKindDimensionVector_ISO': null,
  'http://qudt.org/schema/qudt/QuantityKindDimensionVector_Imperial': null,
  'http://qudt.org/schema/qudt/QuantityKindDimensionVector_CGS': null,
  'http://www.opengis.net/ont/geosparql#Geometry': 'http://www.opengis.net/ont/geosparql#hasGeometry',
}

// Conventional prefixes for well-known namespaces (prefix.cc style). Everything
// else is guessed from the namespace. Used by the --prefixes pass.
const NS_PREFIX = {
  'http://schema.org/': 'schema',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#': 'rdf',
  'http://www.w3.org/2000/01/rdf-schema#': 'rdfs',
  'http://www.w3.org/2002/07/owl#': 'owl',
  'http://www.w3.org/2004/02/skos/core#': 'skos',
  'http://www.w3.org/2008/05/skos-xl#': 'skosxl',
  'http://www.w3.org/2006/time#': 'time',
  'http://www.w3.org/2006/http#': 'http',
  'http://www.w3.org/ns/dcat#': 'dcat',
  'http://www.w3.org/ns/shacl#': 'sh',
  'http://www.w3.org/ns/locn#': 'locn',
  'http://www.w3.org/ns/prov#': 'prov',
  'http://purl.org/dc/terms/': 'dct',
  'http://purl.org/dc/elements/1.1/': 'dc',
  'http://purl.org/linked-data/cube#': 'qb',
  'http://purl.org/spar/fabio/': 'fabio',
  'http://xmlns.com/foaf/0.1/': 'foaf',
  'http://rdfs.org/ns/void#': 'void',
  'http://qudt.org/schema/qudt/': 'qudt',
  'http://publications.europa.eu/ontology/euvoc#': 'euvoc',
  'http://www.linkedmodel.org/schema/vaem#': 'vaem',
  'https://www.ica.org/standards/RiC/ontology#': 'ric',
  'https://cube.link/': 'cube',
  'https://cube.link/meta/': 'meta',
  'https://version.link/': 'vl',
  'https://ch.paf.link/': 'paf',
  'http://rs.tdwg.org/dwc/terms/': 'dwc',
  'http://filteredpush.org/ontologies/oa/dwcFP#': 'dwcFP',
  'http://plazi.org/vocab/treatment#': 'trt',
  'https://cube-creator.zazuko.com/shared-dimensions/vocab#': 'sh-dim',
  'http://www.opengis.net/ont/geosparql#': 'gsp',
}

const GENERIC_NS_SEG = new Set(['terms', 'term', 'ontology', 'ontologies', 'schema', 'vocab', 'vocabulary', 'ns', 'core', 'rdf', 'owl', 'def', 'resource', 'id', 'data', 'meta', 'model'])
// Guess a short prefix from a NAMESPACE (ends in / or #) — last meaningful path
// segment, else first host label. (format.ts guessPrefix does the same from a full
// class URI, so it also drops the trailing local name; here the input is already
// the namespace, so every segment is fair game.)
function guessPrefix(nsUri) {
  let host, path
  try { const u = new URL(nsUri); host = u.hostname.replace(/^www\./, ''); path = u.pathname }
  catch { return '' }
  const segs = path.split('/').filter(Boolean)
  for (let i = segs.length - 1; i >= 0; i--) {
    const raw = segs[i]
    if (!raw.replace(/[^a-zA-Z0-9]/g, '') || GENERIC_NS_SEG.has(raw.toLowerCase())) continue
    const caps = raw.match(/[A-Z]/g)
    if (raw.length > 8 && caps && caps.length >= 2) return caps.join('').toLowerCase().slice(0, 12)
    return raw.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 12)
  }
  return (host.split('.')[0] ?? '').slice(0, 12)
}

const KNOWN_VOCABS = {
  'http://schema.org/': 'schema.org',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#': 'Ontology',
  'http://www.w3.org/2000/01/rdf-schema#': 'Ontology',
  'http://www.w3.org/2002/07/owl#': 'Ontology',
  'http://www.w3.org/2004/02/skos/core#': 'SKOS',
  'http://www.w3.org/2006/time#': 'Time',
  'http://www.w3.org/2006/http#': 'HTTP',
  'http://www.w3.org/ns/dcat#': 'DCAT',
  'http://www.w3.org/ns/shacl#': 'SHACL',
  'http://www.w3.org/ns/locn#': 'Location (LOCN)',
  'http://www.w3.org/ns/prov#': 'PROV',
  'http://purl.org/dc/terms/': 'Dublin Core',
  'http://purl.org/linked-data/cube#': 'RDF Data Cube',
  'http://purl.org/spar/fabio/': 'FaBiO',
  'http://xmlns.com/foaf/0.1/': 'FOAF',
  'http://rdfs.org/ns/void#': 'VoID',
  'http://qudt.org/schema/qudt/': 'QUDT',
  'http://publications.europa.eu/ontology/euvoc#': 'EU Vocabularies',
  'http://www.linkedmodel.org/schema/vaem#': 'VAEM',
  'https://www.ica.org/standards/RiC/ontology#': 'Records in Contexts (RiC)',
  'https://cube.link/': 'Cube',
  'https://cube.link/meta/': 'Cube',
  'https://version.link/': 'version.link',
  'https://ch.paf.link/': 'paf.link',
  'http://rs.tdwg.org/dwc/terms/': 'Darwin Core',
  'http://filteredpush.org/ontologies/oa/dwcFP#': 'Darwin Core',
  'http://plazi.org/vocab/treatment#': 'Plazi Treatment',
  'https://cube-creator.zazuko.com/shared-dimensions/vocab#': 'Shared Dimensions',
  'http://www.opengis.net/ont/geosparql#': 'GeoSPARQL',
}

const ns = uri => uri.replace(/[^/#]+$/, '')

function urlParts(uri) {
  try {
    const u = new URL(uri)
    return { host: u.hostname.replace(/^www\./, ''), segs: u.pathname.split('/').filter(Boolean) }
  } catch {
    return { host: uri, segs: [] }
  }
}

// Dataset label: "environment / foen / nfi" from environment.ld.admin.ch/foen/nfi/…
// depth = how many namespace path segments to keep (grows when a group splits).
function datasetLabel(uri, depth) {
  const { host, segs } = urlParts(ns(uri))
  // Strip the shared .ld.admin.ch suffix only when path segments disambiguate;
  // a bare subdomain ("schema") would collide with real vocab names.
  const hostPart = host.endsWith('.ld.admin.ch') && segs.length ? host.slice(0, -'.ld.admin.ch'.length) : host
  return [hostPart, ...segs.slice(0, depth)].join(' / ')
}

function groupFor(uri, depth) {
  return KNOWN_VOCABS[ns(uri)] ?? datasetLabel(uri, depth)
}

const [, , file, ...flags] = process.argv
if (!file) {
  console.error('usage: node scripts/group-types.mjs <endpoint-config.json> [--dry-run] [--smart] [--force]')
  process.exit(1)
}
const dryRun = flags.includes('--dry-run')
const smart = flags.includes('--smart')
const force = flags.includes('--force')
const doEmbed = flags.includes('--embed')
const doPrefixes = flags.includes('--prefixes')

const config = JSON.parse(readFileSync(file, 'utf8'))
const uris = (config.typeInventory ?? []).map(t => t.uri)
if (!uris.length) {
  console.error('no typeInventory in config — run the profiler first')
  process.exit(1)
}

// 1+2: initial assignment, then 3: split oversized fallback groups one segment deeper.
const known = new Set(Object.values(KNOWN_VOCABS))
const assign = new Map(uris.map(u => [u, groupFor(u, 2)]))
for (let pass = 0; pass < 4; pass++) {
  const sizes = new Map()
  for (const g of assign.values()) sizes.set(g, (sizes.get(g) ?? 0) + 1)
  let changed = false
  for (const [u, g] of assign) {
    if (known.has(g) || sizes.get(g) <= MAX_GROUP) continue
    const deeper = datasetLabel(u, 2 + pass + 1)
    if (deeper !== g) { assign.set(u, deeper); changed = true }
  }
  if (!changed) break
}

// 4: fold tiny fallback groups into their dominant linked group (typeProperties ranges).
const links = new Map() // class uri -> Set of linked class uris (both directions)
const inInventory = new Set(uris)
const addLink = (a, b) => {
  if (!links.has(a)) links.set(a, new Map())
  links.get(a).set(b, (links.get(a).get(b) ?? 0) + 1)
}
for (const [u, tp] of Object.entries(config.typeProperties ?? {})) {
  for (const p of tp?.properties ?? []) {
    for (const r of p.ranges ?? []) {
      if (inInventory.has(r.uri) && r.uri !== u && inInventory.has(u)) {
        addLink(u, r.uri)
        addLink(r.uri, u)
      }
    }
  }
}
const members = new Map()
for (const [u, g] of assign) (members.get(g) ?? members.set(g, []).get(g)).push(u)
for (const [g, mem] of members) {
  if (known.has(g) || mem.length > FOLD_MAX) continue
  const votes = new Map()
  for (const u of mem) {
    for (const [other, n] of links.get(u) ?? []) {
      const og = assign.get(other)
      if (og === g) continue
      // Generic vocab hubs (schema.org, RDFS, OWL…) attract links from every
      // dataset — folding into them mislabels dataset satellites. Only allow a
      // vocab target when source and target live on the same host (cube.link).
      if (known.has(og) && urlParts(other).host !== urlParts(u).host) continue
      votes.set(og, (votes.get(og) ?? 0) + n)
    }
  }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]
  if (best) for (const u of mem) assign.set(u, best[0])
}

/* ── --smart: thematic clustering via Claude ── */

if (smart) {
  const lines = uris.map(u => {
    const count = config.typeInventory.find(t => t.uri === u)?.count ?? 0
    const linked = [...(links.get(u) ?? [])].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([o]) => o)
    return `${u} | instances: ${count}${linked.length ? ` | links: ${linked.join(' ')}` : ''}`
  })
  const prompt = `You are clustering RDF classes from the "${config.name}" SPARQL endpoint into thematic sidebar groups for a data browser.

Below: one class per line — URI | instance count | linked classes (via property ranges, most-linked first).

Rules:
- Cluster by SUBJECT MATTER, using your domain knowledge of the vocabularies and datasets, plus the link evidence. A class belongs with what it's about and what it links to, not merely its namespace (e.g. a taxonomic-treatment class linking to TaxonConcept and JournalArticle belongs in a biodiversity/taxonomy group, not alone).
- 15-40 groups total. Short human-readable English names ("Biodiversity & Taxonomy", "Forest Inventory (NFI)", "Transport & Mobility", "Cube & Dimensions", "Ontology & Meta").
- A group SHOULD NOT exceed ~40 classes; split big ones into "Parent / Subtopic" groups.
- Pure ontology/meta machinery (owl, rdfs, shacl, void, vaem...) goes in one "Ontology & Meta" style group (or a few).
- Every class must be covered. To keep output short, you may assign whole namespaces: any entry ending in "/" or "#" is a namespace prefix covering all its classes; an exact class URI entry overrides a namespace entry.

Output ONLY raw JSON (no markdown fences, no commentary):
{"<Group Name>": ["<namespace-or-class-uri>", ...], ...}

Classes:
${lines.join('\n')}`

  console.error('asking Claude for thematic clusters…')
  const res = spawnSync('claude', ['-p'], { input: prompt, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 600_000 })
  if (res.status !== 0) throw new Error(`claude -p failed: ${res.stderr || res.error}`)
  const raw = res.stdout.replace(/^```(json)?\s*|```\s*$/g, '').trim()
  const smartGroups = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))

  // Exact class URI wins, then longest matching namespace prefix; else keep mechanical.
  const exact = new Map(), prefixes = []
  for (const [g, entries] of Object.entries(smartGroups)) {
    for (const e of entries) (/[/#]$/.test(e) ? prefixes.push([e, g]) : exact.set(e, g))
  }
  prefixes.sort((a, b) => b[0].length - a[0].length)
  let unmatched = 0
  for (const u of uris) {
    const g = exact.get(u) ?? prefixes.find(([p]) => u.startsWith(p))?.[1]
    if (g) assign.set(u, g)
    else unmatched++
  }
  if (unmatched) console.error(`${unmatched} classes not covered by Claude — kept mechanical group`)
}

/* ── --embed: mark Tier-1 value objects render:embed (safety-gated) ── */

const embedPlan = [] // { uri, via, selfMax }
if (doEmbed) {
  for (const [uri, via] of Object.entries(EMBED_TIER1)) {
    if (!inInventory.has(uri)) continue // not in this endpoint
    const selfMax = config.typeProperties?.[uri]?.embed?.selfMax
    if (selfMax != null && selfMax > EMBED_SELFMAX_CAP) {
      console.error(`SKIP embed ${uri}: selfMax ${selfMax} > cap ${EMBED_SELFMAX_CAP} (would fan out under a parent)`)
      continue
    }
    embedPlan.push({ uri, via, selfMax })
  }
  console.error(`\nembed plan: ${embedPlan.length} value-object types`)
  for (const e of embedPlan) {
    const name = e.uri.replace(/.*[/#]/, '')
    console.error(`  ${name.padEnd(28)} selfMax=${e.selfMax ?? 'n/a'}${e.via ? `  via ${e.via.replace(/.*[/#]/, '')}` : '  (any owner)'}`)
  }
}

/* ── --prefixes: generate the endpoint's namespace → prefix map ── */

let prefixMap = null // { prefix: namespace }
if (doPrefixes) {
  const namespaces = [...new Set(uris.map(ns))].sort()
  const taken = new Set()
  const uniq = base => {
    let p = base || 'ns', n = p
    for (let i = 2; taken.has(n); i++) n = `${p}${i}`
    taken.add(n)
    return n
  }
  prefixMap = {}
  for (const n of namespaces) {
    const prefix = uniq(NS_PREFIX[n] ?? guessPrefix(n))
    prefixMap[prefix] = n
  }
  console.error(`\nprefix map: ${namespaces.length} namespaces`)
  for (const [p, n] of Object.entries(prefixMap)) console.error(`  ${p.padEnd(14)} ${n}`)
}

// Report
const finalGroups = new Map()
for (const [u, g] of assign) (finalGroups.get(g) ?? finalGroups.set(g, []).get(g)).push(u)
console.log(`${uris.length} classes → ${finalGroups.size} groups\n`)
for (const [g, mem] of [...finalGroups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(mem.length).padStart(4)}  ${g}`)
}

// Sanity: every class assigned exactly once.
if (assign.size !== uris.length) throw new Error(`assigned ${assign.size} of ${uris.length}`)

if (dryRun) process.exit(0)

config.types ??= {}
let written = 0, kept = 0
for (const [u, g] of assign) {
  const t = (config.types[u] ??= {})
  if (t.group && !force) { kept++; continue } // hand-authored groups win unless --force
  t.group = g
  written++
}
let embedded = 0, embedKept = 0
for (const { uri, via } of embedPlan) {
  const t = (config.types[uri] ??= {})
  if (t.render && !force) { embedKept++; continue } // hand-authored render wins
  t.render = 'embed'
  if (via) t.embedVia = via
  else delete t.embedVia
  embedded++
}

let prefixesWritten = false
if (prefixMap) {
  if (config.prefixes && !force) console.log(`kept existing prefixes (${Object.keys(config.prefixes).length}); pass --force to regenerate`)
  else { config.prefixes = prefixMap; prefixesWritten = true }
}

writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
console.log(`\nwrote ${written} group assignments to ${file} (${kept} existing kept)`)
if (doEmbed) console.log(`marked ${embedded} types render:embed (${embedKept} existing render kept)`)
if (prefixesWritten) console.log(`wrote ${Object.keys(prefixMap).length} endpoint prefixes`)
