[← Back to User Manual](index.md)

# Viewing Details

## Concept Details

When a concept is selected, the right panel shows comprehensive information:

<img src="screenshots/concept-details.png" alt="Concept details panel" width="500">

The details panel shows the following sections (each only appears if data is available):

- **Labels & Notation** — Preferred, alternative, and hidden labels, plus notation codes. Language tags are shown when a label's language differs from your preferred language.
- **Titles** — Dublin Core titles (dct:title, dc:title) and RDFS labels, if present
- **Documentation** — Definition, description, comment, scope note, history/change/editorial notes, examples
- **Hierarchy** — Broader (parent) and narrower (child) concepts, clickable to navigate
- **Relations** — Related concepts (skos:related), clickable to navigate
- **Mappings** — Links to equivalent concepts in other vocabularies: exact match, close match, broad match, narrow match, related match
- **Collections** — Which collections this concept belongs to
- **Schemes** — Which concept schemes this concept is in
- **Metadata** — Creator, publisher, rights, license, identifier, status, version, dates (issued, created, modified), deprecation
- **Other Properties** — Any additional RDF properties not covered above

## Header Actions

The details header includes action buttons:

<!-- IMAGE: screenshots/details-header.png -->
![Details header showing copy and expand buttons](screenshots/details-header.png)

| Button | Action |
|--------|--------|
| 📋 | Copy URI to clipboard |
| <img src="icon-link.svg" height="16"> | Copy as "Label" \<URI\> format |
| ↗️ | Open URI in new tab |
