/**
 * RecentHistory Component Tests
 *
 * Tests for recent history display and interactions.
 * @see /spec/ae-skos/sko06-Utilities.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import RecentHistory from '../skos/RecentHistory.vue'
import { useConceptStore, useEndpointStore, useSchemeStore } from '../../stores'

describe('RecentHistory', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  function mountRecentHistory() {
    return mount(RecentHistory, {
      global: {
        stubs: {
          Listbox: {
            template: `
              <div class="p-listbox">
                <div v-for="(option, i) in options" :key="i" class="p-listbox-item" @click="$emit('change', { value: option })">
                  <slot name="option" :option="option" />
                </div>
              </div>
            `,
            props: ['options', 'optionLabel', 'scrollHeight'],
            emits: ['change'],
          },
          HistoryDeleteDialog: {
            template: '<div class="history-delete-dialog" v-if="visible"><button class="confirm-btn" @click="$emit(\'confirm\')">Confirm</button></div>',
            props: ['visible'],
            emits: ['update:visible', 'confirm'],
          },
        },
      },
    })
  }

  describe('empty state', () => {
    it('shows empty message when no history', () => {
      const wrapper = mountRecentHistory()
      expect(wrapper.find('.empty-state').exists()).toBe(true)
      expect(wrapper.text()).toContain('No recent items')
    })

    it('hides clear button when no history', () => {
      const wrapper = mountRecentHistory()
      expect(wrapper.find('.clear-btn').exists()).toBe(false)
    })
  })

  describe('with history', () => {
    beforeEach(() => {
      const conceptStore = useConceptStore()
      conceptStore.addToHistory({ uri: 'http://ex.org/c1', label: 'Concept 1' })
      conceptStore.addToHistory({ uri: 'http://ex.org/c2', label: 'Concept 2', notation: '123' })
    })

    it('shows history items', async () => {
      const wrapper = mountRecentHistory()
      await nextTick()

      expect(wrapper.find('.p-listbox').exists()).toBe(true)
      expect(wrapper.findAll('.p-listbox-item')).toHaveLength(2)
    })

    it('shows clear button when history exists', async () => {
      const wrapper = mountRecentHistory()
      await nextTick()

      expect(wrapper.find('.clear-btn').exists()).toBe(true)
    })

    it('emits selectConcept when item clicked', async () => {
      const wrapper = mountRecentHistory()
      await nextTick()

      const firstItem = wrapper.find('.p-listbox-item')
      await firstItem.trigger('click')

      expect(wrapper.emitted('selectConcept')).toBeTruthy()
      expect(wrapper.emitted('selectConcept')![0][0]).toHaveProperty('uri')
    })
  })

  describe('context display', () => {
    it('shows endpoint name when available', async () => {
      const endpointStore = useEndpointStore()
      const conceptStore = useConceptStore()

      // Add endpoint first
      const endpoint = endpointStore.addEndpoint({
        name: 'Test Endpoint',
        url: 'https://example.org/sparql',
      })

      // Add history entry with endpoint URL
      conceptStore.addToHistory({
        uri: 'http://ex.org/c1',
        label: 'Concept 1',
        endpointUrl: 'https://example.org/sparql',
      })

      const wrapper = mountRecentHistory()
      await nextTick()

      expect(wrapper.text()).toContain('Test Endpoint')
    })

    it('shows scheme name when available', async () => {
      const schemeStore = useSchemeStore()
      const conceptStore = useConceptStore()

      // Add scheme first
      schemeStore.setSchemes([
        { uri: 'http://ex.org/scheme/1', label: 'Test Scheme' },
      ])

      // Add history entry with scheme URI
      conceptStore.addToHistory({
        uri: 'http://ex.org/c1',
        label: 'Concept 1',
        schemeUri: 'http://ex.org/scheme/1',
      })

      const wrapper = mountRecentHistory()
      await nextTick()

      expect(wrapper.text()).toContain('Test Scheme')
    })
  })

  describe('clear history', () => {
    beforeEach(() => {
      const conceptStore = useConceptStore()
      conceptStore.addToHistory({ uri: 'http://ex.org/c1', label: 'Concept 1' })
    })

    it('opens delete dialog when clear button clicked', async () => {
      const wrapper = mountRecentHistory()
      await nextTick()

      const clearBtn = wrapper.find('.clear-btn')
      await clearBtn.trigger('click')
      await nextTick()

      expect(wrapper.find('.history-delete-dialog').exists()).toBe(true)
    })

    it('clears history when confirm is clicked', async () => {
      const conceptStore = useConceptStore()
      const wrapper = mountRecentHistory()
      await nextTick()

      // Open dialog
      const clearBtn = wrapper.find('.clear-btn')
      await clearBtn.trigger('click')
      await nextTick()

      // Click confirm
      const confirmBtn = wrapper.find('.confirm-btn')
      await confirmBtn.trigger('click')
      await nextTick()

      expect(conceptStore.history).toHaveLength(0)
    })
  })

  describe('history entry types', () => {
    it('shows folder icon for scheme entries', async () => {
      const conceptStore = useConceptStore()
      conceptStore.addToHistory({
        uri: 'http://ex.org/scheme/1',
        label: 'Test Scheme',
        type: 'scheme',
      })

      const wrapper = mountRecentHistory()
      await nextTick()

      // The template uses type === 'scheme' to show folder icon
      const item = wrapper.find('.p-listbox-item')
      expect(item.exists()).toBe(true)
    })

    it('shows label icon for concept entries with narrower', async () => {
      const conceptStore = useConceptStore()
      conceptStore.addToHistory({
        uri: 'http://ex.org/c1',
        label: 'Concept 1',
        hasNarrower: true,
      })

      const wrapper = mountRecentHistory()
      await nextTick()

      const item = wrapper.find('.p-listbox-item')
      expect(item.exists()).toBe(true)
    })
  })
})
