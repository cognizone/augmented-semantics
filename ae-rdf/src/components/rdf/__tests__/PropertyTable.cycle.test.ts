/**
 * Regression: an embed cycle (A inlines B, B inlines A) must not recurse
 * forever. The cycling object renders as a link instead of overflowing the
 * stack. Reproduces the JournalPaper "Maximum call stack size exceeded" crash.
 */
import { describe, it, expect } from 'vitest'
import { link, mountPropertyTable } from '../../../test-utils/propertyTable'
import type { PropertyGroup } from '../../../composables'

const A = 'http://ex/A'
const B = 'http://ex/B'
const REL = 'http://ex/rel'

describe('PropertyTable embed cycles', () => {
  it('does not overflow the stack when embeds form a cycle', () => {
    // A → rel → B (embedded), B → rel → A (embedded): a 2-node cycle.
    const embedded = new Map<string, PropertyGroup[]>([
      [A, [{ predicate: REL, objects: [link(B)] }]],
      [B, [{ predicate: REL, objects: [link(A)] }]],
    ])
    const groups: PropertyGroup[] = [{ predicate: REL, objects: [link(A)] }]

    // No throw === no infinite recursion.
    const wrapper = mountPropertyTable({ groups, resolved: new Map(), embedded, ancestors: [] })
    // A and B each inline exactly once (2 embed tables); the cycle back to A
    // falls through to a single link instead of inlining a third time.
    expect(wrapper.findAll('.embed-table')).toHaveLength(2)
    expect(wrapper.findAll('.uri-link')).toHaveLength(1)
  })
})
