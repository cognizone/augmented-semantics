/**
 * useConceptNavigation - Concept and scheme navigation logic
 *
 * Provides navigation functions for moving between concepts and schemes,
 * with handling for both local and external resources.
 *
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import { useConceptStore, useSchemeStore } from '../stores'
import type { ConceptRef } from '../types'

export function useConceptNavigation(emit: (event: 'selectConcept', uri: string) => void) {
  const conceptStore = useConceptStore()
  const schemeStore = useSchemeStore()

  /**
   * Navigate to a concept by emitting selection event
   * @param ref - The concept reference to navigate to
   */
  function navigateTo(ref: ConceptRef): void {
    emit('selectConcept', ref.uri)
  }

  /**
   * Check if a scheme exists in the current endpoint
   * @param uri - The scheme URI to check
   * @returns true if the scheme is available locally
   */
  function isLocalScheme(uri: string): boolean {
    return schemeStore.schemes.some(s => s.uri === uri)
  }

  /**
   * Navigate to a scheme (select it and show its details)
   * @param ref - The scheme reference to navigate to
   */
  function navigateToScheme(ref: ConceptRef): void {
    schemeStore.selectScheme(ref.uri) // Switch to this scheme
    conceptStore.selectConcept(ref.uri) // Select scheme URI to show its details
  }

  /**
   * Handle scheme click - navigate if local, open external otherwise
   * @param ref - The scheme reference that was clicked
   */
  function handleSchemeClick(ref: ConceptRef): void {
    if (isLocalScheme(ref.uri)) {
      navigateToScheme(ref)
    } else {
      openExternal(ref.uri)
    }
  }

  /**
   * Open an external link in a new tab
   * @param uri - The URI to open
   */
  function openExternal(uri: string): void {
    window.open(uri, '_blank')
  }

  return {
    navigateTo,
    isLocalScheme,
    navigateToScheme,
    handleSchemeClick,
    openExternal
  }
}
