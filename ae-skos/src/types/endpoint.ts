/**
 * Endpoint Types - SPARQL endpoint configuration
 *
 * @see /spec/common/com01-EndpointManager.md
 */

export interface SPARQLEndpoint {
  id: string
  name: string
  url: string
  auth?: EndpointAuth
  analysis?: EndpointAnalysis
  selectedGraphs?: string[]
  languagePriorities?: string[]  // User-ordered language codes
  createdAt: string
  lastAccessedAt?: string
  accessCount: number
}

export interface EndpointAuth {
  type: 'none' | 'basic' | 'apikey' | 'bearer'
  credentials?: {
    username?: string
    password?: string
    apiKey?: string
    token?: string
    headerName?: string
  }
}

export interface DetectedLanguage {
  lang: string
  count: number
}

export interface EndpointAnalysis {
  // Named graphs
  supportsNamedGraphs: boolean | null  // null = not supported by endpoint, false = none, true = has graphs
  graphCount: number | null            // null = count failed, number = exact or estimated
  graphCountExact: boolean             // true = exact count, false = estimated (10000+)

  // Duplicates
  hasDuplicateTriples: boolean | null  // null = detection not supported

  // Languages (sorted by count descending)
  languages?: DetectedLanguage[]

  analyzedAt: string
}

export type EndpointStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
