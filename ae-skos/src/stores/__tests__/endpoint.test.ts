/**
 * Endpoint Store Tests
 *
 * Tests for SPARQL endpoint management, persistence, and selection.
 * @see /spec/common/com01-EndpointManager.md
 * @see /spec/ae-skos/sko07-Testing.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useEndpointStore } from '../endpoint'

describe('endpoint store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  describe('initial state', () => {
    it('starts with empty endpoints array', () => {
      const store = useEndpointStore()
      expect(store.endpoints).toEqual([])
    })

    it('starts with no current endpoint', () => {
      const store = useEndpointStore()
      expect(store.current).toBeNull()
      expect(store.currentId).toBeNull()
    })

    it('starts with disconnected status', () => {
      const store = useEndpointStore()
      expect(store.status).toBe('disconnected')
    })

    it('starts with no error', () => {
      const store = useEndpointStore()
      expect(store.error).toBeNull()
    })
  })

  describe('addEndpoint', () => {
    it('adds endpoint with generated UUID', () => {
      const store = useEndpointStore()

      const result = store.addEndpoint({
        name: 'Test Endpoint',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
      })

      expect(result.id).toBeDefined()
      expect(result.id).toMatch(/^test-uuid-/)
      expect(store.endpoints).toHaveLength(1)
    })

    it('adds endpoint with provided data', () => {
      const store = useEndpointStore()

      const result = store.addEndpoint({
        name: 'My Endpoint',
        url: 'https://example.org/sparql',
        auth: { type: 'basic', credentials: { username: 'user', password: 'pass' } },
      })

      expect(result.name).toBe('My Endpoint')
      expect(result.url).toBe('https://example.org/sparql')
      expect(result.auth?.type).toBe('basic')
    })

    it('sets createdAt timestamp', () => {
      const store = useEndpointStore()

      const result = store.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
      })

      expect(result.createdAt).toBeDefined()
      expect(new Date(result.createdAt).getTime()).toBeGreaterThan(0)
    })

    it('initializes accessCount to 0', () => {
      const store = useEndpointStore()

      const result = store.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
      })

      expect(result.accessCount).toBe(0)
    })

    it('persists to localStorage', () => {
      const store = useEndpointStore()

      store.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
      })

      expect(localStorage.setItem).toHaveBeenCalled()
    })
  })

  describe('removeEndpoint', () => {
    it('removes endpoint by ID', () => {
      const store = useEndpointStore()

      const endpoint = store.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
      })

      store.removeEndpoint(endpoint.id)
      expect(store.endpoints).toHaveLength(0)
    })

    it('clears current if removed endpoint was selected', () => {
      const store = useEndpointStore()

      const endpoint = store.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
      })

      store.selectEndpoint(endpoint.id)
      expect(store.current).not.toBeNull()

      store.removeEndpoint(endpoint.id)
      expect(store.current).toBeNull()
      expect(store.status).toBe('disconnected')
    })

    it('does not affect current if different endpoint removed', () => {
      const store = useEndpointStore()

      const endpoint1 = store.addEndpoint({
        name: 'Test 1',
        url: 'https://example1.org/sparql',
        auth: { type: 'none' },
      })
      const endpoint2 = store.addEndpoint({
        name: 'Test 2',
        url: 'https://example2.org/sparql',
        auth: { type: 'none' },
      })

      store.selectEndpoint(endpoint1.id)
      store.removeEndpoint(endpoint2.id)

      expect(store.current?.id).toBe(endpoint1.id)
    })
  })

  describe('selectEndpoint', () => {
    it('sets currentId', () => {
      const store = useEndpointStore()

      const endpoint = store.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
      })

      store.selectEndpoint(endpoint.id)
      expect(store.currentId).toBe(endpoint.id)
    })

    it('updates lastAccessedAt on selection', () => {
      const store = useEndpointStore()

      const endpoint = store.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
      })

      // Initial state - no lastAccessedAt
      expect(endpoint.lastAccessedAt).toBeUndefined()

      store.selectEndpoint(endpoint.id)

      // After selection - should have lastAccessedAt
      expect(store.current?.lastAccessedAt).toBeDefined()
    })

    it('increments accessCount on selection', () => {
      const store = useEndpointStore()

      const endpoint = store.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
      })

      expect(endpoint.accessCount).toBe(0)

      store.selectEndpoint(endpoint.id)
      expect(store.current?.accessCount).toBe(1)

      store.selectEndpoint(endpoint.id)
      expect(store.current?.accessCount).toBe(2)
    })

    it('can deselect with null', () => {
      const store = useEndpointStore()

      const endpoint = store.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        auth: { type: 'none' },
      })

      store.selectEndpoint(endpoint.id)
      expect(store.current).not.toBeNull()

      store.selectEndpoint(null)
      expect(store.current).toBeNull()
    })
  })

  describe('updateEndpoint', () => {
    it('updates endpoint properties', () => {
      const store = useEndpointStore()

      const endpoint = store.addEndpoint({
        name: 'Original',
        url: 'https://original.org/sparql',
        auth: { type: 'none' },
      })

      store.updateEndpoint(endpoint.id, {
        name: 'Updated',
        url: 'https://updated.org/sparql',
      })

      const updated = store.endpoints.find(e => e.id === endpoint.id)
      expect(updated?.name).toBe('Updated')
      expect(updated?.url).toBe('https://updated.org/sparql')
    })

    it('preserves id and createdAt', () => {
      const store = useEndpointStore()

      const endpoint = store.addEndpoint({
        name: 'Original',
        url: 'https://original.org/sparql',
        auth: { type: 'none' },
      })

      const originalId = endpoint.id
      const originalCreatedAt = endpoint.createdAt

      store.updateEndpoint(endpoint.id, { name: 'Updated' })

      const updated = store.endpoints.find(e => e.id === endpoint.id)
      expect(updated?.id).toBe(originalId)
      expect(updated?.createdAt).toBe(originalCreatedAt)
    })

    it('does nothing for non-existent endpoint', () => {
      const store = useEndpointStore()

      store.addEndpoint({
        name: 'Test',
        url: 'https://test.org/sparql',
        auth: { type: 'none' },
      })

      store.updateEndpoint('non-existent-id', { name: 'Updated' })

      expect(store.endpoints[0]?.name).toBe('Test')
    })
  })

  describe('sortedEndpoints', () => {
    it('sorts by lastAccessedAt descending', () => {
      const store = useEndpointStore()

      // Add endpoints
      store.addEndpoint({
        name: 'First',
        url: 'https://first.org/sparql',
        auth: { type: 'none' },
      })
      store.addEndpoint({
        name: 'Second',
        url: 'https://second.org/sparql',
        auth: { type: 'none' },
      })

      // Select second (makes it most recent)
      store.selectEndpoint(store.endpoints[1]!.id)

      // Sorted should have second first
      expect(store.sortedEndpoints[0]?.name).toBe('Second')
    })
  })

  describe('status and error', () => {
    it('sets status', () => {
      const store = useEndpointStore()

      store.setStatus('connected')
      expect(store.status).toBe('connected')

      store.setStatus('connecting')
      expect(store.status).toBe('connecting')
    })

    it('sets error', () => {
      const store = useEndpointStore()

      const error = { code: 'NETWORK_ERROR' as const, message: 'Failed', timestamp: new Date().toISOString() }
      store.setError(error)
      expect(store.error).toEqual(error)
    })

    it('clears error', () => {
      const store = useEndpointStore()

      store.setError({ code: 'NETWORK_ERROR' as const, message: 'Failed', timestamp: new Date().toISOString() })
      store.clearError()
      expect(store.error).toBeNull()
    })
  })

  describe('languagePriorities', () => {
    it('stores languagePriorities on endpoint', () => {
      const store = useEndpointStore()

      const endpoint = store.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        languagePriorities: ['en', 'fr', 'de'],
      })

      expect(endpoint.languagePriorities).toEqual(['en', 'fr', 'de'])
    })

    it('updates languagePriorities via updateEndpoint', () => {
      const store = useEndpointStore()

      const endpoint = store.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        languagePriorities: ['en'],
      })

      store.updateEndpoint(endpoint.id, {
        languagePriorities: ['fr', 'de', 'en'],
      })

      const updated = store.endpoints.find(e => e.id === endpoint.id)
      expect(updated?.languagePriorities).toEqual(['fr', 'de', 'en'])
    })

    it('preserves languagePriorities when updating other fields', () => {
      const store = useEndpointStore()

      const endpoint = store.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        languagePriorities: ['en', 'fr'],
      })

      store.updateEndpoint(endpoint.id, {
        name: 'Updated Name',
      })

      const updated = store.endpoints.find(e => e.id === endpoint.id)
      expect(updated?.name).toBe('Updated Name')
      expect(updated?.languagePriorities).toEqual(['en', 'fr'])
    })

    it('current endpoint has languagePriorities accessible', () => {
      const store = useEndpointStore()

      const endpoint = store.addEndpoint({
        name: 'Test',
        url: 'https://example.org/sparql',
        languagePriorities: ['nl', 'en'],
      })

      store.selectEndpoint(endpoint.id)
      expect(store.current?.languagePriorities).toEqual(['nl', 'en'])
    })
  })

  describe('persistence', () => {
    it('loads from localStorage on init', () => {
      const storedEndpoints = [
        {
          id: 'stored-1',
          name: 'Stored Endpoint',
          url: 'https://stored.org/sparql',
          auth: { type: 'none' },
          createdAt: '2024-01-01T00:00:00Z',
          accessCount: 5,
        },
      ]

      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(storedEndpoints))

      // Create new store to trigger load
      const store = useEndpointStore()

      expect(store.endpoints).toHaveLength(1)
      expect(store.endpoints[0]?.name).toBe('Stored Endpoint')
    })

    it('loads languagePriorities from localStorage', () => {
      const storedEndpoints = [
        {
          id: 'stored-1',
          name: 'Stored Endpoint',
          url: 'https://stored.org/sparql',
          auth: { type: 'none' },
          createdAt: '2024-01-01T00:00:00Z',
          accessCount: 5,
          languagePriorities: ['de', 'en', 'fr'],
        },
      ]

      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(storedEndpoints))

      const store = useEndpointStore()
      expect(store.endpoints[0]?.languagePriorities).toEqual(['de', 'en', 'fr'])
    })

    it('handles invalid JSON gracefully', () => {
      vi.mocked(localStorage.getItem).mockReturnValue('invalid json')

      // Should not throw
      const store = useEndpointStore()
      expect(store.endpoints).toEqual([])
    })

    it('handles missing localStorage gracefully', () => {
      vi.mocked(localStorage.getItem).mockReturnValue(null)

      const store = useEndpointStore()
      expect(store.endpoints).toEqual([])
    })
  })
})
