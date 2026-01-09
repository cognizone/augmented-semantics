import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'
import Tooltip from 'primevue/tooltip'

import router from './router'
import App from './App.vue'
import { logger } from './services'

import 'primeicons/primeicons.css'
import '@ae/styles'
import './style.css'

const app = createApp(App)

// Pinia
const pinia = createPinia()
app.use(pinia)

// Vue Router
app.use(router)

// PrimeVue
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

// Directives
app.directive('tooltip', Tooltip)

// Global error handler for uncaught errors
app.config.errorHandler = (err, instance, info) => {
  logger.error('GlobalErrorHandler', 'Uncaught error', {
    error: err,
    component: instance?.$options?.name,
    info,
  })
}

app.mount('#app')
