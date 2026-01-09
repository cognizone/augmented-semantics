/**
 * Logger Service - Debug logging utility
 *
 * Logs are visible in browser console (F12 -> Console).
 * In development, access via console: __logger.dump()
 *
 * Usage:
 *   import { logger } from '@/services/logger'
 *   logger.debug('MyComponent', 'Loading data', { id: 123 })
 *   logger.error('MyComponent', 'Failed to load', error)
 *
 * @see /CLAUDE.md (Debugging section)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

interface LogEntry {
  timestamp: string
  level: LogLevel
  component: string
  message: string
  data?: unknown
}

// Log level priority (higher = more severe)
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
}

// Store recent logs for debugging
const LOG_HISTORY_SIZE = 100
const logHistory: LogEntry[] = []

// Minimum log level (can be changed at runtime)
let minLevel: LogLevel = 'warn'

// Log level colors for console
const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '#888',
  info: '#2196F3',
  warn: '#FF9800',
  error: '#F44336',
  fatal: '#B71C1C',
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

  // Store in history (always, regardless of min level)
  logHistory.push(entry)
  if (logHistory.length > LOG_HISTORY_SIZE) {
    logHistory.shift()
  }

  // Check if level meets minimum threshold
  if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[minLevel]) {
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

  fatal: (component: string, message: string, data?: unknown) =>
    log('fatal', component, message, data),

  /**
   * Set minimum log level for console output
   * Logs below this level are still stored in history but not printed
   */
  setMinLevel: (level: LogLevel): void => {
    minLevel = level
  },

  /**
   * Get current minimum log level
   */
  getMinLevel: (): LogLevel => minLevel,

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
