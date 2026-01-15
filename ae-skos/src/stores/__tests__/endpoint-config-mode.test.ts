/**
 * Endpoint Store Config Mode Tests
 *
 * Tests for config mode behavior (external config file).
 * Separated from main endpoint.test.ts to properly control config service mocking.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// Unmock config service - we'll control it ourselves
vi.unmock('../../services/config')
vi.unmock('../../services')

// Mock logger to avoid noise
vi.mock('../../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('endpoint store config mode', () => {
  beforeEach(() => {
    // Reset modules before each test to get fresh imports
    vi.resetModules()
    // Clear localStorage
    localStorage.clear()
  })

  async function setupConfigMode(configEndpoints: Array<{
    name: string
    url: string
    auth?: unknown
    analysis?: unknown
    suggestedLanguagePriorities?: string[]
  }>) {
    // Mock the config service for this test
    vi.doMock('../../services/config', () => ({
      loadConfig: vi.fn(() => Promise.resolve({ configMode: true, config: { endpoints: configEndpoints }, loaded: true, error: null })),
      useConfig: vi.fn(() => ({ value: { configMode: true, config: { endpoints: configEndpoints }, loaded: true, error: null } })),
      isConfigMode: vi.fn(() => true),
      isSingleEndpointMode: vi.fn(() => configEndpoints.length === 1),
      getConfig: vi.fn(() => ({ endpoints: configEndpoints })),
    }))

    // Import store after mocking
    const { useEndpointStore } = await import('../endpoint')
    setActivePinia(createPinia())
    return useEndpointStore()
  }

  async function setupNormalMode() {
    // Mock the config service to return non-config mode
    vi.doMock('../../services/config', () => ({
      loadConfig: vi.fn(() => Promise.resolve({ configMode: false, config: null, loaded: true, error: null })),
      useConfig: vi.fn(() => ({ value: { configMode: false, config: null, loaded: true, error: null } })),
      isConfigMode: vi.fn(() => false),
      isSingleEndpointMode: vi.fn(() => false),
      getConfig: vi.fn(() => null),
    }))

    // Import store after mocking
    const { useEndpointStore } = await import('../endpoint')
    setActivePinia(createPinia())
    return useEndpointStore()
  }

  it('loads endpoints from config when isConfigMode() is true', async () => {
    const store = await setupConfigMode([
      { name: 'Config Endpoint', url: 'https://config.org/sparql' }
    ])

    expect(store.endpoints).toHaveLength(1)
    expect(store.endpoints[0]?.name).toBe('Config Endpoint')
    expect(store.endpoints[0]?.url).toBe('https://config.org/sparql')
  })

  it('sets configMode ref to true when loading from config', async () => {
    const store = await setupConfigMode([
      { name: 'E', url: 'https://example.org/sparql' }
    ])

    expect(store.configMode).toBe(true)
  })

  it('auto-selects first endpoint in config mode', async () => {
    const store = await setupConfigMode([
      { name: 'First', url: 'https://first.org/sparql' },
      { name: 'Second', url: 'https://second.org/sparql' },
    ])

    expect(store.currentId).toBe('config-0')
    expect(store.current?.name).toBe('First')
  })

  it('blocks addEndpoint in config mode', async () => {
    const store = await setupConfigMode([
      { name: 'Config', url: 'https://config.org/sparql' }
    ])

    const result = store.addEndpoint({
      name: 'New Endpoint',
      url: 'https://new.org/sparql',
    })

    expect(result).toBeNull()
    expect(store.endpoints).toHaveLength(1)
  })

  it('blocks addSuggestedEndpoint in config mode', async () => {
    const store = await setupConfigMode([
      { name: 'Config', url: 'https://config.org/sparql' }
    ])

    const result = store.addSuggestedEndpoint({
      name: 'Suggested',
      url: 'https://suggested.org/sparql',
      analysis: {
        hasSkosContent: true,
        supportsNamedGraphs: true,
        skosGraphCount: 1,
        analyzedAt: '2024-01-01T00:00:00Z',
      },
      suggestedLanguagePriorities: ['en'],
    })

    expect(result).toBeNull()
    expect(store.endpoints).toHaveLength(1)
  })

  it('blocks removeEndpoint in config mode', async () => {
    const store = await setupConfigMode([
      { name: 'Config', url: 'https://config.org/sparql' }
    ])

    store.removeEndpoint('config-0')

    expect(store.endpoints).toHaveLength(1)
  })

  it('isSingleEndpoint returns true for single config endpoint', async () => {
    const store = await setupConfigMode([
      { name: 'Single', url: 'https://single.org/sparql' }
    ])

    expect(store.isSingleEndpoint).toBe(true)
  })

  it('isSingleEndpoint returns false for multiple config endpoints', async () => {
    const store = await setupConfigMode([
      { name: 'First', url: 'https://first.org/sparql' },
      { name: 'Second', url: 'https://second.org/sparql' },
    ])

    expect(store.isSingleEndpoint).toBe(false)
  })

  it('loads languagePriorities from config endpoint', async () => {
    const store = await setupConfigMode([
      {
        name: 'Config',
        url: 'https://config.org/sparql',
        suggestedLanguagePriorities: ['fr', 'en', 'de'],
      },
    ])

    expect(store.endpoints[0]?.languagePriorities).toEqual(['fr', 'en', 'de'])
  })

  it('loads auth from config endpoint', async () => {
    const store = await setupConfigMode([
      {
        name: 'Config',
        url: 'https://config.org/sparql',
        auth: { type: 'basic', credentials: { username: 'user', password: 'pass' } },
      },
    ])

    expect(store.endpoints[0]?.auth?.type).toBe('basic')
    expect(store.endpoints[0]?.auth?.credentials?.username).toBe('user')
  })

  it('loads analysis from config endpoint', async () => {
    const store = await setupConfigMode([
      {
        name: 'Config',
        url: 'https://config.org/sparql',
        analysis: {
          hasSkosContent: true,
          supportsNamedGraphs: true,
          skosGraphCount: 5,
          totalConcepts: 1000,
          analyzedAt: '2024-01-01T00:00:00Z',
        },
      },
    ])

    expect(store.endpoints[0]?.analysis?.hasSkosContent).toBe(true)
    expect(store.endpoints[0]?.analysis?.totalConcepts).toBe(1000)
  })

  it('allows addEndpoint in normal mode', async () => {
    const store = await setupNormalMode()

    const result = store.addEndpoint({
      name: 'New Endpoint',
      url: 'https://new.org/sparql',
    })

    expect(result).not.toBeNull()
    expect(store.endpoints).toHaveLength(1)
    expect(store.endpoints[0]?.name).toBe('New Endpoint')
  })

  it('configMode is false in normal mode', async () => {
    const store = await setupNormalMode()

    expect(store.configMode).toBe(false)
  })
})
