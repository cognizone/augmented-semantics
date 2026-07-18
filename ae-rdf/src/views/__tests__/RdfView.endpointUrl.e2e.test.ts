/**
 * Endpoint <-> URL (?endpoint=<slug>) integration:
 *  - a ?endpoint param selects that endpoint (read direction)
 *  - switching endpoint stamps ?endpoint and drops ?type/?resource (write direction)
 * The fill-missing backfill lives in main.ts (router guard) and is not exercised here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'
import Tooltip from 'primevue/tooltip'
import RdfView from '../RdfView.vue'
import { useEndpointStore } from '../../stores'

vi.mock('../../services', async (orig) => {
  const actual = await orig<typeof import('../../services')>()
  return {
    ...actual,
    detectGraphs: vi.fn(async () => ({})),
    resolveUris: vi.fn(async () => new Map()),
    executeSparql: vi.fn(async () => ({ results: { bindings: [] } })),
  }
})

// name "Alpha" → slug "alpha", "Beta Data" → "beta-data"
const ALPHA = { id: 'A', name: 'Alpha', url: 'http://a/sparql' } as any
const BETA = { id: 'B', name: 'Beta Data', url: 'http://b/sparql' } as any

function makeRouter() {
  return createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: RdfView }] })
}

function mountAt(router: ReturnType<typeof makeRouter>) {
  return mount(RdfView, {
    global: { plugins: [router, PrimeVue, ToastService, ConfirmationService], directives: { tooltip: Tooltip } },
  })
}

describe('RdfView: endpoint <-> URL', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('?endpoint=<slug> selects the matching endpoint on load', async () => {
    const store = useEndpointStore()
    store.endpoints = [ALPHA, BETA]
    ;(store as any).currentId = 'A'

    const router = makeRouter()
    router.push('/?endpoint=beta-data')
    await router.isReady()
    mountAt(router)
    await vi.waitFor(() => expect(store.currentId).toBe('B'))
    // URL is NOT rewritten for a URL-driven selection (it already carries it).
    expect(router.currentRoute.value.query.endpoint).toBe('beta-data')
  })

  it('ignores an unknown ?endpoint slug (no deselect)', async () => {
    const store = useEndpointStore()
    store.endpoints = [ALPHA, BETA]
    ;(store as any).currentId = 'A'

    const router = makeRouter()
    router.push('/?endpoint=does-not-exist')
    await router.isReady()
    mountAt(router)
    await new Promise(r => setTimeout(r, 0))
    expect(store.currentId).toBe('A')
  })

  it('switching endpoint stamps ?endpoint and drops ?type/?resource', async () => {
    const store = useEndpointStore()
    store.endpoints = [ALPHA, BETA]
    ;(store as any).currentId = 'A'

    const router = makeRouter()
    router.push('/?type=http://t/X&resource=http://r/Y')
    await router.isReady()
    mountAt(router)

    store.selectEndpoint('B')
    await vi.waitFor(() => expect(router.currentRoute.value.query.endpoint).toBe('beta-data'))
    const q = router.currentRoute.value.query
    expect(q.type).toBeUndefined()
    expect(q.resource).toBeUndefined()
  })
})
