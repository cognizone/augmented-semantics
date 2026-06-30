/**
 * Regression: an embed cycle (A inlines B, B inlines A) must not recurse
 * forever. The cycling object renders as a link instead of overflowing the
 * stack. Reproduces the JournalPaper "Maximum call stack size exceeded" crash.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import PropertyTable from '../PropertyTable.vue'
import type { PropertyGroup } from '../../../composables'

const A = 'http://ex/A'
const B = 'http://ex/B'
const REL = 'http://ex/rel'

const link = (v: string) => ({ termType: 'uri' as const, value: v, graphs: [] })

describe('PropertyTable embed cycles', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('does not overflow the stack when embeds form a cycle', () => {
    // A → rel → B (embedded), B → rel → A (embedded): a 2-node cycle.
    const embedded = new Map<string, PropertyGroup[]>([
      [A, [{ predicate: REL, objects: [link(B)] }]],
      [B, [{ predicate: REL, objects: [link(A)] }]],
    ])
    const groups: PropertyGroup[] = [{ predicate: REL, objects: [link(A)] }]

    // No throw === no infinite recursion.
    const wrapper = mount(PropertyTable, {
      props: { groups, resolved: new Map(), embedded, ancestors: [] },
      global: { plugins: [PrimeVue], directives: { tooltip: Tooltip } },
    })
    // A and B both inline once; the cycle back to A falls through to a link.
    expect(wrapper.findAll('.uri-link').length).toBeGreaterThan(0)
  })
})
