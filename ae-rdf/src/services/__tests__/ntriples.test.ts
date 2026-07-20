import { describe, it, expect } from 'vitest'
import { parseNTriples } from '../sparql'

describe('parseNTriples', () => {
  it('parses IRIs, bnodes, lang + datatype literals, and skips comments/blanks', () => {
    const nt = [
      '# a comment',
      '',
      '<http://s/1> <http://p/name> "Alice"@en .',
      '<http://s/1> <http://p/age> "42"^^<http://www.w3.org/2001/XMLSchema#integer> .',
      '_:b0 <http://p/ref> <http://s/1> .',
      // escaped quote AND an interior period — both must survive the trailing " ." terminator
      '<http://s/1> <http://p/note> "he said \\"hi\\". end" .',
    ].join('\n')

    const rows = parseNTriples(nt)
    expect(rows).toHaveLength(4)

    expect(rows[0]!.subject).toEqual({ type: 'uri', value: 'http://s/1' })
    expect(rows[0]!.predicate).toEqual({ type: 'uri', value: 'http://p/name' })
    expect(rows[0]!.object).toEqual({ type: 'literal', value: 'Alice', 'xml:lang': 'en' })

    expect(rows[1]!.object.datatype).toContain('integer')
    expect(rows[2]!.subject).toEqual({ type: 'bnode', value: '_:b0' })
    expect(rows[3]!.object.value).toBe('he said "hi". end')
  })

  it('returns [] for an empty graph', () => {
    expect(parseNTriples('\n# nothing\n')).toEqual([])
  })
})
