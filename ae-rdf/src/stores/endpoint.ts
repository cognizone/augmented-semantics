/**
 * Endpoint Store - SPARQL endpoint state management
 *
 * Manages saved endpoints, current selection, and connection status.
 * Persisted to localStorage under key 'ae-endpoints'.
 *
 * @see /spec/common/com01-EndpointManager.md
 * @see /spec/common/com02-StateManagement.md
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { SPARQLEndpoint, EndpointStatus, AppError, SuggestedEndpoint, EndpointAuth } from '../types'
import suggestedEndpointsData from '../data/endpoints.json'
import { logger, isConfigMode, getConfig, eventBus } from '../services'

const STORAGE_KEY = 'ae-endpoints'

// Type assertion for imported JSON (plain array from merged curated files)
const suggestedEndpoints = suggestedEndpointsData as SuggestedEndpoint[]

/** Does this endpoint declare auth but lack the secret needed to connect?
 *  Credentials are never persisted (see saveToStorage), so a secured endpoint
 *  always needs them re-entered after a reload — we prompt on connect. */
function needsCredentials(ep: SPARQLEndpoint): boolean {
  const auth = ep.auth
  if (!auth || auth.type === 'none') return false
  const c = auth.credentials
  if (auth.type === 'basic') return !(c?.username && c?.password)
  if (auth.type === 'bearer') return !c?.token
  if (auth.type === 'apikey') return !c?.apiKey
  return false
}

