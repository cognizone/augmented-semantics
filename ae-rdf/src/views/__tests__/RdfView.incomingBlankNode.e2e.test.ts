/**
 * End-to-end proof that BLANK-NODE referrers in "Referenced by" are inlined with
 * their own triples (the cordis owl:Restriction case), with the REAL ResourceView/
 * PropertyTable + a mocked network. A property is referenced by an anonymous
 * restriction (`?b owl:onProperty <prop>`); instead of a bare useless "b10081",
 * buildIncomingBlankNodeQuery fetches the restriction's triples in one query and
 * the app inlines them (rdf:type badge + onProperty/someValuesFrom body).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'
import Tooltip from 'primevue/tooltip'
import RdfView from '../RdfView.vue'
import { useEndpointStore } from '../../stores'

const PROP = 'http://data.europa.eu/s66#publisher'
const PROP_TYPE = 'http://www.w3.org/2002/07/owl#DatatypeProperty'
const RESTRICTION = 'http://www.w3.org/2002/07/owl#Restriction'
const ON_PROPERTY = 'http://www.w3.org/2002/07/owl#onProperty'
const SOME_VALUES = 'http://www.w3.org/2002/07/owl#someValuesFrom'
const SOMECLASS = 'http://data.europa.eu/s66#Publication'
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'
const BN = 'b10081' // the anonymous restriction

vi.mock('../../services', async (orig) => {
  const actual = await orig<typeof import('../../services')>()
  return {
    ...actual,
    detectGraphs: vi.fn(async () => ({})),
    resolveUris: vi.fn(async (uris: string[]) => {
      const m = new Map<string, { prefix: string; localName: string }>()
      for (const u of uris) m.set(u, { prefix: 'ex', localName: u.split(/[#/]/).pop() ?? u })
      return m
    }),
    executeSparql: vi.fn(async (_e: unknown, query: string) => {
      const b: Record<string, unknown>[] = []
      if (/GROUP BY \?type/i.test(query)) {
        b.push({ type: { type: 'uri', value: PROP_TYPE }, count: { value: '1' } })
      } else if (/COUNT\(DISTINCT \?s\)/i.test(query)) {
        b.push({ n: { value: '1' } }) // one referrer — the restriction
      } else if (/isBlank\(\?b\)/i.test(query) && /\?xp/.test(query)) {
        // incoming blank referrer + its own triples, one query (self-consistent bn).
        b.push(
          { xp: { type: 'uri', value: ON_PROPERTY }, b: { type: 'bnode', value: BN }, p: { type: 'uri', value: RDF_TYPE }, o: { type: 'uri', value: RESTRICTION } },
          { xp: { type: 'uri', value: ON_PROPERTY }, b: { type: 'bnode', value: BN }, p: { type: 'uri', value: ON_PROPERTY }, o: { type: 'uri', value: PROP } },
          { xp: { type: 'uri', value: ON_PROPERTY }, b: { type: 'bnode', value: BN }, p: { type: 'uri', value: SOME_VALUES }, o: { type: 'uri', value: SOMECLASS } },
        )
      } else if (/FILTER\(!isBlank\(\?s\)\)/i.test(query)) {
        // URI referrers list — none in this scenario.
      } else if (query.includes(PROP) && /\?o\b/i.test(query) && !/VALUES/i.test(query)) {
        // the property's own triples: a label + its type.
        b.push(
          { p: { type: 'uri', value: RDFS_LABEL }, o: { type: 'literal', value: 'publisher', 'xml:lang': 'en' } },
          { p: { type: 'uri', value: RDF_TYPE }, o: { type: 'uri', value: PROP_TYPE } },
        )
      }
      return { results: { bindings: b } }
    }),
  }
})

describe('RdfView e2e: blank-node referrers inline in "Referenced by"', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('inlines an anonymous restriction (type badge + onProperty/someValuesFrom), not a bare bnode id', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: RdfView }] })
    router.push({ path: '/', query: { type: PROP_TYPE, resource: PROP } })
    await router.isReady()

    const endpoint = useEndpointStore()
    endpoint.endpoints = [{ id: 'e1', name: 'cordis', url: 'http://x/sparql' } as any]
    ;(endpoint as any).currentId = 'e1'

    const wrapper = mount(RdfView, {
      global: {
        plugins: [router, PrimeVue, ToastService, ConfirmationService],
        directives: { tooltip: Tooltip },
      },
    })
    await flushPromises()

    // Expand "Referenced by" — incoming is lazily loaded on toggle.
    await wrapper.find('.incoming-toggle').trigger('click')
    await flushPromises()

    const body = wrapper.find('.incoming-body')
    expect(body.exists(), 'incoming body shown').toBe(true)
    const text = body.text()
    expect(text, 'restriction inlined (someValuesFrom)').toContain('values from')
    expect(text, 'inlined object class shown').toContain('Publication')
    expect(text, 'type badge shown').toContain('Restriction')
    expect(text, 'not a bare bnode id').not.toContain(BN)
    expect(text, 'not opaque').not.toContain('anonymous node')
    expect(body.find('.embed').exists(), 'rendered as an embed').toBe(true)
  })
})
