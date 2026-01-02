import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useEndpointForm } from '../useEndpointForm'
import type { SPARQLEndpoint } from '../../types'

describe('useEndpointForm', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('initialization', () => {
    it('initializes with empty form when no endpoint provided', () => {
      const { form } = useEndpointForm()

      expect(form.name).toBe('')
      expect(form.url).toBe('')
      expect(form.authType).toBe('none')
      expect(form.username).toBe('')
      expect(form.password).toBe('')
      expect(form.apiKey).toBe('')
      expect(form.headerName).toBe('X-API-Key')
      expect(form.token).toBe('')
    })

    it('initializes with endpoint data when provided', () => {
      const endpoint: SPARQLEndpoint = {
        id: 'test-1',
        name: 'Test Endpoint',
        url: 'https://example.org/sparql',
        auth: {
          type: 'basic',
          credentials: { username: 'user', password: 'pass' },
        },
        createdAt: '2024-01-01',
        accessCount: 5,
      }

      const { form } = useEndpointForm(endpoint)

      expect(form.name).toBe('Test Endpoint')
      expect(form.url).toBe('https://example.org/sparql')
      expect(form.authType).toBe('basic')
      expect(form.username).toBe('user')
      expect(form.password).toBe('pass')
    })
  })

  describe('formValid', () => {
    it('returns false when name is empty', () => {
      const { form, formValid } = useEndpointForm()
      form.url = 'https://example.org/sparql'

      expect(formValid.value).toBe(false)
    })

    it('returns false when url is empty', () => {
      const { form, formValid } = useEndpointForm()
      form.name = 'Test'

      expect(formValid.value).toBe(false)
    })

    it('returns false when url is invalid', () => {
      const { form, formValid } = useEndpointForm()
      form.name = 'Test'
      form.url = 'not-a-valid-url'

      expect(formValid.value).toBe(false)
    })

    it('returns true when name and valid url are provided', () => {
      const { form, formValid } = useEndpointForm()
      form.name = 'Test'
      form.url = 'https://example.org/sparql'

      expect(formValid.value).toBe(true)
    })

    it('returns false when basic auth missing username', () => {
      const { form, formValid } = useEndpointForm()
      form.name = 'Test'
      form.url = 'https://example.org/sparql'
      form.authType = 'basic'
      form.password = 'pass'

      expect(formValid.value).toBe(false)
    })

    it('returns false when basic auth missing password', () => {
      const { form, formValid } = useEndpointForm()
      form.name = 'Test'
      form.url = 'https://example.org/sparql'
      form.authType = 'basic'
      form.username = 'user'

      expect(formValid.value).toBe(false)
    })

    it('returns true when basic auth is complete', () => {
      const { form, formValid } = useEndpointForm()
      form.name = 'Test'
      form.url = 'https://example.org/sparql'
      form.authType = 'basic'
      form.username = 'user'
      form.password = 'pass'

      expect(formValid.value).toBe(true)
    })

    it('returns false when apikey auth missing key', () => {
      const { form, formValid } = useEndpointForm()
      form.name = 'Test'
      form.url = 'https://example.org/sparql'
      form.authType = 'apikey'

      expect(formValid.value).toBe(false)
    })

    it('returns true when apikey auth is complete', () => {
      const { form, formValid } = useEndpointForm()
      form.name = 'Test'
      form.url = 'https://example.org/sparql'
      form.authType = 'apikey'
      form.apiKey = 'my-key'

      expect(formValid.value).toBe(true)
    })

    it('returns false when bearer auth missing token', () => {
      const { form, formValid } = useEndpointForm()
      form.name = 'Test'
      form.url = 'https://example.org/sparql'
      form.authType = 'bearer'

      expect(formValid.value).toBe(false)
    })

    it('returns true when bearer auth is complete', () => {
      const { form, formValid } = useEndpointForm()
      form.name = 'Test'
      form.url = 'https://example.org/sparql'
      form.authType = 'bearer'
      form.token = 'my-token'

      expect(formValid.value).toBe(true)
    })
  })

  describe('securityCheck', () => {
    it('returns null when url is empty', () => {
      const { securityCheck } = useEndpointForm()

      expect(securityCheck.value).toBeNull()
    })

    it('returns security info for HTTPS url', () => {
      const { form, securityCheck } = useEndpointForm()
      form.url = 'https://example.org/sparql'

      expect(securityCheck.value).not.toBeNull()
      expect(securityCheck.value?.isHttps).toBe(true)
    })

    it('returns security warning for HTTP url', () => {
      const { form, securityCheck } = useEndpointForm()
      form.url = 'http://example.org/sparql'

      expect(securityCheck.value).not.toBeNull()
      expect(securityCheck.value?.isHttps).toBe(false)
    })
  })

  describe('trustCheck', () => {
    it('returns null when url is empty', () => {
      const { trustCheck } = useEndpointForm()

      expect(trustCheck.value).toBeNull()
    })

    it('returns trust info for known endpoint', () => {
      const { form, trustCheck } = useEndpointForm()
      form.url = 'https://dbpedia.org/sparql'

      expect(trustCheck.value).not.toBeNull()
      expect(trustCheck.value?.level).toBe('trusted')
    })

    it('returns unknown trust for unknown endpoint', () => {
      const { form, trustCheck } = useEndpointForm()
      form.url = 'https://random-unknown-endpoint.org/sparql'

      expect(trustCheck.value).not.toBeNull()
      expect(trustCheck.value?.level).toBe('unknown')
    })
  })

  describe('resetForm', () => {
    it('clears all form fields', () => {
      const { form, resetForm } = useEndpointForm()
      form.name = 'Test'
      form.url = 'https://example.org/sparql'
      form.authType = 'basic'
      form.username = 'user'
      form.password = 'pass'

      resetForm()

      expect(form.name).toBe('')
      expect(form.url).toBe('')
      expect(form.authType).toBe('none')
      expect(form.username).toBe('')
      expect(form.password).toBe('')
    })

    it('resets headerName to default', () => {
      const { form, resetForm } = useEndpointForm()
      form.headerName = 'Custom-Header'

      resetForm()

      expect(form.headerName).toBe('X-API-Key')
    })
  })

  describe('loadEndpoint', () => {
    it('populates form from endpoint', () => {
      const { form, loadEndpoint } = useEndpointForm()
      const endpoint: SPARQLEndpoint = {
        id: 'ep-1',
        name: 'Loaded Endpoint',
        url: 'https://loaded.org/sparql',
        auth: {
          type: 'apikey',
          credentials: { apiKey: 'secret', headerName: 'X-Custom' },
        },
        createdAt: '2024-01-01',
        accessCount: 0,
      }

      loadEndpoint(endpoint)

      expect(form.name).toBe('Loaded Endpoint')
      expect(form.url).toBe('https://loaded.org/sparql')
      expect(form.authType).toBe('apikey')
      expect(form.apiKey).toBe('secret')
      expect(form.headerName).toBe('X-Custom')
    })

    it('handles endpoint without auth', () => {
      const { form, loadEndpoint } = useEndpointForm()
      const endpoint: SPARQLEndpoint = {
        id: 'ep-1',
        name: 'Public Endpoint',
        url: 'https://public.org/sparql',
        createdAt: '2024-01-01',
        accessCount: 0,
      }

      loadEndpoint(endpoint)

      expect(form.authType).toBe('none')
      expect(form.username).toBe('')
    })
  })

  describe('useExample', () => {
    it('loads example endpoint data', () => {
      const { form, useExample } = useEndpointForm()
      form.authType = 'basic'
      form.username = 'leftover'

      useExample({ name: 'DBpedia', url: 'https://dbpedia.org/sparql' })

      expect(form.name).toBe('DBpedia')
      expect(form.url).toBe('https://dbpedia.org/sparql')
      expect(form.authType).toBe('none')
    })
  })

  describe('buildAuth', () => {
    it('returns undefined for none auth type', () => {
      const { buildAuth } = useEndpointForm()

      expect(buildAuth()).toBeUndefined()
    })

    it('builds basic auth object', () => {
      const { form, buildAuth } = useEndpointForm()
      form.authType = 'basic'
      form.username = 'user'
      form.password = 'pass'

      const auth = buildAuth()

      expect(auth).toEqual({
        type: 'basic',
        credentials: { username: 'user', password: 'pass' },
      })
    })

    it('builds apikey auth object', () => {
      const { form, buildAuth } = useEndpointForm()
      form.authType = 'apikey'
      form.apiKey = 'my-key'
      form.headerName = 'X-Custom'

      const auth = buildAuth()

      expect(auth).toEqual({
        type: 'apikey',
        credentials: { apiKey: 'my-key', headerName: 'X-Custom' },
      })
    })

    it('builds bearer auth object', () => {
      const { form, buildAuth } = useEndpointForm()
      form.authType = 'bearer'
      form.token = 'my-token'

      const auth = buildAuth()

      expect(auth).toEqual({
        type: 'bearer',
        credentials: { token: 'my-token' },
      })
    })
  })

  describe('buildEndpoint', () => {
    it('builds endpoint with default id', () => {
      const { form, buildEndpoint } = useEndpointForm()
      form.name = 'Test'
      form.url = 'https://example.org/sparql'

      const endpoint = buildEndpoint()

      expect(endpoint.id).toBe('new')
      expect(endpoint.name).toBe('Test')
      expect(endpoint.url).toBe('https://example.org/sparql')
      expect(endpoint.auth).toBeUndefined()
      expect(endpoint.accessCount).toBe(0)
      expect(endpoint.createdAt).toBeDefined()
    })

    it('builds endpoint with custom id', () => {
      const { form, buildEndpoint } = useEndpointForm()
      form.name = 'Test'
      form.url = 'https://example.org/sparql'

      const endpoint = buildEndpoint('custom-id')

      expect(endpoint.id).toBe('custom-id')
    })

    it('includes auth when configured', () => {
      const { form, buildEndpoint } = useEndpointForm()
      form.name = 'Test'
      form.url = 'https://example.org/sparql'
      form.authType = 'basic'
      form.username = 'user'
      form.password = 'pass'

      const endpoint = buildEndpoint()

      expect(endpoint.auth).toEqual({
        type: 'basic',
        credentials: { username: 'user', password: 'pass' },
      })
    })
  })
})
