# Augmented Semantics

AI-powered toolkit for Semantic Web technologies.

## Architecture

Browser-only tools that connect directly to SPARQL endpoints via HTTP. No backend server required.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Vue 3 + Composition API |
| Language | TypeScript (strict) |
| Build | Vite |
| State | Pinia |
| Routing | Vue Router |
| UI | PrimeVue |

## Project Structure

- `/spec` - Tool specifications and documentation
  - `/spec/overview.md` - High-level overview of all tools
  - `/spec/common/` - Common components (prefix: `com`)
    - `com01-EndpointManager.md` - SPARQL endpoint management
    - `com02-StateManagement.md` - State architecture and events
    - `com03-ErrorHandling.md` - Errors, loading, empty states
    - `com04-URLRouting.md` - Deep linking and sharing
    - `com05-SPARQLPatterns.md` - Unified query patterns
    - `com06-Security.md` - Security considerations
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
  - `/spec/task/` - Implementation task lists
    - `ae-skos-tasks.md` - AE SKOS implementation plan

## Tools

| Tool | Folder | Status | Description |
|------|--------|--------|-------------|
| AE SKOS | `ae-skos` | Spec ready | SKOS vocabulary browser |
| AE RDF | `ae-rdf` | Planned | RDF data browser |
| AE OWL | `ae-owl` | Planned | OWL ontology viewer |
| AE SHACL | `ae-shacl` | Planned | SHACL validation |

## Conventions

- Folder names: lowercase with hyphens (e.g., `ae-skos`)
- Tool names: uppercase with space (e.g., `AE SKOS`)
- Spec file prefix: `com` (common), `sko` (skos), `rdf` (rdf), `owl` (owl), `sha` (shacl)
- Vue components: `<script setup lang="ts">` syntax
- State: Pinia stores per com02-StateManagement

## Storage Keys

| Key | Purpose |
|-----|---------|
| `ae-endpoints` | Saved SPARQL endpoints |
| `ae-language` | Language preferences |
| `ae-skos-scheme` | Last selected scheme |
| `ae-skos-history` | Recently viewed concepts |
