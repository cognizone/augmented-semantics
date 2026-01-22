/**
 * Property Processor - Declarative SPARQL binding processing
 *
 * Replaces if/else chains with a data-driven approach for mapping
 * SPARQL bindings to detail objects.
 *
 * @see /spec/ae-skos/sko06-ConceptDetails.md
 */

import { PRED } from '../constants/predicates'
import type { LabelValue, NotationValue, ConceptRef } from '../types'

// =============================================================================
// Types
// =============================================================================

/**
 * Handler types for different property categories
 */
export type PropertyHandler =
  | { type: 'label'; target: string }                    // { value, lang } array
  | { type: 'notation'; target: string }                 // { value, datatype } array, dedupe
  | { type: 'ref'; target: string }                      // { uri } array, dedupe
  | { type: 'uri'; target: string }                      // string array, dedupe
  | { type: 'single'; target: string }                   // single string value
  | { type: 'singleUri'; target: string }                // single string, extract fragment if URI
  | { type: 'boolean'; target: string }                  // boolean from 'true'/'1'

/**
 * Property mapping: predicate URI → handler
 */
export type PropertyMapping = Record<string, PropertyHandler>

/**
 * SPARQL binding shape
 */
export interface SparqlBinding {
  property?: { value: string }
  value?: { value: string; 'xml:lang'?: string; datatype?: string }
  [key: string]: { value: string; 'xml:lang'?: string; datatype?: string } | undefined
}

// =============================================================================
// Property Mappings
// =============================================================================

/**
 * Concept property mapping
 */
export const CONCEPT_PROPERTY_MAP: PropertyMapping = {
  // Labels
  [PRED.prefLabel]: { type: 'label', target: 'prefLabels' },
  [PRED.altLabel]: { type: 'label', target: 'altLabels' },
  [PRED.hiddenLabel]: { type: 'label', target: 'hiddenLabels' },
  [PRED.label]: { type: 'label', target: 'rdfsLabels' },
  [PRED.dctTitle]: { type: 'label', target: 'dctTitles' },
  [PRED.dcTitle]: { type: 'label', target: 'dcTitles' },

  // Documentation
  [PRED.comment]: { type: 'label', target: 'comments' },
  [PRED.dctDescription]: { type: 'label', target: 'description' },
  [PRED.definition]: { type: 'label', target: 'definitions' },
  [PRED.scopeNote]: { type: 'label', target: 'scopeNotes' },
  [PRED.historyNote]: { type: 'label', target: 'historyNotes' },
  [PRED.changeNote]: { type: 'label', target: 'changeNotes' },
  [PRED.editorialNote]: { type: 'label', target: 'editorialNotes' },
  [PRED.note]: { type: 'label', target: 'notes' },
  [PRED.example]: { type: 'label', target: 'examples' },

  // Notation
  [PRED.notation]: { type: 'notation', target: 'notations' },

  // Hierarchy (refs)
  [PRED.broader]: { type: 'ref', target: 'broader' },
  [PRED.narrower]: { type: 'ref', target: 'narrower' },
  [PRED.related]: { type: 'ref', target: 'related' },
  [PRED.inScheme]: { type: 'ref', target: 'inScheme' },

  // Mappings (URIs)
  [PRED.exactMatch]: { type: 'uri', target: 'exactMatch' },
  [PRED.closeMatch]: { type: 'uri', target: 'closeMatch' },
  [PRED.broadMatch]: { type: 'uri', target: 'broadMatch' },
  [PRED.narrowMatch]: { type: 'uri', target: 'narrowMatch' },
  [PRED.relatedMatch]: { type: 'uri', target: 'relatedMatch' },

  // Metadata (URIs with dedupe)
  [PRED.dcIdentifier]: { type: 'uri', target: 'identifier' },
  [PRED.dctCreator]: { type: 'uri', target: 'creator' },
  [PRED.dctPublisher]: { type: 'uri', target: 'publisher' },
  [PRED.dctRights]: { type: 'uri', target: 'rights' },
  [PRED.dctLicense]: { type: 'uri', target: 'license' },
  [PRED.ccLicense]: { type: 'uri', target: 'ccLicense' },
  [PRED.seeAlso]: { type: 'uri', target: 'seeAlso' },

  // Metadata (single values)
  [PRED.dctCreated]: { type: 'single', target: 'created' },
  [PRED.dctModified]: { type: 'single', target: 'modified' },
  [PRED.dctIssued]: { type: 'single', target: 'issued' },
  [PRED.versionInfo]: { type: 'single', target: 'versionInfo' },
  [PRED.dctStatus]: { type: 'singleUri', target: 'status' },
}

/**
 * Scheme property mapping
 */
