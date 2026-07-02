/**
 * groupByType: a predicate listed in `groupByType` renders its object list
 * partitioned by the object's type — one subheading + count per type — instead
 * of a flat list (for long, mixed-type relations like Project → hasResult).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import PropertyTable from '../PropertyTable.vue'
import type { PropertyGroup } from '../../../composables'

const REL = 'http://ex/hasResult'
const link = (v: string) => ({ termType: 'uri' as const, value: v, graphs: [] })

describe('PropertyTable groupByType', () => {
  beforeEach(() => setActivePinia(createPinia()))

  const groups: PropertyGroup[] = [{ predicate: REL, objects: [link('http://ex/a'), link('http://ex/b'), link('http://ex/c')] }]
  const objectTypes = new Map([
    ['http://ex/a', 'http://ex/Paper'],
    ['http://ex/b', 'http://ex/Paper'],
    ['http://ex/c', 'http://ex/Dataset'],
  ])

  it('groups objects under per-type subheadings with counts', () => {
    const wrapper = mount(PropertyTable, {
      props: { groups, resolved: new Map(), objectTypes, groupByType: [REL] },
      global: { plugins: [PrimeVue], directives: { tooltip: Tooltip } },
    })
    const headings = wrapper.findAll('.type-subheading')
    expect(headings).toHaveLength(2) // Paper, Dataset
    const text = headings.map(h => h.text())
    expect(text.some(t => t.includes('Paper') && t.includes('2'))).toBe(true)
    expect(text.some(t => t.includes('Dataset') && t.includes('1'))).toBe(true)
    expect(wrapper.findAll('.uri-link')).toHaveLength(3) // all three still rendered
    // The heading conveys the type, so per-row type badges are suppressed.
    expect(wrapper.findAll('.type-badge')).toHaveLength(0)
  })

  it('renders a flat list (no subheadings, per-row type badges) when not grouped', () => {
    const wrapper = mount(PropertyTable, {
      props: { groups, resolved: new Map(), objectTypes },
      global: { plugins: [PrimeVue], directives: { tooltip: Tooltip } },
    })
    expect(wrapper.findAll('.type-subheading')).toHaveLength(0)
    expect(wrapper.findAll('.uri-link')).toHaveLength(3)
    expect(wrapper.findAll('.type-badge')).toHaveLength(3) // each row badged
  })
})
