import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchDoiCitation } from '../doi'

const CSL = {
  title: 'FIGURE 2 in A new species',
  author: [
    { family: 'Grismer', given: 'Lee' }, { family: 'Wood', given: 'Perry' },
    { family: 'Anuar', given: 'Shahrul' }, { family: 'Davis', given: 'Hayden' },
    { family: 'Cobos', given: 'Anthony' }, { family: 'Murdoch', given: 'Matthew' },
  ],
  issued: { 'date-parts': [[2016, 12, 31]] },
  type: 'graphic',
  'container-title': 'Zootaxa',
  publisher: 'Zenodo',
  categories: ['Biodiversity', 'Taxonomy', 'Reptilia'],
}

const mockFetch = (ok: boolean, body?: unknown) =>
  vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) })

describe('fetchDoiCitation', () => {
  beforeEach(() => vi.stubGlobal('fetch', mockFetch(true, CSL)))
  afterEach(() => vi.unstubAllGlobals())

  it('parses CSL-JSON into a citation, truncating authors past 5 with et al.', async () => {
    const c = await fetchDoiCitation('10.5281/zenodo.a')
    expect(c).toMatchObject({ title: 'FIGURE 2 in A new species', year: '2016', type: 'graphic', container: 'Zootaxa', publisher: 'Zenodo', categories: ['Biodiversity', 'Taxonomy', 'Reptilia'] })
    expect(c!.authors).toBe('Grismer, L.; Wood, P.; Anuar, S.; Davis, H.; Cobos, A. et al.')
  })

  it('caches per DOI — no second network call', async () => {
    const spy = mockFetch(true, CSL); vi.stubGlobal('fetch', spy)
    await fetchDoiCitation('10.5281/zenodo.cache')
    await fetchDoiCitation('10.5281/zenodo.cache')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('returns null (cached) on a non-OK response', async () => {
    vi.stubGlobal('fetch', mockFetch(false))
    expect(await fetchDoiCitation('10.5281/zenodo.dead')).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('CORS')))
    expect(await fetchDoiCitation('10.5281/zenodo.err')).toBeNull()
  })
})
