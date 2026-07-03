/**
 * Regression: a navigable, non-dangling URI must render its label EXACTLY ONCE.
 * A mid-chain `v-if` (the dangling marker) had detached the uri-static
 * `v-else-if`, so every normal URI rendered as both a link (blue) AND a static
 * span (black) — the "weird duplications" bug.
 */
import { describe, it, expect } from 'vitest'
import { link, mountPropertyTable } from '../../../test-utils/propertyTable'
import type { PropertyGroup } from '../../../composables'

const REL = 'http://ex/rel'
const OBJ = 'http://ex/thing'

describe('PropertyTable value duplication', () => {
  it('renders a navigable URI label once — link only, no static twin', () => {
    const groups: PropertyGroup[] = [{ predicate: REL, objects: [link(OBJ)] }]
    const wrapper = mountPropertyTable({
      groups,
      resolved: new Map(),
      labels: new Map([[OBJ, 'Research and Innovation action']]), // has a label ⇒ not dangling
    })

    expect(wrapper.findAll('.uri-link')).toHaveLength(1)
    expect(wrapper.findAll('.uri-static')).toHaveLength(0)
    // The label text must appear exactly once in the value cell.
    const hits = wrapper.findAll('.prop-value').filter(v => v.text().includes('Research and Innovation action'))
    expect(hits).toHaveLength(1)
  })

  it('dangling URI still gets its warning marker (and no duplicate)', () => {
    const groups: PropertyGroup[] = [{ predicate: REL, objects: [link(OBJ)] }]
    // no labels / objectTypes / embedded ⇒ dangling
    const wrapper = mountPropertyTable({ groups, resolved: new Map() })

    expect(wrapper.findAll('.uri-link')).toHaveLength(1)
    expect(wrapper.findAll('.uri-static')).toHaveLength(0)
    expect(wrapper.findAll('.dangling-icon')).toHaveLength(1)
  })
})
