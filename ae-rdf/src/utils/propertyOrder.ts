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

/**
 * Predicates pinned to the very bottom of their section, in every render context
 * (the standalone `rank` fallback AND the embed insertion-order fallback).
 * `order` can only pin to the TOP, so "always last" has to live here.
 * ponytail: fedlex-specific list; promote to per-endpoint config if it must vary.
 */
export const ALWAYS_LAST: readonly string[] = [
  'http://data.legilux.public.lu/resource/ontology/jolux#isRealizedBy',
  'http://data.legilux.public.lu/resource/ontology/jolux#isEmbodiedBy',
]

/** True when `predicate` should sink below every other field in its section. */
export const isAlwaysLast = (predicate: string): boolean => ALWAYS_LAST.includes(predicate)

/** Fallback comparator: sink ALWAYS_LAST keys to the bottom, otherwise stable (0). */
export const sinkAlwaysLast =
  <T>(keyOf: (t: T) => string) =>
  (a: T, b: T): number => (isAlwaysLast(keyOf(a)) ? 1 : 0) - (isAlwaysLast(keyOf(b)) ? 1 : 0)

/**
 * Compose a label from `labelPreds` in order: look up each predicate's value,
 * drop blanks, and join. Returns '' when nothing resolves (caller falls back to
 * the default label). `valueOf` returns the display value for a predicate.
 */
export function composeLabel(
  labelPreds: string[],
  valueOf: (predicate: string) => string | undefined,
  separator = ' · ',
): string {
  return labelPreds
    .map(valueOf)
    .filter((v): v is string => !!v && v.trim().length > 0)
    .join(separator)
}

/** Add `item` to `list` if absent, else remove it. Returns a new array. */
export function toggleInList(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter(x => x !== item) : [...list, item]
}

/** Move the key at `from` to `to`, returning a new array (input untouched). */
export function moveInOrder(keys: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= keys.length || to >= keys.length) return keys
  const next = [...keys]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}
