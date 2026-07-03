# AE RDF — gotchas

## Embed (`render: embed`) is for small value objects, not entities

Embedding inlines an object's properties recursively. Use it for **low-cardinality
value objects** (MonetaryAmount, coordinates, addresses, time intervals).

**Do NOT embed high-cardinality entity types** (anything with many thousands of
instances, e.g. ERA's `NationalRegistrationProperty`/`VehicleRegistrationCheck`/
`prov:Activity`). A resource that links to hundreds/thousands of embedded objects
makes the resource loader inline them all, recursively — the **load screen hangs**.

- Scope every embed with `embedVia` (the owning predicate) so it only inlines under
  its owner, not everywhere it's referenced.
- For large entities, prefer `link`.
- Backstop: the embed BFS in `useResourceView` is capped on **both** depth
  (`MAX_EMBED_DEPTH`) and breadth (`MAX_EMBED_TOTAL`); past the breadth cap objects
  render as links. Don't remove these caps.

## Resource-view config edits have repeatedly caused load-screen hangs

Changes to embed / order / hide / label config or the loading lifecycle have
repeatedly hung the app. When touching `useResourceView`, `useRdfTypes`, or
`PropertyTable` reactivity:

- Keep heavy work (queries, big joins, unbounded BFS) off the render/watch path.
- Ensure `loading` always resets (it's only cleared when `isCurrent()` — a query
  that never resolves leaves the spinner stuck forever).
- No reactive writes during render.
- Verify in the running app after the change — these bugs don't show up in unit tests.

## Selection changes must invalidate in-flight loads AND reset derived state

The most common bug class in this app: the user switches resource / type / endpoint /
graph while a query is in flight, and stale data lands on the new selection. When you
add or touch any async load keyed on a selection:

- **Invalidate through the same token the load checks.** `load()` guards its writes
  with `isCurrent()` (id === requestId && same endpoint). A `reset()` that bumps a
  *different* counter does NOT cancel the in-flight load — its result still passes
  `isCurrent()` and overwrites the new selection. Bump the token `isCurrent()` reads.
- **Clear the view state you own before/while loading.** Don't leave `triples` /
  `types` / `count` / label / expand-state holding the previous selection until the
  new query resolves — the header, list, and graph chips will show the old resource
  next to the new URI (seconds on slow Virtuoso).
- **`:key` per-resource components by URI** (e.g. the top-level `PropertyTable`s in
  `ResourceView`) so Vue tears down their local state (`expanded` sets, page offset)
  instead of reusing it across navigation.
- **Param watchers must clear siblings.** In `RdfView`, `?type` must clear
  `currentResource`, and dropping `?resource` must clear the URI input — a watcher
  guarded by `if (uri)` silently keeps the stale value.

## One canonical label resolver

The same resource must show the same label everywhere (heading, instance list, link,
embed, "Referenced by"). There is ONE rule:

- `LABEL_PREDICATES` **precedence**, resolved with per-predicate `COALESCE(?l1, ?l2, …)`
  — never `SAMPLE` over a `VALUES` list (that picks arbitrarily and ignores precedence).
- **Preferred-language pick**, then **SKOS-XL** fallback.

Do not hand-roll a subset of the predicates (or drop the language/SKOS-XL step) inside
a query builder or composable — that's exactly how the list, heading, and link labels
drifted apart. If you need labels somewhere new, call the shared resolver.

## Untrusted URIs are hostile at every sink

Endpoint responses, deep-link params (`?resource`), and config values are all
untrusted. Guard at the sink, not just at one entry point:

- **Every IRI interpolated into SPARQL** goes through `sanitizeIri` / `isNavigableIri`
  — including `fetchRawRdf` and the `VALUES`-list builders — and you interpolate the
  **sanitized (trimmed) value**, not the raw one (raw whitespace/`>` breaks or injects
  the query).
- **Every URL bound to `href`/`src`** is protocol-checked (`validateURI`) before render,
  or a `javascript:` URI becomes a clickable script sink in the app origin.
- External `target="_blank"` links need `rel="noopener"`.

## This tool is mirrored from AE SKOS — much is inert copy

Large surfaces were copied from `ae-skos` and never wired up here: the ARIA
`announce*` actions, the `sessionStorage` credential store, and several `prefix` /
`security` / `eventBus` / `useElapsedTime` helpers have zero callers. **Grep for
callers before trusting or building on a service/store method** — "it exists" does not
mean "it's connected."

> Detailed findings behind these rules live in `CODE_REVIEW.md`.
