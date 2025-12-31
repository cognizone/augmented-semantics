# Augmented Semantics - Tool Specifications

This folder contains specifications for the Augmented Semantics toolkit - a suite of AI-powered tools for working with Semantic Web technologies.

## Architecture

All tools are **browser-only** applications that connect directly to SPARQL endpoints via HTTP. No backend server required.

## Common Components

| # | Component | Description |
|---|-----------|-------------|
| com01 | [EndpointManager](./common/com01-EndpointManager.md) | Endpoint connection, management, and analysis |
| com02 | [StateManagement](./common/com02-StateManagement.md) | State architecture, events, initialization |
| com03 | [ErrorHandling](./common/com03-ErrorHandling.md) | Errors, loading states, empty states |
| com04 | [URLRouting](./common/com04-URLRouting.md) | Deep linking, bookmarking, sharing |
| com05 | [SPARQLPatterns](./common/com05-SPARQLPatterns.md) | Unified SPARQL query patterns |

## Tools Overview

| Tool | Description | Status |
|------|-------------|--------|
| [AE SKOS](./ae-skos/) | SKOS vocabulary browser and explorer | Spec ready |
| [AE RDF](./ae-rdf/) | RDF data manipulation and transformation | Planned |
| [AE OWL](./ae-owl/) | OWL ontology editing and reasoning | Planned |
| [AE SHACL](./ae-shacl/) | SHACL shape validation and generation | Planned |

## Naming Convention

- **AE** = Augmented Editor / Augmented Engine
- Folder names: lowercase with hyphens (e.g., `ae-skos`)
- Tool names: uppercase with space (e.g., `AE SKOS`)

## Specification Structure

Each tool folder contains numbered spec files with app prefix:
- `{prefix}00-overview.md` - Tool overview and architecture
- `{prefix}01-ComponentName.md` - Component specifications

Prefixes: `com` (common), `sko` (ae-skos), `rdf` (ae-rdf), `owl` (ae-owl), `sha` (ae-shacl)
