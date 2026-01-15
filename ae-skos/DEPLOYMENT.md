# AE SKOS Deployment Guide

## Overview

AE SKOS is a browser-only application. It consists of static HTML, CSS, and JavaScript files that run entirely in the browser. No backend server, database, or runtime environment is required.

The app connects directly to SPARQL endpoints via HTTP from the user's browser.

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

## Deployment

Copy the contents of the `dist/` folder to your web server's document root.

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

    # SSL configuration
    SSLEngine on
    SSLCertificateFile /path/to/cert.pem
    SSLCertificateKeyFile /path/to/key.pem
</VirtualHost>
```

## Configuring the Endpoint in AE SKOS

Once deployed, users can add the SPARQL endpoint in the app:

1. Click the endpoint selector in the top bar
2. Click "Add endpoint"
3. Enter:
   - **Name**: Your endpoint name
   - **URL**: `/sparql` (relative URL works with same-domain proxy)
4. Click Save

The endpoint is stored in the browser's local storage.

## Pre-configured Deployment (Optional)

For deployments where you want to pre-configure endpoints without user setup, create a configuration file.

### Configuration File

Create `config/app.json` in the deployment folder (alongside `index.html`):

```json
{
  "appName": "My Vocabulary Browser",
  "documentationUrl": "https://wiki.example.com/vocab-browser",
  "endpoints": [
    {
      "name": "Production Vocabulary",
      "url": "/sparql"
    }
  ]
}
```

### Configuration Options

| Field | Required | Description |
|-------|----------|-------------|
| `appName` | No | Custom app title (default: "AE SKOS") |
| `documentationUrl` | No | Help link URL (default: GitHub docs) |
| `endpoints` | No | Pre-configured SPARQL endpoints |

### Endpoint Configuration

Each endpoint supports:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name |
| `url` | Yes | SPARQL endpoint URL (can be relative with proxy) |
| `auth` | No | Authentication config (see below) |
| `analysis` | No | Pre-calculated endpoint analysis |
| `suggestedLanguagePriorities` | No | Language preference order (e.g., `["en", "fr"]`) |

#### Authentication Example

```json
{
  "endpoints": [
    {
      "name": "Protected Endpoint",
      "url": "/sparql",
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

Supported auth types: `none`, `basic`, `bearer`, `apikey`

### Behavior

- **With endpoints configured**: Users cannot add/remove endpoints (locked mode)
- **Single endpoint**: Endpoint dropdown is completely hidden
- **Multiple endpoints**: Dropdown visible but "Manage endpoints" option hidden
- **No config file**: App works as normal (user manages endpoints via UI)

### Cache Headers

To ensure config updates take effect immediately, configure cache headers:

#### nginx
```nginx
location /config/ {
    add_header Cache-Control "no-cache, must-revalidate";
}
```

#### Apache
```apache
<Directory /var/www/ae-skos/config>
    Header set Cache-Control "no-cache, must-revalidate"
</Directory>
```

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
