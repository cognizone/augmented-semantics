---
outline: deep
---

# AE RDF User Manual

::: tip Try it now
[Open AE RDF](https://cognizone.github.io/augmented-semantics/) in your browser — no installation required.
:::

A fast, browser-only explorer for **any** RDF dataset behind a SPARQL endpoint. Connect, see what types of things exist, drill into a type's instances, open any resource, and follow its links — all live, all in your browser. No backend, no precomputed indexes, no data leaves your machine.

::: info Early days
AE RDF is intentionally barebones: live queries only. Endpoint connection, type discovery, instance lists, and a graph-aware resource view work today. A raw SPARQL panel and incoming-link view are planned.
:::

> **Want your endpoint on the list?** If you maintain a public SPARQL endpoint and would like it included as a suggested endpoint, [open an issue on GitHub](https://github.com/cognizone/augmented-semantics/issues).

## Getting Started

AE RDF connects directly to SPARQL endpoints from your browser — the endpoint must allow browser access ([CORS](04-troubleshooting.md#cors-the-endpoint-wont-load)).

### Quick Start

1. Open the endpoint menu in the header and pick a **suggested endpoint**, or choose **Add endpoint** for a custom URL.
2. Once connected, the **Types** sidebar lists every `rdf:type` in the dataset with an instance count.
3. Click a type to see its instances, then click an instance to open it.
4. Or paste any **resource URI** into the bar at the top and press **Go**.

Endpoints are **shared with the other Augmented Semantics tools** (e.g. AE SKOS) — add one here and it's available there too, and vice versa.

### Header Toolbar

| Button | | Description |
|--------|---|-------------|
| **Endpoint** | badge | Shows the active endpoint. Click to switch endpoints or open the [Endpoint Manager](01-endpoints.md). |
| **Help** | <img src="./icons/icon-help.svg" height="16"> | Opens this user manual. |
| **Dark mode** | <img src="./icons/icon-dark-mode.svg" height="16"> | Toggle light/dark theme. |
| **Settings** | <img src="./icons/icon-settings.svg" height="16"> | Dark mode, URI display, and build info. |

## Settings

Open the settings dialog from the <img src="./icons/icon-settings.svg" height="14"> button:

- **Dark mode** — toggle light/dark theme.
- **URI display** — how predicates, links, and type names render:
  - *Humanized names* (default) — friendly labels (e.g. "Date end applicability").
  - *Prefixed* — compact qnames (e.g. `skos:Concept`).
  - *Full URI* — the raw IRI.

- **Config authoring mode** — off by default (clean, read-only browsing). Turn it on to reveal the per-type gears in the Types sidebar and the export button below. The configured effects (embed/hide/pin) apply either way; this just shows the editing tools.
- **Export app.json** (Deployment, authoring mode only) — download the current endpoints (incl. their graph behaviour), per-type config, and a cached snapshot of the type inventory (for an instant Types sidebar on deploy) (sidebar visibility, embed/link/label) as a locked deployment config. Tweak everything live, export, drop the file at `config/app.json`, and end users get a pre-configured, locked AE RDF. Credentials are never included in the export.

Settings are saved in your browser (localStorage).

## User Guide

1. [Managing Endpoints](01-endpoints.md) — Add, test, switch, and remove SPARQL endpoints
2. [Browsing](02-browsing.md) — Types, instances, the resource view, and walking links
3. [Graphs](03-graphs.md) — How AE RDF shows which named graph each fact lives in
4. [Troubleshooting](04-troubleshooting.md) — CORS, empty results, slow queries

---

*AE RDF is part of the [Augmented Semantics](https://github.com/cognizone/augmented-semantics) toolkit by [Cognizone](https://cogni.zone).*
