/**
 * End-to-end reproduction with REAL TypeList / InstanceList / ResourceView and
 * a mocked network: click type → instances, click instance → resource, click
 * type again → instances must come back.
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

const TYPE = 'http://t/X'
const INSTANCE = 'http://r/Y'

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
      const bindings: Record<string, unknown>[] = []
      if (/GROUP BY \?type/i.test(query)) {
        bindings.push({ type: { type: 'uri', value: TYPE }, count: { value: '5' } })
      } else if (/AS \?total/i.test(query)) {
        bindings.push({ total: { value: '5' } })
      } else if (/SELECT \?s \?p \?l\b/i.test(query)) {
        // resolveLabels label-values query (?s ?p ?l): the instance's rdfs:label
        bindings.push({ s: { type: 'uri', value: INSTANCE }, p: { type: 'uri', value: 'http://www.w3.org/2000/01/rdf-schema#label' }, l: { type: 'literal', value: 'Instance Y', 'xml:lang': 'en' } })
      } else if (/SELECT \?s \?t\b/i.test(query)) {
        // resolveLabels most-specific-type query (?s ?t)
        bindings.push({ s: { type: 'uri', value: INSTANCE }, t: { type: 'uri', value: TYPE } })
      } else if (new RegExp(INSTANCE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(query) && /\?o\b/i.test(query)) {
        // resource triples for the opened instance — a label, a type, a uri link
        bindings.push(
          { p: { type: 'uri', value: 'http://www.w3.org/2000/01/rdf-schema#label' }, o: { type: 'literal', value: 'Instance Y', 'xml:lang': 'en' } },
          { p: { type: 'uri', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' }, o: { type: 'uri', value: TYPE } },
          { p: { type: 'uri', value: 'http://ex/related' }, o: { type: 'uri', value: 'http://r/Z' }, g: { type: 'uri', value: 'http://g/1' } },
        )
      } else if (/DISTINCT \?s\b/i.test(query) || /\?s\b[\s\S]*LIMIT/i.test(query)) {
        // instance list — ?s only; labels are resolved separately (above)
        bindings.push({ s: { type: 'uri', value: INSTANCE } })
      }
      return { results: { bindings } }
    }),
  }
})

describe('RdfView e2e: type → resource → type', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('re-shows instances after viewing a resource', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: RdfView }] })
    router.push('/')
    await router.isReady()

    const endpoint = useEndpointStore()
    endpoint.endpoints = [{ id: 'e1', name: 'Test', url: 'http://x/sparql' } as any]
    ;(endpoint as any).currentId = 'e1'

    const wrapper = mount(RdfView, {
      global: {
        plugins: [router, PrimeVue, ToastService, ConfirmationService],
        directives: { tooltip: Tooltip },
      },
    })
    await flushPromises()

    // 1. Click the type in the sidebar.
    const typeBtn = () => wrapper.findAll('button.type-item').find(b => b.attributes('title') === TYPE)
    expect(typeBtn(), 'type button present').toBeTruthy()
    await typeBtn()!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.instance-list').exists(), 'instances after first type click').toBe(true)
    expect(wrapper.text()).toContain('Instance Y')

    // 2. Click the instance → resource view.
    await wrapper.find('button.il-item').trigger('click')
    await flushPromises()
    expect(wrapper.find('.instance-list').exists()).toBe(false)

    // 3. Click the type again → instances must come back.
    expect(typeBtn(), 'type button still present').toBeTruthy()
    await typeBtn()!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.instance-list').exists(), 'instances after SECOND type click').toBe(true)
    expect(wrapper.text()).toContain('Instance Y')
  })

  // Regression: a URL carrying BOTH ?type and ?resource (what clicking an instance
  // produces, and what a shared link / refresh replays) must render the RESOURCE,
  // not the list. The type watcher used to clobber the resource on such a load.
  it('renders the resource when the URL has both ?type and ?resource', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: RdfView }] })
    router.push({ path: '/', query: { type: TYPE, resource: INSTANCE } })
    await router.isReady()

    const endpoint = useEndpointStore()
    endpoint.endpoints = [{ id: 'e1', name: 'Test', url: 'http://x/sparql' } as any]
    ;(endpoint as any).currentId = 'e1'

    const wrapper = mount(RdfView, {
      global: {
        plugins: [router, PrimeVue, ToastService, ConfirmationService],
        directives: { tooltip: Tooltip },
      },
    })
    await flushPromises()

    expect(wrapper.find('.instance-list').exists(), 'list must NOT show when ?resource is present').toBe(false)
    expect(wrapper.find('.resource-title').exists(), 'resource view is shown').toBe(true)
    expect(wrapper.find('.resource-title').text()).toContain('Instance Y')
  })
})
