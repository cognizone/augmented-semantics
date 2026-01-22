/**
 * Router - Vue Router configuration with URL state support
 *
 * Supports deep linking via URL parameters:
 * - endpoint: SPARQL endpoint URL
 * - scheme: Selected concept scheme URI
 * - concept: Selected concept URI
 * - lang: Preferred language code
 * - q: Search query
 *
 * @see /spec/common/com04-URLRouting.md
 */
import { createRouter, createWebHistory } from 'vue-router'
import SkosView from '../views/SkosView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'skos',
      component: SkosView,
    },
  ],
})

// URL parameter keys per com04-URLRouting
export const URL_PARAMS = {
  ENDPOINT: 'endpoint',
  SCHEME: 'scheme',
  CONCEPT: 'concept',
  LANG: 'lang',
  SEARCH: 'q',
} as const

export default router
