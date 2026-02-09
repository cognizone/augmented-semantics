[← Back to User Manual](index.md)

# 6. Troubleshooting

- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Connection Issues](#connection-issues)
- [Display Issues](#display-issues)
- [Performance](#performance)
- [Getting Help](#getting-help)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `/` | Focus search input |
| `Escape` | Close dialogs |
| `↑` / `↓` | Navigate tree (when focused) |

## Connection Issues

**"Failed to connect to endpoint"**
- Verify the endpoint URL is correct
- Check if the endpoint requires authentication
- Ensure CORS is enabled on the endpoint — if a **CORS Issue** tag appears on the endpoint in the [Endpoint Manager](01-endpoints.md#endpoint-status-indicators), the endpoint is blocking browser access. A CORS browser extension can work around this.
- Try accessing the endpoint directly in your browser

**"No concept schemes found"**
- The endpoint may not contain SKOS data
- Try running the analysis again
- Check if data is in a named graph (configure in wizard)

## Display Issues

**Labels showing URIs instead of text**
- The endpoint may not have labels in your preferred language
- Try adjusting language priorities in endpoint settings
- Some concepts may genuinely lack labels

**Tree not loading**
- Check browser console for errors
- The endpoint may be slow - wait for loading to complete
- Try refreshing the page

## Performance

**Slow loading**
- Large vocabularies take longer to load
- Tree loads in pages of 200 concepts
- Consider filtering by scheme if available

**Browser memory**
- Very large vocabularies may consume significant memory
- Try closing other browser tabs
- Refresh the page to clear cached data

## Getting Help

- **Issues**: Report bugs at [GitHub Issues](https://github.com/cognizone/augmented-semantics/issues)
- **Source Code**: [GitHub Repository](https://github.com/cognizone/augmented-semantics)

---

<p align="center">← <a href="05-settings.md">5. Settings</a> &nbsp; · &nbsp; <a href="index.md">User Manual</a></p>
