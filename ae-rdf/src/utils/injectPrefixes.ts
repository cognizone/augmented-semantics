/**
 * Prepend `PREFIX` declarations for any qname prefix the query USES but does not
 * already declare (and whose namespace we know). Lets a query written with
 * `era:Foo` / `skos:prefLabel` run without the author hand-adding the prologue —
 * the SPARQL panel resolves known prefixes the way YASGUI does.
 *
 * Text pass, not a parser: IRIs (`<…>`) and string literals are masked first so a
 * `:` inside one is never mistaken for a qname separator. Everything else (layout,
 * the query body) is untouched. Whitespace-insensitive, so the query runs identically.
 *
 * ponytail: default-namespace qnames (`:local`) aren't auto-declared — rare in
 * hand-written SPARQL; add if it ever matters.
 */
const STR_IRI =
  /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<[^>\s]*>/g
// PREFIX declarations already present (so we never redeclare one).
const DECL = /\bPREFIX\s+([A-Za-z][\w.\-]*)?\s*:/gi
// A used qname prefix: `name:` sitting at a term position (a boundary char before
// it, so we don't match a suffix of some longer token).
const USED = /(^|[\s{}()[\].,;|^!+*/-])([A-Za-z][\w.\-]*):/g

export function injectPrefixes(query: string, prefixes: Record<string, string>): string {
  if (!query) return query
  // Blank out IRIs/strings (same length keeps offsets irrelevant — we only scan).
  const masked = query.replace(STR_IRI, m => ' '.repeat(m.length))

  const declared = new Set<string>()
  for (const m of masked.matchAll(DECL)) declared.add(m[1] ?? '')

  const add: string[] = []
  const seen = new Set<string>()
  for (const m of masked.matchAll(USED)) {
    const p = m[2]!
    if (seen.has(p) || declared.has(p)) continue
    seen.add(p)
    const ns = prefixes[p]
    if (ns) add.push(`PREFIX ${p}: <${ns}>`)
  }
  if (!add.length) return query
  add.sort()
  return `${add.join('\n')}\n${query}`
}
