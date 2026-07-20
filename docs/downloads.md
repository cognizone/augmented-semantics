# Downloads

Access Augmented Semantics tools online or download desktop versions for offline use.

## Online Apps (GitHub Pages)

Use the tools directly in your browser — no installation required.

| App | Description | Link |
|-----|-------------|------|
| **AE SKOS** | SKOS vocabulary browser | [Open AE SKOS](https://cognizone.github.io/augmented-semantics/skos/) |
| **AE SKOS (ERA)** | Pre-configured for ERA vocabularies | [Open ERA Edition](https://cognizone.github.io/augmented-semantics/skos-era/) |
| **AE RDF** | RDF/SPARQL data browser (all bundled endpoints) | [Open AE RDF](https://cognizone.github.io/augmented-semantics/rdf/) |
| **AE RDF (CORDIS)** | Pre-configured for CORDIS Datalab | [Open CORDIS Edition](https://cognizone.github.io/augmented-semantics/rdf-cordis/) |
| **AE RDF (ERA OCR)** | Pre-configured for the ERA OCR-KG | [Open ERA OCR Edition](https://cognizone.github.io/augmented-semantics/rdf-era-ocr/) |
| **AE RDF (ERA VKM)** | Pre-configured for the ERA VKM-KG | [Open ERA VKM Edition](https://cognizone.github.io/augmented-semantics/rdf-era-vkm/) |

## Desktop Apps

Download native desktop applications built with Tauri. Desktop apps provide:

- Offline access
- Native performance
- System tray integration
- Automatic updates

### AE SKOS Desktop

| Platform | Download |
|----------|----------|
| Windows (.msi) | [Download for Windows](https://github.com/cognizone/augmented-semantics/releases/latest) |
| macOS (.dmg) | [Download for macOS](https://github.com/cognizone/augmented-semantics/releases/latest) |
| Linux (.AppImage) | [Download for Linux](https://github.com/cognizone/augmented-semantics/releases/latest) |

### ERA RDF Browser

The RDF/SPARQL browser pre-configured for the ERA knowledge graphs (EVR, OCR, ERADIS, VKM, RINF).

- **[Download the latest release](https://github.com/cognizone/augmented-semantics/releases/tag/rdf-era-v0.4.0)** — Windows (.msi / .exe), macOS (.dmg, universal), Linux (.deb / .rpm / .AppImage).

### CORDIS RDF Browser

The RDF/SPARQL browser pre-configured for the CORDIS Datalab (EU research projects, results, organisations).

- **[Download the latest release](https://github.com/cognizone/augmented-semantics/releases/tag/rdf-cordis-v0.4.0)** — Windows (.msi / .exe), macOS (.dmg, universal), Linux (.deb / .rpm / .AppImage).

::: tip
Visit the [GitHub Releases](https://github.com/cognizone/augmented-semantics/releases) page for all versions and release notes. The RDF browsers are tagged `rdf-era-v*` and `rdf-cordis-v*`.
:::

## System Requirements

### Web App
- Modern browser (Chrome, Firefox, Edge, Safari)
- JavaScript enabled
- Network access to SPARQL endpoints

### Desktop App
- **Windows**: Windows 10 or later
- **macOS**: macOS 10.15 (Catalina) or later
- **Linux**: Ubuntu 20.04+ or equivalent

## Source Code

Augmented Semantics is open source. Clone the repository to build from source or contribute:

```bash
git clone https://github.com/cognizone/augmented-semantics.git
cd augmented-semantics
pnpm install
pnpm dev:skos
```

See the [GitHub repository](https://github.com/cognizone/augmented-semantics) for build instructions and contribution guidelines.
