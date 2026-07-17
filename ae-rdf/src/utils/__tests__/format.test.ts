import { describe, it, expect } from 'vitest'
import { localName, humanizeLocalName, qname, displayPredicate, displayObject, displayType, guessPrefix, mediaKind, doiId } from '../format'

describe('doiId', () => {
  it('extracts the bare DOI from URL, dx, doi:, and bare forms', () => {
    expect(doiId('http://dx.doi.org/10.5281/zenodo.255473')).toBe('10.5281/zenodo.255473')
    expect(doiId('https://doi.org/10.1000/xyz')).toBe('10.1000/xyz')
    expect(doiId('doi:10.5281/zenodo.255473')).toBe('10.5281/zenodo.255473')
    expect(doiId('10.5281/zenodo.255473')).toBe('10.5281/zenodo.255473')
  })
  it('returns null for non-DOIs', () => {
    expect(doiId('https://zenodo.org/records/255473')).toBeNull()
    expect(doiId('see 10.5281/zenodo.255473 for details')).toBeNull() // not the whole value
    expect(doiId('10.5/x')).toBeNull() // registrant too short
  })
})

describe('mediaKind', () => {
  it('detects images, video, audio by extension', () => {
    expect(mediaKind('https://zenodo.org/record/255473/files/figure.png')).toBe('image')
    expect(mediaKind('http://x/a.JPEG')).toBe('image')
    expect(mediaKind('http://x/clip.mp4')).toBe('video')
    expect(mediaKind('http://x/track.mp3')).toBe('audio')
  })
  it('ignores query/fragment after the extension', () => {
    expect(mediaKind('http://x/a.png?v=2#frag')).toBe('image')
  })
  it('returns null for non-media and extensionless URLs', () => {
    expect(mediaKind('http://dx.doi.org/10.5281/zenodo.255473')).toBeNull()
    expect(mediaKind('https://zenodo.org/records/255473')).toBeNull()
    expect(mediaKind('http://x/report.pdf')).toBeNull() // pdf intentionally excluded
  })
})

describe('guessPrefix', () => {
  it('drops the local name and skips generic segments', () => {
    expect(guessPrefix('http://rs.tdwg.org/dwc/terms/TaxonName')).toBe('dwc') // "terms" is generic → "dwc"
    expect(guessPrefix('http://qudt.org/schema/qudt/Unit')).toBe('qudt') // "schema" generic → "qudt"
  })
  it('uses the fragment-side namespace for # URIs', () => {
    expect(guessPrefix('http://filteredpush.org/ontologies/oa/dwcFP#MaterialCitation')).toBe('dwcfp')
  })
  it('falls back to the first host label when no usable path segment', () => {
    expect(guessPrefix('https://cube.link/Observation')).toBe('cube')
  })
  it('acronyms long CamelCase segments', () => {
    expect(guessPrefix('https://environment.ld.admin.ch/foen/nfi/ClassificationUnit/X')).toBe('cu')
    expect(guessPrefix('https://environment.ld.admin.ch/foen/nfi/UnitOfEvaluation/X')).toBe('uoe')
  })
  it('caps length and returns empty for junk', () => {
    expect(guessPrefix('https://x/verylonglowercasesegmenthere/X').length).toBeLessThanOrEqual(12)
    expect(guessPrefix('not a uri')).toBe('')
  })
})

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

  it('displayPredicate: `^` marks an inverse (incoming) predicate with a ↤ prefix', () => {
    expect(displayPredicate('^' + pred, new Map(), 'humanized')).toBe('↤ Date end applicability')
    expect(displayPredicate('^' + dct, resolved, 'prefixed')).toBe('↤ dct:title')
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
