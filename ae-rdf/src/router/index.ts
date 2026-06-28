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
  ],
})

// URL parameter keys per com04-URLRouting
export const URL_PARAMS = {
  ENDPOINT: 'endpoint',
  TYPE: 'type',
  RESOURCE: 'resource',
} as const

export default router
