/**
 * App Component Tests
 *
 * Tests for main application shell, focusing on header functionality.
 *
 * Note: Config-related tests (logo, appName, error banner) are limited due to
 * vitest mock hoisting issues with Vue reactive refs. The config service
 * is fully tested in config.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { ref, readonly } from 'vue'
import App from '../App.vue'
import { useSettingsStore, useEndpointStore } from '../stores'
import type { ResolvedConfig } from '../types'

// Default config for most tests (no config, no error)
const defaultConfig: ResolvedConfig = {
  configMode: false,
  config: null,
  loaded: true,
  error: null,
}

// Mock the config service with default state
vi.mock('../services/config', () => ({
  useConfig: () => readonly(ref(defaultConfig)),
  loadConfig: vi.fn().mockResolvedValue(undefined),
}))

// Mock the logger
vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock vue-router
vi.mock('vue-router', () => ({
  RouterView: { template: '<div class="router-view"></div>' },
  useRoute: () => ({ params: {}, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

describe('App', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    // Set up default endpoint to avoid null errors
    const endpointStore = useEndpointStore()
    const endpoint = endpointStore.addEndpoint({
      name: 'Test Endpoint',
      url: 'https://example.org/sparql',
    })
    endpointStore.selectEndpoint(endpoint.id)
  })

  function mountApp() {
    return mount(App, {
      global: {
        stubs: {
          Toast: { template: '<div class="toast"></div>' },
          Menu: { template: '<div class="menu"></div>', props: ['model', 'popup'] },
          Dialog: { template: '<div class="dialog" v-if="visible"><slot /><slot name="footer" /></div>', props: ['visible', 'header', 'modal', 'position'] },
          Button: { template: '<button><slot /></button>', props: ['label', 'severity', 'text', 'outlined'] },
          Select: { template: '<select></select>', props: ['modelValue', 'options', 'optionLabel', 'optionValue', 'placeholder', 'disabled'] },
          Checkbox: { template: '<input type="checkbox" />', props: ['modelValue', 'binary'] },
          EndpointManager: { template: '<div v-if="visible" class="endpoint-manager"></div>', props: ['visible'] },
          ErrorBoundary: { template: '<div class="error-boundary"><slot /></div>' },
          ConceptBreadcrumb: { template: '<div class="concept-breadcrumb"></div>' },
          RouterView: { template: '<div class="router-view"></div>' },
        },
      },
    })
  }

  describe('dark mode toggle', () => {
    it('renders dark mode toggle button', () => {
      const wrapper = mountApp()
      const toggleBtn = wrapper.find('button[aria-label="Toggle dark mode"]')
      expect(toggleBtn.exists()).toBe(true)
    })

    it('shows moon icon when in light mode', () => {
      const settingsStore = useSettingsStore()
      settingsStore.setDarkMode(false)

      const wrapper = mountApp()
      const toggleBtn = wrapper.find('button[aria-label="Toggle dark mode"]')
      expect(toggleBtn.text()).toContain('dark_mode')
    })

    it('shows sun icon when in dark mode', () => {
      const settingsStore = useSettingsStore()
      settingsStore.setDarkMode(true)

      const wrapper = mountApp()
      const toggleBtn = wrapper.find('button[aria-label="Toggle dark mode"]')
      expect(toggleBtn.text()).toContain('light_mode')
    })

    it('toggles dark mode on click', async () => {
      const settingsStore = useSettingsStore()
      settingsStore.setDarkMode(false)
      expect(settingsStore.darkMode).toBe(false)

      const wrapper = mountApp()
      const toggleBtn = wrapper.find('button[aria-label="Toggle dark mode"]')
      await toggleBtn.trigger('click')

      expect(settingsStore.darkMode).toBe(true)
    })

    it('toggles from dark to light on click', async () => {
      const settingsStore = useSettingsStore()
      settingsStore.setDarkMode(true)
      expect(settingsStore.darkMode).toBe(true)

      const wrapper = mountApp()
      const toggleBtn = wrapper.find('button[aria-label="Toggle dark mode"]')
      await toggleBtn.trigger('click')

      expect(settingsStore.darkMode).toBe(false)
    })

    it('shows correct title tooltip in light mode', () => {
      const settingsStore = useSettingsStore()
      settingsStore.setDarkMode(false)

      const wrapper = mountApp()
      const toggleBtn = wrapper.find('button[aria-label="Toggle dark mode"]')
      expect(toggleBtn.attributes('title')).toBe('Switch to dark mode')
    })

    it('shows correct title tooltip in dark mode', () => {
      const settingsStore = useSettingsStore()
      settingsStore.setDarkMode(true)

      const wrapper = mountApp()
      const toggleBtn = wrapper.find('button[aria-label="Toggle dark mode"]')
      expect(toggleBtn.attributes('title')).toBe('Switch to light mode')
    })
  })

  describe('app name and document title', () => {
    it('displays default app name when no config', () => {
      const wrapper = mountApp()
      expect(wrapper.find('.app-title').text()).toBe('AE SKOS')
    })

    it('sets document.title to default when no config', () => {
      mountApp()
      expect(document.title).toBe('AE SKOS')
    })
  })

  describe('logo', () => {
    it('does not show logo when no config and not config mode', () => {
      const wrapper = mountApp()
      expect(wrapper.find('.app-logo').exists()).toBe(false)
    })
  })

  describe('config error banner', () => {
    it('does not show error banner when no error', () => {
      const wrapper = mountApp()
      expect(wrapper.find('.config-error-banner').exists()).toBe(false)
    })
  })

  describe('auto-open endpoint manager', () => {
    it('does not auto-open endpoint manager when endpoints exist', () => {
      // beforeEach already adds an endpoint
      const wrapper = mountApp()
      // EndpointManager stub renders with class when visible
      // Since endpoints exist, it should not auto-open
      expect(wrapper.find('.endpoint-manager').exists()).toBe(false)
    })
  })
})
