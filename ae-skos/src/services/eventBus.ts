/**
 * Event Bus Service - Centralized event coordination
 *
 * Coordinates state changes across stores with:
 * - Typed events and payloads
 * - Async handler support
 * - Priority-based execution
 *
 * @see /spec/common/com02-StateManagement.md
 */

import { logger } from './logger'
import type { EventPayloads, EventName } from '../types/events'

export type { EventPayloads, EventName }

export interface EventHandler<T extends EventName> {
  (payload: EventPayloads[T]): void | Promise<void>
}

export interface EventSubscription {
  unsubscribe: () => void
}

export interface EventBusOptions {
  /** Lower number = higher priority, default 100 */
  priority?: number
  /** Auto-unsubscribe after first call */
  once?: boolean
}

interface HandlerEntry<T extends EventName = EventName> {
  handler: EventHandler<T>
  priority: number
  once: boolean
}

class EventBusImpl {
  private handlers = new Map<EventName, HandlerEntry[]>()

  /**
   * Subscribe to an event
   */
  on<T extends EventName>(
    event: T,
    handler: EventHandler<T>,
    options: EventBusOptions = {}
  ): EventSubscription {
    const { priority = 100, once = false } = options

    if (!this.handlers.has(event)) {
      this.handlers.set(event, [])
    }

    const entry: HandlerEntry<T> = { handler, priority, once }
    const entries = this.handlers.get(event)!
    entries.push(entry as HandlerEntry)

    // Sort by priority (lower = first)
    entries.sort((a, b) => a.priority - b.priority)

    logger.debug('EventBus', `Subscribed to ${event}`, { priority, once })

    return {
      unsubscribe: () => {
        const idx = entries.indexOf(entry as HandlerEntry)
        if (idx >= 0) {
          entries.splice(idx, 1)
          logger.debug('EventBus', `Unsubscribed from ${event}`)
        }
      },
    }
  }

  /**
   * Subscribe to an event (once)
   */
  once<T extends EventName>(
    event: T,
    handler: EventHandler<T>,
    options?: Omit<EventBusOptions, 'once'>
  ): EventSubscription {
    return this.on(event, handler, { ...options, once: true })
  }

  /**
   * Emit an event (fires all handlers in priority order)
   */
  async emit<T extends EventName>(event: T, payload: EventPayloads[T]): Promise<void> {
    const entries = this.handlers.get(event)
    if (!entries?.length) {
      logger.debug('EventBus', `No handlers for ${event}`)
      return
    }

    logger.info('EventBus', `Emitting ${event}`, { handlerCount: entries.length })

    // Create copy to handle removal during iteration
    const toExecute = [...entries]
    const toRemove: HandlerEntry[] = []

    for (const entry of toExecute) {
      try {
        await entry.handler(payload)
      } catch (error) {
        logger.error('EventBus', `Handler error for ${event}`, { error })
      }

      if (entry.once) {
        toRemove.push(entry)
      }
    }

    // Remove once handlers
    for (const entry of toRemove) {
      const idx = entries.indexOf(entry)
      if (idx >= 0) entries.splice(idx, 1)
    }
  }

  /**
   * Remove all handlers for an event
   */
  off<T extends EventName>(event: T): void {
    this.handlers.delete(event)
    logger.debug('EventBus', `Cleared handlers for ${event}`)
  }

  /**
   * Clear all subscriptions
   */
  clear(): void {
    this.handlers.clear()
    logger.debug('EventBus', 'Cleared all handlers')
  }
}

// Singleton instance
export const eventBus = new EventBusImpl()
