/**
 * useOrphanConcepts Tests
 *
 * Tests for orphan concept calculation functions (fast and slow methods)
 * @see /spec/ae-skos/sko02-SchemeSelector.md
 * @see /spec/ae-skos/sko03-ConceptTree.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { calculateOrphanConcepts, calculateOrphanConceptsFast, calculateOrphanCollections } from '../useOrphanConcepts'
import type { SPARQLEndpoint } from '../../types'
import type { ProgressState } from '../useOrphanProgress'

// Mock the SPARQL execution module
vi.mock('../../services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services')>()
  return {
    ...actual,
    executeSparql: vi.fn(),
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }
})

// Mock the query builders
vi.mock('../useOrphanQueries', () => ({
  buildAllConceptsQuery: vi.fn((pageSize: number, offset: number) =>
    `SELECT ?concept WHERE { ?concept a skos:Concept } LIMIT ${pageSize} OFFSET ${offset}`
  ),
  buildOrphanExclusionQueries: vi.fn((endpoint: SPARQLEndpoint, pageSize: number, offset: number) => {
    const rel = endpoint.analysis?.relationships
    if (!rel) return []

    const queries = []
    if (rel.hasInScheme) {
      queries.push({
        name: 'inScheme',
        query: `SELECT ?concept WHERE { ?concept skos:inScheme ?s } LIMIT ${pageSize} OFFSET ${offset}`
      })
    }
    if (rel.hasTopConceptOf) {
      queries.push({
        name: 'topConceptOf',
        query: `SELECT ?concept WHERE { ?concept skos:topConceptOf ?s } LIMIT ${pageSize} OFFSET ${offset}`
      })
    }
    return queries
  }),
  buildSingleOrphanQuery: vi.fn((endpoint: SPARQLEndpoint, pageSize: number, offset: number) => {
    const rel = endpoint.analysis?.relationships
    if (!rel || (!rel.hasInScheme && !rel.hasTopConceptOf)) return null

    return `SELECT ?concept WHERE { ?concept a skos:Concept . FILTER NOT EXISTS { ... } } LIMIT ${pageSize} OFFSET ${offset}`
  }),
  buildOrphanCollectionsQuery: vi.fn((endpoint: SPARQLEndpoint, pageSize: number, offset: number) => {
    const rel = endpoint.analysis?.relationships
    if (!rel || (!rel.hasInScheme && !rel.hasTopConceptOf)) return null

    return `SELECT ?collection WHERE { ?collection a skos:Collection . FILTER NOT EXISTS { ... } } LIMIT ${pageSize} OFFSET ${offset}`
  }),
}))

import { executeSparql } from '../../services'

// Helper to create mock endpoint
function mockEndpoint(relationships: Partial<Record<string, boolean>>, totalConcepts = 100): SPARQLEndpoint {
  return {
    id: 'test-endpoint',
    name: 'Test Endpoint',
    url: 'http://example.org/sparql',
    analysis: {
      hasSkosContent: true,
      supportsNamedGraphs: false,
      skosGraphCount: 0,
      languages: [],
      analyzedAt: new Date().toISOString(),
      totalConcepts,
      relationships: {
        hasInScheme: false,
        hasTopConceptOf: false,
        hasHasTopConcept: false,
        hasBroader: false,
        hasNarrower: false,
        hasBroaderTransitive: false,
        hasNarrowerTransitive: false,
        ...relationships,
      },
    },
    createdAt: new Date().toISOString(),
    accessCount: 0,
  } as SPARQLEndpoint
}

// Helper to create SPARQL result bindings for concepts
function createBindings(uris: string[]) {
  return {
    results: {
      bindings: uris.map(uri => ({ concept: { value: uri } })),
    },
  }
}

// Helper to create SPARQL result bindings for collections
function createCollectionBindings(uris: string[]) {
  return {
    results: {
      bindings: uris.map(uri => ({ collection: { value: uri } })),
    },
  }
}

describe('useOrphanConcepts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('calculateOrphanConceptsFast', () => {
    it('throws error if relationships not available', async () => {
      const endpoint: SPARQLEndpoint = {
        id: 'test',
        name: 'Test',
        url: 'http://example.org/sparql',
        createdAt: new Date().toISOString(),
        accessCount: 0,
      } as SPARQLEndpoint

      await expect(calculateOrphanConceptsFast(endpoint)).rejects.toThrow(
        'Cannot build single orphan query'
      )
    })

    it('throws error if no relationships exist', async () => {
      const endpoint = mockEndpoint({})

      await expect(calculateOrphanConceptsFast(endpoint)).rejects.toThrow(
        'Cannot build single orphan query'
      )
    })

    it('builds query using endpoint capabilities', async () => {
      const endpoint = mockEndpoint({ hasInScheme: true }, 10)
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>

      // Mock single page of results
      mockExecuteSparql.mockResolvedValueOnce(createBindings([
        'http://example.org/concept1',
        'http://example.org/concept2',
      ]))

      const result = await calculateOrphanConceptsFast(endpoint)

      expect(result).toHaveLength(2)
      expect(mockExecuteSparql).toHaveBeenCalledTimes(1)
    })

    it('paginates with PAGE_SIZE=5000', async () => {
      const endpoint = mockEndpoint({ hasInScheme: true }, 10000)
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>

      // Create array with 5001 items (triggers pagination)
      const page1Uris = Array.from({ length: 5001 }, (_, i) =>
        `http://example.org/concept${i}`
      )
      const page2Uris = [
        'http://example.org/concept5001',
        'http://example.org/concept5002',
      ]

      mockExecuteSparql
        .mockResolvedValueOnce(createBindings(page1Uris)) // First page (5001 items)
        .mockResolvedValueOnce(createBindings(page2Uris)) // Second page

      const result = await calculateOrphanConceptsFast(endpoint)

      expect(result).toHaveLength(5002) // 5000 from page 1 + 2 from page 2
      expect(mockExecuteSparql).toHaveBeenCalledTimes(2)
    })

    it('detects more results with +1 pattern', async () => {
      const endpoint = mockEndpoint({ hasInScheme: true }, 5001)
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>

      // Exactly 5001 items means we hit PAGE_SIZE + 1
      const page1Uris = Array.from({ length: 5001 }, (_, i) =>
        `http://example.org/concept${i}`
      )

      mockExecuteSparql
        .mockResolvedValueOnce(createBindings(page1Uris))
        .mockResolvedValueOnce(createBindings([])) // Empty second page

      const result = await calculateOrphanConceptsFast(endpoint)

      expect(result).toHaveLength(5000) // +1 item was removed
      expect(mockExecuteSparql).toHaveBeenCalledTimes(2)
    })

    it('sorts results alphabetically', async () => {
      const endpoint = mockEndpoint({ hasInScheme: true })
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>

      mockExecuteSparql.mockResolvedValueOnce(createBindings([
        'http://example.org/concept3',
        'http://example.org/concept1',
        'http://example.org/concept2',
      ]))

      const result = await calculateOrphanConceptsFast(endpoint)

      expect(result).toEqual([
        'http://example.org/concept1',
        'http://example.org/concept2',
        'http://example.org/concept3',
      ])
    })

    it('reports progress via callback', async () => {
      const endpoint = mockEndpoint({ hasInScheme: true }, 100)
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>
      const progressUpdates: ProgressState[] = []

      mockExecuteSparql.mockResolvedValueOnce(createBindings([
        'http://example.org/concept1',
        'http://example.org/concept2',
      ]))

      await calculateOrphanConceptsFast(endpoint, (progress) => {
        progressUpdates.push({ ...progress })
      })

      expect(progressUpdates.length).toBeGreaterThan(0)
      expect(progressUpdates.some(p => p.phase === 'running-exclusions')).toBe(true)
      expect(progressUpdates.some(p => p.phase === 'complete')).toBe(true)
    })

    it('reports phase: running-exclusions', async () => {
      const endpoint = mockEndpoint({ hasInScheme: true })
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>
      let hasRunningExclusionsPhase = false

      mockExecuteSparql.mockResolvedValueOnce(createBindings([]))

      await calculateOrphanConceptsFast(endpoint, (progress) => {
        if (progress.phase === 'running-exclusions') {
          hasRunningExclusionsPhase = true
        }
      })

      expect(hasRunningExclusionsPhase).toBe(true)
    })

    it('reports phase: complete', async () => {
      const endpoint = mockEndpoint({ hasInScheme: true })
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>
      let completeProgress: ProgressState | null = null

      mockExecuteSparql.mockResolvedValueOnce(createBindings(['http://example.org/concept1']))

      await calculateOrphanConceptsFast(endpoint, (progress) => {
        if (progress.phase === 'complete') {
          completeProgress = progress
        }
      })

      expect(completeProgress).not.toBeNull()
      expect(completeProgress?.phase).toBe('complete')
      expect(completeProgress?.remainingCandidates).toBe(1)
    })

    it('includes duration in completed query result', async () => {
      const endpoint = mockEndpoint({ hasInScheme: true })
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>
      let finalProgress: ProgressState | null = null

      mockExecuteSparql.mockResolvedValueOnce(createBindings([]))

      await calculateOrphanConceptsFast(endpoint, (progress) => {
        if (progress.phase === 'complete') {
          finalProgress = progress
        }
      })

      expect(finalProgress?.completedQueries).toHaveLength(1)
      expect(finalProgress?.completedQueries[0].duration).toBeGreaterThanOrEqual(0)
    })

    it('handles empty results', async () => {
      const endpoint = mockEndpoint({ hasInScheme: true })
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>

      mockExecuteSparql.mockResolvedValueOnce(createBindings([]))

      const result = await calculateOrphanConceptsFast(endpoint)

      expect(result).toEqual([])
    })

    it('handles single page of results', async () => {
      const endpoint = mockEndpoint({ hasInScheme: true })
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>

      mockExecuteSparql.mockResolvedValueOnce(createBindings([
        'http://example.org/concept1',
        'http://example.org/concept2',
        'http://example.org/concept3',
      ]))

      const result = await calculateOrphanConceptsFast(endpoint)

      expect(result).toHaveLength(3)
      expect(mockExecuteSparql).toHaveBeenCalledTimes(1)
    })
  })

  describe('calculateOrphanConcepts (multi-query)', () => {
    it('fetches all concepts first', async () => {
      const endpoint = mockEndpoint({ hasInScheme: true }, 10)
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>

      // Mock: all concepts
      mockExecuteSparql.mockResolvedValueOnce(createBindings([
        'http://example.org/concept1',
        'http://example.org/concept2',
        'http://example.org/concept3',
      ]))

      // Mock: inScheme exclusion
      mockExecuteSparql.mockResolvedValueOnce(createBindings([
        'http://example.org/concept1',
      ]))

      const result = await calculateOrphanConcepts(endpoint)

      // First query should be all concepts
      expect(mockExecuteSparql).toHaveBeenCalled()
      expect(result).toHaveLength(2) // 3 total - 1 excluded
    })

    it('runs exclusion queries in order', async () => {
      const endpoint = mockEndpoint({
        hasInScheme: true,
        hasTopConceptOf: true,
      }, 10)
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>

      // Mock: all concepts (3)
      mockExecuteSparql.mockResolvedValueOnce(createBindings([
        'http://example.org/concept1',
        'http://example.org/concept2',
        'http://example.org/concept3',
      ]))

      // Mock: inScheme exclusion (excludes concept1)
      mockExecuteSparql.mockResolvedValueOnce(createBindings([
        'http://example.org/concept1',
      ]))

      // Mock: topConceptOf exclusion (excludes concept2)
      mockExecuteSparql.mockResolvedValueOnce(createBindings([
        'http://example.org/concept2',
      ]))

      const result = await calculateOrphanConcepts(endpoint)

      expect(result).toHaveLength(1)
      expect(result).toContain('http://example.org/concept3')
    })

    it('skips queries when no candidates remain', async () => {
      const endpoint = mockEndpoint({
        hasInScheme: true,
        hasTopConceptOf: true,
      }, 10)
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>
      let progressUpdates: ProgressState[] = []

      // Mock: all concepts (2)
      mockExecuteSparql.mockResolvedValueOnce(createBindings([
        'http://example.org/concept1',
        'http://example.org/concept2',
      ]))

      // Mock: inScheme exclusion (excludes all)
      mockExecuteSparql.mockResolvedValueOnce(createBindings([
        'http://example.org/concept1',
        'http://example.org/concept2',
      ]))

      await calculateOrphanConcepts(endpoint, (progress) => {
        progressUpdates.push({ ...progress })
      })

      // Second query should be skipped
      const finalProgress = progressUpdates.find(p => p.phase === 'complete')
      expect(finalProgress?.skippedQueries).toContain('topConceptOf')
    })

    it('calculates set difference correctly', async () => {
      const endpoint = mockEndpoint({ hasInScheme: true }, 10)
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>

      // All concepts
      mockExecuteSparql.mockResolvedValueOnce(createBindings([
        'http://example.org/concept1',
        'http://example.org/concept2',
        'http://example.org/concept3',
        'http://example.org/concept4',
      ]))

      // Excluded
      mockExecuteSparql.mockResolvedValueOnce(createBindings([
        'http://example.org/concept2',
        'http://example.org/concept4',
      ]))

      const result = await calculateOrphanConcepts(endpoint)

      expect(result).toHaveLength(2)
      expect(result).toContain('http://example.org/concept1')
      expect(result).toContain('http://example.org/concept3')
      expect(result).not.toContain('http://example.org/concept2')
      expect(result).not.toContain('http://example.org/concept4')
    })

    it('reports phase: fetching-all', async () => {
      const endpoint = mockEndpoint({ hasInScheme: true }, 10)
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>
      let hasFetchingAllPhase = false

      mockExecuteSparql.mockResolvedValue(createBindings([]))

      await calculateOrphanConcepts(endpoint, (progress) => {
        if (progress.phase === 'fetching-all') {
          hasFetchingAllPhase = true
        }
      })

      expect(hasFetchingAllPhase).toBe(true)
    })

    it('reports phase: running-exclusions', async () => {
      const endpoint = mockEndpoint({ hasInScheme: true }, 10)
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>
      let hasRunningExclusionsPhase = false

      mockExecuteSparql.mockResolvedValue(createBindings([]))

      await calculateOrphanConcepts(endpoint, (progress) => {
        if (progress.phase === 'running-exclusions') {
          hasRunningExclusionsPhase = true
        }
      })

      expect(hasRunningExclusionsPhase).toBe(true)
    })

    it('reports phase: calculating', async () => {
      const endpoint = mockEndpoint({ hasInScheme: true }, 10)
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>
      let hasCalculatingPhase = false

      mockExecuteSparql.mockResolvedValue(createBindings([]))

      await calculateOrphanConcepts(endpoint, (progress) => {
        if (progress.phase === 'calculating') {
          hasCalculatingPhase = true
        }
      })

      expect(hasCalculatingPhase).toBe(true)
    })

    it('reports phase: complete', async () => {
      const endpoint = mockEndpoint({ hasInScheme: true }, 10)
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>
      let completeProgress: ProgressState | null = null

      mockExecuteSparql.mockResolvedValue(createBindings([]))

      await calculateOrphanConcepts(endpoint, (progress) => {
        if (progress.phase === 'complete') {
          completeProgress = progress
        }
      })

      expect(completeProgress).not.toBeNull()
      expect(completeProgress?.phase).toBe('complete')
    })

    it('includes query metrics in progress', async () => {
      const endpoint = mockEndpoint({ hasInScheme: true }, 10)
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>
      let runningExclusionsProgress: ProgressState | null = null

      // Return some concepts for fetchAllConcepts, then empty for exclusion queries
      mockExecuteSparql
        .mockResolvedValueOnce(createBindings([
          'http://example.org/concept1',
          'http://example.org/concept2',
        ]))
        .mockResolvedValue(createBindings([]))

      await calculateOrphanConcepts(endpoint, (progress) => {
        if (progress.phase === 'running-exclusions' && progress.completedQueries.length > 0) {
          runningExclusionsProgress = progress
        }
      })

      expect(runningExclusionsProgress).not.toBeNull()
      expect(runningExclusionsProgress?.completedQueries[0]).toHaveProperty('name')
      expect(runningExclusionsProgress?.completedQueries[0]).toHaveProperty('excludedCount')
      expect(runningExclusionsProgress?.completedQueries[0]).toHaveProperty('duration')
    })

    it('stops early when all concepts excluded', async () => {
      const endpoint = mockEndpoint({
        hasInScheme: true,
        hasTopConceptOf: true,
      }, 10)
      const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>

      // All concepts
      mockExecuteSparql.mockResolvedValueOnce(createBindings([
        'http://example.org/concept1',
        'http://example.org/concept2',
      ]))

      // Excludes all
      mockExecuteSparql.mockResolvedValueOnce(createBindings([
        'http://example.org/concept1',
        'http://example.org/concept2',
      ]))

      const result = await calculateOrphanConcepts(endpoint)

      // Should only call executeSparql twice (all concepts + first exclusion)
      // Second exclusion query should be skipped
      expect(mockExecuteSparql).toHaveBeenCalledTimes(2)
      expect(result).toEqual([])
    })
  })

  describe('calculateOrphanCollections', () => {
    describe('error handling', () => {
      it('returns empty array when endpoint has no analysis', async () => {
        const endpoint: SPARQLEndpoint = {
          id: 'test',
          name: 'Test',
          url: 'http://example.org/sparql',
          createdAt: new Date().toISOString(),
          accessCount: 0,
        } as SPARQLEndpoint

        const result = await calculateOrphanCollections(endpoint)

        expect(result).toEqual([])
      })

      it('returns empty array when query cannot be built (no relationships)', async () => {
        const endpoint = mockEndpoint({})

        const result = await calculateOrphanCollections(endpoint)

        expect(result).toEqual([])
      })
    })

    describe('query execution & pagination', () => {
      it('paginates through results using PAGE_SIZE', async () => {
        const endpoint = mockEndpoint({ hasInScheme: true })
        const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>

        // Create array with 5001 items (triggers pagination)
        const page1Uris = Array.from({ length: 5001 }, (_, i) =>
          `http://example.org/collection${i}`
        )
        const page2Uris = [
          'http://example.org/collection5001',
          'http://example.org/collection5002',
        ]

        mockExecuteSparql
          .mockResolvedValueOnce(createCollectionBindings(page1Uris)) // First page (5001 items)
          .mockResolvedValueOnce(createCollectionBindings(page2Uris)) // Second page

        const result = await calculateOrphanCollections(endpoint)

        expect(result).toHaveLength(5002) // 5000 from page 1 + 2 from page 2
        expect(mockExecuteSparql).toHaveBeenCalledTimes(2)
      })

      it('uses +1 detection pattern for hasMore', async () => {
        const endpoint = mockEndpoint({ hasInScheme: true })
        const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>

        // Exactly 5001 items means we hit PAGE_SIZE + 1
        const page1Uris = Array.from({ length: 5001 }, (_, i) =>
          `http://example.org/collection${i}`
        )

        mockExecuteSparql
          .mockResolvedValueOnce(createCollectionBindings(page1Uris))
          .mockResolvedValueOnce(createCollectionBindings([])) // Empty second page

        const result = await calculateOrphanCollections(endpoint)

        expect(result).toHaveLength(5000) // +1 item was removed
        expect(mockExecuteSparql).toHaveBeenCalledTimes(2)
      })

      it('sorts results alphabetically', async () => {
        const endpoint = mockEndpoint({ hasInScheme: true })
        const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>

        mockExecuteSparql.mockResolvedValueOnce(createCollectionBindings([
          'http://example.org/collection3',
          'http://example.org/collection1',
          'http://example.org/collection2',
        ]))

        const result = await calculateOrphanCollections(endpoint)

        expect(result).toEqual([
          'http://example.org/collection1',
          'http://example.org/collection2',
          'http://example.org/collection3',
        ])
      })
    })

    describe('progress callback', () => {
      it('reports running phase with count updates', async () => {
        const endpoint = mockEndpoint({ hasInScheme: true })
        const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>
        const progressUpdates: { phase: 'running' | 'complete'; found: number }[] = []

        mockExecuteSparql.mockResolvedValueOnce(createCollectionBindings([
          'http://example.org/collection1',
          'http://example.org/collection2',
        ]))

        await calculateOrphanCollections(endpoint, (phase, found) => {
          progressUpdates.push({ phase, found })
        })

        expect(progressUpdates.some(p => p.phase === 'running')).toBe(true)
      })

      it('reports complete phase with final count', async () => {
        const endpoint = mockEndpoint({ hasInScheme: true })
        const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>
        let completeProgress: { phase: 'running' | 'complete'; found: number } | null = null

        mockExecuteSparql.mockResolvedValueOnce(createCollectionBindings([
          'http://example.org/collection1',
        ]))

        await calculateOrphanCollections(endpoint, (phase, found) => {
          if (phase === 'complete') {
            completeProgress = { phase, found }
          }
        })

        expect(completeProgress).not.toBeNull()
        expect(completeProgress?.phase).toBe('complete')
        expect(completeProgress?.found).toBe(1)
      })
    })

    describe('integration', () => {
      it('returns empty array when no orphan collections found', async () => {
        const endpoint = mockEndpoint({ hasInScheme: true })
        const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>

        mockExecuteSparql.mockResolvedValueOnce(createCollectionBindings([]))

        const result = await calculateOrphanCollections(endpoint)

        expect(result).toEqual([])
      })

      it('returns correct URIs for orphan collections', async () => {
        const endpoint = mockEndpoint({ hasInScheme: true })
        const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>

        mockExecuteSparql.mockResolvedValueOnce(createCollectionBindings([
          'http://example.org/collection1',
          'http://example.org/collection2',
          'http://example.org/collection3',
        ]))

        const result = await calculateOrphanCollections(endpoint)

        expect(result).toHaveLength(3)
        expect(result).toContain('http://example.org/collection1')
        expect(result).toContain('http://example.org/collection2')
        expect(result).toContain('http://example.org/collection3')
      })

      it('handles single page of results', async () => {
        const endpoint = mockEndpoint({ hasInScheme: true })
        const mockExecuteSparql = executeSparql as ReturnType<typeof vi.fn>

        mockExecuteSparql.mockResolvedValueOnce(createCollectionBindings([
          'http://example.org/collection1',
          'http://example.org/collection2',
        ]))

        const result = await calculateOrphanCollections(endpoint)

        expect(result).toHaveLength(2)
        expect(mockExecuteSparql).toHaveBeenCalledTimes(1)
      })
    })
  })
})
