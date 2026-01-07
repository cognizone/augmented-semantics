# Image Checklist

Screenshots needed for the user manual. Place images in this folder and they'll be referenced from README.md.

## Required Screenshots

### Getting Started
- [ ] `screenshot-first-launch.png` - Initial screen showing the endpoint configuration prompt

### Managing Endpoints
- [ ] `screenshot-endpoint-dropdown.png` - Endpoint dropdown showing the "Manage endpoints..." option
- [ ] `screenshot-endpoint-wizard.png` - Endpoint wizard showing the connection step
- [ ] `screenshot-endpoint-analysis.png` - Analysis step showing detected schemes and languages
- [ ] `screenshot-language-priorities.png` - Language priority configuration with drag-and-drop
- [ ] `screenshot-endpoint-delete.png` - Delete confirmation dialog

### Browsing Concept Schemes
- [ ] `screenshot-scheme-dropdown.png` - Scheme dropdown showing available concept schemes
- [ ] `screenshot-scheme-details.png` - Scheme details panel showing labels and metadata

### Navigating the Concept Tree
- [ ] `screenshot-concept-tree.png` - Concept tree showing expanded hierarchy with different node types
- [ ] `screenshot-goto-uri.png` - Go to URI input field
- [ ] `screenshot-breadcrumb.png` - Breadcrumb showing: Home > Scheme > Parent > Child > Current
- [ ] `screenshot-deprecated-concept.png` - Deprecated concept in tree with badge

### Viewing Details
- [ ] `screenshot-concept-details.png` - Full concept details panel
- [ ] `screenshot-details-header.png` - Details header showing copy and expand buttons

### Searching
- [ ] `screenshot-search-panel.png` - Search panel with input and results
- [ ] `screenshot-search-settings.png` - Search settings popover

### Recent History
- [ ] `screenshot-recent-history.png` - Recent history panel showing visited concepts and schemes
- [ ] `screenshot-clear-history.png` - Clear history confirmation dialog

### Settings
- [ ] `screenshot-settings-dialog.png` - Settings dialog with all options

---

## Image Guidelines

- **Format**: PNG preferred (for sharp text)
- **Size**: 800-1200px width recommended
- **Theme**: Use light mode for consistency (unless showing dark mode feature)
- **Content**: Use sample/public data, avoid sensitive information
- **Annotations**: Add red boxes/arrows if highlighting specific UI elements

## Updating README.md

After adding images, update the placeholders in README.md:

```markdown
<!-- Before -->
<!-- IMAGE: screenshot-first-launch.png -->
<!-- Caption: Initial screen showing the endpoint configuration prompt -->

<!-- After -->
![Initial screen showing the endpoint configuration prompt](screenshot-first-launch.png)
```
