# Developer Tools

Debug logging and development settings for AE SKOS.

## Overview

Developer tools provide configurable logging, browser console access, and debugging capabilities for troubleshooting and development.

**Key Features:**
- Configurable log levels (debug, info, warn, error)
- Log history with 1000-message buffer
- Browser console integration via `__logger` global
- Settings UI for log level configuration
- Component-based logging with context
- Performance tracking via timestamps

## Logger Service

### Architecture

The logger service provides a centralized logging system with filtering, history tracking, and console integration.

```
┌──────────────────────────────────────────────────┐
│          Application Components                  │
│  ConceptTree, SchemeSelector, SearchBox, etc.   │
└────────────────┬─────────────────────────────────┘
                 │ logger.debug(), .info(), etc.
                 ▼
┌──────────────────────────────────────────────────┐
│              Logger Service                       │
│  ┌────────────────────────────────────────────┐ │
│  │ Minimum Level Filter                       │ │
│  │ (configurable via settings)                │ │
│  └────────────┬───────────────────────────────┘ │
│               ▼                                  │
│  ┌────────────────────────────────────────────┐ │
│  │ Log History (last 1000 messages)           │ │
│  └────────────┬───────────────────────────────┘ │
└───────────────┼──────────────────────────────────┘
                │
        ┌───────┴────────┐
        ▼                ▼
┌──────────────┐   ┌─────────────────┐
│   Console    │   │  Log Viewer UI  │
│ (F12 tools)  │   │  (planned)      │
└──────────────┘   └─────────────────┘
```

### Data Model

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  timestamp: number       // Performance.now() for precision
  level: LogLevel
  component: string       // Source component name
  message: string         // Human-readable message
  data?: any              // Optional structured context
}

interface LoggerService {
  // Logging methods
  debug(component: string, message: string, data?: any): void
  info(component: string, message: string, data?: any): void
  warn(component: string, message: string, data?: any): void
  error(component: string, message: string, data?: any): void

  // Configuration
  setMinLevel(level: LogLevel): void
  getMinLevel(): LogLevel

  // History management
  getHistory(): LogEntry[]
  clearHistory(): void
  dump(): void  // Pretty-print to console
}
```

### Log Levels

| Level | Value | Usage | Example |
|-------|-------|-------|---------|
| `debug` | 0 | Verbose development info | "Loading top concepts with offset 200" |
| `info` | 1 | Important state changes | "Scheme loaded: Albania Thesaurus" |
| `warn` | 2 | Recoverable issues | "Fallback to default language" |
| `error` | 3 | Failures requiring attention | "Failed to load concept: network error" |

**Filtering:** Only log levels >= configured minimum are logged and stored.

### Usage Example

```typescript
import { logger } from '@/services'

// In component setup or method
export default {
  name: 'ConceptTree',
  setup() {
    const loadTopConcepts = async () => {
      logger.debug('ConceptTree', 'Loading top concepts', {
        scheme: schemeStore.current?.uri,
        offset: 0,
        limit: 200
      })

      try {
        const concepts = await sparql.queryTopConcepts(...)
        logger.info('ConceptTree', 'Top concepts loaded', {
          count: concepts.length
        })
      } catch (error) {
        logger.error('ConceptTree', 'Failed to load concepts', {
          error: error.message,
          stack: error.stack
        })
      }
    }

    return { loadTopConcepts }
  }
}
```

**Naming Convention:**
- Use component name as first parameter
- Messages are short descriptions (not full sentences)
- Include relevant context in data object

### Implementation Details

**Log History Buffer:**
```typescript
class Logger {
  private history: LogEntry[] = []
  private maxHistory = 1000

  private addToHistory(entry: LogEntry): void {
    this.history.push(entry)
    if (this.history.length > this.maxHistory) {
      this.history.shift()  // Remove oldest
    }
  }
}
```

**Minimum Level Filtering:**
```typescript
private minLevel: LogLevel = 'info'  // Default

debug(component: string, message: string, data?: any): void {
  if (this.shouldLog('debug')) {
    const entry: LogEntry = {
      timestamp: performance.now(),
      level: 'debug',
      component,
      message,
      data
    }
    this.addToHistory(entry)
    console.debug(`[${component}]`, message, data ?? '')
  }
}

