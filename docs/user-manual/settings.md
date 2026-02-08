[← Back to User Manual](README.md)

# Settings

- [Opening Settings](#opening-settings)
- [Display](#display-section)
- [Language](#language-section)
- [Deprecation](#deprecation-section)
- [Search](#search-section)
- [Developer](#developer-section)
- [About](#about-section)
- [Pre-configured Deployments](#pre-configured-deployments)
- [Reset to Defaults](#reset-to-defaults)

## Opening Settings

Click the settings icon (⚙️) in the header toolbar. The Settings dialog uses a sidebar navigation with six sections.

<!-- IMAGE: screenshots/settings-dialog.png -->
![Settings dialog with sidebar navigation](screenshots/settings-dialog.png)

**Quick Dark Mode Toggle:** You can toggle dark mode directly from the header toolbar using the sun/moon icon, without opening the Settings dialog.

## Display Section

| Setting | Description |
|---------|-------------|
| Show Datatypes | Display datatype tags (e.g., xsd:date) on values |
| Show xsd:string | Show string datatype explicitly |
| Show Language Tags | Display language codes on labels |
| Include Preferred Language | Show tag even when label matches your preference |
| Show Notation in Labels | Prefix labels with notation codes |
| Show Orphans Selector | Include "Orphan Concepts" in scheme dropdown |

## Language Section

Select your preferred language for viewing labels. Only languages detected in the current endpoint are shown. The dropdown shows all available languages with their full names.

## Deprecation Section

| Setting | Description |
|---------|-------------|
| Show Deprecation Indicators | Toggle visibility of deprecated badges |

**Detection Rules:**
Configure which conditions indicate deprecation:
- OWL Deprecated: `owl:deprecated = true`
- EU Vocabularies Status: Status not equal to CURRENT

## Search Section

Configure search behavior (also accessible via the settings button in the Search panel):

| Setting | Description |
|---------|-------------|
| Search in Preferred Labels | Include prefLabel in search |
| Search in Alternative Labels | Include altLabel in search |
| Search in Definitions | Include definitions in search |
| Match Mode | Contains, Starts with, Exact, or Regex |
| Search All Schemes | Ignore current scheme filter |

## Developer Section

| Setting | Description |
|---------|-------------|
| Developer Mode | Enable advanced debugging features |
| Log Level | Control console logging verbosity |
| Enable Scheme URI Slash Fix | Automatically corrects trailing-slash mismatches between declared concept scheme URIs and the URIs used by concepts. Turn this on if the [Scheme URI mismatch](endpoints.md#endpoint-status-indicators) tag appears on an endpoint. |

When Developer Mode is enabled:
- A download button appears next to each endpoint in the Endpoint Manager
- Click the download button to export endpoint data as JSON
- The export includes: endpoint name, URL, analysis data, and language priorities

## About Section

View build information including version number, build date, and links to source code and documentation.

## Pre-configured Deployments

Some deployments of AE SKOS may be pre-configured by administrators:
- A custom logo may appear in the header for branded deployments
- Endpoint management features may be restricted
- Some settings (like Developer Mode) may be hidden

If you're using a pre-configured deployment and need to modify settings, contact your administrator. Administrators can find setup instructions in the [Deployment Guide](https://github.com/cognizone/augmented-semantics/blob/main/ae-skos/DEPLOYMENT.md).

## Reset to Defaults

Click "Reset to defaults" to restore all settings to their original values.
