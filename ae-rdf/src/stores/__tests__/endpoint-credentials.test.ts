import { describe, it, expect } from 'vitest'
import { useEndpointStore } from '../endpoint'

const STORAGE_KEY = 'ae-endpoints'

function stored() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
}

describe('endpoint store — connect-time credentials', () => {
  it('never persists credentials to localStorage, keeps only the auth type', () => {
    const ep = useEndpointStore()
    ep.addEndpoint({
      name: 'Secured',
      url: 'https://e.org/sparql',
      auth: { type: 'basic', credentials: { username: 'alice', password: 'sup3rsecret' } },
    })
    const persisted = stored()[0]
    expect(persisted.auth).toEqual({ type: 'basic' })
    expect(JSON.stringify(stored())).not.toContain('sup3rsecret')
  })

  it('prompts (does not connect) when a secured endpoint has no credentials', () => {
    const ep = useEndpointStore()
    const e = ep.addEndpoint({ name: 'S', url: 'https://e.org/sparql', auth: { type: 'basic' } })!
    ep.selectEndpoint(e.id)
    expect(ep.pendingCredentialsId).toBe(e.id)
    expect(ep.currentId).toBeNull()
    expect(ep.status).toBe('disconnected')
  })

  it('connects after credentials are provided, holding them in memory only', () => {
    const ep = useEndpointStore()
    const e = ep.addEndpoint({ name: 'S', url: 'https://e.org/sparql', auth: { type: 'basic' } })!
    ep.selectEndpoint(e.id)
    ep.provideCredentials({ username: 'u', password: 'p' })

    expect(ep.pendingCredentialsId).toBeNull()
    expect(ep.currentId).toBe(e.id)
    expect(ep.status).toBe('connected')
    expect(ep.current?.auth?.credentials).toEqual({ username: 'u', password: 'p' })
    // ...but the secret still never reaches storage.
    expect(stored()[0].auth).toEqual({ type: 'basic' })
  })

  it('connects directly when no auth is configured', () => {
    const ep = useEndpointStore()
    const e = ep.addEndpoint({ name: 'Open', url: 'https://e.org/sparql' })!
    ep.selectEndpoint(e.id)
    expect(ep.pendingCredentialsId).toBeNull()
    expect(ep.currentId).toBe(e.id)
  })
})
