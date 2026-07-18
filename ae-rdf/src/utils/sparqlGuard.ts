/**
 * Pure guard helpers for the raw SPARQL panel.
 *
 * The panel is READ-ONLY and defensive: it must let SELECT / ASK through, block
 * everything else (CONSTRUCT, DESCRIBE, INSERT, DELETE, LOAD, …) before any
 * request is sent, and never ship an unbounded SELECT (append a LIMIT when none
 * is present). All logic here is pure so it can be unit-tested in isolation.
 *
 * @see /spec/ae-rdf
 */

/** Keywords allowed to run in the read-only panel. */
export const READ_ONLY_KEYWORDS = ['SELECT', 'ASK'] as const
export type ReadOnlyKeyword = (typeof READ_ONLY_KEYWORDS)[number]

/** Default LIMIT appended to a SELECT that declares none. */
export const DEFAULT_LIMIT = 100

// One scanner that matches (in priority order) a triple-quoted string, a quoted
// string, an <IRI>, or a `#` line comment. Strings and IRIs are matched FIRST and
// preserved, so a `#` inside them (an IRI fragment, a literal) is never mistaken
// for a comment. Only the comment alternative is stripped.
const TOKEN =
  /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<[^<>"{}|\\^`\s]*>|#[^\n\r]*/g

/** Remove `#` line comments, leaving strings and IRIs intact. */
export function stripComments(query: string): string {
  return query.replace(TOKEN, (m) => (m[0] === '#' ? '' : m))
}

// A single leading PREFIX or BASE declaration at the current head of the string.
const PROLOGUE_DECL = /^(?:PREFIX\s+[^\s:]*:\s*<[^>]*>|BASE\s+<[^>]*>)\s*/i

/** Strip leading PREFIX/BASE declarations (prologue) so the query verb is exposed. */
export function stripPrologue(query: string): string {
  let s = query.replace(/^\s+/, '')
  while (PROLOGUE_DECL.test(s)) s = s.replace(PROLOGUE_DECL, '')
  return s
}

/**
 * The leading query verb (uppercased), after comments and the PREFIX/BASE
 * prologue are removed — or null when none is recognisable.
 */
export function firstKeyword(query: string): string | null {
  const body = stripPrologue(stripComments(query)).replace(/^\s+/, '')
  const m = /^([A-Za-z]+)/.exec(body)
  return m ? m[1]!.toUpperCase() : null
}

/**
 * Does the query carry a top-level LIMIT? Detected on the tail after the last
 * `}` (where the outer solution modifiers live), so a LIMIT that belongs only to
 * an inner sub-SELECT does not count as the outer query's limit.
 */
export function hasTopLevelLimit(query: string): boolean {
  const stripped = stripComments(query)
  const lastBrace = stripped.lastIndexOf('}')
  const tail = lastBrace >= 0 ? stripped.slice(lastBrace + 1) : stripped
  return /\bLIMIT\s+\d+/i.test(tail)
}

/** Append `LIMIT <DEFAULT_LIMIT>` unless the query already has a top-level one. */
export function ensureLimit(query: string): { query: string; added: boolean } {
  if (hasTopLevelLimit(query)) return { query, added: false }
  return { query: `${query.replace(/\s+$/, '')}\nLIMIT ${DEFAULT_LIMIT}`, added: true }
}

export interface PreparedQuery {
  /** True when the query may be sent. */
  ok: boolean
  /** Friendly inline error when `ok` is false. */
  error?: string
  /** The query to send (LIMIT-appended for SELECT when needed). */
  query: string
  /** True when a LIMIT was appended. */
  limitAdded: boolean
  /** The recognised read-only verb, when `ok`. */
  keyword?: ReadOnlyKeyword
}

/**
 * Validate + normalise a raw query for the read-only panel:
 * - blank → error
 * - first verb must be SELECT or ASK → else error, nothing sent
 * - SELECT with no top-level LIMIT → append one
 */
export function prepareQuery(raw: string): PreparedQuery {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { ok: false, error: 'Enter a query to run.', query: raw, limitAdded: false }
  }

  const keyword = firstKeyword(raw)
  if (keyword === 'SELECT') {
    const { query, added } = ensureLimit(raw)
    return { ok: true, query, limitAdded: added, keyword: 'SELECT' }
  }
  if (keyword === 'ASK') {
    // ASK returns a boolean; LIMIT is meaningless, so send verbatim.
    return { ok: true, query: raw, limitAdded: false, keyword: 'ASK' }
  }

  const found = keyword ? `“${keyword}” ` : ''
  return {
    ok: false,
    error: `Only SELECT and ASK queries can run here — this panel is read-only. ${found}is not allowed.`.replace(
      '  ',
      ' ',
    ),
    query: raw,
    limitAdded: false,
  }
}
