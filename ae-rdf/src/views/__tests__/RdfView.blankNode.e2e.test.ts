/**
 * End-to-end proof that blank-node objects are fetched path-scoped and embedded
 * inline (the OCR MappedCode case), with the REAL ResourceView/PropertyTable + a
 * mocked network. A Concept links via op-mapped-code to a BLANK NODE (no queryable
 * id), so it can't go in a VALUES embed; buildBlankNodeTriplesQuery fetches its
 * triples relative to the parent and the app inlines them — not "[ anonymous node ]".
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

const CONCEPT = 'http://data.europa.eu/949/concepts/organisation-roles/RU-1'
const CONCEPT_TYPE = 'http://www.w3.org/2004/02/skos/core#Concept'
const MAPPEDCODE = 'http://publications.europa.eu/ontology/authority/MappedCode'
const OP_MAPPED = 'http://publications.europa.eu/ontology/authority/op-mapped-code'
const LEGACY = 'http://publications.europa.eu/ontology/authority/legacy-code'
const SOURCE = 'http://purl.org/dc/elements/1.1/source'
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'
const BN = 'b1' // the blank-node label, consistent across the parent + path queries

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
        b.push({ type: { type: 'uri', value: CONCEPT_TYPE }, count: { value: '1' } })
      } else if (/isBlank\(\?b\)/i.test(query)) {
        // path-scoped blank-node triples: the bnode's type + its two literals.
        b.push(
          { b: { type: 'bnode', value: BN }, p: { type: 'uri', value: RDF_TYPE }, o: { type: 'uri', value: MAPPEDCODE } },
          { b: { type: 'bnode', value: BN }, p: { type: 'uri', value: LEGACY }, o: { type: 'literal', value: 'PL' } },
          { b: { type: 'bnode', value: BN }, p: { type: 'uri', value: SOURCE }, o: { type: 'literal', value: 'EurLex' } },
        )
      } else if (query.includes(CONCEPT) && /\?o\b/i.test(query) && !/VALUES/i.test(query)) {
        // the Concept's own triples: a label + a blank-node mapped code.
        b.push(
          { p: { type: 'uri', value: RDFS_LABEL }, o: { type: 'literal', value: 'Railway Undertaking', 'xml:lang': 'en' } },
          { p: { type: 'uri', value: RDF_TYPE }, o: { type: 'uri', value: CONCEPT_TYPE } },
          { p: { type: 'uri', value: OP_MAPPED }, o: { type: 'bnode', value: BN } },
        )
      }
      return { results: { bindings: b } }
    }),
  }
})

describe('RdfView e2e: blank-node objects embed inline', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('inlines a blank-node MappedCode (its literals), not "[ anonymous node ]"', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: RdfView }] })
    router.push({ path: '/', query: { type: CONCEPT_TYPE, resource: CONCEPT } })
    await router.isReady()

    const endpoint = useEndpointStore()
    endpoint.endpoints = [{ id: 'e1', name: 'OCR', url: 'http://x/sparql' } as any]
    ;(endpoint as any).currentId = 'e1'

    const wrapper = mount(RdfView, {
      global: {
        plugins: [router, PrimeVue, ToastService, ConfirmationService],
        directives: { tooltip: Tooltip },
      },
    })
    await flushPromises()

    expect(wrapper.find('.resource-title').exists(), 'resource view shown').toBe(true)
    const text = wrapper.text()
    expect(text, 'blank-node literals inlined').toContain('PL')
    expect(text).toContain('EurLex')
    expect(text, 'bnode is embedded, not opaque').not.toContain('anonymous node')
    expect(wrapper.find('.embed').exists(), 'rendered as an embed').toBe(true)
  })
})
