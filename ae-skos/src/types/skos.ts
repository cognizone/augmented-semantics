// Types from sko02, sko03, sko04, sko05

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
