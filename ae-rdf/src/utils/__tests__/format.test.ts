import { describe, it, expect } from 'vitest'
import { localName, humanizeLocalName, qname } from '../format'

describe('localName', () => {
  it('takes the segment after the last # or /', () => {
    expect(localName('http://data.europa.eu/s66#endDate')).toBe('endDate')
    expect(localName('http://purl.org/dc/terms/title')).toBe('title')
    expect(localName('urn:x')).toBe('urn:x') // no separator → whole thing
  })
})

describe('humanizeLocalName', () => {
  it('splits camelCase and sentence-cases', () => {
    expect(humanizeLocalName('http://x#dateEndApplicability')).toBe('Date end applicability')
    expect(humanizeLocalName('http://x#inForceStatus')).toBe('In force status')
    expect(humanizeLocalName('http://x#typeDocument')).toBe('Type document')
  })

  it('handles underscores and hyphens', () => {
    expect(humanizeLocalName('http://x#CODE_RECUEIL')).toBe('Code recueil')
    expect(humanizeLocalName('http://x#not-applicable')).toBe('Not applicable')
  })
})

describe('qname', () => {
  const resolved = new Map([
    ['http://purl.org/dc/terms/title', { prefix: 'dct', localName: 'title' }],
    ['http://x#noPrefix', { prefix: '', localName: 'noPrefix' }],
  ])

  it('renders prefix:local when resolved, local-only when no prefix, else the IRI', () => {
    expect(qname('http://purl.org/dc/terms/title', resolved)).toBe('dct:title')
    expect(qname('http://x#noPrefix', resolved)).toBe('noPrefix')
    expect(qname('http://unknown.org/x', resolved)).toBe('http://unknown.org/x')
  })
})
