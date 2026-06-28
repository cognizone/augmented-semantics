/**
 * Vitest test setup — global mocks and lifecycle.
 *
 * Lean to start: browser-API mocks + a fresh Pinia per test. Add PrimeVue
 * component stubs / a config-service mock here when component/store tests land
 * (mirror ae-skos/src/test-utils/setup.ts).
 */
import { vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// crypto.randomUUID (used by the endpoint store)
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: vi.fn(() => 'test-uuid-' + Math.random().toString(36).slice(2, 11)) },
    configurable: true,
  })
}

// Deterministic navigator.language (language store defaults off it)
Object.defineProperty(globalThis.navigator, 'language', { value: 'en-US', configurable: true })

// In-memory localStorage / sessionStorage
function createStorageMock(): Storage {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((k: string) => store[k] ?? null),
    setItem: vi.fn((k: string, v: string) => { store[k] = v }),
    removeItem: vi.fn((k: string) => { delete store[k] }),
    clear: vi.fn(() => { store = {} }),
    get length() { return Object.keys(store).length },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
  }
}
Object.defineProperty(globalThis, 'localStorage', { value: createStorageMock(), configurable: true })
Object.defineProperty(globalThis, 'sessionStorage', { value: createStorageMock(), configurable: true })

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})
