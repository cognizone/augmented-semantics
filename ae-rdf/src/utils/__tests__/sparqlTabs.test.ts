import { describe, it, expect, beforeEach } from 'vitest'
import { initTabs, persistTabs, loadTabs, nextName, type QueryTab } from '../sparqlTabs'

const URL = 'http://x/sparql'
const DEF = 'SELECT * WHERE { ?s ?p ?o } LIMIT 25'

describe('sparqlTabs', () => {
  beforeEach(() => localStorage.clear())

  it('fresh endpoint → a single default-query tab', () => {
    const { tabs, activeId } = initTabs(URL, DEF)
    expect(tabs).toHaveLength(1)
    expect(tabs[0]!.query).toBe(DEF)
    expect(tabs[0]!.name).toBe('Query 1')
    expect(activeId).toBe(tabs[0]!.id)
  })

  it('migrates a legacy single query into the first tab', () => {
    localStorage.setItem('ae-rdf-sparql', JSON.stringify({ [URL]: 'ASK { ?s ?p ?o }' }))
    const { tabs } = initTabs(URL, DEF)
    expect(tabs).toHaveLength(1)
    expect(tabs[0]!.query).toBe('ASK { ?s ?p ?o }')
  })

  it('persist → load round-trips tabs and the active id', () => {
    const tabs: QueryTab[] = [
      { id: 'a', name: 'One', query: 'Q1' },
      { id: 'b', name: 'Two', query: 'Q2' },
    ]
    persistTabs(URL, tabs, 'b')
    const loaded = loadTabs(URL)
    expect(loaded).toEqual({ tabs, activeId: 'b' })
  })

  it('saved tabs win over the default; unknown activeId falls back to the first', () => {
    persistTabs(URL, [{ id: 'a', name: 'One', query: 'Q1' }], 'gone')
    const { tabs, activeId } = initTabs(URL, DEF)
    expect(tabs).toHaveLength(1)
    expect(tabs[0]!.query).toBe('Q1')
    expect(activeId).toBe('a')
  })

  it('a handoff query is appended as a new active tab', () => {
    persistTabs(URL, [{ id: 'a', name: 'One', query: 'Q1' }], 'a')
    const { tabs, activeId } = initTabs(URL, DEF, 'SELECT ?x {}')
    expect(tabs).toHaveLength(2)
    expect(tabs[1]!.query).toBe('SELECT ?x {}')
    expect(activeId).toBe(tabs[1]!.id)
  })

  it('sanitizes malformed stored entries (drops bad tabs, keeps valid)', () => {
    localStorage.setItem('ae-rdf-sparql-tabs', JSON.stringify({
      [URL]: { tabs: [{ id: 'a', query: 'Q1' }, { id: 5 }, null, { name: 'x' }], activeId: 'a' },
    }))
    const loaded = loadTabs(URL)
    expect(loaded!.tabs).toHaveLength(1)
    expect(loaded!.tabs[0]).toEqual({ id: 'a', name: 'Query', query: 'Q1' }) // missing name → default
  })

  it('nextName skips names already in use', () => {
    expect(nextName([{ id: 'a', name: 'Query 1', query: '' }])).toBe('Query 2')
    expect(nextName([{ id: 'a', name: 'Query 2', query: '' }])).toBe('Query 3') // len+1 collides → bump
  })

  it('no url → no persist, null load', () => {
    persistTabs(undefined, [{ id: 'a', name: 'One', query: 'Q' }], 'a')
    expect(loadTabs(undefined)).toBeNull()
  })
})
