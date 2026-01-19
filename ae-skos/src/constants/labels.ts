/**
 * Label Constants - Canonical definitions for label types and predicates
 *
 * Provides consistent label handling across all components:
 * - LABEL_TYPES: Type identifiers for labels
 * - LABEL_PRIORITY: Priority order for display label selection
 * - LABEL_PREDICATES: URI and prefixed form for each label type
 * - buildLabelUnionClause: SPARQL helper for label queries
 *
 * @see /spec/ae-skos/sko01-LanguageSelector.md
 */

/**
 * Label type identifiers used throughout the application.
 * These are the values stored in ?labelType bindings in SPARQL queries.
 */
export const LABEL_TYPES = {
  PREF_LABEL: 'prefLabel',
  XL_PREF_LABEL: 'xlPrefLabel',
  DCT_TITLE: 'dctTitle',        // dct:title (Dublin Core Terms) - preferred
  DC_TITLE: 'dcTitle',          // dc:title (Dublin Core Elements) - legacy
  RDFS_LABEL: 'rdfsLabel',
  ALT_LABEL: 'altLabel',
  XL_ALT_LABEL: 'xlAltLabel',
  HIDDEN_LABEL: 'hiddenLabel',
  XL_HIDDEN_LABEL: 'xlHiddenLabel',
} as const

export type LabelType = typeof LABEL_TYPES[keyof typeof LABEL_TYPES]

/**
 * Priority order for selecting the display label.
 *
 * 1. prefLabel - Standard SKOS preferred label
 * 2. xlPrefLabel - SKOS-XL preferred label
 * 3. dctTitle - Dublin Core Terms title (has better semantics)
 * 4. dcTitle - Dublin Core Elements title (legacy)
 * 5. rdfsLabel - RDFS generic label (fallback)
 */
export const LABEL_PRIORITY = [
  'prefLabel',
  'xlPrefLabel',
  'dctTitle',
  'dcTitle',
  'rdfsLabel',
] as const

export type LabelPriorityType = typeof LABEL_PRIORITY[number]

/**
 * Alternative label priority for altLabel/xlAltLabel selection.
 */
export const ALT_LABEL_PRIORITY = [
  'altLabel',
  'xlAltLabel',
] as const

/**
 * Label predicate definitions with full URI and prefixed form.
 */
export const LABEL_PREDICATES = {
  prefLabel: {
    uri: 'http://www.w3.org/2004/02/skos/core#prefLabel',
    prefixed: 'skos:prefLabel',
  },
  xlPrefLabel: {
    uri: 'http://www.w3.org/2008/05/skos-xl#prefLabel',
    prefixed: 'skosxl:prefLabel',
    literalFormPath: 'skosxl:prefLabel/skosxl:literalForm',
  },
  dctTitle: {
    uri: 'http://purl.org/dc/terms/title',
    prefixed: 'dct:title',
  },
  dcTitle: {
    uri: 'http://purl.org/dc/elements/1.1/title',
    prefixed: 'dc:title',
  },
  rdfsLabel: {
    uri: 'http://www.w3.org/2000/01/rdf-schema#label',
    prefixed: 'rdfs:label',
  },
  altLabel: {
    uri: 'http://www.w3.org/2004/02/skos/core#altLabel',
    prefixed: 'skos:altLabel',
  },
  xlAltLabel: {
    uri: 'http://www.w3.org/2008/05/skos-xl#altLabel',
    prefixed: 'skosxl:altLabel',
    literalFormPath: 'skosxl:altLabel/skosxl:literalForm',
  },
  hiddenLabel: {
    uri: 'http://www.w3.org/2004/02/skos/core#hiddenLabel',
    prefixed: 'skos:hiddenLabel',
  },
  xlHiddenLabel: {
    uri: 'http://www.w3.org/2008/05/skos-xl#hiddenLabel',
    prefixed: 'skosxl:hiddenLabel',
    literalFormPath: 'skosxl:hiddenLabel/skosxl:literalForm',
  },
} as const

export type LabelPredicateKey = keyof typeof LABEL_PREDICATES

/**
 * Build a SPARQL UNION clause for fetching labels with type tracking.
 *
 * Generates a clause that binds ?label and ?labelType for all label predicates.
 * This ensures consistent label fetching across the application.
 *
 * @param subjectVar - The SPARQL variable for the subject (e.g., '?concept', '<uri>')
 * @param labelVar - The variable name for the label (default: '?label')
 * @param langVar - The variable name for the language (default: '?labelLang')
 * @param typeVar - The variable name for the label type (default: '?labelType')
 * @returns SPARQL UNION clause string (without OPTIONAL wrapper)
 *
 * @example
 * const clause = buildLabelUnionClause('?concept')
 * // Returns:
 * // {
 * //   ?concept skos:prefLabel ?label .
 * //   BIND("prefLabel" AS ?labelType)
 * // } UNION {
 * //   ?concept skosxl:prefLabel/skosxl:literalForm ?label .
 * //   BIND("xlPrefLabel" AS ?labelType)
 * // } UNION ...
 */
export function buildLabelUnionClause(
  subjectVar: string,
  labelVar = '?label',
  langVar = '?labelLang',
  typeVar = '?labelType'
): string {
  const unions = [
    {
      pattern: `${subjectVar} skos:prefLabel ${labelVar} .`,
      type: LABEL_TYPES.PREF_LABEL,
    },
    {
      pattern: `${subjectVar} skosxl:prefLabel/skosxl:literalForm ${labelVar} .`,
      type: LABEL_TYPES.XL_PREF_LABEL,
    },
    {
      pattern: `${subjectVar} dct:title ${labelVar} .`,
      type: LABEL_TYPES.DCT_TITLE,
    },
    {
      pattern: `${subjectVar} dc:title ${labelVar} .`,
      type: LABEL_TYPES.DC_TITLE,
    },
    {
      pattern: `${subjectVar} rdfs:label ${labelVar} .`,
      type: LABEL_TYPES.RDFS_LABEL,
    },
  ]

  const clauses = unions.map(
    ({ pattern, type }) => `{
          ${pattern}
          BIND("${type}" AS ${typeVar})
        }`
  )

  return `${clauses.join(' UNION ')}
        BIND(LANG(${labelVar}) AS ${langVar})`
}

/**
 * Build optional SPARQL clause for fetching labels.
 *
 * Wraps buildLabelUnionClause in OPTIONAL { } for use in queries
 * where labels might not exist.
 *
 * @param subjectVar - The SPARQL variable for the subject
 * @param labelVar - The variable name for the label (default: '?label')
 * @param langVar - The variable name for the language (default: '?labelLang')
 * @param typeVar - The variable name for the label type (default: '?labelType')
 * @returns SPARQL OPTIONAL clause string
 */
export function buildOptionalLabelClause(
  subjectVar: string,
  labelVar = '?label',
  langVar = '?labelLang',
  typeVar = '?labelType'
): string {
  return `OPTIONAL {
        ${buildLabelUnionClause(subjectVar, labelVar, langVar, typeVar)}
      }`
}

/**
 * Check if a label type is a preferred label type (for display purposes).
 */
export function isPreferredLabelType(type: string): boolean {
  return LABEL_PRIORITY.includes(type as LabelPriorityType)
}

/**
 * Get the predicate info for a label type.
 */
export function getLabelPredicate(type: string): typeof LABEL_PREDICATES[LabelPredicateKey] | undefined {
  return LABEL_PREDICATES[type as LabelPredicateKey]
}
