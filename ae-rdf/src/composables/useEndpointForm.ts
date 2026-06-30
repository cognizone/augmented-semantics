/**
 * useEndpointForm - Endpoint form state and validation composable
 *
 * Manages form state, validation, security checks, and endpoint
 * object construction for add/edit dialogs.
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import { reactive, computed } from 'vue'
import { isValidEndpointUrl, checkEndpointSecurity, assessEndpointTrust } from '../services/security'
import type { SPARQLEndpoint, EndpointAuth, EndpointGraph } from '../types'

type GraphQuads = 'auto' | 'yes' | 'no'
type GraphDefaultView = 'auto' | 'own' | 'merged'

const quadsToForm = (q?: boolean): GraphQuads => (q === true ? 'yes' : q === false ? 'no' : 'auto')

export function useEndpointForm(initialEndpoint?: SPARQLEndpoint) {
  const form = reactive({
    name: initialEndpoint?.name || '',
    url: initialEndpoint?.url || '',
    authType: (initialEndpoint?.auth?.type || 'none') as 'none' | 'basic' | 'apikey' | 'bearer',
    username: initialEndpoint?.auth?.credentials?.username || '',
    password: initialEndpoint?.auth?.credentials?.password || '',
    apiKey: initialEndpoint?.auth?.credentials?.apiKey || '',
    headerName: initialEndpoint?.auth?.credentials?.headerName || 'X-API-Key',
    token: initialEndpoint?.auth?.credentials?.token || '',
    graphQuads: quadsToForm(initialEndpoint?.graph?.quads),
    graphDefaultView: (initialEndpoint?.graph?.defaultView ?? 'auto') as GraphDefaultView,
  })

  const formValid = computed(() => {
    if (!form.name.trim() || !form.url.trim()) return false
    if (!isValidEndpointUrl(form.url)) return false

    // Credentials are optional at save time: they're never persisted, so a
    // secured endpoint is saved with just its auth type and prompts on connect.
    return true
  })

  const securityCheck = computed(() => {
    if (!form.url) return null
    return checkEndpointSecurity(form.url)
  })

  const trustCheck = computed(() => {
    if (!form.url) return null
    return assessEndpointTrust(form.url)
  })

  /**
   * Reset form to empty state
   */
  function resetForm() {
    form.name = ''
    form.url = ''
    form.authType = 'none'
    form.username = ''
    form.password = ''
    form.apiKey = ''
    form.headerName = 'X-API-Key'
    form.token = ''
    form.graphQuads = 'auto'
    form.graphDefaultView = 'auto'
  }

  /**
   * Load endpoint data into form
   */
  function loadEndpoint(endpoint: SPARQLEndpoint) {
    form.name = endpoint.name
    form.url = endpoint.url
    form.authType = endpoint.auth?.type || 'none'
    form.username = endpoint.auth?.credentials?.username || ''
    form.password = endpoint.auth?.credentials?.password || ''
    form.apiKey = endpoint.auth?.credentials?.apiKey || ''
    form.headerName = endpoint.auth?.credentials?.headerName || 'X-API-Key'
    form.token = endpoint.auth?.credentials?.token || ''
    form.graphQuads = quadsToForm(endpoint.graph?.quads)
    form.graphDefaultView = endpoint.graph?.defaultView ?? 'auto'
  }

  /**
   * Load example endpoint data
   */
  function useExample(example: { name: string; url: string }) {
    form.name = example.name
    form.url = example.url
    form.authType = 'none'
  }

  /**
   * Build auth object from form
   */
  function buildAuth(): EndpointAuth | undefined {
    if (form.authType === 'none') return undefined

    const auth: EndpointAuth = { type: form.authType }

    switch (form.authType) {
      case 'basic':
        auth.credentials = { username: form.username, password: form.password }
        break
      case 'apikey':
        auth.credentials = { apiKey: form.apiKey, headerName: form.headerName }
        break
      case 'bearer':
        auth.credentials = { token: form.token }
        break
    }

    return auth
  }

  /** Build the per-endpoint graph config from the form (undefined when all auto). */
  function buildGraph(): EndpointGraph | undefined {
    const g: EndpointGraph = {}
    if (form.graphQuads === 'yes') g.quads = true
    else if (form.graphQuads === 'no') g.quads = false
    if (form.graphDefaultView !== 'auto') g.defaultView = form.graphDefaultView
    return Object.keys(g).length ? g : undefined
  }

  /**
   * Build endpoint object from form
   */
  function buildEndpoint(id?: string): SPARQLEndpoint {
    return {
      id: id || 'new',
      name: form.name,
      url: form.url,
      auth: buildAuth(),
      createdAt: new Date().toISOString(),
      accessCount: 0,
    }
  }

  return {
    form,
    formValid,
    securityCheck,
    trustCheck,
    resetForm,
    loadEndpoint,
    useExample,
    buildAuth,
    buildGraph,
    buildEndpoint,
  }
}
