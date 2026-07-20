---
outline: deep
---

# Deployment & Releases

How AE RDF ships: branded **web deployments** on GitHub Pages, and the **ERA** and **CORDIS RDF Browser** standalone desktop apps. (The generic build/host mechanics — Vite `BASE_URL`, config mode, proxying — are shared with AE SKOS; see its [Deployment Guide](../ae-skos/deployment.md) for those details.)

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

## Standalone desktop apps (ERA + CORDIS)

Two [Tauri](https://tauri.app) desktop apps build from the same `ae-rdf` code, each with its own endpoints baked in. The tag prefix picks which one:

| App | Tag prefix | Bundled config |
|-----|-----------|----------------|
| **ERA RDF Browser** | `rdf-era-v*` | `apps/era-rdf/app.json` (EVR, OCR, ERADIS, VKM, RINF) |
| **CORDIS RDF Browser** | `rdf-cordis-v*` | `apps/cordis-rdf/app.json` (CORDIS Datalab) |

Pushing a matching tag runs `tauri-rdf.yml`, which builds installers for macOS (universal), Windows (exe + msi), and Linux (AppImage, deb, rpm) and attaches them to a **draft** GitHub release named after the app. `scripts/bundle-app-config.mjs <app>` bakes the chosen `apps/<app>/app.json` into the build; the base `src-tauri/tauri.conf.json` *is* the ERA app, and CORDIS is a thin `tauri.cordis.conf.json` override merged in via `tauri build --config` (the workflow adds it for `rdf-cordis-*` tags).

### Release runbook

1. **Bump the version** in the relevant tauri config to match the tag — ERA → `src-tauri/tauri.conf.json`, CORDIS → `src-tauri/tauri.cordis.conf.json`. This field is the source of truth for the installer version.
2. Update `CHANGELOG.md` (repo root) with the release entry.
3. Commit and push `main` first — the tag build checks out the repo, so the config and workflow must already be on `origin`.
4. Tag and push; the two apps release independently:
   ```bash
   git tag rdf-era-v0.4.0    && git push origin rdf-era-v0.4.0     # ERA
   git tag rdf-cordis-v0.4.0 && git push origin rdf-cordis-v0.4.0  # CORDIS
   ```
5. CI builds (~8 minutes) and attaches all installers to a **draft** release.
6. Write the release notes (from the CHANGELOG entry) and **publish** the draft from the Releases page.

The canonical runbook — including how to add a third app — lives in [`ae-rdf/RELEASE.md`](https://github.com/cognizone/augmented-semantics/blob/main/ae-rdf/RELEASE.md).

> **The version bump is not cosmetic** — On update, the app clears the WebView's cached assets **only when the app version changed** since the last launch (`src-tauri/src/lib.rs`). Skip the bump and updated users keep seeing the previous build's cached files. Bumping the version is what guarantees a clean update — `localStorage` (theme, history) survives; only the asset cache is wiped.
