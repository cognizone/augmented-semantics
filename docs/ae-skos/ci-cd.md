---
outline: deep
---

# CI/CD Deployment

The repository includes two GitHub Actions workflows for automated deployment.

## GitHub Pages

Deploys the web application and documentation to GitHub Pages.

### Setup

1. Go to repo **Settings** → **Pages**
2. Under "Build and deployment", select **GitHub Actions** as source

### How It Works

The workflow (`.github/workflows/deploy-skos.yml`):

1. Builds the AE SKOS app with `BASE_URL=/augmented-semantics/`
2. Copies `index.html` to `404.html` for SPA routing
3. Builds the VitePress documentation site
4. Deploys the combined site to GitHub Pages

### Site Structure

After deployment, the site is available at:

| Path | Content |
|------|---------|
| `/augmented-semantics/` | AE SKOS application |
| `/augmented-semantics/docs/` | VitePress documentation |

### URLs

- **App:** `https://cognizone.github.io/augmented-semantics/`
- **Docs:** `https://cognizone.github.io/augmented-semantics/docs/`

### Customizing for Forks

If you fork this repository, update the workflow's `BASE_URL` to match your repository name:

```yaml
- run: pnpm --filter ae-skos build
  env:
    BASE_URL: /your-repo-name/
```

## Tauri Desktop Builds

Builds native desktop installers for macOS, Linux, and Windows.

### How It Works

The workflow (`.github/workflows/tauri-build.yml`):

1. Triggered by pushing a version tag (`v*`) or manual dispatch
2. Builds in parallel for three platforms:

| Platform | Runner | Output |
|----------|--------|--------|
| macOS | `macos-latest` | Universal binary (Intel + Apple Silicon) |
| Linux | `ubuntu-22.04` | AppImage / deb |
| Windows | `windows-latest` | MSI / exe installer |

3. Creates a **draft GitHub Release** with installers attached

### Creating a Release

```bash
git tag v0.2.0
git push origin v0.2.0
```

This triggers the workflow. Once the builds complete, go to **Releases** in GitHub to review and publish the draft.

### Local Development

For local Tauri development (requires [Rust toolchain](https://v2.tauri.app/start/prerequisites/)):

```bash
cd ae-skos

# Development (hot-reload)
pnpm tauri:dev

# Production build
pnpm tauri:build
```

Configuration: `ae-skos/src-tauri/tauri.conf.json`
