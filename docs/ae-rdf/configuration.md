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
