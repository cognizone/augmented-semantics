# sko09: Curation Workflow

Separate workflow for managing curated SPARQL endpoints outside the main application.

## Overview

The curation workflow allows maintainers to:
- Add new SPARQL endpoints with minimal configuration
- Run endpoint analysis to detect SKOS content
- Customize analysis output per endpoint
- Merge all curated endpoints into the app's data file

## Folder Structure

```
ae-skos/curation/
├── _shared/                     # Shared utilities
│   └── analyze.ts               # Reusable analysis logic
├── {endpoint-name}/             # One folder per endpoint
│   ├── input/
│   │   └── config.json          # Minimal input configuration
│   ├── output/
│   │   └── endpoint.json        # Full curated endpoint data
│   └── curate.ts                # Curation script
├── curate-all.ts                # Curate all endpoints + merge
└── merge.ts                     # Combines all outputs
```

## Input Configuration

Each endpoint has a minimal `input/config.json`:

```json
{
  "name": "ERA Data Interop",
  "url": "https://data-interop.era.europa.eu/api/sparql",
  "description": "European Union Agency for Railways..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name for the endpoint |
| `url` | string | Yes | SPARQL endpoint URL |
| `description` | string | No | Human-readable description |

## Output Format

The curation script generates `output/endpoint.json`:

```json
{
  "name": "ERA Data Interop",
  "url": "https://data-interop.era.europa.eu/api/sparql",
  "description": "...",
  "analysis": {
    "hasSkosContent": true,
    "supportsNamedGraphs": true,
    "skosGraphCount": 3,
    "schemeUris": ["..."],
    "schemeCount": 101,
    "schemesLimited": false,
    "languages": [
      { "lang": "en", "count": 3509 },
      { "lang": "es", "count": 376 }
    ],
    "totalConcepts": 3439,
    "relationships": {
      "hasInScheme": true,
      "hasTopConceptOf": true,
      "hasHasTopConcept": true,
      "hasBroader": true,
      "hasNarrower": true,
      "hasBroaderTransitive": false,
      "hasNarrowerTransitive": false
    },
    "analyzedAt": "2026-01-15T21:04:59.537Z"
  },
  "suggestedLanguagePriorities": ["en", "es", ...]
}
```

## Curation Scripts

### Default Pattern

Most endpoints use the standard curation flow:

```typescript
import { curate } from '../_shared/analyze'

curate(import.meta.dirname)
```

This:
1. Reads `input/config.json`
2. Analyzes the SPARQL endpoint
3. Generates language priorities
4. Writes `output/endpoint.json`

### Custom Pattern

When an endpoint needs special handling:

```typescript
import { readConfig, analyzeEndpoint, generateLanguagePriorities, writeOutput } from '../_shared/analyze'

const config = readConfig(import.meta.dirname)
const analysis = await analyzeEndpoint(config.url)

if (!analysis) {
  console.error('No SKOS content found')
  process.exit(1)
}

// Custom logic here
const priorities = generateLanguagePriorities(analysis.languages || [])
priorities.unshift('de')  // Force German first

writeOutput(import.meta.dirname, {
  ...config,
  analysis,
  suggestedLanguagePriorities: priorities
})
```

## Shared Module

`_shared/analyze.ts` provides:

| Function | Description |
|----------|-------------|
| `readConfig(dir)` | Read `input/config.json` from directory |
| `analyzeEndpoint(url)` | Run full SKOS analysis on endpoint |
| `generateLanguagePriorities(languages)` | Sort languages with 'en' first |
| `writeOutput(dir, data)` | Write `output/endpoint.json` |
| `curate(dir)` | Convenience wrapper for standard flow |

## Merge Script

`merge.ts` combines all outputs into `src/data/endpoints.json`:

```bash
cd ae-skos && npx tsx curation/merge.ts
```

The merge script:
1. Globs all `*/output/endpoint.json` files
2. Validates required fields (name, url, analysis)
3. Sorts alphabetically by name
4. Writes to `../src/data/endpoints.json`

## Adding a New Endpoint

1. Create folder structure:
   ```bash
   mkdir -p curation/new-endpoint/input
   mkdir -p curation/new-endpoint/output
   ```

2. Create `input/config.json`:
   ```json
   {
     "name": "New Endpoint",
     "url": "https://example.org/sparql",
     "description": "Description of the endpoint"
   }
   ```

3. Create `curate.ts`:
   ```typescript
   import { curate } from '../_shared/analyze'
   curate(import.meta.dirname)
   ```

4. Run curation:
   ```bash
   npx tsx curation/new-endpoint/curate.ts
   ```

5. Merge all endpoints:
   ```bash
   npx tsx curation/merge.ts
   ```

## Re-running Analysis

To update a single endpoint:
```bash
cd ae-skos && npx tsx curation/era/curate.ts
```

To update all endpoints:
```bash
cd ae-skos && npx tsx curation/curate-all.ts
```

This curates all endpoints sequentially and automatically runs the merge script at the end.

## Current Endpoints

| Folder | Name | URL |
|--------|------|-----|
| `agrovoc` | AGROVOC | agrovoc.fao.org |
| `bnf` | BnF | data.bnf.fr |
| `cordis` | Cordis Datalab | cordis.europa.eu |
| `dbpedia` | DBpedia | dbpedia.org |
| `era` | ERA Data Interop | data-interop.era.europa.eu |
| `eu-publications` | EU Publications Office | publications.europa.eu |
| `fedlex` | Fedlex | fedlex.data.admin.ch |
| `legilux` | Legilux | data.legilux.public.lu |
| `nerc` | NERC Vocabulary Server | vocab.nerc.ac.uk |
