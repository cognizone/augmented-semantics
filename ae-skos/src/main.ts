import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'
import Tooltip from 'primevue/tooltip'

import router from './router'
import App from './App.vue'
import { logger, loadConfig, diagnoseEndpoint, executeSparql, withPrefixes } from './services'
import { useEndpointStore } from './stores'

import 'primeicons/primeicons.css'
import '@ae/styles'
import './style.css'

/**
 * Bootstrap the application
 * Loads external config before creating Vue app to ensure
 * stores have access to config during initialization.
 */
async function bootstrap() {
  // Step 1: Load external config (handles 404 gracefully)
  await loadConfig()

  // Step 2: Create Vue app
  const app = createApp(App)

  // Step 3: Setup Pinia (stores will check config during initialization)
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
}

bootstrap()

// Dev mode diagnostics
if (import.meta.env.DEV) {
  (window as any).__diagnoseEndpoint = async () => {
    const endpointStore = useEndpointStore()
    const endpoint = endpointStore.current
    if (!endpoint) {
      console.error('❌ No endpoint selected')
      return
    }
    return await diagnoseEndpoint(endpoint)
  }

  (window as any).__checkOrphanStatus = async (conceptUri: string) => {
    const endpointStore = useEndpointStore()
    const endpoint = endpointStore.current
    if (!endpoint) {
      console.error('❌ No endpoint selected')
      return
    }

    console.log('🔍 Checking orphan status for:', conceptUri)

    // Check each exclusion condition
    const checks = {
      inScheme: `SELECT * WHERE { <${conceptUri}> skos:inScheme ?scheme }`,
      topConceptOf: `SELECT * WHERE { <${conceptUri}> skos:topConceptOf ?scheme }`,
      hasTopConcept: `SELECT * WHERE { ?scheme skos:hasTopConcept <${conceptUri}> }`,
      broader: `SELECT * WHERE { <${conceptUri}> skos:broader ?parent }`,
      narrower: `SELECT * WHERE { ?parent skos:narrower <${conceptUri}> }`,
      broaderTransitive: `SELECT * WHERE { <${conceptUri}> skos:broaderTransitive ?ancestor }`,
      narrowerTransitive: `SELECT * WHERE { ?ancestor skos:narrowerTransitive <${conceptUri}> }`,
      broaderPath: `SELECT * WHERE { <${conceptUri}> skos:broader+ ?ancestor }`,
      narrowerPath: `SELECT * WHERE { ?ancestor skos:narrower+ <${conceptUri}> }`,
    }

    for (const [name, query] of Object.entries(checks)) {
      try {
        const results = await executeSparql(endpoint, withPrefixes(query))
        const hasResults = results.results.bindings.length > 0
        console.log(`  ${name}:`, hasResults ? '✓ HAS' : '✗ NONE',
          hasResults ? results.results.bindings : '')
      } catch (e) {
        console.error(`  ${name}: ERROR`, e)
      }
    }
  }

  (window as any).__checkRelationships = async () => {
    const endpointStore = useEndpointStore()
    const endpoint = endpointStore.current
    if (!endpoint) {
      console.error('❌ No endpoint selected')
      return
    }

    console.log('🔍 Checking SKOS relationships in endpoint:', endpoint.url)

    // First check if there are any SKOS concepts
    const conceptCountQuery = withPrefixes(`
      SELECT (COUNT(DISTINCT ?c) AS ?count)
      WHERE {
        ?c a skos:Concept .
      }
    `)

    try {
      const countResult = await executeSparql(endpoint, conceptCountQuery)
      const count = parseInt(countResult.results.bindings[0]?.count?.value || '0', 10)
      console.log(`📊 Total SKOS concepts: ${count.toLocaleString()}`)

      if (count === 0) {
        console.log('⚠️ No SKOS concepts found!')
        return
      }
    } catch (e) {
      console.error('❌ Failed to count concepts:', e)
      return
    }

    // Check the relationship detection query (same as analysis)
    const relQuery = withPrefixes(`
      SELECT
        (EXISTS { ?c skos:inScheme ?x } AS ?hasInScheme)
        (EXISTS { ?c skos:topConceptOf ?x } AS ?hasTopConceptOf)
        (EXISTS { ?s skos:hasTopConcept ?x } AS ?hasHasTopConcept)
        (EXISTS { ?c skos:broader ?x } AS ?hasBroader)
        (EXISTS { ?c skos:narrower ?x } AS ?hasNarrower)
        (EXISTS { ?c skos:broaderTransitive ?x } AS ?hasBroaderTransitive)
        (EXISTS { ?c skos:narrowerTransitive ?x } AS ?hasNarrowerTransitive)
      WHERE {
        ?c a skos:Concept .
      }
      LIMIT 1
    `)

    try {
      const relResult = await executeSparql(endpoint, relQuery)
      const binding = relResult.results.bindings[0]

      console.log('📋 Relationship detection results:')
      if (!binding) {
        console.log('⚠️ No bindings returned (might be an issue with the query)')
        return
      }

      const relationships = {
        hasInScheme: binding.hasInScheme?.value === 'true',
        hasTopConceptOf: binding.hasTopConceptOf?.value === 'true',
        hasHasTopConcept: binding.hasHasTopConcept?.value === 'true',
        hasBroader: binding.hasBroader?.value === 'true',
        hasNarrower: binding.hasNarrower?.value === 'true',
        hasBroaderTransitive: binding.hasBroaderTransitive?.value === 'true',
        hasNarrowerTransitive: binding.hasNarrowerTransitive?.value === 'true',
      }

      for (const [key, value] of Object.entries(relationships)) {
        console.log(`  ${key}: ${value ? '✅' : '❌'}`)
      }

      const trueCount = Object.values(relationships).filter(Boolean).length
      console.log(`\n📊 Summary: ${trueCount}/7 relationships available`)

      // Sample a few concepts to see what properties they actually have
      console.log('\n🔍 Sampling 5 concepts to see their properties:')
      const sampleQuery = withPrefixes(`
        SELECT ?concept ?p ?o
        WHERE {
          ?concept a skos:Concept .
          ?concept ?p ?o .
          FILTER(STRSTARTS(STR(?p), "http://www.w3.org/2004/02/skos/core#"))
        }
        LIMIT 50
      `)

      const sampleResult = await executeSparql(endpoint, sampleQuery)
      const grouped = new Map<string, string[]>()

      for (const binding of sampleResult.results.bindings) {
        const concept = binding.concept?.value
        const prop = binding.p?.value?.replace('http://www.w3.org/2004/02/skos/core#', 'skos:')
        if (concept && prop) {
          if (!grouped.has(concept)) grouped.set(concept, [])
          if (!grouped.get(concept)!.includes(prop)) {
            grouped.get(concept)!.push(prop)
          }
        }
      }

      let count = 0
      for (const [concept, props] of grouped.entries()) {
        if (count++ >= 5) break
        console.log(`  ${concept}`)
        console.log(`    Properties: ${props.join(', ')}`)
      }

    } catch (e) {
      console.error('❌ Failed to check relationships:', e)
    }
  }
}
