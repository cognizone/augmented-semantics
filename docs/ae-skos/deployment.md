---
outline: deep
---

# AE SKOS Deployment Guide

## Overview

AE SKOS is a browser-only application. It consists of static HTML, CSS, and JavaScript files that run entirely in the browser. No backend server, database, or runtime environment is required.

The app connects directly to SPARQL endpoints via HTTP from the user's browser.

## Deployment Modes

AE SKOS supports two deployment modes:

| Mode | Config File | Endpoint Management | Use Case |
|------|-------------|---------------------|----------|
| **Standard** | None or no `endpoints` | Users add/remove endpoints | Public demo, developer tool |
| **Config** | [`app.json`](#configuration) with `endpoints` | Locked (admin-controlled) | Production deployment |

### Standard Mode

Users manage their own SPARQL endpoints through the UI:
- Add, edit, and remove endpoints
- Endpoints stored in browser localStorage
- Optional: Customize app name, logo, and documentation link via [`app.json`](#configuration)

### Config Mode

Administrators pre-configure endpoints via [`app.json`](#configuration):
- Users cannot add or remove endpoints
- Single endpoint: Endpoint dropdown is hidden
- Multiple endpoints: Dropdown visible, but "Manage Endpoints" is hidden
- Developer mode features (like JSON export) are disabled

## Requirements

- A web server (nginx, Apache, IIS, or similar)
- The ability to configure reverse proxy rules (recommended)

## Build

To generate the deployment files:

```bash
cd ae-skos
pnpm install
pnpm build
```

This creates a `dist/` folder containing all static files.

## Build Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `/` | Base path for the application (affects asset URLs and routing) |

**Examples:**

```bash
# Local development / root deployment
pnpm build

# Subpath deployment (e.g., GitHub Pages)
BASE_URL=/my-app/ pnpm build

# Custom domain subpath
BASE_URL=/tools/skos/ pnpm build
```

The `BASE_URL` must:
- Start and end with `/`
- Match the path where the app will be served

## Deployment

Copy the contents of the `dist/` folder to your web server's document root.

### Directory Structure

```
/var/www/ae-skos/
├── index.html
├── assets/
│   ├── index-xxxxx.js
│   └── index-xxxxx.css
└── config/                  # Optional - for customization
    ├── app.json             # Configuration file
    └── logo.png             # Custom logo (fallback)
```

### Recommended: Same-Domain Proxy Setup

For the best experience, configure your web server to:
1. Serve the app's static files
2. Proxy SPARQL requests to your endpoint

This eliminates CORS issues and keeps your SPARQL endpoint private.

#### nginx

```nginx
server {
    listen 443 ssl;
    server_name skos.example.com;

    # SSL configuration
    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Serve the app
    root /var/www/ae-skos;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy SPARQL endpoint
    location /sparql {
        proxy_pass http://your-sparql-server:8890/sparql;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Disable caching for config files
    location /config/ {
        add_header Cache-Control "no-cache, must-revalidate";
    }
}
```

#### Apache

```apache
<VirtualHost *:443>
    ServerName skos.example.com
    DocumentRoot /var/www/ae-skos

    # SPA fallback
    <Directory /var/www/ae-skos>
        RewriteEngine On
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteCond %{REQUEST_FILENAME} !-d
        RewriteRule . /index.html [L]
    </Directory>

    # Proxy SPARQL endpoint
    ProxyPass /sparql http://your-sparql-server:8890/sparql
    ProxyPassReverse /sparql http://your-sparql-server:8890/sparql

    # Disable caching for config files
    <Directory /var/www/ae-skos/config>
        Header set Cache-Control "no-cache, must-revalidate"
    </Directory>

    # SSL configuration
    SSLEngine on
    SSLCertificateFile /path/to/cert.pem
    SSLCertificateKeyFile /path/to/key.pem
</VirtualHost>
```

## Configuration

### Configuration File

Create `config/app.json` in the deployment folder:

```json
{
  "appName": "My Vocabulary Browser",
  "logoUrl": "/config/logo.png",
  "documentationUrl": "https://wiki.example.com/help",
  "endpoints": [
    {
      "name": "Production Vocabulary",
      "url": "https://vocab.example.com/sparql"
    }
  ]
}
```

### Configuration Options

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `appName` | No | "AE SKOS" | Application title (shown in header and browser tab) |
| `logoUrl` | No | `/config/logo.png`* | Logo image URL (shown before app name) |
| `documentationUrl` | No | GitHub docs | Help link URL |
| `endpoints` | No | - | Pre-configured SPARQL endpoints |

\* Logo fallback only applies in config mode. In standard mode, no logo is shown unless explicitly set.

### Logo Configuration

The logo appears in the header before the application name.

**Options:**

1. **Explicit URL** - Set `logoUrl` in app.json (relative or absolute):
   ```json
   { "logoUrl": "/config/my-logo.png" }
   ```
   or external URL:
   ```json
   { "logoUrl": "https://cdn.example.com/logo.svg" }
   ```

2. **Default fallback** (config mode only) - Place `logo.png` in the config folder:
   ```
   /var/www/ae-skos/config/logo.png
   ```

3. **No logo** - In standard mode without `logoUrl`, no logo is displayed.

**Notes:**
- Recommended size: 28px height (width auto-scales)
- Supported formats: PNG, SVG, JPG
- If the image fails to load, it's gracefully hidden

### Standard Mode Examples

**Minimal (no customization):**
No `config/app.json` file needed.

**Custom branding only:**
```json
{
  "appName": "Corporate Vocabulary Browser",
  "logoUrl": "/config/corp-logo.svg",
  "documentationUrl": "https://intranet.example.com/vocab-help"
}
```
Users can still manage their own endpoints.

### Config Mode Examples

**Single endpoint (dropdown hidden):**
```json
{
  "appName": "Product Taxonomy Browser",
  "endpoints": [
    {
      "name": "Taxonomy",
      "url": "https://taxonomy.example.com/sparql"
    }
  ]
}
```

**Multiple endpoints:**
```json
{
  "appName": "Vocabulary Hub",
  "logoUrl": "/config/hub-logo.png",
  "endpoints": [
    {
      "name": "Production",
      "url": "https://vocab.example.com/sparql"
    },
    {
      "name": "Staging",
      "url": "https://staging.vocab.example.com/sparql"
    }
  ]
}
```

### Endpoint Configuration

Each endpoint supports:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name |
| `url` | Yes | SPARQL endpoint URL (can be relative with proxy) |
| `description` | No | Short description shown in endpoint list |
| `auth` | No | Authentication configuration |
| `analysis` | No | Pre-calculated endpoint analysis |
| `suggestedLanguagePriorities` | No | Language preference order for label resolution and dropdown display (e.g., `["en", "fr", "de"]`) |

### Authentication

> **Note:** Authentication support is experimental. The application is primarily tested with public SPARQL endpoints. Basic auth, bearer tokens, and API keys are implemented but not extensively tested in production environments.

```json
{
  "endpoints": [
    {
      "name": "Protected Endpoint",
      "url": "https://secure.example.com/sparql",
      "auth": {
        "type": "basic",
        "credentials": {
          "username": "user",
          "password": "pass"
        }
      }
    }
  ]
}
```

**Supported auth types:**

| Type | Credentials |
|------|-------------|
| `none` | - |
| `basic` | `username`, `password` |
| `bearer` | `token` |
| `apikey` | `headerName`, `apiKey` |

### Pre-calculated Analysis

The app analyzes endpoints on first connection to determine capabilities. You can skip this by providing pre-calculated analysis data. This information is used internally to optimize queries and configure the UI.

**Safe to customize:**
- `languages` - Filter or reorder available languages in the analysis
- `suggestedLanguagePriorities` - Set language preference order (controls label resolution and header dropdown order)
- `schemeUris` - Limit which schemes appear in the dropdown

> **Note:** Keep `languages` and `suggestedLanguagePriorities` in sync. Languages in `suggestedLanguagePriorities` should exist in `languages`, otherwise labels may not resolve correctly.

**Display only** (safe to modify, but rarely useful):
- `schemeCount`, `totalConcepts`, `analyzedAt` - Shown in capabilities panel but not used for queries

**Be careful with these fields** - incorrect values may cause missing results or query errors:
- `hasSkosContent` - Must be `true` for the app to function properly
- `supportsNamedGraphs`, `skosGraphCount`, `skosGraphUris` - Affect query generation strategy
- `relationships` - Used to build orphan detection queries; wrong values cause incorrect results

> **Recommendation:** Use the Developer Mode JSON export to get accurate values, then customize only the safe fields listed above.

**Analysis fields:**

| Field | Type | Purpose |
|-------|------|---------|
| `hasSkosContent` | boolean | Whether endpoint contains SKOS Concepts or ConceptSchemes |
| `supportsNamedGraphs` | boolean/null | `true` = has named graphs, `false` = no graphs, `null` = not supported |
| `skosGraphCount` | number/null | Number of graphs containing SKOS data |
| `skosGraphUris` | string[] | URIs of SKOS graphs (max 500, used for batched queries) |
| `languages` | array | Detected languages with label counts, sorted by count descending |
| `schemeUris` | string[] | ConceptScheme URIs (max 200, populates scheme dropdown) |
| `schemeCount` | number | Total number of schemes found |
| `schemesLimited` | boolean | `true` if more schemes exist than stored |
| `totalConcepts` | number | Total SKOS Concept count (displayed in capabilities) |
| `relationships` | object | Which SKOS relationships exist (used for orphan detection queries) |
| `analyzedAt` | string | ISO timestamp of analysis |

**Relationships object:**

| Field | SKOS Property | Used for |
|-------|---------------|----------|
| `hasInScheme` | `skos:inScheme` | Scheme membership detection |
| `hasTopConceptOf` | `skos:topConceptOf` | Top concept detection |
| `hasHasTopConcept` | `skos:hasTopConcept` | Inverse top concept detection |
| `hasBroader` | `skos:broader` | Hierarchy navigation |
| `hasNarrower` | `skos:narrower` | Hierarchy navigation |
| `hasBroaderTransitive` | `skos:broaderTransitive` | Transitive hierarchy |
| `hasNarrowerTransitive` | `skos:narrowerTransitive` | Transitive hierarchy |

**Example:**

```json
{
  "endpoints": [
    {
      "name": "Vocabulary",
      "url": "https://vocab.example.com/sparql",
      "analysis": {
        "hasSkosContent": true,
        "supportsNamedGraphs": true,
        "skosGraphCount": 3,
        "languages": [
          { "lang": "en", "count": 5000 },
          { "lang": "fr", "count": 3000 }
        ],
        "schemeUris": [
          "http://example.com/scheme/1",
          "http://example.com/scheme/2"
        ],
        "schemeCount": 2,
        "totalConcepts": 8000,
        "relationships": {
          "hasInScheme": true,
          "hasTopConceptOf": true,
          "hasHasTopConcept": false,
          "hasBroader": true,
          "hasNarrower": true,
          "hasBroaderTransitive": false,
          "hasNarrowerTransitive": false
        },
        "analyzedAt": "2024-01-15T10:30:00Z"
      },
      "suggestedLanguagePriorities": ["en", "fr"]
    }
  ]
}
```

**Tip:** Use Developer Mode (Settings → Developer → Developer mode) to export endpoint analysis as JSON, then include it in your config.

## Alternative: Direct Endpoint Access

If you cannot use a reverse proxy, users can connect directly to the SPARQL endpoint. In this case, the endpoint must allow CORS requests by returning these headers:

```
Access-Control-Allow-Origin: https://skos.example.com
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

Or for public endpoints:
```
Access-Control-Allow-Origin: *
```

## GitHub Pages Deployment

The repository includes a GitHub Actions workflow for automated deployment to GitHub Pages.

### Setup

1. Go to repo **Settings** → **Pages**
2. Under "Build and deployment", select **GitHub Actions** as source

### How It Works

The workflow (`.github/workflows/deploy-skos.yml`):
1. Builds with `BASE_URL=/augmented-semantics/`
2. Copies `index.html` to `404.html` for SPA routing
3. Deploys to GitHub Pages

### URL

After deployment: `https://cognizone.github.io/augmented-semantics/`

### Customizing for Forks

If you fork this repository, update the workflow's `BASE_URL`:

```yaml
- run: pnpm --filter ae-skos build
  env:
    BASE_URL: /your-repo-name/
```

## Troubleshooting

### Config file not loading

1. Check the file exists at `/config/app.json`
2. Verify it's valid JSON (use a JSON validator)
3. Check browser console for errors
4. Ensure proper cache headers are set

### Logo not displaying

1. Verify the image path is correct
2. Check browser console for 404 errors
3. Ensure the image format is supported (PNG, SVG, JPG)
4. In standard mode, `logoUrl` must be explicitly set

### Endpoints locked unexpectedly

Config mode activates when `app.json` contains a non-empty `endpoints` array. To enable user endpoint management:
- Remove the `endpoints` field, OR
- Set `endpoints` to an empty array `[]`, OR
- Delete the `app.json` file
