# Augmented Semantics

Browser-only tools for exploring Semantic Web data: SKOS vocabularies and any RDF, live from SPARQL endpoints. No backend, and no data leaves your browser.

## Tools

| Tool | Description | Live | Docs | Status |
|------|-------------|------|------|--------|
| **AE SKOS** | Browse SKOS vocabularies and thesauri | [Open](https://cognizone.github.io/augmented-semantics/skos/) | [Manual](https://cognizone.github.io/augmented-semantics/ae-skos/) | Available |
| **AE RDF** | Explore any RDF dataset: types, resources, faceted browsing, and a read-only SPARQL console | [Open](https://cognizone.github.io/augmented-semantics/rdf/) | [Manual](https://cognizone.github.io/augmented-semantics/ae-rdf/) | Available |
| AE OWL | View OWL ontologies | | | Planned |
| AE SHACL | Validate with SHACL shapes | | | Planned |

## Links

- [Documentation](https://cognizone.github.io/augmented-semantics/): user guides, configuration, and deployment
- [Downloads](https://cognizone.github.io/augmented-semantics/downloads.html): desktop apps and releases

## Development

TypeScript / Vue 3 monorepo managed with pnpm workspaces. Each tool lives in its own folder ([`ae-skos/`](./ae-skos/), [`ae-rdf/`](./ae-rdf/)); see the [documentation](https://cognizone.github.io/augmented-semantics/) for configuration and deployment.

---

Built by [Cognizone](https://cogni.zone).
