/**
 * Rewrite full `<IRI>`s in a (machine-generated) SPARQL query as `prefix:local`
 * qnames and prepend the matching `PREFIX` prologue — so the query the user copies
 * out of "Open in SPARQL" reads (and pastes) like a hand-written one.
 *
 * Text pass, not a parser: string literals are masked first (a `<…>` inside a
 * literal is never an IRI), then each `<IRI>` is collapsed to the LONGEST known
 * namespace whose remainder is a safe local name. IRIs with no clean prefix (local
 * part carries `/`, `#`, `:`, …) are left as-is. Whitespace/formatting is untouched,
 * so it runs AFTER formatSparql and preserves the indentation.
 *
 * ponytail: conservative local-name test — only collapse what's unambiguously a
 * valid PN_LOCAL, else keep the full IRI. Never rewrites semantics.
 */
const STR = /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g
const IRI = /<([^>\s]*)>/g
const MASK_OPEN = ''
const MASK_CLOSE = ''

// A local name we're willing to emit unescaped: starts alnum/_ , no reserved qname
// chars (`/ # : ? & …`), and doesn't end in `.` (illegal as the last PN_LOCAL char).
function isSafeLocal(local: string): boolean {
  return local === '' || (/^[A-Za-z0-9_][A-Za-z0-9_.\-]*$/.test(local) && !local.endsWith('.'))
}

export function prefixifyQuery(query: string, prefixes: Record<string, string>): string {
  if (!query) return query
  // Longest namespace first → most specific prefix wins.
  const entries = Object.entries(prefixes)
    .filter(([p, ns]) => p && ns)
    .sort((a, b) => b[1].length - a[1].length)
  if (!entries.length) return query

  const strs: string[] = []
  const masked = query.replace(STR, m => `${MASK_OPEN}${strs.push(m) - 1}${MASK_CLOSE}`)

  const used = new Map<string, string>() // prefix → namespace, only those emitted
  const body = masked.replace(IRI, (full, iri: string) => {
    for (const [p, ns] of entries) {
      if (iri.startsWith(ns)) {
        const local = iri.slice(ns.length)
        if (isSafeLocal(local)) {
          used.set(p, ns)
          return `${p}:${local}`
        }
      }
    }
    return full
  })

  const unmasked = body.replace(
    new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, 'g'),
    (_, n) => strs[Number(n)] ?? '',
  )
  if (!used.size) return unmasked

  const prologue = [...used]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([p, ns]) => `PREFIX ${p}: <${ns}>`)
    .join('\n')
  return `${prologue}\n\n${unmasked}`
}
