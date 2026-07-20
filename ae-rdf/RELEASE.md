# Releasing the RDF Browser standalones

The desktop apps (Tauri) are built from **`ae-rdf`** and published by pushing a git
tag. One codebase ships as multiple branded apps; the tag prefix picks which one.

| App | Tag prefix | Product name | Bundled config |
|-----|-----------|--------------|----------------|
| ERA RDF Browser | `rdf-era-v*` | ERA RDF Browser | `apps/era-rdf/app.json` |
| CORDIS RDF Browser | `rdf-cordis-v*` | CORDIS RDF Browser | `apps/cordis-rdf/app.json` |

Pushing a matching tag triggers **`.github/workflows/tauri-rdf.yml`**, which builds
installers for macOS / Windows / Linux and attaches them to a **draft** GitHub
release named after the app + tag. You then review and publish the draft.

## How it fits together

- **`apps/<app>/app.json`** — the app's baked-in config (which endpoints it shows,
  branding). Optional `apps/<app>/logo.png`.
- **`scripts/bundle-app-config.mjs <app>`** — copies that config (+ logo if present)
  into `dist/config/` at build time, so the app boots as that app.
- **`src-tauri/tauri.conf.json`** — the **base** config; it *is* the ERA app
  (productName, identifier `com.augmented-semantics.era-rdf`, version). Its
  `beforeBuildCommand` bundles `era-rdf`.
- **`src-tauri/tauri.cordis.conf.json`** — a thin **override** merged onto the base
  via `tauri build --config` (CORDIS productName, identifier
  `com.augmented-semantics.cordis-rdf`, and a `beforeBuildCommand` that bundles
  `cordis-rdf`). The workflow adds `--config src-tauri/tauri.cordis.conf.json` only
  for `rdf-cordis-*` tags.

The single source of truth for the app **version** is the `version` field in the
tauri config (base for ERA, `tauri.cordis.conf.json` for CORDIS). Keep it in sync
with the git tag you push.

## Cutting a release

1. **Bump the version** in the relevant tauri config to match the tag you'll push:
   - ERA → `src-tauri/tauri.conf.json`
   - CORDIS → `src-tauri/tauri.cordis.conf.json`
2. **Update `CHANGELOG.md`** (repo root) — add the version's entry.
3. **Commit and push `main`** — the workflow checks out the repo at the tag, so the
   config + workflow must already be on `origin`.
4. **Tag and push** (tag must match the bumped version):
   ```bash
   # ERA
   git tag rdf-era-v0.4.0    && git push origin rdf-era-v0.4.0
   # CORDIS
   git tag rdf-cordis-v0.4.0 && git push origin rdf-cordis-v0.4.0
   ```
   The two tags build independently — release one without the other.
5. **Watch the build** (optional):
   ```bash
   gh run list --workflow=tauri-rdf.yml --limit 2
   gh run watch <run-id> --exit-status
   ```
6. **Fill in the release notes** on the draft (or up front with `--notes-file`):
   ```bash
   gh release edit rdf-era-v0.4.0 --notes-file notes.md
   ```
7. **Publish the draft** from the repo's Releases page once you've reviewed the
   attached installers. Releases are created as drafts on purpose — nothing is
   public until you publish.

## Adding another app

1. Create `apps/<new>/app.json` (+ optional `logo.png`).
2. Add `src-tauri/tauri.<new>.conf.json` — override productName, a **unique**
   `identifier`, version, and `beforeBuildCommand` (`… bundle-app-config.mjs <new>`).
   Copy the full `app.windows` entry (config merge replaces arrays, not merges them).
3. In `.github/workflows/tauri-rdf.yml`, add the `rdf-<new>-v*` tag pattern and a
   branch in the "Resolve app from tag" step setting `product` + `config_arg`.
