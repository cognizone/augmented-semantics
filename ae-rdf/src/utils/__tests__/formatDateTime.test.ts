import { describe, it, expect } from 'vitest'
import { formatDateTime } from '../format'

describe('formatDateTime', () => {
  it('drops the T separator and Z marker, keeps the numbers', () => {
    expect(formatDateTime('2024-01-15T10:30:00Z')).toBe('2024-01-15 10:30:00')
    expect(formatDateTime('2024-01-15T10:30:00')).toBe('2024-01-15 10:30:00')
    expect(formatDateTime('2024-01-15T10:30')).toBe('2024-01-15 10:30')
    expect(formatDateTime('2024-01-15T10:30:00.500')).toBe('2024-01-15 10:30:00.500')
  })

  it('keeps a numeric zone offset, space-separated', () => {
    expect(formatDateTime('2024-01-15T10:30:00+01:00')).toBe('2024-01-15 10:30:00 +01:00')
  })

  it('returns null for non-dateTime values (kept raw by the caller)', () => {
    expect(formatDateTime('2024-01-15')).toBeNull() // plain xsd:date — no T
    expect(formatDateTime('hello world')).toBeNull()
    expect(formatDateTime('312500')).toBeNull()
    expect(formatDateTime('')).toBeNull()
  })
})
