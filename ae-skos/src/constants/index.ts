/**
 * Constants - Canonical definitions for the AE SKOS application
 *
 * @see /spec/ae-skos/sko01-LanguageSelector.md
 */

export {
  LABEL_TYPES,
  LABEL_PRIORITY,
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
  type LabelPredicateKey,
} from './labels'
