/**
 * concept-tree utility tests
 *
 * Tests for pure utility functions used in ConceptTree.
 */
import { describe, it, expect } from 'vitest'
import { pickBestNotation, compareNodes } from '../concept-tree'
import type { ConceptNode } from '../../types'

describe('pickBestNotation', () => {
  it('returns undefined for empty array', () => {
    expect(pickBestNotation([])).toBeUndefined()
  })

  it('returns the single notation when only one exists', () => {
    expect(pickBestNotation(['ABC'])).toBe('ABC')
  })

  it('picks the smallest numeric notation', () => {
    expect(pickBestNotation(['10', '5', '20'])).toBe('5')
  })

  it('handles numeric notations with decimals', () => {
    expect(pickBestNotation(['1.5', '1.2', '2.0'])).toBe('1.2')
  })

  it('handles mixed numeric and non-numeric notations', () => {
    // Should pick smallest numeric
    expect(pickBestNotation(['ABC', '5', 'XYZ'])).toBe('5')
  })

  it('falls back to alphabetical for non-numeric notations', () => {
    expect(pickBestNotation(['XYZ', 'ABC', 'MNO'])).toBe('ABC')
  })

  it('handles notation strings that look numeric but have extra chars', () => {
    expect(pickBestNotation(['5a', '3b', '10c'])).toBe('3b')
  })
})

describe('compareNodes', () => {
  function createNode(overrides: Partial<ConceptNode>): ConceptNode {
    return {
      uri: 'http://example.org/concept',
      hasNarrower: false,
      expanded: false,
      ...overrides,
    }
  }

  describe('both nodes have notation', () => {
    it('sorts by numeric notation ascending', () => {
      const a = createNode({ notation: '10', label: 'A' })
      const b = createNode({ notation: '5', label: 'B' })

      expect(compareNodes(a, b)).toBeGreaterThan(0) // 10 > 5, so a comes after b
      expect(compareNodes(b, a)).toBeLessThan(0)
    })

    it('sorts by string notation when not numeric', () => {
      const a = createNode({ notation: 'ABC', label: 'Z' })
      const b = createNode({ notation: 'XYZ', label: 'A' })

      expect(compareNodes(a, b)).toBeLessThan(0) // ABC < XYZ
    })

    it('handles mixed numeric comparison', () => {
      const a = createNode({ notation: '2', label: 'A' })
      const b = createNode({ notation: '10', label: 'B' })

      expect(compareNodes(a, b)).toBeLessThan(0) // 2 < 10 numerically
    })
  })

  describe('one node has notation', () => {
    it('puts node with notation before node without', () => {
      const withNotation = createNode({ notation: '5', label: 'B' })
      const withoutNotation = createNode({ label: 'A' })

      expect(compareNodes(withNotation, withoutNotation)).toBeLessThan(0)
      expect(compareNodes(withoutNotation, withNotation)).toBeGreaterThan(0)
    })
  })

  describe('neither node has notation', () => {
    it('sorts by label alphabetically', () => {
      const a = createNode({ label: 'Zebra' })
      const b = createNode({ label: 'Apple' })

      expect(compareNodes(a, b)).toBeGreaterThan(0) // Zebra > Apple
      expect(compareNodes(b, a)).toBeLessThan(0)
    })

    it('falls back to URI when no label', () => {
      const a = createNode({ uri: 'http://example.org/z' })
      const b = createNode({ uri: 'http://example.org/a' })

      expect(compareNodes(a, b)).toBeGreaterThan(0)
    })

    it('handles missing labels gracefully', () => {
      const a = createNode({ label: 'Test' })
      const b = createNode({ uri: 'http://example.org/concept' })

      // Should not throw
      expect(() => compareNodes(a, b)).not.toThrow()
    })
  })

  describe('sorting arrays', () => {
    it('correctly sorts a mixed array', () => {
      const nodes: ConceptNode[] = [
        createNode({ notation: '10', label: 'Ten' }),
        createNode({ label: 'No notation B' }),
        createNode({ notation: '2', label: 'Two' }),
        createNode({ label: 'No notation A' }),
        createNode({ notation: 'ABC', label: 'Alpha' }),
      ]

      nodes.sort(compareNodes)

      // Expected order: 2, 10, ABC, No notation A, No notation B
      expect(nodes[0]?.notation).toBe('2')
      expect(nodes[1]?.notation).toBe('10')
      expect(nodes[2]?.notation).toBe('ABC')
      expect(nodes[3]?.label).toBe('No notation A')
      expect(nodes[4]?.label).toBe('No notation B')
    })
  })
})