export const SCHEME_PROPERTY_MAP: PropertyMapping = {
  // Labels
  [PRED.prefLabel]: { type: 'label', target: 'prefLabels' },
  [PRED.altLabel]: { type: 'label', target: 'altLabels' },
  [PRED.hiddenLabel]: { type: 'label', target: 'hiddenLabels' },
  [PRED.label]: { type: 'label', target: 'rdfsLabels' },
  [PRED.dctTitle]: { type: 'label', target: 'dctTitles' },
  [PRED.dcTitle]: { type: 'label', target: 'dcTitles' },

  // Documentation
  [PRED.comment]: { type: 'label', target: 'comments' },
  [PRED.dctDescription]: { type: 'label', target: 'description' },
  [PRED.definition]: { type: 'label', target: 'definitions' },
  [PRED.scopeNote]: { type: 'label', target: 'scopeNotes' },
  [PRED.historyNote]: { type: 'label', target: 'historyNotes' },
  [PRED.changeNote]: { type: 'label', target: 'changeNotes' },
  [PRED.editorialNote]: { type: 'label', target: 'editorialNotes' },
  [PRED.note]: { type: 'label', target: 'notes' },
  [PRED.example]: { type: 'label', target: 'examples' },

  // Notation
  [PRED.notation]: { type: 'notation', target: 'notations' },

  // Metadata (URIs with dedupe)
  [PRED.dcIdentifier]: { type: 'uri', target: 'identifier' },
  [PRED.dctCreator]: { type: 'uri', target: 'creator' },
  [PRED.dctPublisher]: { type: 'uri', target: 'publisher' },
  [PRED.dctRights]: { type: 'uri', target: 'rights' },
  [PRED.dctLicense]: { type: 'uri', target: 'license' },
  [PRED.ccLicense]: { type: 'uri', target: 'ccLicense' },
  [PRED.seeAlso]: { type: 'uri', target: 'seeAlso' },

  // Metadata (single values)
  [PRED.dctCreated]: { type: 'single', target: 'created' },
  [PRED.dctModified]: { type: 'single', target: 'modified' },
  [PRED.dctIssued]: { type: 'single', target: 'issued' },
  [PRED.versionInfo]: { type: 'single', target: 'versionInfo' },
  [PRED.dctStatus]: { type: 'singleUri', target: 'status' },
  [PRED.deprecated]: { type: 'boolean', target: 'deprecated' },
}

// =============================================================================
// Processor
// =============================================================================

/**
 * Process SPARQL bindings using a property mapping.
 *
 * @param bindings - SPARQL result bindings
 * @param target - Target object to populate
 * @param mapping - Property mapping to use
 * @param options - Processing options
 * @returns Array of rdf:type values found (for type checking)
 */
export function processPropertyBindings<T extends Record<string, unknown>>(
  bindings: SparqlBinding[],
  target: T,
  mapping: PropertyMapping,
  options: {
    propertyVar?: string  // Variable name for property (default: 'property')
    valueVar?: string     // Variable name for value (default: 'value')
  } = {}
): string[] {
  const { propertyVar = 'property', valueVar = 'value' } = options
  const types: string[] = []

  for (const binding of bindings) {
    const prop = binding[propertyVar]?.value
    const val = binding[valueVar]?.value
    const lang = binding[valueVar]?.['xml:lang']
    const datatype = binding[valueVar]?.datatype

    if (!prop || !val) continue

    // Collect rdf:type separately
    if (prop === PRED.type) {
      types.push(val)
      continue
    }

    const handler = mapping[prop]
    if (!handler) continue

    const targetArray = target[handler.target]

    switch (handler.type) {
      case 'label':
        if (Array.isArray(targetArray)) {
          (targetArray as LabelValue[]).push({ value: val, lang })
        }
        break

      case 'notation':
        if (Array.isArray(targetArray)) {
          const notations = targetArray as NotationValue[]
          if (!notations.some(n => n.value === val)) {
            notations.push({ value: val, datatype })
          }
        }
        break

      case 'ref':
        if (Array.isArray(targetArray)) {
          const refs = targetArray as ConceptRef[]
          if (!refs.some(r => r.uri === val)) {
            refs.push({ uri: val })
          }
        }
        break

      case 'uri':
        if (Array.isArray(targetArray)) {
          const uris = targetArray as string[]
          if (!uris.includes(val)) {
            uris.push(val)
          }
        }
        break

      case 'single':
        if (target[handler.target] === undefined || target[handler.target] === null) {
          (target as Record<string, unknown>)[handler.target] = val
        }
        break

      case 'singleUri':
        if (target[handler.target] === undefined || target[handler.target] === null) {
          // Extract fragment if it's a URI
          const extractedVal = val.includes('/') ? val.split('/').pop() || val : val
          ;(target as Record<string, unknown>)[handler.target] = extractedVal
        }
        break

      case 'boolean':
        if (target[handler.target] === undefined) {
          (target as Record<string, unknown>)[handler.target] = val === 'true' || val === '1'
        }
        break
    }
  }

  return types
}
