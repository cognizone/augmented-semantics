/**
 * SKOS Types - Domain models for SKOS vocabulary
 *
 * @see /spec/ae-skos/sko02-SchemeSelector.md
 * @see /spec/ae-skos/sko03-ConceptTree.md
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 * @see /spec/ae-skos/sko05-SearchBox.md
 */

export interface ConceptScheme {
  uri: string
  label?: string
  labelLang?: string
  description?: string
  title?: string
  creator?: string
  created?: string
  modified?: string
}

// Simple reference (breadcrumb, relations, search results)
export interface ConceptRef {
  uri: string
  label?: string
  notation?: string
  lang?: string
}

// Tree node with expansion state
export interface ConceptNode extends ConceptRef {
  hasNarrower: boolean
  children?: ConceptNode[]
  expanded: boolean
}

export interface ConceptDetails {
  uri: string
  prefLabels: LabelValue[]
  altLabels: LabelValue[]
  hiddenLabels: LabelValue[]
  definitions: LabelValue[]
  scopeNotes: LabelValue[]
  historyNotes: LabelValue[]
  changeNotes: LabelValue[]
  editorialNotes: LabelValue[]
  examples: LabelValue[]
  notations: NotationValue[]
  broader: ConceptRef[]
  narrower: ConceptRef[]
  related: ConceptRef[]
  inScheme: ConceptRef[]
  exactMatch: string[]
  closeMatch: string[]
  broadMatch: string[]
  narrowMatch: string[]
  relatedMatch: string[]
  // SKOS-XL extended labels
  prefLabelsXL: XLLabel[]
  altLabelsXL: XLLabel[]
  hiddenLabelsXL: XLLabel[]
  // Other properties (non-SKOS predicates)
  otherProperties: OtherProperty[]
}

export interface SchemeDetails {
  uri: string
  prefLabels: LabelValue[]
  altLabels: LabelValue[]
  definitions: LabelValue[]
  scopeNotes: LabelValue[]
  historyNotes: LabelValue[]
  changeNotes: LabelValue[]
  editorialNotes: LabelValue[]
  examples: LabelValue[]
  title: LabelValue[]
  description: LabelValue[]
  creator: string[]
  created?: string
  modified?: string
  // SKOS-XL extended labels
  prefLabelsXL: XLLabel[]
  // Other properties (non-SKOS predicates)
  otherProperties: OtherProperty[]
  topConceptCount?: number
}

export interface OtherProperty {
  predicate: string
  values: PropertyValue[]
}

export interface PropertyValue {
  value: string
  lang?: string
  datatype?: string  // Short form like "xsd:date" or full URI
  isUri: boolean
}

export interface LabelValue {
  value: string
  lang?: string
}

export interface NotationValue {
  value: string
  datatype?: string  // Short form like "xsd:string" or full URI
}

// SKOS-XL Extended Labels
export interface XLLabel {
  uri: string
  literalForm: LabelValue
  labelRelations?: XLLabelRelation[]
}

export interface XLLabelRelation {
  type: 'broader' | 'narrower' | 'related'
  target: XLLabel
}

export interface SearchResult {
  uri: string
  label: string
  notation?: string
  lang?: string
  matchedIn: 'prefLabel' | 'altLabel' | 'definition' | 'notation'
  matchedValue?: string
  scheme?: ConceptRef
}

export interface SearchSettings {
  searchIn: {
    prefLabel: boolean
    altLabel: boolean
    definition: boolean
    notation: boolean
  }
  caseSensitive: boolean
  wholeWord: boolean
}

export interface HistoryEntry {
  uri: string
  label: string
  notation?: string
  lang?: string
  accessedAt: string
  endpointUrl?: string
  schemeUri?: string
}
