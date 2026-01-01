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
  notations: string[]
  broader: ConceptRef[]
  narrower: ConceptRef[]
  related: ConceptRef[]
  inScheme: ConceptRef[]
  exactMatch: string[]
  closeMatch: string[]
  broadMatch: string[]
  narrowMatch: string[]
  relatedMatch: string[]
}

export interface LabelValue {
  value: string
  lang?: string
}

export interface SearchResult {
  uri: string
  label: string
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
  accessedAt: string
}
