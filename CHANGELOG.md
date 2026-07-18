# Changelog

Notable changes to the RDF browser (the **ERA RDF Browser** standalone and the AE RDF
web app). Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
standalone releases are tagged `rdf-vX.Y.Z`.

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

### Fixed
- Auto-clear the stale WebView cache on update, so a rebuilt app no longer shows the previous install's assets.

## [0.2.0] — 2026-07-17

### Added
- EVR *no-inference* endpoint, and made it the default.
