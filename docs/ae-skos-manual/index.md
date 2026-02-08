# AE SKOS User Manual

A fast, modern browser for exploring SKOS vocabularies. Lazy-loaded trees, instant search, multilingual support, dark mode, and keyboard shortcuts — all running directly in your browser. No backend, no installation, no data leaves your machine.

> **Want your endpoint on the list?** If you maintain a public SKOS endpoint and would like it included as a suggested endpoint (pre-analyzed, no setup needed for users), [open an issue on GitHub](https://github.com/cognizone/augmented-semantics/issues).

## Getting Started

AE SKOS connects directly to SPARQL endpoints in your browser - no backend server required. Your data stays between you and the endpoint.

### First Launch

When you first open AE SKOS, what you see depends on how it was deployed:

| Standard Mode | Pre-configured Mode |
|---------------|---------------------|
| The Endpoint Manager opens with suggested endpoints for you to add and manage. | Endpoints are already set up by an administrator — you're ready to browse. |
| <img src="screenshots/mode-standard.png" width="350" alt="Standard Mode"> | <img src="screenshots/mode-preconfigured.png" width="350" alt="Pre-configured Mode"> |
| Continue with **Quick Start** below | Skip to [Browsing](02-browsing.md#browsing-concept-schemes) |

### Quick Start

1. Pick a **suggested endpoint** from the list, or click "Add Endpoint" for a custom URL
2. Click **Done** to close the Endpoint Manager
3. Select a concept scheme from the dropdown
4. Start browsing!

### Header Toolbar

The header toolbar provides quick access to key functions. From left to right:

<img src="screenshots/header-toolbar.png" alt="Header toolbar showing endpoint badge, language selector, help, dark mode, and settings buttons" width="720">

| Button | | Description |
|--------|---|-------------|
| **Endpoint** | badge | Shows the active endpoint name. Click to switch endpoints or open the [Endpoint Manager](01-endpoints.md). |
| **Language** | <img src="icons/icon-language.svg" height="16"> | Change the display language. The dropdown shows languages detected in the current endpoint. See [Language settings](05-settings.md#language-section). |
| **Help** | <img src="icons/icon-help.svg" height="16"> | Opens this user manual in a new tab. |
| **Dark mode** | <img src="icons/icon-dark-mode.svg" height="16"> | Toggle between light and dark theme. |
| **Settings** | <img src="icons/icon-settings.svg" height="16"> | Open the [Settings](05-settings.md) dialog. |

## User Guide

1. [Managing Endpoints](01-endpoints.md) — Add, configure, and switch SPARQL endpoints
2. [Browsing](02-browsing.md) — Schemes, concept tree, collections, and orphan detection
3. [Viewing Details](03-details.md) — Concept, collection, and scheme properties
4. [Search & History](04-search.md) — Search concepts and revisit recent items
5. [Settings](05-settings.md) — Display, language, deprecation, search, and developer options
6. [Troubleshooting](06-troubleshooting.md) — Common issues, keyboard shortcuts, and getting help

---

*AE SKOS is part of the Augmented Semantics toolkit by Cognizone.*
