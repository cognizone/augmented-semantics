/**
 * Config Service Tests
 *
 * Tests for external configuration loading and state management.
 * Note: These tests unmock the config module to test the actual implementation.
 * @see /spec/common/com01-EndpointManager.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AppConfig } from '../../types'

// Unmock the config module for these tests since we want to test the actual implementation
vi.unmock('../config')

// Helper to create mock fetch responses
function mockFetch404() {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 404,
    statusText: 'Not Found',
  })
}

function mockFetchSuccess(config: AppConfig) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => config,
  })
}

function mockFetchError(status: number, statusText: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
  })
}

function mockFetchInvalidJson() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
  })
}

// Mock the logger to avoid console noise
vi.mock('../logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('config service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('loadConfig', () => {
    describe('no config file (404)', () => {
      it('returns configMode: false when config not found', async () => {
        global.fetch = mockFetch404()
        const { loadConfig } = await import('../config')

        const result = await loadConfig()

        expect(result.configMode).toBe(false)
        expect(result.config).toBeNull()
        expect(result.loaded).toBe(true)
        expect(result.error).toBeNull()
      })

      it('does not throw error on 404', async () => {
        global.fetch = mockFetch404()
        const { loadConfig } = await import('../config')

        await expect(loadConfig()).resolves.not.toThrow()
      })
    })

    describe('valid config', () => {
      it('loads config with endpoints and sets configMode: true', async () => {
        const config: AppConfig = {
          appName: 'Test App',
          endpoints: [
            { name: 'Test Endpoint', url: 'https://example.org/sparql' },
          ],
        }
        global.fetch = mockFetchSuccess(config)
        const { loadConfig } = await import('../config')

        const result = await loadConfig()

        expect(result.configMode).toBe(true)
        expect(result.config).toEqual(config)
        expect(result.loaded).toBe(true)
        expect(result.error).toBeNull()
      })

      it('loads config without endpoints and sets configMode: false', async () => {
        const config: AppConfig = {
          appName: 'Test App',
          documentationUrl: 'https://docs.example.org',
        }
        global.fetch = mockFetchSuccess(config)
        const { loadConfig } = await import('../config')

        const result = await loadConfig()

        expect(result.configMode).toBe(false)
        expect(result.config).toEqual(config)
        expect(result.loaded).toBe(true)
      })

      it('loads config with empty endpoints array and sets configMode: false', async () => {
        const config: AppConfig = {
          appName: 'Test App',
          endpoints: [],
        }
        global.fetch = mockFetchSuccess(config)
        const { loadConfig } = await import('../config')

        const result = await loadConfig()

        expect(result.configMode).toBe(false)
      })

      it('parses appName and documentationUrl', async () => {
        const config: AppConfig = {
          appName: 'My Custom App',
          documentationUrl: 'https://wiki.example.org/help',
          endpoints: [{ name: 'Endpoint', url: 'https://sparql.example.org' }],
        }
        global.fetch = mockFetchSuccess(config)
        const { loadConfig, getConfig } = await import('../config')

        await loadConfig()

        expect(getConfig()?.appName).toBe('My Custom App')
        expect(getConfig()?.documentationUrl).toBe('https://wiki.example.org/help')
      })

      it('parses logoUrl', async () => {
        const config: AppConfig = {
          appName: 'Logo Test App',
          logoUrl: '/config/custom-logo.png',
          endpoints: [{ name: 'Endpoint', url: 'https://sparql.example.org' }],
        }
        global.fetch = mockFetchSuccess(config)
        const { loadConfig, getConfig } = await import('../config')

        await loadConfig()

        expect(getConfig()?.logoUrl).toBe('/config/custom-logo.png')
      })
    })

    describe('invalid config', () => {
      it('falls back gracefully on malformed JSON', async () => {
        global.fetch = mockFetchInvalidJson()
        const { loadConfig } = await import('../config')

        const result = await loadConfig()

        expect(result.configMode).toBe(false)
        expect(result.config).toBeNull()
        expect(result.loaded).toBe(true)
        expect(result.error).toBeTruthy()
      })

      it('falls back on HTTP error', async () => {
        global.fetch = mockFetchError(500, 'Internal Server Error')
        const { loadConfig } = await import('../config')

        const result = await loadConfig()

        expect(result.configMode).toBe(false)
        expect(result.config).toBeNull()
        expect(result.error).toBeTruthy()
      })

      it('falls back on missing required endpoint fields', async () => {
        const invalidConfig = {
          endpoints: [{ name: 'Missing URL' }], // Missing url
        }
        global.fetch = mockFetchSuccess(invalidConfig as AppConfig)
        const { loadConfig } = await import('../config')

        const result = await loadConfig()

        expect(result.configMode).toBe(false)
        expect(result.error).toBeTruthy()
      })

      it('falls back on invalid endpoints type', async () => {
        const invalidConfig = {
          endpoints: 'not-an-array',
        }
        global.fetch = mockFetchSuccess(invalidConfig as unknown as AppConfig)
        const { loadConfig } = await import('../config')

        const result = await loadConfig()

        expect(result.configMode).toBe(false)
        expect(result.error).toBeTruthy()
      })
    })

    describe('caching behavior', () => {
      it('returns cached result on subsequent calls', async () => {
        const config: AppConfig = {
          appName: 'Test',
          endpoints: [{ name: 'E', url: 'https://example.org/sparql' }],
        }
        global.fetch = mockFetchSuccess(config)
        const { loadConfig } = await import('../config')

        const result1 = await loadConfig()
        const result2 = await loadConfig()

        expect(result1).toStrictEqual(result2)
        expect(fetch).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('config state functions', () => {
    it('useConfig() returns reactive readonly state', async () => {
      const config: AppConfig = {
        appName: 'Reactive Test',
        endpoints: [{ name: 'E', url: 'https://example.org/sparql' }],
      }
      global.fetch = mockFetchSuccess(config)
      const { loadConfig, useConfig } = await import('../config')

      await loadConfig()
      const state = useConfig()

      expect(state.value.configMode).toBe(true)
      expect(state.value.config?.appName).toBe('Reactive Test')
    })

    it('isConfigMode() returns correct boolean', async () => {
      const config: AppConfig = {
        endpoints: [{ name: 'E', url: 'https://example.org/sparql' }],
      }
      global.fetch = mockFetchSuccess(config)
      const { loadConfig, isConfigMode } = await import('../config')

      await loadConfig()

      expect(isConfigMode()).toBe(true)
    })

    it('isConfigMode() returns false when no endpoints', async () => {
      global.fetch = mockFetch404()
      const { loadConfig, isConfigMode } = await import('../config')

      await loadConfig()

      expect(isConfigMode()).toBe(false)
    })

    it('isSingleEndpointMode() returns true for single endpoint', async () => {
      const config: AppConfig = {
        endpoints: [{ name: 'Single', url: 'https://example.org/sparql' }],
      }
      global.fetch = mockFetchSuccess(config)
      const { loadConfig, isSingleEndpointMode } = await import('../config')

      await loadConfig()

      expect(isSingleEndpointMode()).toBe(true)
    })

    it('isSingleEndpointMode() returns false for multiple endpoints', async () => {
      const config: AppConfig = {
        endpoints: [
          { name: 'First', url: 'https://first.example.org/sparql' },
          { name: 'Second', url: 'https://second.example.org/sparql' },
        ],
      }
      global.fetch = mockFetchSuccess(config)
      const { loadConfig, isSingleEndpointMode } = await import('../config')

      await loadConfig()

      expect(isSingleEndpointMode()).toBe(false)
    })

    it('getConfig() returns loaded config', async () => {
      const config: AppConfig = {
        appName: 'GetConfig Test',
        endpoints: [{ name: 'E', url: 'https://example.org/sparql' }],
      }
      global.fetch = mockFetchSuccess(config)
      const { loadConfig, getConfig } = await import('../config')

      await loadConfig()

      expect(getConfig()).toEqual(config)
    })

    it('getConfig() returns null when no config loaded', async () => {
      global.fetch = mockFetch404()
      const { loadConfig, getConfig } = await import('../config')

      await loadConfig()

      expect(getConfig()).toBeNull()
    })
  })
})
