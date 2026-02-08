[← Back to User Manual](index.md)

# Search & History

## Searching

### Search Interface

Click the **Search** tab in the left sidebar to access the search panel.

<!-- IMAGE: screenshots/search-panel.png -->
![Search panel with input and results](screenshots/search-panel.png)

### Basic Search

1. Enter your search term
2. Press Enter or click the search button
3. Results appear below

Results show:
- Concept label and notation
- Which field matched (prefLabel, altLabel, definition, notation)
- The scheme containing the concept

### Search Settings

Click the settings icon (⚙️) next to the search input to open the Settings dialog to the Search section.

**Search in:**
- Preferred Labels (default: on)
- Alternative Labels (default: on)
- Definitions (default: off)

**Match Mode:**

| Mode | Description |
|------|-------------|
| Contains | Substring match anywhere (default) |
| Starts with | Prefix match at the beginning |
| Exact | Full label must match |
| Regex | Regular expression pattern |

**Scope:**
- Current scheme only (default when a scheme is selected)
- All schemes - search across the entire endpoint

Settings are saved automatically and persist across sessions. When you change settings, any active search re-runs automatically.

### Navigating Results

Click any search result to:
- Select that concept
- Reveal it in the tree (expanding ancestors as needed)
- Show its details in the right panel

---

## Recent History

### Viewing History

Click the **Recent** tab in the left sidebar to see your browsing history.

<!-- IMAGE: screenshots/recent-history.png -->
![Recent history panel showing visited concepts and schemes](screenshots/recent-history.png)

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

<!-- IMAGE: screenshots/clear-history.png -->
![Clear history confirmation dialog](screenshots/clear-history.png)

### History Persistence

History is saved to your browser's localStorage and persists across sessions. Up to 50 items are stored.
