---
outline: deep
---

# AE RDF User Manual

::: tip Try it now
[Open AE RDF](https://cognizone.github.io/augmented-semantics/rdf/) in your browser — no installation required.
:::

A fast, browser-only explorer for **any** RDF dataset behind a SPARQL endpoint. Connect, see what types of things exist, drill into a type's instances, open any resource, and follow its links — all live, all in your browser. No backend, no precomputed indexes, no data leaves your machine.

::: info Live queries only
AE RDF runs entirely on live SPARQL — no backend, no precomputed indexes. Today it does endpoint connection and type discovery, filterable instance lists with optional [columns](02-browsing.md#instance-list) and a card/table view, [faceted filtering](02-browsing.md#facets), incoming links ("Referenced by"), a graph-aware resource view, [rich values](02-browsing.md#rich-values-media-dois-geometry) (media, DOIs, geometry), shareable URLs, and a read-only [SPARQL panel](#sparql-panel) with multiple tabs (the <img src="./icons/icon-terminal.svg" height="14"> button in the header).
:::

> **Want your endpoint on the list?** If you maintain a public SPARQL endpoint and would like it included as a suggested endpoint, [open an issue on GitHub](https://github.com/cognizone/augmented-semantics/issues).

## Getting Started

AE RDF connects directly to SPARQL endpoints from your browser — the endpoint must allow browser access ([CORS](04-troubleshooting.md#cors-the-endpoint-wont-load)).

### Quick Start

1. Open the endpoint menu in the header and pick an endpoint. (In the standalone / authoring build you can also **Add endpoint** for a custom URL — see [Managing Endpoints](01-endpoints.md).)
2. Once connected, the **Types** sidebar lists every `rdf:type` in the dataset with an instance count.
3. Click a type to see its instances, then click an instance to open it.
4. Or paste any **resource URI** into the bar at the top and press **Go**.

On a deployed instance the endpoints come from the app's bundled configuration; AE SKOS and AE RDF each ship their own, so the endpoint lists are **not** shared between the tools.

### Header Toolbar

| Button | | Description |
|--------|---|-------------|
| **Endpoint** | badge | Shows the active endpoint. Click to switch endpoints or open the [Endpoint Manager](01-endpoints.md). |
| **SPARQL** | <img src="./icons/icon-terminal.svg" height="16"> | Opens the read-only raw SPARQL panel — run SELECT / ASK queries against the current endpoint. See [SPARQL panel](#sparql-panel). |
| **Documentation** | <img src="./icons/icon-help.svg" height="16"> | Opens the AE RDF documentation (this manual). |
| **Prefixes** | <img src="./icons/icon-tag.svg" height="16"> | The active `prefix → namespace` mappings used to render qnames. |
| **Dark mode** | <img src="./icons/icon-dark-mode.svg" height="16"> | Toggle light/dark theme. |
| **Settings** | <img src="./icons/icon-settings.svg" height="16"> | Display, sidebar behaviour, authoring mode, export, and build info. |

## Settings

Open the settings dialog from the <img src="./icons/icon-settings.svg" height="14"> button:

- **Dark mode** — toggle light/dark theme.
- **URI display** — how predicates, links, and type names render:
  - *Humanized names* (default) — friendly labels (e.g. "Date end applicability").
  - *Prefixed* — compact qnames (e.g. `skos:Concept`).
  - *Full URI* — the raw IRI.
- **Show hidden fields** — reveal properties hidden by the endpoint config (shown greyed), without entering authoring mode.
- **Collapse groups by default** — named sidebar groups (e.g. "Ontology") start collapsed. The built-in **Hidden** group always starts collapsed and **Embedded** always starts expanded, regardless of this setting.
- **Nest embedded types** — off by default. When on, embedded value-object types show nested inline under their composing class in the Types tree (also toggled by the `{}` button in the Types header). Off → they appear only in the collapsed **Embedded** group.
- **Card view for search results** — on by default. Shows a type's instances as cards instead of a table (for types with [configured columns](02-browsing.md#instance-list)); also toggled from the list header.
- **Auto-limit SPARQL results** — on by default. Appends a `LIMIT` to an unbounded `SELECT` in the [SPARQL panel](#sparql-panel); turn off to run the full result set.
- **DOI citations** — off by default. When on, DOI values show an inline citation card (authors, year, title, …) fetched from doi.org on demand — an external request per DOI you scroll to. See [Rich values](02-browsing.md#rich-values-media-dois-geometry).
- **Geometry maps** — off by default. When on, WKT geometry values render an embedded map (swisstopo / OpenStreetMap tiles — external tile requests). See [Rich values](02-browsing.md#rich-values-media-dois-geometry).
- **Config authoring mode** — off by default (clean, read-only browsing). Turn it on to reveal the per-type gears in the Types sidebar and the export buttons below. The configured effects (embed/hide/pin) apply either way; this just shows the editing tools. Authoring — per-type configuration, graph behaviour, and exporting a deployment config — is covered in the [Configuration Guide](configuration.md).

Settings are saved in your browser (localStorage).

## SPARQL panel

The <img src="./icons/icon-terminal.svg" height="14"> button in the header opens a **read-only SPARQL panel** — a syntax-highlighting editor for running your own queries against the current endpoint.

- **Read-only.** Only `SELECT` and `ASK` queries run. Anything else (`CONSTRUCT`, `DESCRIBE`, `INSERT`, `DELETE`, `LOAD`, …) is refused before any request is sent.
- **Many named tabs.** Keep several queries side by side: **+** opens a new tab, **double-click** a tab to rename it, **✕** closes it. Tabs (and their queries) are remembered per endpoint across reloads and endpoint switches.
- **Automatic LIMIT.** A `SELECT` with no top-level `LIMIT` gets `LIMIT 1000` appended, and the panel tells you when it did. Turn this off with the **Auto-limit** toggle (or in [Settings](#settings)) to run the full result set. At most **1,000 rows** render regardless.
- **Paginated results.** The results table pages (50 per page) so a large result stays navigable.
- **Portable queries.** Full IRIs are written as `prefix:local` with a `PREFIX` prologue, and any prefix you type is auto-declared on **Run** — so the query in the editor is a complete, standalone query you can copy into any SPARQL tool.
- **Run it.** Press **Run**, or <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd>. The query duration is shown on success.
- **Clickable results.** In a `SELECT` table, URI cells are links — click one to open that resource in the browser. `ASK` shows a simple `true` / `false`.
- **Open in SPARQL.** From any instance list, the **SPARQL** button hands you the exact query behind the current filtered view in a fresh tab — see [Browsing → Open in SPARQL](02-browsing.md#open-in-sparql).

## User Guide

1. [Managing Endpoints](01-endpoints.md) — Add, test, switch, and remove SPARQL endpoints
2. [Browsing](02-browsing.md) — Types, instances, the resource view, and walking links
3. [Graphs](03-graphs.md) — How AE RDF shows which named graph each fact lives in
4. [Troubleshooting](04-troubleshooting.md) — CORS, empty results, slow queries

## Administration

- [Configuration Guide](configuration.md) — Authoring mode, per-type configuration, graph behaviour, and exporting a deployment config
- [Deployment & Releases](deployment.md) — GitHub Pages variants and the ERA standalone release process

---

*AE RDF is part of the [Augmented Semantics](https://github.com/cognizone/augmented-semantics) toolkit by [Cognizone](https://cogni.zone).*
