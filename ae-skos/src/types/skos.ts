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
  deprecated?: boolean
}

// Simple reference (breadcrumb, relations, search results)
export interface ConceptRef {
  uri: string
  label?: string
  notation?: string
  lang?: string
  deprecated?: boolean
}

// Tree node with expansion state
export interface ConceptNode extends ConceptRef {
  hasNarrower: boolean
  children?: ConceptNode[]
  expanded: boolean
}

export interface ConceptDetails {
  uri: string
  deprecated?: boolean
  prefLabels: LabelValue[]
  altLabels: LabelValue[]
  hiddenLabels: LabelValue[]
  definitions: LabelValue[]
  scopeNotes: LabelValue[]
  historyNotes: LabelValue[]
  changeNotes: LabelValue[]
  editorialNotes: LabelValue[]
  notes: LabelValue[]
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
  // Metadata (Dublin Core / RDFS)
  identifier: string[]        // dc:identifier
  created?: string            // dct:created
  modified?: string           // dct:modified
  status?: string             // dct:status
  seeAlso: string[]           // rdfs:seeAlso
  // SKOS-XL extended labels
  prefLabelsXL: XLLabel[]
  altLabelsXL: XLLabel[]
  hiddenLabelsXL: XLLabel[]
  // Other properties (non-SKOS predicates)
  otherProperties: OtherProperty[]
}

export interface SchemeDetails {
  uri: string
  deprecated?: boolean        // owl:deprecated
  prefLabels: LabelValue[]
  altLabels: LabelValue[]
  hiddenLabels: LabelValue[]
  labels: LabelValue[]        // rdfs:label
  notations: NotationValue[]  // skos:notation
  definitions: LabelValue[]
  scopeNotes: LabelValue[]
  historyNotes: LabelValue[]
  changeNotes: LabelValue[]
  editorialNotes: LabelValue[]
  notes: LabelValue[]
  examples: LabelValue[]
  comments: LabelValue[]      // rdfs:comment
  title: LabelValue[]
  description: LabelValue[]
  creator: string[]
  created?: string
  modified?: string
  issued?: string             // dct:issued
  versionInfo?: string        // owl:versionInfo
  publisher: string[]
  rights: string[]
  license: string[]
  ccLicense: string[]         // cc:license
  seeAlso: string[]           // rdfs:seeAlso
  // SKOS-XL extended labels
  prefLabelsXL: XLLabel[]
  altLabelsXL: XLLabel[]
  hiddenLabelsXL: XLLabel[]
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
  type?: 'concept' | 'scheme'
  hasNarrower?: boolean
}
