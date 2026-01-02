# AE SKOS

Browser-based SKOS vocabulary browser and explorer. Connect to any SPARQL endpoint and browse SKOS concept schemes directly in your browser.

## Features

- **Direct SPARQL Connection** - No backend required, connects directly to SPARQL endpoints via Fetch API
- **Hierarchical Browsing** - Navigate concept hierarchies with an expandable tree view
- **Multi-language Support** - Automatic language detection with configurable priorities per endpoint
- **Full-text Search** - Search across labels with autocomplete suggestions
- **Concept Details** - View all properties, relations, and documentation for concepts
- **Endpoint Analysis** - Automatic detection of named graphs, duplicates, and available languages
- **Persistent Settings** - Endpoints and preferences saved to localStorage

## Prerequisites

- Node.js 18+
- npm 9+
- A SPARQL endpoint with CORS enabled

## Getting Started

### Installation

```bash
# Clone the repository
git clone https://github.com/cognizone/augmented-semantics.git
cd augmented-semantics/ae-skos

# Install dependencies
npm install
```

### Development

```bash
# Start development server
npm run dev
```

The app will be available at `http://localhost:5173`

### Build

```bash
# Type-check and build for production
npm run build

# Preview production build
npm run preview
```

### Testing

```bash
# Run tests in watch mode
npm test

# Run tests once
npm run test:run

# Run tests with coverage
npm run test:coverage
```

## Usage

1. **Add an Endpoint** - Click the endpoint dropdown and add a SPARQL endpoint URL
2. **Select a Scheme** - Choose a concept scheme from the detected schemes
3. **Browse Concepts** - Navigate the hierarchy or use search to find concepts
4. **View Details** - Click any concept to see its full details

### Example Endpoints

| Name | URL |
|------|-----|
| DBpedia | `https://dbpedia.org/sparql` |
| Wikidata | `https://query.wikidata.org/sparql` |
| EU Publications | `https://publications.europa.eu/webapi/rdf/sparql` |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Vue 3 + Composition API |
| Language | TypeScript (strict mode) |
| Build | Vite |
| State | Pinia |
| Routing | Vue Router |
| UI | PrimeVue |
| Testing | Vitest |

## Project Structure

```
ae-skos/
├── src/
│   ├── components/
│   │   ├── common/          # Shared components (EndpointManager, etc.)
│   │   └── skos/            # SKOS-specific components
│   ├── composables/         # Vue composables (useLabelResolver, etc.)
│   ├── services/            # SPARQL service, logger
│   ├── stores/              # Pinia stores (endpoint, language, settings)
│   ├── types/               # TypeScript type definitions
│   └── views/               # Route views
├── public/                  # Static assets
└── spec/                    # Specifications (in parent directory)
```

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

## CORS Requirements

For browser-based direct connections, the SPARQL endpoint must have CORS enabled:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Accept
```

Most public SPARQL endpoints (DBpedia, Wikidata, etc.) have CORS enabled by default.

## License

MIT
