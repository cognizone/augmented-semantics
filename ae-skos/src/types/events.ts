/**
 * Event payloads for the event bus
 * @see /spec/common/com02-StateManagement.md
 */

import type { SPARQLEndpoint, ConceptScheme, ConceptNode } from './index'

export interface EventPayloads {
  // === Endpoint Events ===

  /** User selected a different endpoint */
  'endpoint:changed': SPARQLEndpoint

  // === Scheme Events ===

  /** User selected a scheme (or null for all schemes) */
  'scheme:selected': ConceptScheme | null

  // === Concept Events ===

  /** Concept selection is about to happen (for pre-selection prep) */
  'concept:selecting': string

  /** Concept was selected (URI set in store) */
  'concept:selected': string | null

  /** Concept has been revealed in the tree (scroll complete) */
  'concept:revealed': string

  // === Tree Events ===

  /** Tree is loading top concepts */
  'tree:loading': void

  /** Tree finished loading top concepts */
  'tree:loaded': ConceptNode[]
}

export type EventName = keyof EventPayloads
