# Changelog

Notable changes to the RDF browser (the **ERA RDF Browser** standalone and the AE RDF
web app). Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
standalone releases are tagged `rdf-vX.Y.Z`.

## [0.4.0] — 2026-07-19

### Added
- **SPARQL panel** — a read-only query console: syntax-highlighted editor, **multiple named tabs** (persisted per endpoint), run `SELECT`/`ASK` with ⌘/Ctrl+Enter. Results **paginate** (50/page); an unbounded `SELECT` gets an auto-`LIMIT` you can **toggle off** (Settings → *Auto-limit SPARQL results*).
- **Open in SPARQL** — hand the current filtered instance list to the panel as the exact query behind it. The query is **portable**: full IRIs collapse to `prefix:local` with a `PREFIX` prologue, and any prefix you type is auto-declared on run.
- **Faceted browsing** — a **Filters** rail on configured types: value, numeric-range, and year/date facets, including values one or more hops away. Configured for CORDIS (Project status / total cost / start year; Organisation type / role / country) and ERA EVR.
- **Search views (instance-list columns)** — types can show a compact **table** of chosen properties, with a **card/box view** toggle (default cards). Columns **inherit down the subclass hierarchy** (configure a superclass once). CORDIS: projects, results + publication/book/thesis subtypes, organisations. ERA EVR: vehicles, registration applications, registration cases.
- **Shareable URLs** — the active endpoint, type, resource, and filters all live in the URL (`?endpoint`/`?type`/`?resource`/`?filters`), so any view is bookmarkable and back/forward works; pasting a URI from another configured dataset **auto-switches** to that endpoint.
- **Back to list** button in the resource view (keeps the type + filters you came from).

### Changed
- **One shared prefix map** (`prefix-map.json`) is now the single source of truth for namespace→prefix across the app, the profiler, and tooling — a namespace resolves to the same prefix everywhere. The prefix legend is **scoped to the endpoint's actual vocabularies**.
- **Settings panel** grouped into labelled sections; the stray UI toggles (nest embedded types, results card view, SPARQL auto-limit) are now managed there.
- **Cleaner SPARQL errors** (width-capped, no echoed query) and fail-fast on 4xx.

### Notes
- **Results default to card view**; the embedded-types-nested toggle now defaults **off**.

## [0.3.0] — 2026-07-18

### Added
- **Inline media previews** — image / video / audio file values render inline; images click through to full size (http(s), by file extension).
- **DOI values** — a `DOI ↗` badge links to doi.org; an opt-in **citation card** (Settings → *DOI citations*) shows authors, year, title, publisher, subject categories, abstract, and a landing-page link, fetched on demand and cached.
- **WKT geometry** — a `map ↗` link opens the location on OpenStreetMap; an opt-in **embedded map** (Settings → *Geometry maps*, Leaflet) renders the geometry with a swisstopo basemap for Swiss coordinates and OpenStreetMap elsewhere, switchable.
- **`geo:Geometry` embedded inline** on its owning feature (via `hasGeometry`), so coordinates/map show without clicking through.

### Changed
- **Sidebar class grouping** into readable, collapsible sections instead of a flat list.
- **Namespace prefixes** shown in the type tree, aligned into a column.
- **Per-endpoint label predicates** (e.g. `foaf:name` / `schema:name`) so more resources show a name instead of a bare URI.
- **Per-endpoint prefixes** seeded into the resolver, dynamic per endpoint.
- **Multilingual values** sort grouped by language.

### Notes
- The two external-request features — **DOI citations** and **geometry maps** — are **off by default**.
- Updating from a previous version auto-refreshes the WebView cache, so the new build loads immediately (no stale assets).

## [0.2.1] — 2026-07-17

### Added
- EVR *no-inference* endpoint, and made it the default. *(First tagged v0.2.0, whose build was problematic; the changes ship in v0.2.1.)*

### Fixed
- Auto-clear the stale WebView cache on update, so a rebuilt app no longer shows the previous install's assets.
