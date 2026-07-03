/**
 * Label-language helpers, shared by every label-resolution path (resource view,
 * incoming relations, instance list) so they pick languages identically.
 */

/** Label language priority: the endpoint's configured languagePriorities, else
 *  the user's global preference, always ending in 'en' as a universal fallback.
 *  The first entry drives single-language label queries. */
export function labelLangs(languagePriorities: string[] | undefined, preferred: string): string[] {
  const cfg = languagePriorities?.filter(Boolean) ?? []
  const base = cfg.length ? cfg : [preferred]
  return [...new Set([...base, 'en'].filter(Boolean))]
}

/** Pick the best candidate by language priority, then untagged, then first. */
export function pickByLangs<T extends { lang?: string }>(cands: T[], langs: string[]): T | undefined {
  for (const l of langs) {
    const m = cands.find(c => c.lang === l)
    if (m) return m
  }
  return cands.find(c => !c.lang) ?? cands[0]
}
