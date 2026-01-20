# AE SKOS

Browser-based SKOS vocabulary browser and explorer.

## Overview

AE SKOS allows users to browse, search, and explore SKOS (Simple Knowledge Organization System) vocabularies from any SPARQL endpoint directly in the browser.

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Browser                     │
│  ┌─────────────────────────────────────┐    │
│  │            AE SKOS App              │    │
│  │  ┌──────────┐  ┌──────────────────┐ │    │
│  │  │ Endpoint │  │   SKOS Browser   │ │    │
│  │  │ Manager  │  │   Components     │ │    │
│  │  └────┬─────┘  └────────┬─────────┘ │    │
│  │       │                 │           │    │
│  │       └────────┬────────┘           │    │
│  │                ▼                    │    │
│  │         SPARQL Service              │    │
│  └────────────────┬────────────────────┘    │
└───────────────────┼─────────────────────────┘
                    │ HTTP (Fetch API)
                    ▼
           ┌────────────────┐
           │ SPARQL Endpoint │
           │ (CORS enabled)  │
           └────────────────┘
```

## Common Specs

These common specifications apply to all components:

| Spec | Description |
|------|-------------|
| [com02-StateManagement](../common/com02-StateManagement.md) | State architecture, events, initialization |
| [com03-ErrorHandling](../common/com03-ErrorHandling.md) | Errors, loading states, empty states |
| [com04-URLRouting](../common/com04-URLRouting.md) | Deep linking, bookmarking, sharing |
| [com05-SPARQLPatterns](../common/com05-SPARQLPatterns.md) | Unified SPARQL query patterns |

## Components

| # | Component | Spec | Description |
|---|-----------|------|-------------|
| com01 | EndpointManager | [com01-EndpointManager](../common/com01-EndpointManager.md) | SPARQL endpoint connection and management |
| sko01 | LanguageSelector | [sko01-LanguageSelector](./sko01-LanguageSelector.md) | Language detection and selection |
| sko02 | SchemeSelector | [sko02-SchemeSelector](./sko02-SchemeSelector.md) | Scheme listing and selection |
| sko03 | ConceptTree | [sko03-ConceptTree](./sko03-ConceptTree.md) | Hierarchical browsing and breadcrumbs |
| sko04 | ConceptDetails | [sko04-ConceptDetails](./sko04-ConceptDetails.md) | Property display for selected concept |
| sko05 | SearchBox | [sko05-SearchBox](./sko05-SearchBox.md) | Search and autocomplete |
| sko06 | Utilities | [sko06-Utilities](./sko06-Utilities.md) | Copy, raw view, history |
| sko08 | DeveloperTools | [sko08-DeveloperTools](./sko08-DeveloperTools.md) | Debug logging and development settings |
| sko10 | PropertyAnalysis | [sko10-PropertyAnalysis](./sko10-PropertyAnalysis.md) | Property comparison across detail types |

## Technology

- **Frontend**: Modern reactive framework (Vue.js, React, or Svelte)
- **Storage**: localStorage for preferences and history
- **Connection**: Direct SPARQL via Fetch API (requires CORS-enabled endpoint)

## UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│ [Endpoint ▼]  [Scheme ▼]  [Language ▼]     [🔍 Search...]   │
├──────────────────────┬──────────────────────────────────────┤
│                      │                                      │
│   Concept Tree       │   Concept Details                    │
│                      │                                      │
│   ▼ Top Concept 1    │   URI: http://example.org/concept/1  │
│     ├─ Child 1       │   ─────────────────────────────────  │
│     │  ├─ Grandchild │   prefLabel: Example Concept         │
│     │  └─ ...        │   altLabel: Alt name, Other name     │
│     └─ Child 2       │   definition: Lorem ipsum...         │
│   ▶ Top Concept 2    │                                      │
│   ▶ Top Concept 3    │   Broader: [Parent Concept]          │
│                      │   Narrower: [Child 1] [Child 2]      │
│                      │   Related: [Related Concept]         │
│                      │                                      │
├──────────────────────┴──────────────────────────────────────┤
│ Breadcrumb: Scheme > Top Concept > Parent > Current         │
└─────────────────────────────────────────────────────────────┘
```

## Responsive Layout

### Breakpoints

| Breakpoint | Width | Layout |
|------------|-------|--------|
| Desktop | ≥1024px | Side-by-side panels |
| Tablet | 768-1023px | Collapsible tree panel |
| Mobile | <768px | Stacked panels with tabs |

### Desktop (≥1024px)

```
┌─────────────────────────────────────────────────────────────┐
│ [Endpoint ▼]  [Scheme ▼]  [Language ▼]     [🔍 Search...]   │
├──────────────────────┬──────────────────────────────────────┤
│   Concept Tree       │   Concept Details                    │
│   (300-400px)        │   (remaining width)                  │
├──────────────────────┴──────────────────────────────────────┤
│ Breadcrumb                                                  │
└─────────────────────────────────────────────────────────────┘
```

### Tablet (768-1023px)

```
┌─────────────────────────────────────────────────────────────┐
│ [☰] [Endpoint ▼] [Scheme ▼] [🌐] [🔍]                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Concept Details (full width)                              │
│                                                             │
│   Tree opens as slide-out panel [☰]                         │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ Breadcrumb                                                  │
└─────────────────────────────────────────────────────────────┘
```

### Mobile (<768px)

```
┌─────────────────────────────────┐
│ [☰]  AE SKOS  [🔍]              │
├─────────────────────────────────┤
│ [Tree] [Details] [Search]       │  ← Tab navigation
├─────────────────────────────────┤
│                                 │
│   Active tab content            │
│   (full width, scrollable)      │
│                                 │
├─────────────────────────────────┤
│ Breadcrumb (scrollable)         │
└─────────────────────────────────┘
```

### Touch Interactions

| Desktop | Mobile |
|---------|--------|
| Click to select | Tap to select |
| Hover for tooltips | Long-press for tooltips |
| Right-click context menu | Long-press context menu |
| Scroll wheel | Swipe to scroll |
| Drag to resize panels | Swipe to switch tabs |

### Toolbar Adaptation

| Desktop | Tablet | Mobile |
|---------|--------|--------|
| Full dropdowns | Icon + dropdown | Hamburger menu |
| Search input visible | Search icon → expand | Search in tab |
| All controls visible | Grouped controls | Menu drawer |

## Status

Spec ready
