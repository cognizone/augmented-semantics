#!/usr/bin/env node
/**
 * THROWAWAY one-off: fill the `prefixes` block of each endpoint config from the
 * namespaces its already-profiled typeInventory/typeProperties reference. No live
 * endpoint access — the profiled data is already in the JSON. Endpoint-specific
 * namespaces are resolved via prefix.cc; the common ones the app already knows
 * (COMMON_PREFIXES) are skipped, and any hand-declared prefixes are preserved.
 *
 * Splices ONLY the "prefixes" block into the raw text so the rest of the file's
 * formatting is untouched (a full JSON re-dump balloons the inline facet objects).
 *
 * Usage: node scripts/gen-prefixes.mjs [file ...]   (defaults to all endpoint configs)
 * Remove this script once prefix collection lives in the profiler.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// prefix.cc currently serves an invalid TLS cert (its content is fine); tolerate it
// for this throwaway resolver so fetch() doesn't reject the handshake.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = join(HERE, '..', 'public', 'config', 'endpoints')

// The shared master map (src/services/prefix-map.json) is the single source of
// truth. A namespace it already covers is resolved centrally and consistently, so
// the per-endpoint config never needs to redeclare it — skip those here.
const MASTER = JSON.parse(readFileSync(join(HERE, '..', 'src', 'services', 'prefix-map.json'), 'utf8'))

const nsOf = (uri) => {
  const h = uri.lastIndexOf('#')
  if (h >= 0) return uri.slice(0, h + 1)
  const s = uri.lastIndexOf('/')
  return s >= 0 ? uri.slice(0, s + 1) : uri
}

function namespacesOf(cfg) {
  const out = new Set()
  for (const t of cfg.typeInventory ?? []) if (t?.uri) out.add(nsOf(t.uri))
  for (const tp of Object.values(cfg.typeProperties ?? {})) {
    for (const p of tp?.properties ?? []) {
      if (p?.uri) out.add(nsOf(p.uri))
      for (const d of p?.datatypes ?? []) if (d?.uri) out.add(nsOf(d.uri))
      for (const r of p?.ranges ?? []) if (r?.uri) out.add(nsOf(r.uri))
    }
  }
  return out
}

const ccCache = new Map() // namespace → prefix|null, shared across files
async function prefixCc(ns) {
  if (ccCache.has(ns)) return ccCache.get(ns)
  let prefix = null
  try {
    const r = await fetch(`https://prefix.cc/reverse?uri=${encodeURIComponent(ns)}&format=json`)
    if (r.ok) prefix = Object.keys(await r.json())[0] ?? null
  } catch { /* offline / rate-limited → leave null */ }
  ccCache.set(ns, prefix)
  await new Promise(res => setTimeout(res, 120)) // be polite to prefix.cc
  return prefix
}

// Store-internal namespaces (surfaced by profiling) we never want declared.
const SYSTEM = new Set(['http://proton.semanticweb.org/protonsys#'])

// Replace an existing "prefixes": {…} block, else insert one right after "url": "…",
function spliceIn(raw, block) {
  if (/"prefixes"\s*:\s*\{[^{}]*\}/.test(raw)) {
    return raw.replace(/"prefixes"\s*:\s*\{[^{}]*\}/, block)
  }
  return raw.replace(/("url"\s*:\s*"[^"]*"\s*,)/, `$1\n  ${block},`)
}
// Remove the whole "prefixes": {…}, line (master owns everything this endpoint uses).
function spliceOut(raw) {
  return raw.replace(/\n\s*"prefixes"\s*:\s*\{[^{}]*\}\s*,/, '')
}

const files = process.argv.slice(2).map(f => f.split('/').pop())
  .filter(Boolean)
const targets = (files.length ? files : readdirSync(DIR)).filter(f => f.endsWith('.json'))

for (const file of targets) {
  const path = join(DIR, file)
  const raw = readFileSync(path, 'utf8')
  const cfg = JSON.parse(raw)
  const nss = namespacesOf(cfg)
  if (!nss.size) { console.log(`- ${file}: no profiled data, skipped`); continue }

  // Keep only existing entries the master does NOT own (endpoint-private prefixes).
  const prefixes = {}
  for (const [p, ns] of Object.entries(cfg.prefixes ?? {})) {
    if (!MASTER[ns] && !SYSTEM.has(ns)) prefixes[p] = ns
  }
  const takenNs = new Set(Object.values(prefixes))
  const takenP = new Set(Object.keys(prefixes))
  let added = 0
  for (const ns of [...nss].sort()) {
    if (MASTER[ns] || SYSTEM.has(ns) || takenNs.has(ns)) continue // master/system-owned or done
    const p = await prefixCc(ns)
    if (!p || takenP.has(p)) continue                  // unknown, or name already used
    prefixes[p] = ns; takenP.add(p); takenNs.add(ns); added++
  }

  const keys = Object.keys(prefixes).sort()
  const hadBlock = /"prefixes"\s*:\s*\{[^{}]*\}/.test(raw)
  const body = keys.map(p => `    "${p}": "${prefixes[p]}"`).join(',\n')
  const next = keys.length ? spliceIn(raw, `"prefixes": {\n${body}\n  }`)
    : hadBlock ? spliceOut(raw) : raw
  if (next === raw) { console.log(`- ${file}: unchanged (master covers everything)`); continue }
  writeFileSync(path, next)
  console.log(`✓ ${file}: ${keys.length} endpoint-private prefix(es)${added ? ` (+${added} newly resolved)` : ''}`)
}
