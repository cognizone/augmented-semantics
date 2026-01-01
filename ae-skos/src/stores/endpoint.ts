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
import type { SPARQLEndpoint, EndpointStatus, AppError } from '../types'

const STORAGE_KEY = 'ae-endpoints'

export const useEndpointStore = defineStore('endpoint', () => {
  // State
  const endpoints = ref<SPARQLEndpoint[]>([])
  const currentId = ref<string | null>(null)
  const status = ref<EndpointStatus>('disconnected')
  const error = ref<AppError | null>(null)

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

  // Actions
  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        endpoints.value = JSON.parse(stored)
      }
    } catch (e) {
      console.error('Failed to load endpoints from storage:', e)
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(endpoints.value))
    } catch (e) {
      console.error('Failed to save endpoints to storage:', e)
    }
  }

  function addEndpoint(endpoint: Omit<SPARQLEndpoint, 'id' | 'createdAt' | 'accessCount'>) {
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
      createdAt: existing.createdAt,
      lastAccessedAt: updates.lastAccessedAt ?? existing.lastAccessedAt,
      accessCount: updates.accessCount ?? existing.accessCount,
    }
    saveToStorage()
  }

  function removeEndpoint(id: string) {
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
    // Getters
    current,
    sortedEndpoints,
    // Actions
    loadFromStorage,
    addEndpoint,
    updateEndpoint,
    removeEndpoint,
    selectEndpoint,
    setStatus,
    setError,
    clearError,
  }
})
