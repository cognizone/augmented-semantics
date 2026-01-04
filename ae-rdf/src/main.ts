import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'

import App from './App.vue'

import 'primeicons/primeicons.css'
import '@ae/styles'
import './style.css'

const app = createApp(App)

// Pinia
const pinia = createPinia()
app.use(pinia)

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

app.mount('#app')
