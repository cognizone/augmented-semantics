# Augmented Semantics

AI-powered toolkit for Semantic Web technologies.

## Architecture

Browser-only tools that connect directly to SPARQL endpoints via HTTP. No backend server required.

## Project Structure

- `/spec` - Tool specifications and documentation
  - `/spec/overview.md` - High-level overview of all tools
  - `/spec/common/` - Common components (prefix: `com`)
    - `com01-EndpointManager.md` - SPARQL endpoint management
    - `com02-StateManagement.md` - State architecture and events
    - `com03-ErrorHandling.md` - Errors, loading, empty states
    - `com04-URLRouting.md` - Deep linking and sharing
    - `com05-SPARQLPatterns.md` - Unified query patterns
  - `/spec/ae-skos/` - AE SKOS specifications (prefix: `sko`)
    - `sko00-overview.md` - Overview and architecture
    - `sko01-LanguageSelector.md` - Language detection/selection
    - `sko02-SchemeSelector.md` - Scheme selection
    - `sko03-ConceptTree.md` - Hierarchical browsing
    - `sko04-ConceptDetails.md` - Concept property display
    - `sko05-SearchBox.md` - Search and autocomplete
    - `sko06-Utilities.md` - Copy, raw view, history
  - `/spec/ae-rdf/` - AE RDF specifications
  - `/spec/ae-owl/` - AE OWL specifications
  - `/spec/ae-shacl/` - AE SHACL specifications

## Tools

| Tool | Folder | Description |
|------|--------|-------------|
| AE SKOS | `ae-skos` | SKOS vocabulary management |
| AE RDF | `ae-rdf` | RDF data manipulation |
| AE OWL | `ae-owl` | OWL ontology editing |
| AE SHACL | `ae-shacl` | SHACL validation |

## Conventions

- Folder names: lowercase with hyphens (e.g., `ae-skos`)
- Tool names: uppercase with space (e.g., `AE SKOS`)
- Spec file prefix: `com` (common), `sko` (skos), `rdf` (rdf), `owl` (owl), `sha` (shacl)
