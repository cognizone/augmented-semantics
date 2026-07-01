/**
 * Regression: embedVia must gate PER EDGE at render, not just at fetch. An
 * object of a type that pins an owning predicate embeds under that predicate but
 * renders as a link under any other (e.g. an inverse back-reference) — even
 * though the object is present in the embed map (fetched via its owner).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import PropertyTable from '../PropertyTable.vue'
import { useEndpointStore, useTypeConfigStore } from '../../../stores'
import type { PropertyGroup } from '../../../composables'

const GRANT = 'http://ex/grant-1'
const TYPE = 'http://ex/Grant'
const OWNS = 'http://ex/isFundedBy' // Grant's owning predicate
const INVERSE = 'http://ex/isBeneficiaryOf' // an inverse back-reference
const LEAF = 'http://ex/duration'

const link = (v: string) => ({ termType: 'uri' as const, value: v, graphs: [] })
const lit = (v: string) => ({ termType: 'literal' as const, value: v, graphs: [] })

describe('PropertyTable embedVia per-edge gating', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const ep = useEndpointStore()
    const created = ep.addEndpoint({ name: 't', url: 'https://e/sparql' })!
    ep.selectEndpoint(created.id)
    useTypeConfigStore().set(TYPE, { render: 'embed', embedVia: OWNS })
  })

  it('embeds under the owning predicate, links under a non-owning one', () => {
    const embedded = new Map<string, PropertyGroup[]>([
      [GRANT, [{ predicate: LEAF, objects: [lit('63')] }]],
    ])
    // Same object reached two ways: its owner (OWNS) and an inverse (INVERSE).
    const groups: PropertyGroup[] = [
      { predicate: OWNS, objects: [link(GRANT)] },
      { predicate: INVERSE, objects: [link(GRANT)] },
    ]
    const wrapper = mount(PropertyTable, {
      props: { groups, resolved: new Map(), embedded, objectTypes: new Map([[GRANT, TYPE]]), ancestors: [] },
      global: { plugins: [PrimeVue], directives: { tooltip: Tooltip } },
    })

    // Embedded exactly once (under OWNS), and rendered as a link at least once (under INVERSE).
    expect(wrapper.findAll('.embed-table').length).toBe(1)
    expect(wrapper.findAll('.uri-link').length).toBeGreaterThan(0)
  })
})
