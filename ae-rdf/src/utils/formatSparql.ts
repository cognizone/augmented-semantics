/**
 * Pretty-print a (machine-generated) SPARQL query for human reading in the panel.
 *
 * Not a parser: it masks IRIs (`<…>`) and string literals so their braces, dots
 * and keywords are inert, then indents on `{` / `}` and breaks on statement dots.
 * Whitespace-insensitive semantics mean the reflowed query runs identically.
 *
 * ponytail: mask-then-indent, no grammar. Handles the queries this app emits
 * (list + facet constraints: IRIs, VALUES/GRAPH groups, typed-literal FILTERs).
 * Not a general SPARQL beautifier — nested ORDER/GROUP BY indent to their block,
 * which is enough here; reach for a real formatter lib if arbitrary input matters.
 */
// Private-use sentinels wrap a mask index so it can't collide with a real number
// in the query (e.g. LIMIT 100) when it is substituted back at the end.
const MASK_OPEN = '\uE000'
const MASK_CLOSE = '\uE001'

export function formatSparql(query: string): string {
  if (!query || !query.trim()) return query

  // Mask IRIs and string literals; a dot/brace/keyword inside one is not structure.
  const masks: string[] = []
  const masked = query.replace(
    /<[^>\s]*>|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    m => `${MASK_OPEN}${masks.push(m) - 1}${MASK_CLOSE}`,
  )
  const s = masked.replace(/\s+/g, ' ').trim()

  let out = ''
  let depth = 0
  let atGroupEnd = false // last structural token emitted was a closing '}'
  const pad = () => '  '.repeat(depth)

  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '{') {
      out = out.replace(/\s+$/, '')
      if (out.endsWith('}')) out += '\n' + pad() // sibling group on its own line
      else if (out !== '') out += ' '
      out += '{\n'
      depth++
      out += pad()
      atGroupEnd = false
    } else if (c === '}') {
      depth = Math.max(0, depth - 1)
      out = out.replace(/\s+$/, '') + '\n' + pad() + '}'
      atGroupEnd = true
    } else if (c === '.' && (i === s.length - 1 || s[i + 1] === ' ' || s[i + 1] === '}')) {
      // Statement terminator (dot followed by space/brace/end) — NOT a decimal point.
      out = out.replace(/[ \t]+$/, '') + ' .\n' + pad()
      atGroupEnd = false
    } else if (c === ' ') {
      if (!atGroupEnd && out !== '' && !/[ \n]$/.test(out)) out += ' '
    } else {
      if (atGroupEnd) { out += '\n' + pad(); atGroupEnd = false } // token after '}' → new line
      out += c
    }
  }

  out = out
    .split('\n')
    .map(l => l.replace(/[ \t]+$/, ''))
    .filter(l => l.trim() !== '')
    .join('\n')

  const unmask = new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, 'g')
  return out.replace(unmask, (m, n) => masks[Number(n)] ?? m).trim()
}
