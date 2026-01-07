# AE SKOS User Manual

A browser-based tool for exploring SKOS (Simple Knowledge Organization System) vocabularies via SPARQL endpoints.

## Table of Contents

- [Getting Started](#getting-started)
- [Managing Endpoints](#managing-endpoints)
- [Browsing Concept Schemes](#browsing-concept-schemes)
- [Navigating the Concept Tree](#navigating-the-concept-tree)
- [Viewing Details](#viewing-details)
- [Searching](#searching)
- [Recent History](#recent-history)
- [Settings](#settings)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)

---

## Getting Started

AE SKOS connects directly to SPARQL endpoints in your browser - no backend server required. Your data stays between you and the endpoint.

### First Launch

When you first open AE SKOS, you'll see an empty interface prompting you to configure an endpoint.

<!-- IMAGE: screenshot-first-launch.png -->
<!-- Caption: Initial screen showing the endpoint configuration prompt -->

### Quick Start

1. Click the endpoint dropdown in the header
2. Select "Manage endpoints..."
3. Add your SPARQL endpoint URL
4. Select a concept scheme
5. Start browsing!

---

## Managing Endpoints

### Opening the Endpoint Manager

Click the endpoint badge in the header toolbar, then select "Manage endpoints..." from the dropdown.

<!-- IMAGE: screenshot-endpoint-dropdown.png -->
<!-- Caption: Endpoint dropdown showing the "Manage endpoints..." option -->

### Adding a New Endpoint

1. Click **Add Endpoint** in the Endpoint Manager
2. The setup wizard opens with multiple steps:

<!-- IMAGE: screenshot-endpoint-wizard.png -->
<!-- Caption: Endpoint wizard showing the connection step -->

#### Step 1: Connection

- **Name**: A friendly name for this endpoint (e.g., "UNESCO Thesaurus")
- **URL**: The SPARQL endpoint URL (e.g., `https://vocabularies.unesco.org/sparql`)
- **Authentication**: Optional - supports Basic Auth, API Key, or Bearer Token

Click **Test Connection** to verify the endpoint is reachable.

#### Step 2: Analysis

The wizard automatically analyzes the endpoint to detect:
- Available named graphs
- SKOS concept schemes
- Languages used in labels

<!-- IMAGE: screenshot-endpoint-analysis.png -->
<!-- Caption: Analysis step showing detected schemes and languages -->

#### Step 3: Language Priorities

Drag and drop languages to set your preferred order. Labels will be shown in the first available language from this list.

<!-- IMAGE: screenshot-language-priorities.png -->
<!-- Caption: Language priority configuration with drag-and-drop -->

### Editing an Endpoint

Click the configure button (⚙️) next to any endpoint to reopen the wizard with existing settings.

### Deleting an Endpoint

Click the delete button (🗑️) next to an endpoint. A confirmation dialog will appear before deletion.

<!-- IMAGE: screenshot-endpoint-delete.png -->
<!-- Caption: Delete confirmation dialog -->

### Switching Endpoints

Click the endpoint badge in the header and select a different endpoint from the dropdown.

---

## Browsing Concept Schemes

### Selecting a Scheme

Use the scheme dropdown in the breadcrumb bar to select a concept scheme.

<!-- IMAGE: screenshot-scheme-dropdown.png -->
<!-- Caption: Scheme dropdown showing available concept schemes -->

When you select a scheme:
- The tree loads with top-level concepts
- The right panel shows scheme details
- The scheme is added to your recent history

### Scheme Details

When viewing a scheme (no concept selected), the right panel displays:

- **Title/Labels**: Scheme name in multiple languages
- **Documentation**: Definitions, scope notes, and other descriptions
- **Metadata**: Creator, dates, version information
- **Other Properties**: Any additional RDF properties

<!-- IMAGE: screenshot-scheme-details.png -->
<!-- Caption: Scheme details panel showing labels and metadata -->

### Deprecated Schemes

Schemes marked as deprecated show a "deprecated" badge next to their name in both the dropdown and the tree.

---

## Navigating the Concept Tree

### Tree Structure

The concept tree displays a hierarchical view of concepts within the selected scheme.

<!-- IMAGE: screenshot-concept-tree.png -->
<!-- Caption: Concept tree showing expanded hierarchy with different node types -->

**Node Icons:**
| Icon | Meaning |
|------|---------|
| 📁 | Scheme (root node) |
| 🏷️ | Concept with children |
| ⚫ | Leaf concept (no children) |

### Expanding and Collapsing

- Click the arrow (▶) to expand a node and load its children
- Click again to collapse
- Children are loaded on-demand (lazy loading)

### Selecting a Concept

Click on any concept label to:
- Select it (highlighted in the tree)
- Load its details in the right panel
- Update the breadcrumb path

### Go to URI

Use the "Go to URI..." input at the top of the tree to navigate directly to any concept or scheme by its URI.

<!-- IMAGE: screenshot-goto-uri.png -->
<!-- Caption: Go to URI input field -->

**Supported URIs:**
- **Concept URI**: Selects the concept and reveals it in the tree
- **Scheme URI**: Switches to that scheme and shows its details

**Tip:** You can paste URIs with angle brackets (e.g., `<http://example.org/concept/1>`) - they're automatically cleaned.

### Home Button

Click the home button (🏠) in the breadcrumb to:
- Return to the scheme root
- Show scheme details
- Scroll the tree to the top

### Breadcrumb Navigation

The breadcrumb shows the path from the scheme to the current concept.

<!-- IMAGE: screenshot-breadcrumb.png -->
<!-- Caption: Breadcrumb showing: Home > Scheme > Parent > Child > Current -->

Click any segment to navigate to that level.

### Deprecation Indicators

Deprecated concepts are visually indicated with:
- A "deprecated" badge after the label
- Reduced opacity (60%)

<!-- IMAGE: screenshot-deprecated-concept.png -->
<!-- Caption: Deprecated concept in tree with badge -->

---

## Viewing Details

### Concept Details

When a concept is selected, the right panel shows comprehensive information:

<!-- IMAGE: screenshot-concept-details.png -->
<!-- Caption: Full concept details panel -->

#### Labels Section
- **Preferred Labels**: Primary labels (skos:prefLabel)
- **Alternative Labels**: Synonyms and variants (skos:altLabel)
- **Hidden Labels**: Labels for search only (skos:hiddenLabel)

Labels show language tags when different from your preferred language.

#### Notations
Concept codes or identifiers (skos:notation) with their datatypes.

#### Documentation
- **Definitions**: What the concept means
- **Scope Notes**: Usage guidance
- **Examples**: Usage examples
- **History/Change/Editorial Notes**: Administrative information

#### Relationships
- **Broader**: Parent concepts (click to navigate)
- **Narrower**: Child concepts (click to navigate)
- **Related**: Associated concepts (click to navigate)

#### Mapping Properties
Links to equivalent concepts in other vocabularies:
- Exact Match, Close Match
- Broad Match, Narrow Match, Related Match

#### Metadata
Dublin Core properties like identifier, creation date, modification date, status.

#### Other Properties
Any additional RDF properties not covered above.

### Header Actions

The details header includes action buttons:

<!-- IMAGE: screenshot-details-header.png -->
<!-- Caption: Details header showing copy and expand buttons -->

| Button | Action |
|--------|--------|
| 📋 | Copy URI to clipboard |
| 🔗 | Copy as "Label" \<URI\> format |
| ↗️ | Open URI in new tab |

---

## Searching

### Search Interface

Click the **Search** tab in the left sidebar to access the search panel.

<!-- IMAGE: screenshot-search-panel.png -->
<!-- Caption: Search panel with input and results -->

### Basic Search

1. Enter your search term
2. Press Enter or click the search button
3. Results appear below

Results show:
- Concept label and notation
- Which field matched (prefLabel, altLabel, definition, notation)
- The scheme containing the concept

### Search Settings

Click the settings icon (⚙️) next to the search input to configure:

<!-- IMAGE: screenshot-search-settings.png -->
<!-- Caption: Search settings popover -->

**Search In:**
- Preferred Labels (default: on)
- Alternative Labels (default: on)
- Definitions (default: off)
- Notations (default: off)

**Options:**
- Case Sensitive: Match exact case
- Whole Word: Match complete words only

### Navigating Results

Click any search result to:
- Select that concept
- Reveal it in the tree (expanding ancestors as needed)
- Show its details in the right panel

---

## Recent History

### Viewing History

Click the **Recent** tab in the left sidebar to see your browsing history.

<!-- IMAGE: screenshot-recent-history.png -->
<!-- Caption: Recent history panel showing visited concepts and schemes -->

Each entry shows:
- Icon indicating type (folder for schemes, label/circle for concepts)
- Label and notation
- Context (endpoint name, scheme name)
- Relative timestamp (e.g., "5 min ago")

### Navigating from History

Click any history entry to:
- Navigate to that concept or scheme
- Switch endpoints if necessary
- Reveal in tree and show details

### Clearing History

Click the delete button (🗑️) in the history header. A confirmation dialog appears before clearing.

<!-- IMAGE: screenshot-clear-history.png -->
<!-- Caption: Clear history confirmation dialog -->

### History Persistence

History is saved to your browser's localStorage and persists across sessions. Up to 50 items are stored.

---

## Settings

### Opening Settings

Click the settings icon (⚙️) in the header toolbar.

<!-- IMAGE: screenshot-settings-dialog.png -->
<!-- Caption: Settings dialog with all options -->

### Language

Select your preferred language for viewing labels. Only languages detected in the current endpoint are shown.

### Display Options

| Setting | Description |
|---------|-------------|
| Dark Mode | Toggle dark/light color scheme |
| Show Datatypes | Display datatype tags (e.g., xsd:date) on values |
| Show Language Tags | Display language codes on labels |
| Include Preferred Language | Show tag even when label matches your preference |

### Deprecation Settings

| Setting | Description |
|---------|-------------|
| Show Deprecation Indicators | Toggle visibility of deprecated badges |

**Detection Rules:**
Configure which conditions indicate deprecation:
- OWL Deprecated: `owl:deprecated = true`
- EU Vocabularies Status: Status not equal to CURRENT

### Reset to Defaults

Click "Reset to defaults" to restore all settings to their original values.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `/` | Focus search input |
| `Escape` | Close dialogs |
| `↑` / `↓` | Navigate tree (when focused) |

---

## Troubleshooting

### Connection Issues

**"Failed to connect to endpoint"**
- Verify the endpoint URL is correct
- Check if the endpoint requires authentication
- Ensure CORS is enabled on the endpoint
- Try accessing the endpoint directly in your browser

**"No concept schemes found"**
- The endpoint may not contain SKOS data
- Try running the analysis again
- Check if data is in a named graph (configure in wizard)

### Display Issues

**Labels showing URIs instead of text**
- The endpoint may not have labels in your preferred language
- Try adjusting language priorities in endpoint settings
- Some concepts may genuinely lack labels

**Tree not loading**
- Check browser console for errors
- The endpoint may be slow - wait for loading to complete
- Try refreshing the page

### Performance

**Slow loading**
- Large vocabularies take longer to load
- Tree loads in pages of 200 concepts
- Consider filtering by scheme if available

**Browser memory**
- Very large vocabularies may consume significant memory
- Try closing other browser tabs
- Refresh the page to clear cached data

---

## Getting Help

- **Issues**: Report bugs at [GitHub Issues](https://github.com/cognizone/augmented-semantics/issues)
- **Source Code**: [GitHub Repository](https://github.com/cognizone/augmented-semantics)

---

*AE SKOS is part of the Augmented Semantics toolkit by Cognizone.*
