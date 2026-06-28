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

import router from './router'
import App from './App.vue'
import { logger, loadConfig } from './services'

import 'primeicons/primeicons.css'
import '@ae/styles'
import './style.css'

async function bootstrap() {
  // Load optional external config before stores initialize (handles 404 gracefully)
  await loadConfig()

  const app = createApp(App)

  app.use(createPinia())
  app.use(router)
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
