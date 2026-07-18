/**
 * Application entry point.
 * Bootstraps Vue with Pinia, PrimeVue, and the router.
 * @see /spec/ae-rdf
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'
import Tooltip from 'primevue/tooltip'

import router, { URL_PARAMS } from './router'
import App from './App.vue'
import { useEndpointStore } from './stores'
import { endpointSlug } from './utils/configExport'
import { logger, loadConfig, getConfig, setConfigPrefixes } from './services'

import 'primeicons/primeicons.css'
import '@ae/styles'
import './style.css'

async function bootstrap() {
  // Load optional external config before stores initialize (handles 404 gracefully)
  await loadConfig()
  // Seed declared prefixes so qnames render from config (offline, no prefix.cc).
  setConfigPrefixes(getConfig()?.prefixes)

  const app = createApp(App)

  app.use(createPinia())
  app.use(router)

  // Keep ?endpoint=<slug> present on every browse URL so links are self-contained.
  // Fill-ONLY-when-missing (never overwrite): a URL-driven endpoint change (deep
  // link / back-forward) already carries its own ?endpoint and is left untouched;
  // this only backfills navigations that drop it (e.g. selecting a type). Skipped
  // for a single-endpoint deploy, where the param would be noise.
  router.beforeEach((to) => {
    if (to.query[URL_PARAMS.ENDPOINT] != null) return true
    const store = useEndpointStore()
    if (store.isSingleEndpoint || !store.current) return true
    return { ...to, query: { ...to.query, [URL_PARAMS.ENDPOINT]: endpointSlug(store.current.name) }, replace: true }
  })
  app.use(PrimeVue, {
    theme: {
      preset: Aura,
      options: {
        darkModeSelector: '.dark-mode',
        cssLayer: false,
      },
    },
  })
  app.use(ToastService)
  app.use(ConfirmationService)
  app.directive('tooltip', Tooltip)

  app.config.errorHandler = (err, instance, info) => {
    logger.error('GlobalErrorHandler', 'Uncaught error', {
      error: err,
      component: instance?.$options?.name,
      info,
    })
  }

  app.mount('#app')
}

bootstrap()
