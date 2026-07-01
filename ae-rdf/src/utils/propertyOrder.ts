/**
 * Field-order helpers for the resource view. Pure functions so the ordering
 * logic is testable apart from the Vue components that use them.
 *
 * @see /spec/ae-rdf
 * @see TypeConfig.order
 */

/**
 * Stable display order: items whose key is listed in `order` come first, in the
 * order they appear there; everything else keeps its relative order via the
 * `fallback` comparator (e.g. the priority heuristic). Partial orders work — you
 * only pin the fields you care about.
 */
export function orderedByConfig<T>(
  items: T[],
  keyOf: (t: T) => string,
  order: string[],
  fallback: (a: T, b: T) => number,
): T[] {
  const idx = (t: T) => {
    const i = order.indexOf(keyOf(t))
    return i === -1 ? Number.POSITIVE_INFINITY : i
  }
  return [...items].sort((a, b) => idx(a) - idx(b) || fallback(a, b))
}

/** Move the key at `from` to `to`, returning a new array (input untouched). */
export function moveInOrder(keys: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= keys.length || to >= keys.length) return keys
  const next = [...keys]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}
