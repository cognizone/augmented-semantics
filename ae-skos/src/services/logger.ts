/**
 * Simple logger for debugging
 * Logs are visible in browser console (F12 -> Console)
 *
 * Usage:
 *   import { logger } from '@/services/logger'
 *   logger.debug('MyComponent', 'Loading data', { id: 123 })
 *   logger.error('MyComponent', 'Failed to load', error)
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  timestamp: string
  level: LogLevel
  component: string
  message: string
  data?: unknown
}

// Store recent logs for debugging
const LOG_HISTORY_SIZE = 100
const logHistory: LogEntry[] = []

// Log level colors for console
const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '#888',
  info: '#2196F3',
  warn: '#FF9800',
  error: '#F44336',
}

// Check if we're in development mode
const isDev = import.meta.env.DEV

function formatTimestamp(): string {
  const iso = new Date().toISOString()
  const timePart = iso.split('T')[1] ?? '00:00:00.000'
  return timePart.slice(0, 12)
}

function log(level: LogLevel, component: string, message: string, data?: unknown): void {
  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level,
    component,
    message,
    data,
  }

  // Store in history
  logHistory.push(entry)
  if (logHistory.length > LOG_HISTORY_SIZE) {
    logHistory.shift()
  }

  // Only log to console in development, or for errors
  if (!isDev && level !== 'error') {
    return
  }

  const color = LEVEL_COLORS[level]
  const prefix = `%c[${entry.timestamp}] [${level.toUpperCase()}] [${component}]`

  if (data !== undefined) {
    console.log(prefix, `color: ${color}`, message, data)
  } else {
    console.log(prefix, `color: ${color}`, message)
  }
}

export const logger = {
  debug: (component: string, message: string, data?: unknown) =>
    log('debug', component, message, data),

  info: (component: string, message: string, data?: unknown) =>
    log('info', component, message, data),

  warn: (component: string, message: string, data?: unknown) =>
    log('warn', component, message, data),

  error: (component: string, message: string, data?: unknown) =>
    log('error', component, message, data),

  /**
   * Get recent log history (useful for debugging)
   */
  getHistory: (): LogEntry[] => [...logHistory],

  /**
   * Clear log history
   */
  clearHistory: (): void => {
    logHistory.length = 0
  },

  /**
   * Dump logs to console (for debugging)
   */
  dump: (): void => {
    console.group('📋 Log History')
    logHistory.forEach(entry => {
      const color = LEVEL_COLORS[entry.level]
      console.log(
        `%c[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.component}]`,
        `color: ${color}`,
        entry.message,
        entry.data ?? ''
      )
    })
    console.groupEnd()
  },
}

// Expose to window for debugging in browser console
if (isDev) {
  ;(window as unknown as { __logger: typeof logger }).__logger = logger
}
