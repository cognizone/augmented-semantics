import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
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

// Parse URL parameters
export function parseUrlParams(route: RouteLocationNormalized) {
  return {
    endpoint: route.query[URL_PARAMS.ENDPOINT] as string | undefined,
    scheme: route.query[URL_PARAMS.SCHEME] as string | undefined,
    concept: route.query[URL_PARAMS.CONCEPT] as string | undefined,
    lang: route.query[URL_PARAMS.LANG] as string | undefined,
    search: route.query[URL_PARAMS.SEARCH] as string | undefined,
  }
}

export default router
