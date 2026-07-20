/**
 * Router - Vue Router configuration with URL state support
 *
 * Deep linking via URL parameters (com04):
 * - endpoint: SPARQL endpoint URL
 * - type: Selected rdf:type URI
 * - resource: Selected resource URI
 *
 * @see /spec/common/com04-URLRouting.md
 * ponytail: single-route pattern lifted from ae-skos.
 */
import { createRouter, createWebHistory } from 'vue-router'
import RdfView from '../views/RdfView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'rdf',
      component: RdfView,
    },
    {
      // Raw SPARQL panel — read-only SELECT/ASK against the current endpoint.
      path: '/sparql',
      name: 'sparql',
      component: () => import('../views/SparqlView.vue'),
    },
  ],
})

// After a redeploy, a page still running the previous build may navigate to a
// lazy route whose chunk hash no longer exists — the dynamic import rejects and the
// navigation silently fails (e.g. Open-in-SPARQL / the header SPARQL button appear
// dead). Reload to the intended URL so the fresh bundle loads. One-shot per session
// (cleared on the next successful navigation) so a genuine load failure can't loop.
const CHUNK_RELOAD_KEY = 'ae-rdf-chunk-reload'
router.onError((err, to) => {
  const msg = String((err as Error)?.message || '')
  const staleChunk = /dynamically imported module|module script failed|Failed to fetch dynamically/i.test(msg)
  if (!staleChunk || sessionStorage.getItem(CHUNK_RELOAD_KEY)) return
  sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
  window.location.assign(to.fullPath)
})
router.afterEach(() => sessionStorage.removeItem(CHUNK_RELOAD_KEY))

// URL parameter keys per com04-URLRouting
export const URL_PARAMS = {
  ENDPOINT: 'endpoint',
  TYPE: 'type',
  RESOURCE: 'resource',
  FILTERS: 'filters',
} as const

export default router
