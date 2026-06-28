---
outline: deep
---

# Graphs

In a SPARQL dataset, every fact (triple) lives in a **graph** — and the *same*
fact can live in several named graphs at once. That "where does this fact come
from" is real information, so AE RDF always **knows** the graph(s) behind every
triple it shows you, even when it isn't painting them on screen.

## Where you see it

- **Resource header** — a summary of the named graph(s) the resource's facts
  come from (or "default graph").
- **Show graphs toggle** — next to the summary. Off by default to keep the view
  clean; turn it on to see the graph on every triple.
- **Multi-graph facts are always flagged** — if a single triple is asserted in
  more than one graph, it's badged even when the toggle is off, because hiding
  that would be misleading.
- **Hover** — hovering any value shows its graph(s) regardless of the toggle.

## How it works (and its limits)

AE RDF detects once per endpoint whether it uses named graphs. If your endpoint
was already analysed in **AE SKOS**, that information is reused (endpoints are
shared) — otherwise a single quick probe runs on connect.

- The **resource view** fetches triples graph-aware and is correct on every kind
  of endpoint, including those whose default graph is the union of all named
  graphs (common with Virtuoso).
- The **type and instance lists** count and list within named graphs on
  graph-using endpoints. In the rare case where a dataset keeps some data *only*
  in a separate default graph (not in any named graph), those particular items
  may not appear in the lists — open them directly by URI to inspect them fully.

## Not yet included

- **Picking/filtering by graph** (show only one graph, hide others) is not in
  this version — AE RDF shows provenance, it doesn't yet let you scope to a graph.

---

*Next: [Troubleshooting](04-troubleshooting.md) →*
