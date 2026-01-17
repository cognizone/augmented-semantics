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
import type { SPARQLEndpoint, EndpointStatus, AppError, SuggestedEndpoint } from '../types'
import suggestedEndpointsData from '../data/endpoints.json'
import { logger, isConfigMode, getConfig } from '../services'

const STORAGE_KEY = 'ae-endpoints'

// Type assertion for imported JSON (plain array from merged curated files)
const suggestedEndpoints = suggestedEndpointsData as SuggestedEndpoint[]

export const useEndpointStore = defineStore('endpoint', () => {
  // State
  const endpoints = ref<SPARQLEndpoint[]>([])
  const currentId = ref<string | null>(null)
  const status = ref<EndpointStatus>('disconnected')
  const error = ref<AppError | null>(null)
  const configMode = ref(false)

  // Getters
  const current = computed(() =>
    endpoints.value.find(e => e.id === currentId.value) ?? null
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
  function loadFromStorage() {
    // Check if we should use config instead
    if (isConfigMode()) {
      loadFromConfig()
      return
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        endpoints.value = JSON.parse(stored)
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
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(endpoints.value))
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
      auth: updates.auth ?? existing.auth,
      analysis: updates.analysis ?? existing.analysis,
      selectedGraphs: updates.selectedGraphs ?? existing.selectedGraphs,
      languagePriorities: updates.languagePriorities ?? existing.languagePriorities,
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
    currentId.value = id
    if (id) {
      const endpoint = endpoints.value.find(e => e.id === id)
      if (endpoint) {
        updateEndpoint(id, {
          lastAccessedAt: new Date().toISOString(),
          accessCount: endpoint.accessCount + 1,
        })
      }
    }
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
    // Getters
    current,
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
    setStatus,
    setError,
    clearError,
  }
})
