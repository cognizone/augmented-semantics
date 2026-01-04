# Styling Guide

## Principle

**Only share styles when used by 2+ apps.** No premature abstraction.

## Structure

```
packages/styles/          # Shared styles (@ae/styles)
├── src/
│   ├── index.css        # Main entry
│   ├── theme.css        # CSS variables
│   ├── base.css         # Reset, body, scrollbar
│   └── icons.css        # Material Symbols
└── DECISIONS.md         # What's shared and why

ae-skos/src/style.css    # SKOS-specific styles (+ PrimeVue overrides)
ae-rdf/src/style.css     # RDF-specific styles
```

## Usage

Import shared styles before app-specific styles:

```typescript
// main.ts
import '@ae/styles'      // Shared styles first
import './style.css'     // App-specific styles second
```

## Design Tokens

### Colors

| Variable | Light | Dark | Usage |
|----------|-------|------|-------|
| `--ae-bg-base` | `#ffffff` | `#1e1e1e` | Main background |
| `--ae-bg-elevated` | `#f8f9fa` | `#252526` | Cards, panels |
| `--ae-bg-panel` | `#f3f4f6` | `#2d2d2d` | Sidebar |
| `--ae-bg-hover` | `#e5e7eb` | `#3e3e42` | Hover states |
| `--ae-border-color` | `#d1d5db` | `#3e3e42` | Borders |
| `--ae-text-primary` | `#1f2937` | `#cccccc` | Main text |
| `--ae-text-secondary` | `#6b7280` | `#969696` | Secondary text |
| `--ae-text-muted` | `#9ca3af` | `#6e6e6e` | Muted text |
| `--ae-accent` | `#007acc` | `#007acc` | Links, focus |
| `--ae-header-bg` | `#f9fafb` | `#2d2d2d` | Header bar |

### Status Colors

| Variable | Value | Usage |
|----------|-------|-------|
| `--ae-status-success` | `#22c55e` | Success states |
| `--ae-status-warning` | `#f59e0b` | Warning states |
| `--ae-status-error` | `#ef4444` | Error states |

### Fonts

| Variable | Value | Usage |
|----------|-------|-------|
| `--ae-font-sans` | Inter, system-ui, ... | UI text |
| `--ae-font-mono` | ui-monospace, ... | URIs, code |

## Icon System

Using [Material Symbols](https://fonts.google.com/icons) Outlined.

```html
<span class="material-symbols-outlined">icon_name</span>
```

Size utilities: `.icon-sm` (16px), `.icon-md` (20px), `.icon-lg` (24px), `.icon-xl` (32px)

## Adding New Styles

### To shared package

1. Verify style is used by 2+ apps
2. Add to appropriate file in `packages/styles/src/`
3. Update `packages/styles/DECISIONS.md`
4. Remove from app-specific stylesheets

### To app-specific

Add to `ae-{app}/src/style.css` with comment explaining why it's not shared.

## Dark Mode

Toggle via `.dark-mode` class on root element. All CSS variables automatically switch.

```typescript
document.documentElement.classList.toggle('dark-mode', isDark)
```
