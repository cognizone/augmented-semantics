/**
 * Vitest Test Setup
 *
 * Global test configuration and mocks.
 * @see /spec/ae-skos/sko07-Testing.md
 */
import { vi, beforeEach, afterEach } from 'vitest'
import { config } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// --- Browser API Mocks ---

// Mock crypto.randomUUID
Object.defineProperty(globalThis, 'crypto', {
  value: {
    randomUUID: vi.fn(() => 'test-uuid-' + Math.random().toString(36).slice(2, 11)),
  },
})

// Mock navigator.language
Object.defineProperty(globalThis.navigator, 'language', {
  value: 'en-US',
  writable: true,
})

// Mock performance.now
if (!globalThis.performance) {
  Object.defineProperty(globalThis, 'performance', {
    value: { now: vi.fn(() => Date.now()) },
  })
}

// Storage mock factory
function createStorageMock(): Storage {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    get length() {
      return Object.keys(store).length
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  }
}

// Mock localStorage and sessionStorage
Object.defineProperty(globalThis, 'localStorage', {
  value: createStorageMock(),
})

Object.defineProperty(globalThis, 'sessionStorage', {
  value: createStorageMock(),
})

// --- Vue Test Utils Config ---

// Stub PrimeVue components globally
config.global.stubs = {
  // Stub complex PrimeVue components
  Splitter: true,
  SplitterPanel: true,
  Tree: true,
  Tabs: true,
  TabList: true,
  Tab: true,
  TabPanels: true,
  TabPanel: true,
  InputText: true,
  Button: true,
  Dropdown: true,
  Message: true,
  ProgressSpinner: true,
  Chip: true,
  Skeleton: true,
  Dialog: true,
  Toast: true,
  Menu: true,
  Tooltip: true,
  Divider: true,
  InputGroup: true,
  InputGroupAddon: true,
  FloatLabel: true,
  Password: true,
  Select: true,
  SelectButton: true,
  Card: true,
  Accordion: true,
  AccordionPanel: true,
  AccordionHeader: true,
  AccordionContent: true,
  ScrollPanel: true,
  Panel: true,
  Fieldset: true,
  IconField: true,
}

// --- Test Lifecycle ---

beforeEach(() => {
  // Create fresh Pinia instance for each test
  setActivePinia(createPinia())

  // Clear all storage
  localStorage.clear()
  sessionStorage.clear()

  // Reset mocks
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})
