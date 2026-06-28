import { describe, it, expect } from 'vitest'
import { localName, humanizeLocalName, qname, displayPredicate, displayObject, displayType } from '../format'

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

  it('preserves acronyms instead of mangling them (the "Rcn" bug)', () => {
    expect(humanizeLocalName('http://x#rcn')).toBe('RCN')
    expect(humanizeLocalName('http://x#RCN')).toBe('RCN')
    expect(humanizeLocalName('http://x#hasISBN')).toBe('Has ISBN')
    expect(humanizeLocalName('http://x#documentURI')).toBe('Document URI')
  })

  it('handles underscores and hyphens', () => {
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

describe('display modes', () => {
  const dct = 'http://purl.org/dc/terms/title'
  const resolved = new Map([[dct, { prefix: 'dct', localName: 'title' }]])
  const pred = 'http://x#dateEndApplicability'

  it('displayPredicate: humanized / prefixed / full', () => {
    expect(displayPredicate(pred, new Map(), 'humanized')).toBe('Date end applicability')
    expect(displayPredicate(dct, resolved, 'prefixed')).toBe('dct:title')
    expect(displayPredicate(pred, new Map(), 'full')).toBe(pred)
  })

  it('displayObject: label wins when humanized; mode otherwise', () => {
    const thing = 'http://x#thing'
    const withThing = new Map([[thing, { prefix: '', localName: 'thing' }]])
    expect(displayObject(thing, withThing, 'humanized', 'My Thing')).toBe('My Thing')
    expect(displayObject(thing, withThing, 'humanized')).toBe('thing') // no label → resolved local name
    expect(displayObject(dct, resolved, 'prefixed', 'ignored in prefixed')).toBe('dct:title')
    expect(displayObject(dct, resolved, 'full', 'ignored in full')).toBe(dct)
  })

  it('displayType: local name humanized, qname prefixed, IRI full', () => {
    const t = 'http://data.europa.eu/s66#Project'
    expect(displayType(t, new Map(), 'humanized')).toBe('Project')
    expect(displayType(dct, resolved, 'prefixed')).toBe('dct:title')
    expect(displayType(t, new Map(), 'full')).toBe(t)
  })
})
