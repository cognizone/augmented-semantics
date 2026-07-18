/**
 * SPARQL panel query tabs — pure storage/model helpers (no Vue), so the
 * persistence + legacy-migration logic is unit-testable in isolation.
 *
 * Tabs are stored per endpoint URL under TABS_KEY as { [url]: { tabs, activeId } }.
 * The old single-query store (LEGACY_KEY: { [url]: query }) is migrated into a
 * first tab the first time an endpoint has no saved tabs.
 */
export interface QueryTab {
  id: string
  name: string
  query: string
}

const LEGACY_KEY = 'ae-rdf-sparql'
const TABS_KEY = 'ae-rdf-sparql-tabs'

/** The old single persisted query for an endpoint, if any (for migration). */
export function legacyQuery(url: string | undefined): string | null {
  if (!url) return null
  try {
    const map = JSON.parse(localStorage.getItem(LEGACY_KEY) || '{}') as Record<string, unknown>
    return typeof map[url] === 'string' ? (map[url] as string) : null
  } catch {
    return null
  }
}

/** Saved tabs for an endpoint, sanitized; null when none/invalid. */
export function loadTabs(url: string | undefined): { tabs: QueryTab[]; activeId: string } | null {
  if (!url) return null
  try {
    const entry = (JSON.parse(localStorage.getItem(TABS_KEY) || '{}') as Record<string, unknown>)[url] as
      { tabs?: unknown; activeId?: unknown } | undefined
    if (!entry || !Array.isArray(entry.tabs)) return null
    const tabs = entry.tabs
      .filter((t): t is QueryTab => !!t && typeof (t as QueryTab).id === 'string' && typeof (t as QueryTab).query === 'string')
      .map(t => ({ id: t.id, name: typeof t.name === 'string' && t.name.trim() ? t.name : 'Query', query: t.query }))
    if (!tabs.length) return null
    const activeId = typeof entry.activeId === 'string' && tabs.some(t => t.id === entry.activeId)
      ? entry.activeId
      : tabs[0]!.id
    return { tabs, activeId }
  } catch {
    return null
  }
}

/** Persist an endpoint's tabs (merged into the per-URL map). No-op without a url. */
export function persistTabs(url: string | undefined, tabs: QueryTab[], activeId: string): void {
  if (!url) return
  const map = (() => {
    try { return JSON.parse(localStorage.getItem(TABS_KEY) || '{}') as Record<string, unknown> } catch { return {} }
  })()
  map[url] = { tabs, activeId }
  localStorage.setItem(TABS_KEY, JSON.stringify(map))
}

export function makeTab(name: string, query: string): QueryTab {
  return { id: crypto.randomUUID(), name, query }
}

/** The next free "Query N" name given the existing tabs. */
export function nextName(existing: QueryTab[]): string {
  const names = new Set(existing.map(t => t.name))
  let n = existing.length + 1
  while (names.has(`Query ${n}`)) n++
  return `Query ${n}`
}

/**
 * Initial tabs for an endpoint: saved tabs, else a migrated legacy query, else a
 * single default-query tab. A handoff query ("Open in SPARQL") is appended as a
 * new, active tab.
 */
export function initTabs(
  url: string | undefined,
  defaultQuery: string,
  handoff?: string | null,
): { tabs: QueryTab[]; activeId: string } {
  const stored = loadTabs(url)
  let tabs = stored?.tabs ?? [makeTab('Query 1', legacyQuery(url) ?? defaultQuery)]
  let activeId = stored?.activeId ?? tabs[0]!.id
  if (handoff) {
    const t = makeTab(nextName(tabs), handoff)
    tabs = [...tabs, t]
    activeId = t.id
  }
  return { tabs, activeId }
}
