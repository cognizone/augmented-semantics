/**
 * End-to-end proof of deprecation badging (AE SKOS parity), with the REAL
 * ResourceView/PropertyTable + a mocked network: the viewed resource asserts
 * owl:deprecated "true" (header badge, from its own triples) and links to another
 * resource that is also deprecated (link badge, from the batched resolveDeprecated
 * query). Both must render a .deprecated-badge.
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

const DEP = 'http://ex/thing/1'
const OTHER = 'http://ex/thing/2'
const TYPE = 'http://ex/Thing'
const REL = 'http://ex/related'
const OWL_DEP = 'http://www.w3.org/2002/07/owl#deprecated'
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
        b.push({ type: { type: 'uri', value: TYPE }, count: { value: '1' } })
      } else if (/str\(\?d\)/i.test(query)) {
        // resolveDeprecated over the object IRIs → OTHER is deprecated.
        b.push({ s: { type: 'uri', value: OTHER } })
      } else if (/SELECT \?s \?t\b/i.test(query)) {
        b.push({ s: { type: 'uri', value: OTHER }, t: { type: 'uri', value: TYPE } })
      } else if (/SELECT \?s \?p \?l\b/i.test(query)) {
        b.push({ s: { type: 'uri', value: OTHER }, p: { type: 'uri', value: RDFS_LABEL }, l: { type: 'literal', value: 'Other', 'xml:lang': 'en' } })
      } else if (query.includes(DEP) && /\?o\b/i.test(query) && !/VALUES/i.test(query)) {
        b.push(
          { p: { type: 'uri', value: RDFS_LABEL }, o: { type: 'literal', value: 'Thing One', 'xml:lang': 'en' } },
          { p: { type: 'uri', value: RDF_TYPE }, o: { type: 'uri', value: TYPE } },
          { p: { type: 'uri', value: OWL_DEP }, o: { type: 'literal', value: 'true' } }, // self deprecated
          { p: { type: 'uri', value: REL }, o: { type: 'uri', value: OTHER } },
        )
      }
      return { results: { bindings: b } }
    }),
  }
})

describe('RdfView e2e: deprecation badges', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('badges the deprecated resource (header) and a deprecated linked object', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: RdfView }] })
    router.push({ path: '/', query: { type: TYPE, resource: DEP } })
    await router.isReady()

    const endpoint = useEndpointStore()
    endpoint.endpoints = [{ id: 'e1', name: 'X', url: 'http://x/sparql' } as any]
    ;(endpoint as any).currentId = 'e1'

    const wrapper = mount(RdfView, {
      global: { plugins: [router, PrimeVue, ToastService, ConfirmationService], directives: { tooltip: Tooltip } },
    })
    await flushPromises()

    expect(wrapper.find('.resource-title').exists()).toBe(true)
    // One badge in the header (self) + one on the deprecated link.
    expect(wrapper.findAll('.deprecated-badge').length).toBeGreaterThanOrEqual(2)
  })
})
