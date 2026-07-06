/**
 * End-to-end proof of TypeConfig.viaLabels (contextual object labels), with the
 * REAL ResourceView/PropertyTable + a mocked network. Reproduces the OCR case:
 * a Body links out via foaf:homepage to a Document whose foaf:page is a URL, and
 * `viaLabels: { homepage: [page] }` must make the Homepage row render that URL —
 * not the Document's opaque URI tail (the "1" bug).
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

const ORG = 'http://data.europa.eu/949/body/organisation/0050'
const BODY = 'http://data.europa.eu/949/Body'
const HOMEPAGE = 'http://xmlns.com/foaf/0.1/homepage'
const PAGE = 'http://xmlns.com/foaf/0.1/page'
const DOC = 'http://data.europa.eu/949/body/organisation/document/0050/1'
const DOCTYPE = 'http://data.europa.eu/949/Document'
const URL = 'https://www.zfbh.ba/'
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'

vi.mock('../../services', async (orig) => {
  const actual = await orig<typeof import('../../services')>()
  return {
    ...actual,
    detectGraphs: vi.fn(async () => ({})),
    resolveUris: vi.fn(async (uris: string[]) => {
      const m = new Map<string, { prefix: string; localName: string }>()
      for (const u of uris) m.set(u, { prefix: 'ex', localName: u.split('/').pop() ?? u })
      return m
    }),
    executeSparql: vi.fn(async (_e: unknown, query: string) => {
      const b: Record<string, unknown>[] = []
      if (/GROUP BY \?type/i.test(query)) {
        b.push({ type: { type: 'uri', value: BODY }, count: { value: '1' } })
      } else if (/SELECT \?s \?p \?v\b/i.test(query)) {
        // buildValuesQuery — composeViaLabels fetching foaf:page for the Document.
        if (query.includes(PAGE)) b.push({ s: { type: 'uri', value: DOC }, p: { type: 'uri', value: PAGE }, v: { type: 'uri', value: URL } })
      } else if (/SELECT \?s \?t\b/i.test(query)) {
        b.push({ s: { type: 'uri', value: DOC }, t: { type: 'uri', value: DOCTYPE } })
      } else if (/SELECT \?s \?p \?l\b/i.test(query)) {
        // the Document has no standard label — so viaLabels is the ONLY label source.
      } else if (query.includes(ORG) && /\?o\b/i.test(query) && !/VALUES/i.test(query)) {
        // the org's own triples: type Body + a homepage Document (+ a name for the heading).
        b.push(
          { p: { type: 'uri', value: RDFS_LABEL }, o: { type: 'literal', value: 'Org 0050', 'xml:lang': 'en' } },
          { p: { type: 'uri', value: RDF_TYPE }, o: { type: 'uri', value: BODY } },
          { p: { type: 'uri', value: HOMEPAGE }, o: { type: 'uri', value: DOC } },
        )
      }
      return { results: { bindings: b } }
    }),
  }
})

describe('RdfView e2e: viaLabels renders a contextual object label', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('shows the Document\'s foaf:page URL on the Body\'s Homepage relation', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: RdfView }] })
    router.push({ path: '/', query: { type: BODY, resource: ORG } })
    await router.isReady()

    const endpoint = useEndpointStore()
    // The endpoint carries the per-type config the typeConfig store reads.
    endpoint.endpoints = [{ id: 'e1', name: 'OCR', url: 'http://x/sparql', types: { [BODY]: { viaLabels: { [HOMEPAGE]: [PAGE] } } } } as any]
    ;(endpoint as any).currentId = 'e1'

    const wrapper = mount(RdfView, {
      global: {
        plugins: [router, PrimeVue, ToastService, ConfirmationService],
        directives: { tooltip: Tooltip },
      },
    })
    await flushPromises()

    expect(wrapper.find('.resource-title').exists(), 'resource view shown').toBe(true)
    // The homepage link must read as the URL (viaLabels), not the doc URI tail "1".
    const link = wrapper.findAll('a.uri-link').find(a => a.text() === URL)
    expect(link, 'homepage link renders foaf:page URL').toBeTruthy()
    expect(wrapper.text()).not.toContain('body/organisation/document') // not the raw doc URI
  })
})