export const useEndpointStore = defineStore('endpoint', () => {
  // State
  const endpoints = ref<SPARQLEndpoint[]>([])
  const currentId = ref<string | null>(null)
  const status = ref<EndpointStatus>('disconnected')
  const error = ref<AppError | null>(null)
  const configMode = ref(false)
  // Endpoint awaiting connect-time credentials (secured, none in memory yet).
  const pendingCredentialsId = ref<string | null>(null)

  // Getters
  const current = computed(() =>
    endpoints.value.find(e => e.id === currentId.value) ?? null
  )

  const pendingCredentialsEndpoint = computed(() =>
    endpoints.value.find(e => e.id === pendingCredentialsId.value) ?? null
  )

  const sortedEndpoints = computed(() =>
    [...endpoints.value].sort((a, b) => {
      // Most recently accessed first
      const aTime = a.lastAccessedAt ? new Date(a.lastAccessedAt).getTime() : 0
      const bTime = b.lastAccessedAt ? new Date(b.lastAccessedAt).getTime() : 0
      return bTime - aTime
    })
  )

  // Suggested endpoints not yet added by the user (matched by URL)
  const availableSuggestedEndpoints = computed(() => {
    const existingUrls = new Set(endpoints.value.map(e => e.url))
    return suggestedEndpoints.filter(te => !existingUrls.has(te.url))
  })

  // Check if only one endpoint is configured (hide dropdown)
  const isSingleEndpoint = computed(() =>
    configMode.value && endpoints.value.length === 1
  )

  // Actions
  function mergeAnalysis(
    existing: SPARQLEndpoint['analysis'] | undefined,
    suggested: SuggestedEndpoint['analysis'] | undefined
  ) {
    if (!suggested) return existing
    if (!existing) return suggested

    const merged = { ...suggested, ...existing }
    if (suggested.schemeUriSlashMismatch !== undefined) {
      merged.schemeUriSlashMismatch = suggested.schemeUriSlashMismatch
    }
    if (suggested.schemeUriSlashMismatchPairs !== undefined) {
      merged.schemeUriSlashMismatchPairs = suggested.schemeUriSlashMismatchPairs
    }
    return merged
  }

  function enrichEndpointFromSuggested(endpoint: SPARQLEndpoint) {
    const suggested = suggestedEndpoints.find(se => se.url === endpoint.url)
    if (!suggested) return endpoint

    const mergedAnalysis = mergeAnalysis(endpoint.analysis, suggested.analysis)
    const mergedLanguagePriorities =
      endpoint.languagePriorities && endpoint.languagePriorities.length > 0
        ? endpoint.languagePriorities
        : suggested.suggestedLanguagePriorities

    return {
      ...endpoint,
      analysis: mergedAnalysis,
      languagePriorities: mergedLanguagePriorities,
    }
  }

  function loadFromStorage() {
    // Check if we should use config instead
    if (isConfigMode()) {
      loadFromConfig()
      return
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        endpoints.value = parsed.map(enrichEndpointFromSuggested)
      }
    } catch (e) {
      logger.error('EndpointStore', 'Failed to load endpoints from storage', { error: e })
    }
  }

  /**
   * Load endpoints from external config file
   * Called when config mode is active
   */
  function loadFromConfig() {
    const config = getConfig()
    if (!config?.endpoints) return

    configMode.value = true
    logger.info('EndpointStore', 'Loading endpoints from config', {
      count: config.endpoints.length,
    })

    // Convert ConfigEndpoint to SPARQLEndpoint
    endpoints.value = config.endpoints.map((ce, index) => ({
      id: `config-${index}`,
      name: ce.name,
      url: ce.url,
      auth: ce.auth,
      analysis: ce.analysis,
      graph: ce.graph,
      types: ce.types,
      typeInventory: ce.typeInventory,
      typeProperties: ce.typeProperties,
      subclasses: ce.subclasses,
      composition: ce.composition,
      orphanCounts: ce.orphanCounts,
      profiledAt: ce.profiledAt,
      languagePriorities: ce.suggestedLanguagePriorities,
      createdAt: new Date().toISOString(),
      accessCount: 0,
    }))

    // Auto-select first endpoint
    if (endpoints.value.length > 0) {
      currentId.value = endpoints.value[0]?.id ?? null
    }
  }

  function saveToStorage() {
    // Config endpoints are never user-managed and are re-loaded from the config
    // file each start; persisting them to ae-endpoints only creates ghost
    // endpoints if the config later goes missing (R05).
    if (configMode.value) return
    try {
      // Never persist credentials — keep the auth *type* so we know to prompt
      // on connect, but the secret lives only in memory for the session. The
      // apikey header *name* is not a secret and must survive reload, else the
      // prompt falls back to X-API-Key and the key is sent under it (R07).
      const sanitized = endpoints.value.map(e => {
        if (!e.auth || e.auth.type === 'none') return e
        const headerName = e.auth.credentials?.headerName
        return {
          ...e,
          auth: { type: e.auth.type, ...(headerName ? { credentials: { headerName } } : {}) },
        }
      })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized))
    } catch (e) {
      logger.error('EndpointStore', 'Failed to save endpoints to storage', { error: e })
    }
  }

  function addEndpoint(endpoint: Omit<SPARQLEndpoint, 'id' | 'createdAt' | 'accessCount'>) {
    if (configMode.value) {
      logger.warn('EndpointStore', 'Cannot add endpoints in config mode')
      return null
    }

    const newEndpoint: SPARQLEndpoint = {
      ...endpoint,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      accessCount: 0,
    }
    endpoints.value.push(newEndpoint)
    saveToStorage()
    return newEndpoint
  }

  /**
   * Add a suggested endpoint with pre-calculated analysis data
   */
  function addSuggestedEndpoint(suggestedEndpoint: SuggestedEndpoint) {
    if (configMode.value) {
      logger.warn('EndpointStore', 'Cannot add endpoints in config mode')
      return null
    }

    const newEndpoint: SPARQLEndpoint = {
      id: crypto.randomUUID(),
      name: suggestedEndpoint.name,
      url: suggestedEndpoint.url,
      analysis: suggestedEndpoint.analysis,
      languagePriorities: suggestedEndpoint.suggestedLanguagePriorities,
      createdAt: new Date().toISOString(),
      accessCount: 0,
    }
    endpoints.value.push(newEndpoint)
    saveToStorage()
    return newEndpoint
  }

  function updateEndpoint(id: string, updates: Partial<Omit<SPARQLEndpoint, 'id' | 'createdAt'>>) {
    const existing = endpoints.value.find(e => e.id === id)
    if (!existing) return

    const index = endpoints.value.indexOf(existing)
    endpoints.value[index] = {
      id: existing.id,
      name: updates.name ?? existing.name,
      url: updates.url ?? existing.url,
      // 'auth' present (even undefined) overwrites, so it can be reset to None (R06).
      auth: 'auth' in updates ? updates.auth : existing.auth,
      analysis: updates.analysis ?? existing.analysis,
      // 'graph' present (even undefined) overwrites, so it can be reset to auto.
      graph: 'graph' in updates ? updates.graph : existing.graph,
      types: 'types' in updates ? updates.types : existing.types,
      typeInventory: 'typeInventory' in updates ? updates.typeInventory : existing.typeInventory,
      typeProperties: 'typeProperties' in updates ? updates.typeProperties : existing.typeProperties,
      subclasses: 'subclasses' in updates ? updates.subclasses : existing.subclasses,
      composition: 'composition' in updates ? updates.composition : existing.composition,
      orphanCounts: 'orphanCounts' in updates ? updates.orphanCounts : existing.orphanCounts,
      profiledAt: 'profiledAt' in updates ? updates.profiledAt : existing.profiledAt,
      selectedGraphs: updates.selectedGraphs ?? existing.selectedGraphs,
      languagePriorities: updates.languagePriorities ?? existing.languagePriorities,
      lastTestStatus: updates.lastTestStatus ?? existing.lastTestStatus,
      lastTestedAt: updates.lastTestedAt ?? existing.lastTestedAt,
      lastTestErrorCode: updates.lastTestErrorCode ?? existing.lastTestErrorCode,
      createdAt: existing.createdAt,
      lastAccessedAt: updates.lastAccessedAt ?? existing.lastAccessedAt,
      accessCount: updates.accessCount ?? existing.accessCount,
    }
    saveToStorage()
  }

  function removeEndpoint(id: string) {
    if (configMode.value) {
      logger.warn('EndpointStore', 'Cannot remove endpoints in config mode')
      return
    }

    endpoints.value = endpoints.value.filter(e => e.id !== id)
    if (currentId.value === id) {
      currentId.value = null
      status.value = 'disconnected'
    }
    saveToStorage()
  }

  function selectEndpoint(id: string | null) {
    if (id) {
      const endpoint = endpoints.value.find(e => e.id === id)
      // Secured endpoint with no in-memory credentials: prompt before connecting.
      if (endpoint && needsCredentials(endpoint)) {
        pendingCredentialsId.value = id
        return
      }
    }
    currentId.value = id
    if (id) {
      const endpoint = endpoints.value.find(e => e.id === id)
      if (endpoint) {
        updateEndpoint(id, {
          lastAccessedAt: new Date().toISOString(),
          accessCount: endpoint.accessCount + 1,
        })
        status.value = 'connected'
        // Notify consumers (type discovery in T3 subscribes to this).
        void eventBus.emit('endpoint:changed', endpoint)
      }
    } else {
      status.value = 'disconnected'
    }
  }

  /** Apply connect-time credentials (held in memory only) and connect. */
  function provideCredentials(credentials: NonNullable<EndpointAuth['credentials']>) {
    const id = pendingCredentialsId.value
    pendingCredentialsId.value = null
    if (!id) return
    const endpoint = endpoints.value.find(e => e.id === id)
    if (endpoint?.auth) {
      // Mutate in memory; saveToStorage strips it, so it never persists.
      endpoint.auth.credentials = { ...endpoint.auth.credentials, ...credentials }
    }
    selectEndpoint(id)
  }

  function cancelCredentials() {
    pendingCredentialsId.value = null
  }

  function setStatus(newStatus: EndpointStatus) {
    status.value = newStatus
  }

  function setError(newError: AppError | null) {
    error.value = newError
  }

  function clearError() {
    error.value = null
  }

  // Initialize
  loadFromStorage()

  return {
    // State
    endpoints,
    currentId,
    status,
    error,
    configMode,
    pendingCredentialsId,
    // Getters
    current,
    pendingCredentialsEndpoint,
    sortedEndpoints,
    availableSuggestedEndpoints,
    isSingleEndpoint,
    // Actions
    loadFromStorage,
    addEndpoint,
    addSuggestedEndpoint,
    updateEndpoint,
    removeEndpoint,
    selectEndpoint,
    provideCredentials,
    cancelCredentials,
    setStatus,
    setError,
    clearError,
  }
})
