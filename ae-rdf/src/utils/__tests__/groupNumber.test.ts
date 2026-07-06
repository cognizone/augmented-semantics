import { describe, it, expect } from 'vitest'
import { groupNumber } from '../format'

describe('groupNumber', () => {
  it('groups integers', () => {
    expect(groupNumber('312500')).toBe('312,500')
    expect(groupNumber('7497790')).toBe('7,497,790')
    expect(groupNumber('36')).toBe('36') // no separator needed, unchanged
  })

  it('preserves sign and fractional part exactly (lossless)', () => {
    expect(groupNumber('-1234')).toBe('-1,234')
    expect(groupNumber('1234.50')).toBe('1,234.50') // trailing zero kept
  })

  it('does not lose precision on big integers (beyond 2^53)', () => {
    expect(groupNumber('9007199254740993')).toBe('9,007,199,254,740,993')
  })

  it('returns null for non-plain-number strings, so callers keep the raw value', () => {
    expect(groupNumber('EUR 312500')).toBeNull() // a label, not a bare number
    expect(groupNumber('2025-08-02')).toBeNull()
    expect(groupNumber('1.5E10')).toBeNull() // scientific notation
    expect(groupNumber('')).toBeNull()
    expect(groupNumber('NaN')).toBeNull()
  })
})
