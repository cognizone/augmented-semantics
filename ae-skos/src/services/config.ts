/**
 * Configuration Service - Load external app configuration
 *
 * Fetches optional config from /config/app.json
 * Falls back gracefully when config is not present (404)
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import { ref, readonly } from 'vue'
import type { AppConfig, ResolvedConfig } from '../types'
import { logger } from './logger'

const CONFIG_PATH = '/config/app.json'

// Singleton state
const state = ref<ResolvedConfig>({
  configMode: false,
  config: null,
  loaded: false,
  error: null,
})

/**
 * Load configuration from /config/app.json
 * Should be called once during app initialization, before stores are used
 *
 * @returns Promise that resolves when config is loaded (or 404 detected)
 */
export async function loadConfig(): Promise<ResolvedConfig> {
  if (state.value.loaded) {
    return state.value
  }

  try {
    const response = await fetch(CONFIG_PATH)

    if (response.status === 404) {
      // No config file - this is expected for dev/default deployments
      logger.debug('ConfigService', 'No config file found (404), using default behavior')
      state.value = {
        configMode: false,
        config: null,
        loaded: true,
        error: null,
      }
      return state.value
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const config: AppConfig = await response.json()

    // Validate config structure
    validateConfig(config)

    const hasConfigEndpoints = Array.isArray(config.endpoints) && config.endpoints.length > 0

    logger.info('ConfigService', 'Config loaded successfully', {
      configMode: hasConfigEndpoints,
      endpointCount: config.endpoints?.length ?? 0,
      appName: config.appName,
    })

    state.value = {
      configMode: hasConfigEndpoints,
      config,
      loaded: true,
      error: null,
    }
  } catch (error) {
    logger.error('ConfigService', 'Failed to load config', { error })
    state.value = {
      configMode: false,
      config: null,
      loaded: true,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }

  return state.value
}

function validateConfig(config: AppConfig): void {
  if (config.endpoints) {
    if (!Array.isArray(config.endpoints)) {
      throw new Error('Config endpoints must be an array')
    }
    for (const ep of config.endpoints) {
      if (!ep.name || typeof ep.name !== 'string') {
        throw new Error('Each endpoint must have a name')
      }
      if (!ep.url || typeof ep.url !== 'string') {
        throw new Error('Each endpoint must have a url')
      }
    }
  }
}

/**
 * Get current config state (reactive, readonly)
 */
export function useConfig() {
  return readonly(state)
}

/**
 * Check if app is in config mode (endpoints locked)
 */
export function isConfigMode(): boolean {
  return state.value.configMode
}

/**
 * Get loaded config (may be null)
 */
export function getConfig(): AppConfig | null {
  return state.value.config
}

/**
 * Check if only one endpoint is configured (hide selector)
 */
export function isSingleEndpointMode(): boolean {
  return state.value.configMode &&
         state.value.config?.endpoints?.length === 1
}
