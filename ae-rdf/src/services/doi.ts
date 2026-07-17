/**
 * DOI citation lookup via doi.org content negotiation (CSL-JSON). Opt-in — only
 * called when the `doiCitations` setting is on. Cached per-DOI in memory (incl.
 * failures, cached as null, so a dead DOI isn't re-fetched). No SPARQL, no backend
 * — a direct cross-origin fetch to doi.org (CORS-enabled for this Accept type).
 *
 * @see /spec/ae-rdf — DOI value rendering
 */
import { logger } from './logger'

export interface DoiCitation {
  title: string
  authors: string // pre-joined display string ("Family, G.; …" + " et al." if truncated)
  year: string
  type: string // CSL type, e.g. "graphic", "article-journal"
  container?: string // journal / dataset title
  publisher?: string
}

const cache = new Map<string, DoiCitation | null>()
const AUTHOR_CAP = 5

function formatAuthors(author: unknown): string {
  if (!Array.isArray(author)) return ''
  const names = author
    .slice(0, AUTHOR_CAP)
    .map((a) => {
      if (a?.family) return a.family + (a.given ? `, ${a.given[0]}.` : '')
      return a?.literal ?? a?.name ?? ''
    })
    .filter(Boolean)
  return names.join('; ') + (author.length > AUTHOR_CAP ? ' et al.' : '')
}

/**
 * Fetch citation metadata for a bare DOI (`10.5281/zenodo.255473`). Returns null
 * on any failure (network, CORS, non-OK, registrar without CSL) — the caller
 * falls back to the plain badge. Result (incl. null) is cached for the session.
 */
export async function fetchDoiCitation(id: string): Promise<DoiCitation | null> {
  if (cache.has(id)) return cache.get(id)!
  logger.debug('DoiService', 'Fetching citation', { id })
  try {
    const res = await fetch(`https://doi.org/${id}`, {
      headers: { Accept: 'application/vnd.citationstyles.csl+json' },
    })
    if (!res.ok) {
      logger.warn('DoiService', 'Citation fetch not OK', { id, status: res.status })
      cache.set(id, null)
      return null
    }
    const d = await res.json()
    const citation: DoiCitation = {
      title: typeof d.title === 'string' ? d.title : id,
      authors: formatAuthors(d.author),
      year: d.issued?.['date-parts']?.[0]?.[0]?.toString() ?? '',
      type: typeof d.type === 'string' ? d.type : '',
      container: (Array.isArray(d['container-title']) ? d['container-title'][0] : d['container-title']) || undefined,
      publisher: typeof d.publisher === 'string' ? d.publisher : undefined,
    }
    cache.set(id, citation)
    logger.info('DoiService', 'Citation resolved', { id, title: citation.title })
    return citation
  } catch (error) {
    logger.warn('DoiService', 'Citation fetch failed', { id, error })
    cache.set(id, null)
    return null
  }
}
