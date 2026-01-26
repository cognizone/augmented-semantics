/**
 * Endpoint Status Utilities
 *
 * Provides configuration status calculation for SPARQL endpoints.
 * Used by EndpointManager and EndpointWizard components.
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import { isValidEndpointUrl } from '../services/security'
import type { SPARQLEndpoint } from '../types'

export type ConfigStatusType = 'success' | 'warning' | 'error' | 'neutral'

export interface ConfigStatus {
  status: ConfigStatusType
  label: string
}

export interface GetConfigStatusOptions {
  /**
   * Additional language count to consider (e.g., from wizard priorities state)
   * Used in wizard where priorities may not yet be saved to endpoint
   */
  additionalLanguageCount?: number
}

/**
 * Calculate the configuration status for an endpoint.
 * Returns status and label for display in status badges.
 *
 * Status progression:
 * - neutral: Not configured (no URL)
 * - error: Invalid URL, connection failed, no SKOS content
 * - warning: Testing in progress, CORS blocked, analysis pending, no languages
 * - success: Fully configured and ready
 */
export function getConfigStatus(
  endpoint: SPARQLEndpoint | null | undefined,
  options: GetConfigStatusOptions = {}
): ConfigStatus {
  // No endpoint or empty URL
  if (!endpoint?.url?.trim()) {
    return { status: 'neutral', label: 'Not configured' }
  }

  // Invalid URL format
  if (!isValidEndpointUrl(endpoint.url)) {
    return { status: 'error', label: 'Invalid URL' }
  }

  const hasAnalysis = !!endpoint.analysis
  const analysisHasSkos = endpoint.analysis?.hasSkosContent

  // Calculate language count from various sources
  const endpointLanguageCount = (endpoint.languagePriorities?.length ?? 0)
    + (endpoint.analysis?.languages?.length ?? 0)
  const languageCount = Math.max(
    endpointLanguageCount,
    options.additionalLanguageCount ?? 0
  )
  const hasLanguages = languageCount > 0

  // Testing in progress
  if (endpoint.lastTestStatus === 'testing') {
    return { status: 'warning', label: 'Testing...' }
  }

  // No SKOS content detected
  if (analysisHasSkos === false) {
    return { status: 'error', label: 'No SKOS content' }
  }

  // CORS blocked (specific error code)
  if (endpoint.lastTestErrorCode === 'CORS_BLOCKED') {
    return { status: 'warning', label: 'CORS blocked' }
  }

  // Connection failed
  if (endpoint.lastTestStatus === 'error') {
    return { status: 'error', label: 'Connection failed' }
  }

  // Analysis not yet run
  if (!hasAnalysis) {
    return { status: 'warning', label: 'Analysis pending' }
  }

  // No languages detected
  if (!hasLanguages) {
    return { status: 'warning', label: 'No languages detected' }
  }

  // CORS issue detected during curation (not blocking, but noteworthy)
  if (endpoint.analysis?.cors === false) {
    return { status: 'warning', label: 'CORS issue' }
  }

  // All checks passed
  return { status: 'success', label: 'Configuration complete' }
}
