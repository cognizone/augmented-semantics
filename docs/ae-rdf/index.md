---
outline: deep
---

# AE RDF User Manual

> [!TIP]
> **Try it now** — [Open AE RDF](https://cognizone.github.io/augmented-semantics/rdf/) in your browser, no installation required.

A fast, browser-only explorer for **any** RDF dataset behind a SPARQL endpoint. Connect, see what types of things exist, drill into a type's instances, open any resource, and follow its links — all live, all in your browser. No backend, no precomputed indexes, no data leaves your machine.

> [!NOTE]
> **Live queries only** — AE RDF runs entirely on live SPARQL: no backend, no precomputed indexes, no data leaves your machine. Endpoint connection, type discovery, instance lists, the resource view with incoming links, and everything in **Highlights** below all run as live queries against the endpoint.

## Highlights

| Feature | What it does |
|---------|--------------|
| **[Faceted browsing](facets.md)** | Filter a type by its values, numeric ranges, and dates — even values several hops away — with live, self-adjusting counts. |
| **[SPARQL panel](sparql.md)** | A read-only query console: many named tabs, auto-`LIMIT`, paginated results, and portable prefixed queries. |
| **[Rich values](rich-values.md)** | Media files inline, DOI citation cards, and embedded maps for WKT geometry. |
| **[Graph provenance](graphs.md)** | Always know which named graph every fact comes from. |
| **[Shareable URLs](sharing.md)** | Endpoint, type, resource, and filters live in the URL — bookmark, share, and step through with back/forward. |
| **[Instance views](browsing.md#instance-list)** | Per-type columns in a table or card layout, with server-side text filtering. |

> **Want your endpoint on the list?** If you maintain a public SPARQL endpoint and would like it included as a suggested endpoint, [open an issue on GitHub](https://github.com/cognizone/augmented-semantics/issues).

## Getting Started

AE RDF connects directly to SPARQL endpoints from your browser — the endpoint must allow browser access ([CORS](troubleshooting.md#cors-the-endpoint-wont-load)).

### Quick Start

1. Open the endpoint menu in the header and pick an endpoint. (In the standalone / authoring build you can also **Add endpoint** for a custom URL — see [Managing Endpoints](endpoints.md).)
2. Once connected, the **Types** sidebar lists every `rdf:type` in the dataset with an instance count.
3. Click a type to see its instances, then click an instance to open it.
4. Or paste any **resource URI** into the bar at the top and press **Go**.

On a deployed instance the endpoints come from the app's bundled configuration; AE SKOS and AE RDF each ship their own, so the endpoint lists are **not** shared between the tools.

### Header Toolbar

| Button | | Description |
|--------|---|-------------|
| **Endpoint** | badge | Shows the active endpoint. Click to switch endpoints or open the [Endpoint Manager](endpoints.md). |
| **SPARQL** | <img src="./icons/icon-terminal.svg" height="16"> | Opens the read-only SPARQL panel — run SELECT / ASK queries against the current endpoint. See [SPARQL panel](sparql.md). |
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
- **Card view for search results** — on by default. Shows a type's instances as cards instead of a table (for types with [configured columns](browsing.md#instance-list)); also toggled from the list header.
- **Auto-limit SPARQL results** — on by default. Appends a `LIMIT` to an unbounded `SELECT` in the [SPARQL panel](sparql.md); turn off to run the full result set.
- **DOI citations** — off by default. When on, DOI values show an inline citation card (authors, year, title, …) fetched from doi.org on demand — an external request per DOI you scroll to. See [Rich values](rich-values.md).
- **Geometry maps** — off by default. When on, WKT geometry values render an embedded map (swisstopo / OpenStreetMap tiles — external tile requests). See [Rich values](rich-values.md).
- **Config authoring mode** — off by default (clean, read-only browsing). Turn it on to reveal the per-type gears in the Types sidebar and the export buttons below. The configured effects (embed/hide/pin) apply either way; this just shows the editing tools. Authoring — per-type configuration, graph behaviour, and exporting a deployment config — is covered in the [Configuration Guide](configuration.md).

Settings are saved in your browser (localStorage).

## SPARQL panel

Run your own `SELECT` / `ASK` queries from the <img src="./icons/icon-terminal.svg" height="14"> button in the header — a read-only console with many named tabs, paginated results, and portable prefixed queries. See **[SPARQL panel](sparql.md)**.

## User Guide

1. [Managing Endpoints](endpoints.md) — Add, test, switch, and remove SPARQL endpoints
2. [Browsing](browsing.md) — Types, instance lists, and the resource view
3. [Faceted browsing](facets.md) — Filter a type by its values, ranges, and dates
4. [SPARQL panel](sparql.md) — The read-only query console
5. [Rich values](rich-values.md) — Media, DOIs, and geometry maps
6. [Graphs](graphs.md) — How AE RDF shows which named graph each fact lives in
7. [Shareable URLs](sharing.md) — Deep-linking, bookmarking, and cross-dataset switching
8. [Troubleshooting](troubleshooting.md) — CORS, empty results, slow queries

## Administration

- [Configuration Guide](configuration.md) — Authoring mode, per-type configuration, graph behaviour, and exporting a deployment config
- [Deployment & Releases](deployment.md) — GitHub Pages variants and the ERA standalone release process

---

*AE RDF is part of the [Augmented Semantics](https://github.com/cognizone/augmented-semantics) toolkit by [Cognizone](https://cogni.zone).*
