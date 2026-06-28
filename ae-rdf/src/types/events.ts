/**
 * Event payloads for the event bus
 * @see /spec/common/com02-StateManagement.md
 *
 * ponytail: copied from ae-skos, trimmed to RDF events only.
 * Add browse events (type:selected, resource:selected) when T3/T4 land.
 */

import type { SPARQLEndpoint } from './endpoint'

export interface EventPayloads {
  /** User selected a different endpoint */
  'endpoint:changed': SPARQLEndpoint
}

export type EventName = keyof EventPayloads
