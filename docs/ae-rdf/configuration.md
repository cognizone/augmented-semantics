---
outline: deep
---

# Configuration Guide

This page is for **curators and deployers**: people who shape how a deployed AE RDF looks — which types are visible, how value objects render, how the endpoint behaves — and then export that as a locked configuration for end users. For day-to-day browsing, see the [User Guide](index.md#user-guide).

## Authoring mode

Everything on this page happens in **Config authoring mode** — a toggle in [Settings](index.md#settings), off by default. Turning it on reveals the per-type gears in the Types sidebar and the export buttons; the configured effects (embed/hide/pin) apply either way. The gear and **Export** stay available even when running a deployed config, so you can tweak and re-export.

## Per-type configuration

Turn on **Config authoring mode** in [Settings](index.md#settings) to reveal a per-type **gear** in the Types sidebar:

- **Pin** to the top, or **Hide** (hidden types move into the **Hidden** group, where you can unhide them).
- **Render as object** — how it shows when it's a *value* of another resource: **Link** (default), **Embed** (inline its properties — for value objects like amounts, addresses, coordinates), or **Label only**.
- **Group** — assign to an existing group, create a new one, or remove.

Without authoring mode the sidebar is read-only, but the configured effects still apply.

### Type config reference

Everything the gear (and the resource-view edit tools) author lands in the endpoint's `types` map, keyed by type IRI:

| Field | Meaning |
|-------|---------|
| `render` | How an instance shows as a *value*: `link` (default), `embed` (inline its properties), `label` (identity only, no navigation — for shared value objects like unit vocabularies). |
| `embedVia` | For `render: embed` — only inline the object where it's reached via **this** predicate (its owning relationship). `^predicate` inverts it (embed the referrer). |
| `sidebar` | `show` / `hide` / `pin`. |
| `group` | Sidebar group label — types with the same label collect under one collapsible header. |
| `order` | Predicate IRIs in display order for this type's resource view. |
| `hide` | Predicate IRIs hidden from the resource view. |
| `label` / `labelFull` | Predicates composing the display label; `labelFull` keeps all parts in the heading. |
| `search` | Predicates the instance-list filter matches (overrides the default label fields). |
| `facets` | [Faceted-browsing](#facets) filters for the instance list — one entry per faceted property (value or range). Config-file-authored only. |
| `foldAfter`, `groupByType`, `boolean`, `number`, `columns`, `capWidth`, `viaLabels` | Per-field display formatting, all authored via the gear/edit tools. |

### Embedding safely

`render: embed` inlines an object's properties recursively — use it for **low-cardinality value objects** (amounts, addresses, coordinates, time instants, geometries). Two rules keep it safe:

- **Never blanket-embed a high-cardinality type.** A resource pointing at hundreds of embedded objects inlines them all; the loader caps depth and total, but the page becomes a wall. Check the worst-case *copies under a single parent* (the profiler records this as `embed.selfMax` in `typeProperties`) — single digits is fine, hundreds is not.
- **Scope with `embedVia`.** Many value objects are *also* the range of a high-fan-out predicate (a "defined term" list, a shared unit). Pinning the owning predicate means the object only inlines under its owner, and everywhere else stays a link. For genuinely shared vocabulary terms, prefer `render: label` over embed.

### Facets

A type can expose **faceted filters** in the sidebar's **Filters** tab (next to **Types**): click values to narrow the instance list without typing. Facets are **config-file-authored** — there's no gear for them in v1. Add a `facets` array to the type's config, one entry per faceted property:

- **Value facet** (no `ranges`) — lists that property's distinct values, most common first, each with a count. Clicking values narrows the list; multi-select within one facet is **OR**, and selecting across several facets is **AND**. `limit` caps how many values are listed (default 15; a "top N shown" note appears when there are more). URI values are shown with their resolved label; literals as-is.
- **Range facet** (`ranges` set) — buckets a numeric property into the bands you define (`min` ≤ value < `max`; either bound may be omitted for an open-ended band). Each band shows a count.

A facet's own counts are computed with the **other** facets' selections applied but not its own — so an unselected value always shows what *adding* it would yield (classic faceted search). The instance list and its total reflect **all** selections. A **Clear filters** link resets them. Selections are not yet saved in the URL.

```json
{
  "types": {
    "http://data.europa.eu/s66#Grant": {
      "facets": [
        {
          "predicate": "http://data.europa.eu/s66#status",
          "label": "Status",
          "limit": 10
        },
        {
          "predicate": "http://data.europa.eu/s66#totalCost",
          "label": "Total cost",
          "ranges": [
            { "label": "< €100k", "max": 100000 },
            { "label": "€100k – €1M", "min": 100000, "max": 1000000 },
            { "label": "≥ €1M", "min": 1000000 }
          ]
        }
      ]
    }
  }
}
```

## Endpoint configuration file

A deployed endpoint (`config/endpoints/<slug>.json`, or embedded in `app.json`) carries, besides `name` and `url`:

| Field | Meaning |
|-------|---------|
| `auth` | Authentication *type* (basic / apikey / bearer). Credentials are never stored — users are prompted on connect. |
| `graph` | [Graph behaviour](#graph-behaviour): `quads` and `defaultView` (`own` / `merged`). |
| `infer` | GraphDB only: send `infer=<value>` with every query (`false` disables inferred triples). |
| `types` | The per-type config map (above). |
| `prefixes` | Endpoint-declared `prefix → namespace` map, loaded at highest precedence while this endpoint is active — keeps exotic-vocab qnames readable without bloating the global `app.json` prefixes. |
| `extraLabelPredicates` | Extra label predicates appended at lowest precedence (e.g. `foaf:name` / `schema:name` for endpoints that label agents only via those). |
| `typeInventory`, `typeProperties`, `subclasses`, `composition`, `orphanCounts`, `deprecatedPredicates`, `profiledAt` | Cached profiler output for an instant sidebar and informed embedding — generated, not hand-written (see the script below). |

## app.json reference

The manifest at `config/app.json`:

| Field | Meaning |
|-------|---------|
| `appName`, `logoUrl`, `documentationUrl` | Branding: header name, logo, and docs link. |
| `endpoints` | The endpoint list — inline objects and/or `"<slug>"` strings referencing `config/endpoints/<slug>.json`. |
| `prefixes` | Global `prefix → namespace` map (shared across endpoints). |
| `doi` | Per-field toggles for the [DOI citation card](02-browsing.md#rich-values-media-dois-geometry): `authors`, `year`, `title`, `container`, `publisher`, `type`, `categories`, `abstract`, `copyright`, `url` (omitted = shown; `false` hides) and `abstractMaxChars` (truncation length, default 280). |

## Generating groups, embeds & prefixes (`group-types.mjs`)

Hand-assigning groups to hundreds of classes doesn't scale. `ae-rdf/scripts/group-types.mjs` writes them into a profiled endpoint config:

```bash
node scripts/group-types.mjs public/config/endpoints/<slug>.json [flags]
```

| Flag | Effect |
|------|--------|
| *(none)* | Mechanical clustering: well-known vocabularies get canonical group names; everything else groups by dataset (host + path), oversized groups split a path segment deeper, tiny groups fold into their dominant linker. |
| `--smart` | Sends the inventory (class URIs, counts, property-range links) to Claude (`claude -p`) for **thematic** clustering — classes group by what they mean and link to, not just their namespace. The mechanical pass remains the fallback for anything uncovered. |
| `--embed` | Marks a curated list of well-known value objects (`schema:PostalAddress`, `time:Instant`, `geo:Geometry`, …) `render: embed`, gated by the profiler's `selfMax` so a fan-out type is refused loudly. |
| `--prefixes` | Generates the endpoint's `prefixes` map (conventional prefixes for known vocabularies, sensible guesses for the rest). |
| `--dry-run` | Report only, write nothing. |
| `--force` | Overwrite existing `group` / `render` / `prefixes` values (default: hand-authored values win). |

It requires a profiled config (`typeInventory` + `typeProperties`); run the profiler first (`scripts/profile-endpoint.ts`).

## Graph behaviour

With [Config authoring mode](index.md#settings) on, the endpoint edit form gains a **Graph
behaviour** section: whether the endpoint uses **named graphs (quads)** and what
its **default (no-`GRAPH`) view** is — *Own* triples or a *Merged* view of the
quads. Leave both **Auto** unless you know the endpoint; see [Graphs](03-graphs.md).
It's saved with the endpoint and exported in `app.json`.

## Exporting a deployment config

With authoring mode on, two export buttons appear under **Deployment**:

- **Export app.json** — the manifest: app name, prefix mappings (so qnames render offline, without prefix.cc), and the endpoint list. Each endpoint carries its graph behaviour, per-type config (sidebar visibility, embed/link/label, order), and a cached snapshot of the type inventory (for an instant Types sidebar on deploy).
- **Export &lt;endpoint&gt;** — the currently selected endpoint as its own file.

To deploy: drop the manifest at `config/app.json`. Endpoints can be embedded in the manifest, or split into `config/endpoints/<slug>.json` files referenced from the manifest by slug — export each with the per-endpoint button and add its slug to the manifest's `endpoints` list. Tweak everything live, export, deploy, and end users get a pre-configured, locked AE RDF. **Credentials are never included in any export.**
