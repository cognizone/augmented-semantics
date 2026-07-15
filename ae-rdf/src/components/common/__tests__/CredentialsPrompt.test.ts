/**
 * CredentialsPrompt verifies credentials before accepting them: a bad password
 * must surface HERE (dialog stays open, error shown), not later as a query error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import CredentialsPrompt from '../CredentialsPrompt.vue'
import { useEndpointStore } from '../../../stores'

const testConnection = vi.fn()
vi.mock('../../../services', async (orig) => ({
  ...(await orig<typeof import('../../../services')>()),
  testConnection: (...args: unknown[]) => testConnection(...args),
}))

function mountPrompt() {
  return mount(CredentialsPrompt, { global: { plugins: [PrimeVue], stubs: { teleport: true } } })
}

function pendSecuredEndpoint() {
  const store = useEndpointStore()
  const e = store.addEndpoint({ name: 'S', url: 'https://e.org/sparql', auth: { type: 'basic' } })!
  store.selectEndpoint(e.id) // no creds → pending
  return store
}

describe('CredentialsPrompt — validates before accepting', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    testConnection.mockReset()
  })

  it('keeps the dialog open and shows the error when credentials fail', async () => {
    testConnection.mockResolvedValue({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } })
    const store = pendSecuredEndpoint()
    const wrapper = mountPrompt()
    await flushPromises()

    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('alice')
    await inputs[1].setValue('wrongpass')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(testConnection).toHaveBeenCalledOnce()
    expect(wrapper.find('.cred-error').text()).toContain('Authentication required')
    // Still pending — NOT connected on a bad password.
    expect(store.pendingCredentialsId).not.toBeNull()
    expect(store.currentId).toBeNull()
  })

  it('accepts and connects when credentials pass', async () => {
    testConnection.mockResolvedValue({ success: true, responseTime: 5 })
    const store = pendSecuredEndpoint()
    const id = store.pendingCredentialsId
    const wrapper = mountPrompt()
    await flushPromises()

    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('alice')
    await inputs[1].setValue('rightpass')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(store.pendingCredentialsId).toBeNull()
    expect(store.currentId).toBe(id)
    expect(store.status).toBe('connected')
    expect(store.current?.auth?.credentials).toEqual({ username: 'alice', password: 'rightpass' })
  })
})
