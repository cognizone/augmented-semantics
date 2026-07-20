---
outline: deep
---

# Deployment & Releases

How AE RDF ships: branded **web deployments** on GitHub Pages, and the **ERA RDF Browser** standalone desktop app. (The generic build/host mechanics — Vite `BASE_URL`, config mode, proxying — are shared with AE SKOS; see its [Deployment Guide](../ae-skos/deployment.md) for those details.)

## Web deployments (GitHub Pages)

The `deploy-skos.yml` workflow runs on every push to `main` (and manually via *workflow_dispatch*). It builds the docs plus one AE RDF build per variant — same code, different baked-in `config/app.json`:

| Variant | URL path | Config source |
|---------|----------|---------------|
| AE RDF (multi-endpoint picker) | `/rdf/` | `ae-rdf/public/config/app.json` |
| CORDIS RDF Browser | `/rdf-cordis/` | `apps/cordis-rdf/app.json` |
| ERA OCR-KG | `/rdf-era-ocr/` | `apps/ocr-rdf/app.json` |
| ERA VKM-KG | `/rdf-era-vkm/` | `apps/vkm-rdf/app.json` |

All under `https://cognizone.github.io/augmented-semantics/`. Each variant is a **locked, single-purpose** deployment: the variant's `app.json` (typically one endpoint, custom `appName`) replaces the default config after the build.

**To change a deployed variant:** edit its `apps/<name>/app.json` (or the endpoint file it references), push to `main`, and the workflow redeploys everything in ~2 minutes. Adding a variant = a new `apps/<name>/app.json` + a build/copy step pair in the workflow.

## ERA RDF Browser (standalone desktop)

A [Tauri](https://tauri.app) app built from `ae-rdf` with the ERA endpoints bundled (`ae-rdf/scripts/bundle-era-config.mjs` bakes `apps/era-rdf/app.json` into the build). Releases are tag-driven: pushing an `rdf-v*` tag runs `tauri-rdf.yml`, which builds installers for macOS (universal), Windows (exe + msi), and Linux (AppImage, deb, rpm) and attaches them to a **draft** GitHub release.

### Release runbook

1. **Bump the version** — in three places, all under `ae-rdf/src-tauri/`: `tauri.conf.json`, `Cargo.toml`, and the `era-rdf-browser` entry in `Cargo.lock`.
2. Update `CHANGELOG.md` (repo root) with the release entry.
3. Commit, then tag and push:
   ```bash
   git tag rdf-vX.Y.Z && git push origin main rdf-vX.Y.Z
   ```
4. CI builds ~8 minutes and attaches all installers to a draft release.
5. Write the release notes (from the CHANGELOG entry) and **publish** the draft.

> [!WARNING]
> **The version bump is not cosmetic** — On update, the app clears the WebView's cached assets **only when the app version changed** since the last launch (`src-tauri/src/lib.rs`). Skip the bump and updated users keep seeing the previous build's cached files. Bumping the version is what guarantees a clean update — `localStorage` (theme, history) survives; only the asset cache is wiped.
