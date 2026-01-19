import { describe, it, expect } from 'vitest'
import {
  LABEL_TYPES,
  LABEL_PRIORITY,
  ALT_LABEL_PRIORITY,
  LABEL_PREDICATES,
  buildLabelUnionClause,
  buildOptionalLabelClause,
  isPreferredLabelType,
  getLabelPredicate,
} from '../labels'

describe('LABEL_TYPES', () => {
  it('contains all expected label types', () => {
    expect(LABEL_TYPES.PREF_LABEL).toBe('prefLabel')
    expect(LABEL_TYPES.XL_PREF_LABEL).toBe('xlPrefLabel')
    expect(LABEL_TYPES.DCT_TITLE).toBe('dctTitle')
    expect(LABEL_TYPES.DC_TITLE).toBe('dcTitle')
    expect(LABEL_TYPES.RDFS_LABEL).toBe('rdfsLabel')
    expect(LABEL_TYPES.ALT_LABEL).toBe('altLabel')
    expect(LABEL_TYPES.XL_ALT_LABEL).toBe('xlAltLabel')
    expect(LABEL_TYPES.HIDDEN_LABEL).toBe('hiddenLabel')
    expect(LABEL_TYPES.XL_HIDDEN_LABEL).toBe('xlHiddenLabel')
  })
})

describe('LABEL_PRIORITY', () => {
  it('has correct order with dct:title before dc:title', () => {
    const dctIndex = LABEL_PRIORITY.indexOf('dctTitle')
    const dcIndex = LABEL_PRIORITY.indexOf('dcTitle')

    expect(dctIndex).toBeGreaterThan(-1)
    expect(dcIndex).toBeGreaterThan(-1)
    expect(dctIndex).toBeLessThan(dcIndex)
  })

  it('has prefLabel as highest priority', () => {
    expect(LABEL_PRIORITY[0]).toBe('prefLabel')
  })

  it('has rdfsLabel as lowest priority', () => {
    expect(LABEL_PRIORITY[LABEL_PRIORITY.length - 1]).toBe('rdfsLabel')
  })

  it('contains exactly 5 items in expected order', () => {
    expect(LABEL_PRIORITY).toEqual([
      'prefLabel',
      'xlPrefLabel',
      'dctTitle',
      'dcTitle',
      'rdfsLabel',
    ])
  })
})

describe('ALT_LABEL_PRIORITY', () => {
  it('contains altLabel and xlAltLabel in correct order', () => {
    expect(ALT_LABEL_PRIORITY).toEqual(['altLabel', 'xlAltLabel'])
  })
})

describe('LABEL_PREDICATES', () => {
  it('has correct URIs for dct:title and dc:title', () => {
    expect(LABEL_PREDICATES.dctTitle.uri).toBe('http://purl.org/dc/terms/title')
    expect(LABEL_PREDICATES.dcTitle.uri).toBe('http://purl.org/dc/elements/1.1/title')
  })

  it('has correct prefixed forms', () => {
    expect(LABEL_PREDICATES.dctTitle.prefixed).toBe('dct:title')
    expect(LABEL_PREDICATES.dcTitle.prefixed).toBe('dc:title')
    expect(LABEL_PREDICATES.prefLabel.prefixed).toBe('skos:prefLabel')
    expect(LABEL_PREDICATES.rdfsLabel.prefixed).toBe('rdfs:label')
  })

  it('has literalFormPath for SKOS-XL predicates', () => {
    expect(LABEL_PREDICATES.xlPrefLabel.literalFormPath).toBe('skosxl:prefLabel/skosxl:literalForm')
    expect(LABEL_PREDICATES.xlAltLabel.literalFormPath).toBe('skosxl:altLabel/skosxl:literalForm')
    expect(LABEL_PREDICATES.xlHiddenLabel.literalFormPath).toBe('skosxl:hiddenLabel/skosxl:literalForm')
  })
})

describe('buildLabelUnionClause', () => {
  it('generates valid SPARQL with all label types', () => {
    const clause = buildLabelUnionClause('?concept')

    expect(clause).toContain('skos:prefLabel')
    expect(clause).toContain('skosxl:prefLabel/skosxl:literalForm')
    expect(clause).toContain('dct:title')
    expect(clause).toContain('dc:title')
    expect(clause).toContain('rdfs:label')
  })

  it('binds correct label types', () => {
    const clause = buildLabelUnionClause('?concept')

    expect(clause).toContain('BIND("prefLabel" AS ?labelType)')
    expect(clause).toContain('BIND("xlPrefLabel" AS ?labelType)')
    expect(clause).toContain('BIND("dctTitle" AS ?labelType)')
    expect(clause).toContain('BIND("dcTitle" AS ?labelType)')
    expect(clause).toContain('BIND("rdfsLabel" AS ?labelType)')
  })

  it('uses custom variable names when provided', () => {
    const clause = buildLabelUnionClause('?s', '?lbl', '?lang', '?type')

    expect(clause).toContain('?s skos:prefLabel ?lbl')
    expect(clause).toContain('BIND(LANG(?lbl) AS ?lang)')
    expect(clause).toContain('BIND("prefLabel" AS ?type)')
  })

  it('works with URI subjects', () => {
    const clause = buildLabelUnionClause('<http://example.org/concept>')

    expect(clause).toContain('<http://example.org/concept> skos:prefLabel ?label')
  })
})

describe('buildOptionalLabelClause', () => {
  it('wraps union clause in OPTIONAL', () => {
    const clause = buildOptionalLabelClause('?concept')

    expect(clause).toContain('OPTIONAL {')
    expect(clause).toContain('skos:prefLabel')
  })
})

describe('isPreferredLabelType', () => {
  it('returns true for types in LABEL_PRIORITY', () => {
    expect(isPreferredLabelType('prefLabel')).toBe(true)
    expect(isPreferredLabelType('xlPrefLabel')).toBe(true)
    expect(isPreferredLabelType('dctTitle')).toBe(true)
    expect(isPreferredLabelType('dcTitle')).toBe(true)
    expect(isPreferredLabelType('rdfsLabel')).toBe(true)
  })

  it('returns false for types not in LABEL_PRIORITY', () => {
    expect(isPreferredLabelType('altLabel')).toBe(false)
    expect(isPreferredLabelType('hiddenLabel')).toBe(false)
    expect(isPreferredLabelType('unknown')).toBe(false)
  })
})

describe('getLabelPredicate', () => {
  it('returns predicate info for valid types', () => {
    const dctTitle = getLabelPredicate('dctTitle')
    expect(dctTitle).toBeDefined()
    expect(dctTitle?.uri).toBe('http://purl.org/dc/terms/title')
    expect(dctTitle?.prefixed).toBe('dct:title')
  })

  it('returns undefined for unknown types', () => {
    expect(getLabelPredicate('unknown')).toBeUndefined()
  })
})
