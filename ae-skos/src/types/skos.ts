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
  type?: 'concept' | 'scheme' | 'collection' | 'orderedCollection'
  hasNarrower?: boolean      // For icon display (leaf vs label)
  inCurrentScheme?: boolean  // True if in currently selected scheme (for cross-scheme indicators)
  displayScheme?: string     // One scheme URI for badge display (when external)
  topConceptSource?: 'inscheme' // Mark in-scheme-only top concepts for UI treatment
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
  // Title/label properties (stored separately by predicate)
  dctTitles: LabelValue[]     // dct:title (Dublin Core Terms)
  dcTitles: LabelValue[]      // dc:title (Dublin Core Elements)
  rdfsLabels: LabelValue[]    // rdfs:label
  // Documentation properties
  comments: LabelValue[]      // rdfs:comment
  description: LabelValue[]   // dct:description
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
  // Collections (inverse of skos:member)
  collections: ConceptRef[]   // Collections this concept belongs to
  // Metadata (Dublin Core / RDFS / OWL)
  identifier: string[]        // dc:identifier
  created?: TemporalValue     // dct:created
  modified?: TemporalValue    // dct:modified
  issued?: TemporalValue      // dct:issued
  versionInfo?: LiteralValue  // owl:versionInfo
  status?: string             // dct:status
  creator: string[]           // dct:creator
  publisher: string[]         // dct:publisher
  rights: string[]            // dct:rights
  license: string[]           // dct:license
  ccLicense: string[]         // cc:license
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
  rdfsLabels: LabelValue[]    // rdfs:label (consistent naming with Concept/Collection)
  notations: NotationValue[]  // skos:notation
  definitions: LabelValue[]
  scopeNotes: LabelValue[]
  historyNotes: LabelValue[]
  changeNotes: LabelValue[]
  editorialNotes: LabelValue[]
  notes: LabelValue[]
  examples: LabelValue[]
  comments: LabelValue[]      // rdfs:comment
  dctTitles: LabelValue[]     // dct:title (Dublin Core Terms, plural for consistency)
  dcTitles: LabelValue[]      // dc:title (Dublin Core Elements, plural for consistency)
  description: LabelValue[]
  creator: string[]
  created?: TemporalValue
  modified?: TemporalValue
  issued?: TemporalValue      // dct:issued
  versionInfo?: LiteralValue  // owl:versionInfo
  status?: string             // dct:status
  identifier: string[]        // dc:identifier
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

export interface TemporalValue {
  value: string
  datatype?: string  // Full URI or short form if available
}

export interface LiteralValue {
  value: string
  datatype?: string
}

export interface LabelValue {
  value: string
  lang?: string
  datatype?: string
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

/**
 * Common interface for types that support SKOS-XL labels.
 * Used by shared composables to load XL labels into ConceptDetails or SchemeDetails.
 */
export interface XLLabelTarget {
  prefLabelsXL: XLLabel[]
  altLabelsXL: XLLabel[]
  hiddenLabelsXL: XLLabel[]
}

/**
 * Common interface for types that support other (non-SKOS) properties.
 * Used by shared composables to load additional properties.
 */
export interface OtherPropertiesTarget {
  otherProperties: OtherProperty[]
}

export interface SearchResult {
  uri: string
  label: string
  type?: 'concept' | 'scheme' | 'collection' | 'orderedCollection'
  notation?: string
  lang?: string
  hasNarrower?: boolean
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
  type?: 'concept' | 'scheme' | 'collection' | 'orderedCollection'
  hasNarrower?: boolean
}

/**
 * SKOS Collection node for tree display
 * Collections group concepts without implying hierarchical relationships.
 */
export interface CollectionNode {
  uri: string
  label?: string
  labelLang?: string
  notation?: string
  isOrdered?: boolean
  // Nesting support
  hasChildCollections?: boolean  // True = expandable (has nested collections)
  isNested?: boolean             // True = has parent collection (hide from root)
}

/**
 * SKOS Collection details
 */
export interface CollectionDetails {
  uri: string
  isOrdered?: boolean
  deprecated?: boolean        // owl:deprecated
  prefLabels: LabelValue[]
  altLabels: LabelValue[]
  hiddenLabels: LabelValue[]  // skos:hiddenLabel
  inScheme: ConceptRef[]
  // Title/label properties (stored separately by predicate)
  dctTitles: LabelValue[]     // dct:title (Dublin Core Terms)
  dcTitles: LabelValue[]      // dc:title (Dublin Core Elements)
  rdfsLabels: LabelValue[]    // rdfs:label
  // Documentation properties
  comments: LabelValue[]      // rdfs:comment
  description: LabelValue[]   // dct:description
  definitions: LabelValue[]
  scopeNotes: LabelValue[]
  historyNotes: LabelValue[]
  changeNotes: LabelValue[]
  editorialNotes: LabelValue[]
  notes: LabelValue[]
  examples: LabelValue[]
  notations: NotationValue[]
  // Metadata (Dublin Core / RDFS / OWL)
  identifier: string[]        // dc:identifier
  created?: TemporalValue     // dct:created
  modified?: TemporalValue    // dct:modified
  issued?: TemporalValue      // dct:issued
  versionInfo?: LiteralValue  // owl:versionInfo
  status?: string             // dct:status
  creator: string[]           // dct:creator
  publisher: string[]         // dct:publisher
  rights: string[]            // dct:rights
  license: string[]           // dct:license
  ccLicense: string[]         // cc:license
  seeAlso: string[]           // rdfs:seeAlso
  // SKOS-XL extended labels (6/12 real endpoints use xlPrefLabel for collections)
  prefLabelsXL: XLLabel[]
  altLabelsXL: XLLabel[]
  hiddenLabelsXL: XLLabel[]
  // Other properties (non-SKOS predicates)
  otherProperties: OtherProperty[]
}
