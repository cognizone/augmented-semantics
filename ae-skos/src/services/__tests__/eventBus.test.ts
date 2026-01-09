/**
 * Event Bus Service Tests
 *
 * Tests for centralized event coordination across stores
 * @see /spec/common/com02-StateManagement.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eventBus } from '../eventBus'

describe('EventBus', () => {
  beforeEach(() => {
    eventBus.clear()
  })

  describe('on()', () => {
    it('subscribes handler to event', async () => {
      const handler = vi.fn()
      eventBus.on('concept:selected', handler)

      await eventBus.emit('concept:selected', 'http://example.org/concept')

      expect(handler).toHaveBeenCalledWith('http://example.org/concept')
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('allows multiple handlers for same event', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      eventBus.on('concept:selected', handler1)
      eventBus.on('concept:selected', handler2)

      await eventBus.emit('concept:selected', 'http://example.org/concept')

      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).toHaveBeenCalledTimes(1)
    })

    it('returns subscription with unsubscribe function', async () => {
      const handler = vi.fn()
      const subscription = eventBus.on('concept:selected', handler)

      subscription.unsubscribe()
      await eventBus.emit('concept:selected', 'http://example.org/concept')

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('emit()', () => {
    it('calls all subscribed handlers', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      const handler3 = vi.fn()
      eventBus.on('concept:selected', handler1)
      eventBus.on('concept:selected', handler2)
      eventBus.on('concept:selected', handler3)

      await eventBus.emit('concept:selected', 'http://example.org/concept')

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
      expect(handler3).toHaveBeenCalled()
    })

    it('respects priority order (lower = first)', async () => {
      const callOrder: number[] = []
      eventBus.on('concept:selected', () => { callOrder.push(3) }, { priority: 300 })
      eventBus.on('concept:selected', () => { callOrder.push(1) }, { priority: 100 })
      eventBus.on('concept:selected', () => { callOrder.push(2) }, { priority: 200 })

      await eventBus.emit('concept:selected', 'http://example.org/concept')

      expect(callOrder).toEqual([1, 2, 3])
    })

    it('uses default priority of 100 when not specified', async () => {
      const callOrder: number[] = []
      eventBus.on('concept:selected', () => { callOrder.push(2) }) // default 100
      eventBus.on('concept:selected', () => { callOrder.push(1) }, { priority: 50 })
      eventBus.on('concept:selected', () => { callOrder.push(3) }, { priority: 150 })

      await eventBus.emit('concept:selected', 'http://example.org/concept')

      expect(callOrder).toEqual([1, 2, 3])
    })

    it('does nothing when no handlers registered', async () => {
      // Should not throw
      await expect(eventBus.emit('concept:selected', null)).resolves.toBeUndefined()
    })

    it('passes correct payload to handlers', async () => {
      const handler = vi.fn()
      eventBus.on('concept:selecting', handler)

      await eventBus.emit('concept:selecting', 'http://example.org/specific-concept')

      expect(handler).toHaveBeenCalledWith('http://example.org/specific-concept')
    })
  })

  describe('once()', () => {
    it('auto-unsubscribes after first call', async () => {
      const handler = vi.fn()
      eventBus.once('concept:selected', handler)

      await eventBus.emit('concept:selected', 'http://example.org/first')
      await eventBus.emit('concept:selected', 'http://example.org/second')

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith('http://example.org/first')
    })

    it('respects priority option', async () => {
      const callOrder: number[] = []
      eventBus.on('concept:selected', () => { callOrder.push(2) }, { priority: 200 })
      eventBus.once('concept:selected', () => { callOrder.push(1) }, { priority: 100 })

      await eventBus.emit('concept:selected', 'http://example.org/concept')

      expect(callOrder).toEqual([1, 2])
    })

    it('can be manually unsubscribed before firing', async () => {
      const handler = vi.fn()
      const subscription = eventBus.once('concept:selected', handler)

      subscription.unsubscribe()
      await eventBus.emit('concept:selected', 'http://example.org/concept')

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('off()', () => {
    it('removes all handlers for an event', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      eventBus.on('concept:selected', handler1)
      eventBus.on('concept:selected', handler2)

      eventBus.off('concept:selected')
      await eventBus.emit('concept:selected', 'http://example.org/concept')

      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).not.toHaveBeenCalled()
    })

    it('does not affect other events', async () => {
      const selectHandler = vi.fn()
      const revealHandler = vi.fn()
      eventBus.on('concept:selected', selectHandler)
      eventBus.on('concept:revealed', revealHandler)

      eventBus.off('concept:selected')
      await eventBus.emit('concept:selected', 'http://example.org/concept')
      await eventBus.emit('concept:revealed', 'http://example.org/concept')

      expect(selectHandler).not.toHaveBeenCalled()
      expect(revealHandler).toHaveBeenCalled()
    })
  })

  describe('clear()', () => {
    it('removes all handlers for all events', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      eventBus.on('concept:selected', handler1)
      eventBus.on('concept:revealed', handler2)

      eventBus.clear()
      await eventBus.emit('concept:selected', 'http://example.org/concept')
      await eventBus.emit('concept:revealed', 'http://example.org/concept')

      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).not.toHaveBeenCalled()
    })
  })

  describe('async handlers', () => {
    it('awaits async handlers', async () => {
      let completed = false
      const asyncHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        completed = true
      })
      eventBus.on('concept:selected', asyncHandler)

      await eventBus.emit('concept:selected', 'http://example.org/concept')

      expect(completed).toBe(true)
    })

    it('executes handlers sequentially', async () => {
      const callOrder: number[] = []
      eventBus.on('concept:selected', async () => {
        await new Promise(resolve => setTimeout(resolve, 20))
        callOrder.push(1)
      }, { priority: 100 })
      eventBus.on('concept:selected', async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        callOrder.push(2)
      }, { priority: 200 })

      await eventBus.emit('concept:selected', 'http://example.org/concept')

      // Priority 100 handler (20ms) should complete before priority 200 (10ms) starts
      expect(callOrder).toEqual([1, 2])
    })
  })

  describe('error handling', () => {
    it('handler errors do not break other handlers', async () => {
      const handler1 = vi.fn(() => { throw new Error('Handler 1 error') })
      const handler2 = vi.fn()
      const handler3 = vi.fn()
      eventBus.on('concept:selected', handler1, { priority: 100 })
      eventBus.on('concept:selected', handler2, { priority: 200 })
      eventBus.on('concept:selected', handler3, { priority: 300 })

      // Should not throw
      await eventBus.emit('concept:selected', 'http://example.org/concept')

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
      expect(handler3).toHaveBeenCalled()
    })

    it('async handler rejection does not break other handlers', async () => {
      const handler1 = vi.fn(async () => { throw new Error('Async error') })
      const handler2 = vi.fn()
      eventBus.on('concept:selected', handler1, { priority: 100 })
      eventBus.on('concept:selected', handler2, { priority: 200 })

      await eventBus.emit('concept:selected', 'http://example.org/concept')

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })
  })
})
