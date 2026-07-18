/**
 * One-shot hand-off of a generated SPARQL query from the browser to the SPARQL
 * panel. The browse view sets it and navigates to /sparql; SparqlView takes it
 * once on setup (seeding the editor) and clears it. A module singleton — the
 * value only needs to survive one in-app navigation, so no store/reactivity.
 * ponytail: a plain module var, not a Pinia store — it's a single transient string.
 */
import { formatSparql } from './formatSparql'

let pending: string | null = null

export function setSparqlHandoff(query: string): void {
  pending = formatSparql(query)
}

/** Return the pending query (once) and clear it. Null when there is none. */
export function takeSparqlHandoff(): string | null {
  const q = pending
  pending = null
  return q
}
