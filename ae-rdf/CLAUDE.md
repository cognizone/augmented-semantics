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
