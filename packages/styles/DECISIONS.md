# @ae/styles - Style Decisions

This document tracks which styles are shared and why.

## Principle

**Only extract styles to this package when used by 2+ apps.**

## Shared Styles

| File | Contents | Used By | Reason |
|------|----------|---------|--------|
| `theme.css` | CSS variables (colors, fonts, status) | ae-skos, ae-rdf | Visual consistency |
| `base.css` | Reset, body, scrollbar, focus states | ae-skos, ae-rdf | Every app needs these |
| `icons.css` | Material Symbols setup, size utilities | ae-skos, ae-rdf | Shared icon system |

## App-Specific Styles (NOT shared)

### ae-skos (`ae-skos/src/style.css`)

| Style | Reason for NOT sharing |
|-------|------------------------|
| `.icon-folder`, `.icon-label`, `.icon-leaf` | SKOS-specific semantic type colors |
| `.action-btn`, `.section-title`, `.lang-tag` | Only used by ae-skos |
| `.sr-only`, `.mono`, `.truncate` | Only ae-skos uses these currently |
| `.dropdown-trigger`, `.select-compact` | Only ae-skos uses PrimeVue dropdowns |
| `.p-menu`, `.p-select`, `.p-dialog`, `.p-button` | Only ae-skos uses PrimeVue components |

## Adding New Shared Styles

Before adding a style to this package:

1. Verify it's used by 2+ apps
2. Add entry to the table above
3. Remove from app-specific stylesheets
4. Test both apps still work

## Removing Shared Styles

If a style is no longer used by 2+ apps:

1. Move it back to the app that uses it
2. Update the table above
3. Remove from this package
