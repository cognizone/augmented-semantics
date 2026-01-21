/**
 * Orphan Progress Tracking
 *
 * Types and utilities for tracking progress during orphan concept and collection calculation.
 *
 * @see /spec/ae-skos/sko08-OrphanDetection.md
 */

export interface QueryResult {
  name: string
  excludedCount: number
  cumulativeExcluded: number
  remainingAfter: number
  duration: number
}

export interface OrphanProgress {
  phase: 'idle' | 'fetching-all' | 'running-exclusions' | 'calculating' | 'detecting-collections' | 'complete'
  totalConcepts: number
  fetchedConcepts: number         // Current fetched count (for Phase 1 batch progress)
  remainingCandidates: number
  completedQueries: QueryResult[]
  skippedQueries: string[]
  currentQueryName: string | null
  // Collection detection progress
  orphanCollections: number       // Number of orphan collections found
  collectionsPhase: 'idle' | 'running' | 'complete'
}

export type ProgressCallback = (progress: OrphanProgress) => void

export function createInitialProgress(): OrphanProgress {
  return {
    phase: 'idle',
    totalConcepts: 0,
    fetchedConcepts: 0,
    remainingCandidates: 0,
    completedQueries: [],
    skippedQueries: [],
    currentQueryName: null,
    orphanCollections: 0,
    collectionsPhase: 'idle',
  }
}
