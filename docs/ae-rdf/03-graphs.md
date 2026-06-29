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

## How it works

AE RDF understands an endpoint on two simple axes, and builds every query from them:

- **Quads?** — does it use named graphs at all? Resolved automatically (reused
  from AE SKOS if known, else a quick probe on connect), or set in config.
- **The explicit (default) view** — is it the endpoint's *own* triples, or just a
  *merged* view of the quads? When it's merely **merged** (common with Virtuoso,
  e.g. CORDIS), that view is redundant and returns each fact once per graph — so
  AE RDF **never queries it**, reading the named graphs directly and de-duplicating.
  That's why values aren't doubled.

The second axis isn't something a tool can reliably guess, so it's part of the
**endpoint config**. With [Config authoring mode](index.md#settings) on, edit an
endpoint in the [Endpoint Manager](01-endpoints.md) → **Graph behaviour** to set
*Named graphs (quads)* and *Default view* (Auto / Own / Merged); it's saved with
the endpoint and included in the [exported `app.json`](index.md#settings).
Declare it once per deployment and every query is correct and fast. Unset, AE RDF
plays it safe (queries everything and de-duplicates).

## Not yet included

- **Picking/filtering by graph** (show only one graph, hide others) — AE RDF
  shows provenance, it doesn't yet let you scope *to* a graph.

---

*Next: [Troubleshooting](04-troubleshooting.md) →*