private shouldLog(level: LogLevel): boolean {
  const levels = { debug: 0, info: 1, warn: 2, error: 3 }
  return levels[level] >= levels[this.minLevel]
}
```

## Settings Integration

### Settings Store

The logger integrates with the settings store for persistence:

```typescript
interface SettingsState {
  // ... existing settings
  logLevel: LogLevel  // 'debug' | 'info' | 'warn' | 'error'
}
```

**Default:** `'info'` (shows info, warn, error; hides debug)

**Persistence:** Auto-saved to `localStorage: ae-skos-settings`

**Watcher:**
```typescript
watch(() => settings.logLevel, (level) => {
  logger.setMinLevel(level)
})
```

### Settings UI

Logger configuration in Settings dialog:

```
┌─────────────────────────────────────┐
│ Settings                            │
├─────────────────────────────────────┤
│ DEVELOPER                           │
│ ┌─────────────────────────────────┐ │
│ │ Log Level: [Info ▾]             │ │
│ │   ○ Debug (verbose)             │ │
│ │   ● Info (default)              │ │
│ │   ○ Warn (warnings only)        │ │
│ │   ○ Error (errors only)         │ │
│ │                                 │ │
│ │ Current logs: 247               │ │
│ │ [View Logs] [Clear Logs]        │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**UI Elements:**
- Dropdown select for log level
- Radio buttons showing current selection
- Log count display
- "View Logs" button (future: opens log viewer dialog)
- "Clear Logs" button (calls `logger.clearHistory()`)

## Browser Console Integration

### Global `__logger` Object

Exposed in browser console (F12) for debugging:

```javascript
// Available globally in development builds
window.__logger = logger

// Usage in console:
__logger.dump()         // Show all logs with formatting
__logger.getHistory()   // Get raw log array
__logger.clearHistory() // Clear all logs
```

**Security:** Only exposed in development mode (`import.meta.env.DEV`).

### Console Output Format

**During development:**
```
[ConceptTree] Loading top concepts { scheme: 'http://...', offset: 0 }
[ConceptTree] Top concepts loaded { count: 45 }
[SearchBox] Search executed { query: 'albania', results: 12 }
```

**Production:**
Only errors logged to console (configurable).

### Pretty-Print Dump

The `dump()` method provides formatted output:

```javascript
__logger.dump()

// Output:
╔══════════════════════════════════════════════════════════╗
║  Logger History (247 entries)                            ║
╠══════════════════════════════════════════════════════════╣

[00:01.234] DEBUG ConceptTree
  Loading top concepts
  { scheme: 'http://example.org/albania', offset: 0, limit: 200 }

[00:01.456] INFO ConceptTree
  Top concepts loaded
  { count: 45 }

[00:02.123] ERROR SearchBox
  Search failed
  { error: 'Network timeout', query: 'albania' }

╚══════════════════════════════════════════════════════════╝
```

**Format:**
- Timestamps relative to page load (MM:SS.mmm)
- Color-coded by level (if supported by console)
- Indented for readability
- JSON.stringify for data objects

### Usage Examples

```javascript
// Get all error logs
__logger.getHistory().filter(e => e.level === 'error')

// Count logs by component
const counts = {}
__logger.getHistory().forEach(e => {
  counts[e.component] = (counts[e.component] || 0) + 1
})
console.table(counts)

// Find slow operations (> 100ms)
const hist = __logger.getHistory()
for (let i = 1; i < hist.length; i++) {
  const delta = hist[i].timestamp - hist[i-1].timestamp
  if (delta > 100) {
    console.log(`Slow: ${hist[i-1].component} -> ${hist[i].component}: ${delta}ms`)
  }
}
```

## Error Handling Integration

### Global Vue Error Handler

Logger integrates with Vue's global error handler:

```typescript
// main.ts
app.config.errorHandler = (err, instance, info) => {
  logger.error('Vue', 'Unhandled error', {
    error: err.message,
    stack: err.stack,
    component: instance?.$options.name,
    info
  })

  // Still throw in development for stack trace
  if (import.meta.env.DEV) {
    throw err
  }
}
```

**Benefits:**
- All Vue errors logged automatically
- Component context captured
- Stack traces preserved in log history

## Implementation Files

| File | Purpose |
|------|---------|
| `services/logger.ts` | Logger service implementation |
| `stores/settings.ts` | Log level setting |
| `components/common/SettingsDialog.vue` | Settings UI |
| `main.ts` | Global logger exposure, Vue error handler |

## Related Specs

- [com02-StateManagement](../common/com02-StateManagement.md) - Settings store integration
- [com03-ErrorHandling](../common/com03-ErrorHandling.md) - Error handling patterns

## Future Enhancements

**Planned:**
- Log Viewer Dialog (view logs without F12 console)
- Export logs to JSON file
- Log filtering by component/level in UI
- Performance markers (measure time between log calls)
- Remote logging (send errors to analytics)

**Not Planned:**
- Log persistence across sessions (use browser's persistent console)
- Server-side logging (browser-only tool)
