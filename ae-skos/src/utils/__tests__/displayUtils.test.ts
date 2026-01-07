/**
 * DisplayUtils Tests
 *
 * Tests for display formatting utilities.
 */
import { describe, it, expect } from 'vitest'
import { formatTemporalValue, formatPropertyValue, getUriFragment, getPredicateName } from '../displayUtils'

describe('formatTemporalValue', () => {
  describe('xsd:date', () => {
    it('formats date-only string to ISO format', () => {
      expect(formatTemporalValue('2009-01-14', 'xsd:date')).toBe('2009-01-14')
    })

    it('formats date with full URI datatype', () => {
      expect(formatTemporalValue('2009-01-14', 'http://www.w3.org/2001/XMLSchema#date')).toBe('2009-01-14')
    })

    it('extracts date from dateTime value when datatype is date', () => {
      expect(formatTemporalValue('2009-01-14T10:30:00Z', 'xsd:date')).toBe('2009-01-14')
    })
  })

  describe('xsd:dateTime', () => {
    it('formats dateTime with timezone to full ISO format', () => {
      expect(formatTemporalValue('2009-01-14T10:30:00Z', 'xsd:dateTime')).toBe('2009-01-14T10:30:00Z')
    })

    it('formats dateTime with milliseconds removes them', () => {
      expect(formatTemporalValue('2009-01-14T10:30:00.123Z', 'xsd:dateTime')).toBe('2009-01-14T10:30:00Z')
    })

    it('formats dateTime with full URI datatype', () => {
      expect(formatTemporalValue('2009-01-14T10:30:00Z', 'http://www.w3.org/2001/XMLSchema#dateTime')).toBe('2009-01-14T10:30:00Z')
    })
  })

  describe('xsd:time', () => {
    it('formats time value', () => {
      expect(formatTemporalValue('10:30:00', 'xsd:time')).toBe('10:30:00')
    })

    it('strips milliseconds from time', () => {
      expect(formatTemporalValue('10:30:00.123', 'xsd:time')).toBe('10:30:00')
    })

    it('formats time with full URI datatype', () => {
      expect(formatTemporalValue('10:30:00', 'http://www.w3.org/2001/XMLSchema#time')).toBe('10:30:00')
    })
  })

  describe('edge cases', () => {
    it('returns empty string for empty input', () => {
      expect(formatTemporalValue('', 'xsd:date')).toBe('')
    })

    it('returns original string for invalid date', () => {
      expect(formatTemporalValue('not-a-date', 'xsd:date')).toBe('not-a-date')
    })

    it('defaults to date format when no datatype specified', () => {
      expect(formatTemporalValue('2009-01-14T10:30:00Z')).toBe('2009-01-14')
    })
  })
})

describe('formatPropertyValue', () => {
  it('formats boolean 0 value', () => {
    expect(formatPropertyValue('0', 'xsd:boolean')).toBe('0 (false)')
  })

  it('formats boolean 1 value', () => {
    expect(formatPropertyValue('1', 'xsd:boolean')).toBe('1 (true)')
  })

  it('formats date values when datatype is xsd:date', () => {
    expect(formatPropertyValue('2009-01-14', 'xsd:date')).toBe('2009-01-14')
  })

  it('formats date values when datatype ends with #date', () => {
    expect(formatPropertyValue('2009-01-14', 'http://www.w3.org/2001/XMLSchema#date')).toBe('2009-01-14')
  })

  it('formats dateTime values to full ISO', () => {
    expect(formatPropertyValue('2009-01-14T10:30:00Z', 'xsd:dateTime')).toBe('2009-01-14T10:30:00Z')
  })

  it('formats time values', () => {
    expect(formatPropertyValue('10:30:00', 'xsd:time')).toBe('10:30:00')
  })

  it('returns value as-is for unknown datatypes', () => {
    expect(formatPropertyValue('hello', 'xsd:string')).toBe('hello')
  })

  it('returns value as-is when no datatype', () => {
    expect(formatPropertyValue('hello')).toBe('hello')
  })
})

describe('getUriFragment', () => {
  it('extracts hash fragment', () => {
    expect(getUriFragment('http://example.org#test')).toBe('test')
  })

  it('extracts last path segment', () => {
    expect(getUriFragment('http://example.org/path/test')).toBe('test')
  })

  it('handles trailing slash', () => {
    expect(getUriFragment('http://example.org/path/test/')).toBe('test')
  })

  it('returns empty string for empty input', () => {
    expect(getUriFragment('')).toBe('')
  })
})

describe('getPredicateName', () => {
  it('uses resolved qualified name when available', () => {
    expect(getPredicateName('http://example.org/test', { prefix: 'ex', localName: 'test' })).toBe('ex:test')
  })

  it('uses localName only when no prefix', () => {
    expect(getPredicateName('http://example.org/test', { prefix: '', localName: 'test' })).toBe('test')
  })

  it('extracts from URI when no resolution', () => {
    expect(getPredicateName('http://example.org/test')).toBe('test')
  })
})
