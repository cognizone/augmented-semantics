/**
 * SchemeSelector Component Tests
 *
 * Tests for whitelist-based scheme loading and label resolution.
 * @see /spec/ae-skos/sko02-SchemeSelector.md
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import SchemeSelector from '../skos/SchemeSelector.vue'
import { useSchemeStore, useEndpointStore, useLanguageStore } from '../../stores'
import { createMockEndpoint, createSparqlResults, mockFetchSuccess, mockFetchError } from '../../test-utils/mocks'

// Mock the logger
vi.mock('../../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock isValidURI
vi.mock('../../services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services')>()
  return {
    ...actual,
    isValidURI: vi.fn((uri: string) => uri?.startsWith('http')),
  }
})

describe('SchemeSelector', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  function mountSchemeSelector() {
    return mount(SchemeSelector, {
      global: {
        stubs: {
          Select: {
            template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>',
            props: ['modelValue', 'options', 'loading', 'disabled'],
          },
          Dialog: {
            template: '<div v-if="visible" class="dialog"><slot /><slot name="footer" /></div>',
            props: ['visible', 'header', 'modal', 'style', 'position'],
          },
          Button: {
            template: '<button @click="$emit(\'click\')"><slot /></button>',
          },
          Message: {
            template: '<div class="message" :class="severity"><slot /></div>',
            props: ['severity', 'closable'],
          },
        },
      },
    })
  }

  function setupEndpointWithSchemes(schemeUris: string[], languagePriorities: string[] = ['en']) {
    const endpointStore = useEndpointStore()
    const endpoint = endpointStore.addEndpoint({
      name: 'Test Endpoint',
      url: 'https://example.org/sparql',
      analysis: {
        hasSkosContent: true,
        supportsNamedGraphs: false,
        skosGraphCount: 0,
        schemeUris,
        schemeCount: schemeUris.length,
        schemesLimited: false,
        analyzedAt: new Date().toISOString(),
      },
      languagePriorities,
    })
    endpointStore.selectEndpoint(endpoint.id)
    return endpoint
  }

  describe('whitelist behavior', () => {
    it('loads schemes from schemeUris whitelist', async () => {
      const schemeUris = ['http://example.org/scheme1', 'http://example.org/scheme2']
      setupEndpointWithSchemes(schemeUris)

      global.fetch = mockFetchSuccess(createSparqlResults([
        { scheme: schemeUris[0], label: 'Scheme One', labelLang: 'en', labelType: 'prefLabel' },
        { scheme: schemeUris[1], label: 'Scheme Two', labelLang: 'en', labelType: 'prefLabel' },
      ]))

      mountSchemeSelector()
      await flushPromises()

      // Verify query used VALUES clause
      expect(global.fetch).toHaveBeenCalledTimes(1)
      const fetchCall = vi.mocked(global.fetch).mock.calls[0]
      const body = decodeURIComponent(fetchCall[1]?.body as string)
      expect(body).toContain('VALUES ?scheme')
      expect(body).toContain('<http://example.org/scheme1>')
      expect(body).toContain('<http://example.org/scheme2>')

      // Verify schemes in store
      const schemeStore = useSchemeStore()
      expect(schemeStore.schemes).toHaveLength(2)
      expect(schemeStore.schemes[0].label).toBe('Scheme One')
      expect(schemeStore.schemes[1].label).toBe('Scheme Two')
    })

    it('shows empty list when schemeUris is empty', async () => {
      setupEndpointWithSchemes([])

      global.fetch = vi.fn()

      mountSchemeSelector()
      await flushPromises()

      // Should NOT make a fetch call
      expect(global.fetch).not.toHaveBeenCalled()

      // Store should have empty schemes
      const schemeStore = useSchemeStore()
      expect(schemeStore.schemes).toHaveLength(0)
    })

    it('shows empty list when schemeUris is undefined', async () => {
      const endpointStore = useEndpointStore()
      const endpoint = endpointStore.addEndpoint({
        name: 'Test Endpoint',
        url: 'https://example.org/sparql',
        analysis: {
          hasSkosContent: true,
          supportsNamedGraphs: false,
          skosGraphCount: 0,
          // No schemeUris field
          analyzedAt: new Date().toISOString(),
        },
      })
      endpointStore.selectEndpoint(endpoint.id)

      global.fetch = vi.fn()

      mountSchemeSelector()
      await flushPromises()

      expect(global.fetch).not.toHaveBeenCalled()
      const schemeStore = useSchemeStore()
      expect(schemeStore.schemes).toHaveLength(0)
    })

    it('includes all configured URIs even if query returns no labels', async () => {
      const schemeUris = ['http://example.org/scheme1', 'http://example.org/scheme2']
      setupEndpointWithSchemes(schemeUris)

      // Return data only for first scheme
      global.fetch = mockFetchSuccess(createSparqlResults([
        { scheme: schemeUris[0], label: 'Scheme One', labelLang: 'en', labelType: 'prefLabel' },
        // scheme2 returns no label data
      ]))

      mountSchemeSelector()
      await flushPromises()

      const schemeStore = useSchemeStore()
      expect(schemeStore.schemes).toHaveLength(2)
      expect(schemeStore.schemes[0].label).toBe('Scheme One')
      // Second scheme should exist but without label (uses URI as fallback in display)
      expect(schemeStore.schemes[1].uri).toBe(schemeUris[1])
      expect(schemeStore.schemes[1].label).toBeUndefined()
    })
  })

  describe('label resolution', () => {
    it('selects label by preferred language', async () => {
      const schemeUris = ['http://example.org/scheme1']
      setupEndpointWithSchemes(schemeUris, ['en', 'fr'])

      const languageStore = useLanguageStore()
      languageStore.setPreferred('fr')

      global.fetch = mockFetchSuccess(createSparqlResults([
        { scheme: schemeUris[0], label: 'English Label', labelLang: 'en', labelType: 'prefLabel' },
        { scheme: schemeUris[0], label: 'French Label', labelLang: 'fr', labelType: 'prefLabel' },
      ]))

      mountSchemeSelector()
      await flushPromises()

      const schemeStore = useSchemeStore()
      expect(schemeStore.schemes[0].label).toBe('French Label')
      expect(schemeStore.schemes[0].labelLang).toBe('fr')
    })

    it('falls back to endpoint language priorities', async () => {
      const schemeUris = ['http://example.org/scheme1']
      setupEndpointWithSchemes(schemeUris, ['de', 'en'])

      const languageStore = useLanguageStore()
      languageStore.setPreferred('es') // Not available

      global.fetch = mockFetchSuccess(createSparqlResults([
        { scheme: schemeUris[0], label: 'German Label', labelLang: 'de', labelType: 'prefLabel' },
        { scheme: schemeUris[0], label: 'English Label', labelLang: 'en', labelType: 'prefLabel' },
      ]))

      mountSchemeSelector()
      await flushPromises()

      const schemeStore = useSchemeStore()
      // Should fall back to 'de' (first in endpoint priorities)
      expect(schemeStore.schemes[0].label).toBe('German Label')
    })

    it('prefers prefLabel over other label types', async () => {
      const schemeUris = ['http://example.org/scheme1']
      setupEndpointWithSchemes(schemeUris)

      global.fetch = mockFetchSuccess(createSparqlResults([
        { scheme: schemeUris[0], label: 'RDFS Label', labelLang: 'en', labelType: 'rdfsLabel' },
        { scheme: schemeUris[0], label: 'Pref Label', labelLang: 'en', labelType: 'prefLabel' },
        { scheme: schemeUris[0], label: 'Title', labelLang: 'en', labelType: 'title' },
      ]))

      mountSchemeSelector()
      await flushPromises()

      const schemeStore = useSchemeStore()
      expect(schemeStore.schemes[0].label).toBe('Pref Label')
    })
  })

  describe('query construction', () => {
    it('queries for deprecated status', async () => {
      const schemeUris = ['http://example.org/scheme1']
      setupEndpointWithSchemes(schemeUris)

      global.fetch = mockFetchSuccess(createSparqlResults([
        { scheme: schemeUris[0], label: 'Test', labelLang: 'en', labelType: 'prefLabel', deprecated: 'true' },
      ]))

      mountSchemeSelector()
      await flushPromises()

      const fetchCall = vi.mocked(global.fetch).mock.calls[0]
      const body = fetchCall[1]?.body as string
      expect(body).toContain('deprecated')

      const schemeStore = useSchemeStore()
      expect(schemeStore.schemes[0].deprecated).toBe(true)
    })
  })

  describe('store integration', () => {
    it('sets connection status on success', async () => {
      const schemeUris = ['http://example.org/scheme1']
      setupEndpointWithSchemes(schemeUris)

      global.fetch = mockFetchSuccess(createSparqlResults([
        { scheme: schemeUris[0], label: 'Test', labelLang: 'en', labelType: 'prefLabel' },
      ]))

      mountSchemeSelector()
      await flushPromises()

      const endpointStore = useEndpointStore()
      expect(endpointStore.status).toBe('connected')
    })

    it('handles fetch failure gracefully', async () => {
      const schemeUris = ['http://example.org/scheme1']
      setupEndpointWithSchemes(schemeUris)

      // Use a mock that rejects the promise
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      mountSchemeSelector()
      await flushPromises()

      // Verify fetch was attempted
      expect(global.fetch).toHaveBeenCalled()

      // Store should be empty after error (schemes not loaded)
      const schemeStore = useSchemeStore()
      expect(schemeStore.schemes).toHaveLength(0)
    })

    it('auto-selects when only one scheme', async () => {
      const schemeUris = ['http://example.org/only-scheme']
      setupEndpointWithSchemes(schemeUris)

      global.fetch = mockFetchSuccess(createSparqlResults([
        { scheme: schemeUris[0], label: 'Only Scheme', labelLang: 'en', labelType: 'prefLabel' },
      ]))

      mountSchemeSelector()
      await flushPromises()

      const schemeStore = useSchemeStore()
      expect(schemeStore.selectedUri).toBe(schemeUris[0])
    })

    it('reloads when language preference changes', async () => {
      const schemeUris = ['http://example.org/scheme1']
      setupEndpointWithSchemes(schemeUris)

      global.fetch = mockFetchSuccess(createSparqlResults([
        { scheme: schemeUris[0], label: 'Test', labelLang: 'en', labelType: 'prefLabel' },
      ]))

      mountSchemeSelector()
      await flushPromises()

      expect(global.fetch).toHaveBeenCalledTimes(1)

      // Change language
      const languageStore = useLanguageStore()
      languageStore.setPreferred('fr')
      await flushPromises()

      expect(global.fetch).toHaveBeenCalledTimes(2)
    })
  })
})
