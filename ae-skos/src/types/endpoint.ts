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

export interface EndpointAnalysis {
  hasNamedGraphs: boolean
  graphs?: string[]
  hasDuplicateTriples: boolean
  duplicateCount?: number
  analyzedAt: string
}

export interface LanguagePreferences {
  preferred: string
  fallback: string
  detected: string[]
  detectedAt?: string
}

export type EndpointStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
