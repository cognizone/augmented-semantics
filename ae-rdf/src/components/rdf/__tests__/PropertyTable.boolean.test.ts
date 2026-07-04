/**
 * boolean: a predicate listed in `booleanParts` (or a literal typed xsd:boolean)
 * renders its 1/0 · true/false lexical value as a checkbox instead of raw text —
 * for endpoints (Virtuoso) that surface booleans as bare "1"/"0".
 */
import { describe, it, expect } from 'vitest'
import { lit, mountPropertyTable } from '../../../test-utils/propertyTable'
import type { PropertyGroup } from '../../../composables'

const PRED = 'http://ex/isActive'
const XSD_BOOLEAN = 'http://www.w3.org/2001/XMLSchema#boolean'
const litT = (v: string, datatype?: string) => ({ termType: 'literal' as const, value: v, datatype, graphs: [] })

describe('PropertyTable boolean', () => {
  it('renders a configured "1" as a checked box labelled true', () => {
    const groups: PropertyGroup[] = [{ predicate: PRED, objects: [lit('1')] }]
    const w = mountPropertyTable({ groups, resolved: new Map(), booleanParts: [PRED] })
    expect(w.find('.bool-literal').exists()).toBe(true)
    expect(w.find('.bool-icon').text()).toBe('check_box')
    expect(w.find('.bool-icon').classes()).toContain('bool-true')
    expect(w.find('.bool-literal').text()).toContain('true')
  })

  it('renders a configured "0"/"false" as an empty box labelled false', () => {
    for (const v of ['0', 'false']) {
      const groups: PropertyGroup[] = [{ predicate: PRED, objects: [lit(v)] }]
      const w = mountPropertyTable({ groups, resolved: new Map(), booleanParts: [PRED] })
      expect(w.find('.bool-icon').text()).toBe('check_box_outline_blank')
      expect(w.find('.bool-icon').classes()).not.toContain('bool-true')
      expect(w.find('.bool-literal').text()).toContain('false')
    }
  })

  it('renders an xsd:boolean literal as a checkbox with no config', () => {
    const groups: PropertyGroup[] = [{ predicate: PRED, objects: [litT('1', XSD_BOOLEAN)] }]
    const w = mountPropertyTable({ groups, resolved: new Map() })
    expect(w.find('.bool-literal').exists()).toBe(true)
    expect(w.find('.bool-icon').text()).toBe('check_box')
  })

  it('leaves an unconfigured, non-boolean literal as raw text', () => {
    const groups: PropertyGroup[] = [{ predicate: PRED, objects: [lit('1')] }]
    const w = mountPropertyTable({ groups, resolved: new Map() })
    expect(w.find('.bool-literal').exists()).toBe(false)
    expect(w.find('.literal').text()).toContain('1')
  })

  it('falls through to raw text when a configured value is not a recognized boolean', () => {
    const groups: PropertyGroup[] = [{ predicate: PRED, objects: [lit('maybe')] }]
    const w = mountPropertyTable({ groups, resolved: new Map(), booleanParts: [PRED] })
    expect(w.find('.bool-literal').exists()).toBe(false)
    expect(w.find('.literal').text()).toContain('maybe')
  })
})
