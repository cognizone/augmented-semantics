/**
 * Constants - Canonical definitions for the AE SKOS application
 *
 * @see /spec/ae-skos/sko01-LanguageSelector.md
 */

export {
  LABEL_TYPES,
  LABEL_PRIORITY,
  CONCEPT_LABEL_PRIORITY,
  ALT_LABEL_PRIORITY,
  LABEL_PREDICATES,
  buildLabelUnionClause,
  buildOptionalLabelClause,
  buildCapabilityAwareLabelUnionClause,
  buildCapabilityAwareOptionalLabelClause,
  buildSingleLanguageLabelClause,
  mergeCapabilities,
  isPreferredLabelType,
  getLabelPredicate,
  type LabelType,
  type LabelPriorityType,
  type ConceptLabelPriorityType,
  type LabelPredicateKey,
} from './labels'

export { NS, PRED, TYPE, type PredicateKey, type PredicateUri, type TypeUri } from './predicates'
