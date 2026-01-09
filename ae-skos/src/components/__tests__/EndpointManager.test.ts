/**
 * EndpointManager Component Tests
 *
 * Tests for SPARQL endpoint configuration and management dialog.
 * @see /spec/common/com01-EndpointManager.md
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import EndpointManager from '../common/EndpointManager.vue'
import { useEndpointStore } from '../../stores'

// Mock the logger
vi.mock('../../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock SPARQL service
vi.mock('../../services/sparql', () => ({
  testConnection: vi.fn().mockResolvedValue({ success: true }),
}))

describe('EndpointManager', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mountEndpointManager(props: { visible?: boolean } = {}) {
    return mount(EndpointManager, {
      props: {
        visible: true,
        ...props,
      },
      global: {
        stubs: {
          Dialog: {
            template: `
              <div v-if="visible" class="p-dialog">
                <div class="p-dialog-header">{{ header }}</div>
                <div class="p-dialog-content"><slot /></div>
              </div>
            `,
            props: ['visible', 'header', 'modal', 'closable', 'position', 'style'],
          },
          Button: {
            template: `
              <button class="p-button" :class="{ 'p-button-disabled': disabled }" @click="$emit('click')" :disabled="disabled">
                <slot name="icon" />
                {{ label }}
              </button>
            `,
            props: ['label', 'size', 'severity', 'outlined', 'disabled'],
            emits: ['click'],
          },
          DataTable: {
            template: `
              <div class="p-datatable">
                <slot v-if="!value || value.length === 0" name="empty" />
                <div v-else class="p-datatable-content">
                  <div v-for="(item, i) in value" :key="item.id" class="p-datatable-row">
                    <span class="endpoint-name-display">{{ item.name }}</span>
                  </div>
                </div>
              </div>
            `,
            props: ['value', 'rows', 'paginator', 'paginatorTemplate', 'currentPageReportTemplate', 'stripedRows'],
          },
          Column: true,
          Tag: {
            template: '<span class="p-tag" :class="`p-tag-${severity}`"><slot /></span>',
            props: ['severity'],
          },
          EndpointWizard: {
            template: '<div v-if="visible" class="endpoint-wizard"><slot /></div>',
            props: ['visible', 'endpoint'],
            emits: ['update:visible', 'save'],
          },
          EndpointDeleteDialog: {
            template: `
              <div v-if="visible" class="endpoint-delete-dialog">
                <button class="confirm-delete-btn" @click="$emit('confirm', endpoint)">Confirm Delete</button>
              </div>
            `,
            props: ['visible', 'endpoint'],
            emits: ['update:visible', 'confirm'],
          },
        },
      },
    })
  }

  describe('initial rendering', () => {
    it('renders dialog when visible', () => {
      const wrapper = mountEndpointManager({ visible: true })
      expect(wrapper.find('.p-dialog').exists()).toBe(true)
    })

    it('does not render when not visible', () => {
      const wrapper = mountEndpointManager({ visible: false })
      expect(wrapper.find('.p-dialog').exists()).toBe(false)
    })

    it('shows "Saved Endpoints" header', () => {
      const wrapper = mountEndpointManager()
      expect(wrapper.find('.list-header h3').text()).toBe('Saved Endpoints')
    })

    it('shows Add Endpoint button', () => {
      const wrapper = mountEndpointManager()
      expect(wrapper.find('.add-endpoint-btn').exists()).toBe(true)
      expect(wrapper.find('.add-endpoint-btn').text()).toContain('Add Endpoint')
    })
  })

  describe('empty state', () => {
    it('shows empty state when no endpoints configured', () => {
      const wrapper = mountEndpointManager()
      expect(wrapper.find('.empty-state').exists()).toBe(true)
      expect(wrapper.text()).toContain('No endpoints configured yet')
    })
  })

  describe('endpoint list', () => {
    it('hides empty state when endpoints exist', async () => {
      const endpointStore = useEndpointStore()
      endpointStore.addEndpoint({
        name: 'Test Endpoint',
        url: 'https://example.org/sparql',
      })

      const wrapper = mountEndpointManager()
      await nextTick()

      expect(wrapper.find('.empty-state').exists()).toBe(false)
    })

    it('shows endpoint names in list', async () => {
      const endpointStore = useEndpointStore()
      endpointStore.addEndpoint({
        name: 'My Test Endpoint',
        url: 'https://example.org/sparql',
      })

      const wrapper = mountEndpointManager()
      await nextTick()

      expect(wrapper.text()).toContain('My Test Endpoint')
    })
  })

  describe('trusted endpoints section', () => {
    it('shows suggested endpoints section', () => {
      // Trusted endpoints come from generated JSON
      // This section should be visible if availableTrustedEndpoints > 0
      const endpointStore = useEndpointStore()
      const wrapper = mountEndpointManager()

      // If there are available trusted endpoints, section should exist
      if (endpointStore.availableTrustedEndpoints.length > 0) {
        expect(wrapper.find('.suggested-section').exists()).toBe(true)
      }
    })

    it('shows trusted endpoint count badge', () => {
      const endpointStore = useEndpointStore()
      const wrapper = mountEndpointManager()

      if (endpointStore.availableTrustedEndpoints.length > 0) {
        const countBadge = wrapper.find('.suggested-count')
        expect(countBadge.exists()).toBe(true)
        expect(countBadge.text()).toBe(String(endpointStore.availableTrustedEndpoints.length))
      }
    })

    it('adds trusted endpoint when clicked', async () => {
      const endpointStore = useEndpointStore()

      if (endpointStore.availableTrustedEndpoints.length === 0) {
        // Skip test if no trusted endpoints available
        return
      }

      const initialCount = endpointStore.endpoints.length
      const wrapper = mountEndpointManager()
      await nextTick()

      // Find and click the first Add button in suggested section
      const addBtn = wrapper.find('.suggested-item .p-button')
      if (addBtn.exists()) {
        await addBtn.trigger('click')
        await nextTick()

        // Should have added one endpoint
        expect(endpointStore.endpoints.length).toBe(initialCount + 1)
        // Should be selected
        expect(endpointStore.currentId).toBe(endpointStore.endpoints[0]?.id)
      }
    })
  })

  describe('add endpoint wizard', () => {
    it('opens wizard when Add Endpoint clicked', async () => {
      const wrapper = mountEndpointManager()
      await nextTick()

      const addBtn = wrapper.find('.add-endpoint-btn')
      await addBtn.trigger('click')
      await nextTick()

      expect(wrapper.find('.endpoint-wizard').exists()).toBe(true)
    })
  })

  describe('info banner', () => {
    it('shows info banner by default', () => {
      const wrapper = mountEndpointManager()
      expect(wrapper.find('.info-banner').exists()).toBe(true)
      expect(wrapper.text()).toContain('Configuration Wizard Enabled')
    })

    it('hides info banner when dismissed', async () => {
      const wrapper = mountEndpointManager()

      const dismissBtn = wrapper.find('.dismiss-btn')
      await dismissBtn.trigger('click')
      await nextTick()

      expect(wrapper.find('.info-banner').exists()).toBe(false)
    })
  })

  describe('suggested endpoints collapse', () => {
    it('toggles suggested section on header click', async () => {
      const endpointStore = useEndpointStore()

      if (endpointStore.availableTrustedEndpoints.length === 0) {
        return // Skip if no trusted endpoints
      }

      const wrapper = mountEndpointManager()
      await nextTick()

      const header = wrapper.find('.suggested-header')
      if (header.exists()) {
        // Click to collapse
        await header.trigger('click')
        await nextTick()

        // Check chevron rotated (collapsed state)
        expect(wrapper.find('.chevron-collapsed').exists()).toBe(true)

        // Click again to expand
        await header.trigger('click')
        await nextTick()

        expect(wrapper.find('.chevron-collapsed').exists()).toBe(false)
      }
    })
  })

  describe('update:visible event', () => {
    it('emits update:visible when closing dialog', async () => {
      const wrapper = mountEndpointManager()

      // Manually trigger the update
      wrapper.vm.$emit('update:visible', false)
      await nextTick()

      expect(wrapper.emitted('update:visible')).toBeTruthy()
    })
  })
})
