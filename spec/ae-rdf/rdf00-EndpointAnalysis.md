# rdf00: Endpoint Analysis + Curation Spec

## Executive Summary

Define a generic, best-in-class SPARQL endpoint analysis pipeline for **ae-rdf**. The goal is a repeatable analysis workflow that produces:
- a **deep structural profile** (types, properties, inheritance)
- **data quality signals** (missing values, wrong datatypes, suspect values)
- **value distributions** (distinct counts, heavy hitters, stats)
- a **curation script** per endpoint that captures domain-specific expectations and suppressions

This spec enumerates everything needed for a robust curation system and analysis output used by the app.

---

## Goals

- Profile any SPARQL endpoint (graph-aware) with minimal configuration.
- Detect types and property usage per type, including inheritance.
- Compute cardinality stats per property per type.
- Compute datatype/language distributions for literals.
- Compute value distributions (distinct count, top-N, numeric/date histograms).
- Detect suspect values (missing, invalid, outliers, mismatched datatype/range).
- Produce a curation script per endpoint to encode domain expectations.
- Produce machine-readable analysis artifacts for UI and reporting.

## Non-Goals (for now)

- Full OWL reasoning or heavy inference.
- Complete dereferencing/validation of external IRIs.
- Huge-scale ETL beyond sampling and paging.
- Automatic correction of data (read-only analysis).

---

## Analysis Workflow (Folder Pattern)

Use the same pattern as ae-skos curation:

```
ae-rdf/analysis/
├── _shared/
│   ├── analyze.ts               # shared query/analysis logic
│   └── report.ts                # report formatting helpers
├── {endpoint-name}/
│   ├── input/
│   │   ├── config.json          # endpoint config
│   │   └── rules.json           # curation rules (expectations/thresholds)
│   ├── output/
│   │   ├── analysis.json        # full analysis artifact
│   │   └── endpoint.json        # curated summary for app
│   └── curate.ts                # per-endpoint entry script
├── curate-all.ts                # run all endpoints
└── merge.ts                     # merge curated outputs for app
```

---

## Input Configuration

### `input/config.json` (minimal)

Required fields:
- `name`: display name
- `url`: SPARQL endpoint URL

Optional fields:
- `description`
- `defaultGraph`
- `graphs` (allowlist)
- `auth` (token/basic)
- `timeoutMs`
- `pageSize`
- `sampling` (`none` | `light` | `standard` | `deep`)
- `prefixes` (custom prefix map)
- `namespaceAllowlist` / `namespaceDenylist`
- `supports` (manual overrides: JSON results, service description, etc.)

### `input/rules.json` (curation expectations)

Purpose: encode domain expectations + suppressions.

Suggested schema:
- `typeRules` keyed by type IRI
  - `requiredProps`
  - `recommendedProps`
  - `maxCardinality`
  - `expectedDatatypes`
  - `expectedRanges` (IRI vs literal, class constraints)
- `propertyRules` keyed by property IRI
  - `expectedDatatypes`
  - `expectedRanges`
  - `preferredLangs`
  - `maxDistinctValues`
- `suppressedIssues` list
- `thresholds` (outlier detection, coverage %, etc.)

---

## Output Artifacts

### `output/analysis.json` (full analysis)

Top-level sections:
- `meta`: analyzedAt, durationMs, endpoint info
- `capabilities`: JSON results, CORS, SERVICE description, graph support
- `graphs`: list + triple counts + distinct s/p/o counts
- `types`: type inventory + counts + subclass closure
- `properties`: predicate inventory + usage counts
- `typePropertyMatrix`: per type/per property usage
- `cardinality`: min/median/avg/max + distribution buckets
- `datatypes`: per property literal datatype distribution
- `languages`: per property language tag distribution
- `valueDistributions`: distinct counts, top-N values, histograms
- `suspectValues`: list of issues with severity and evidence
- `sections`: per-section status + strategy + timing
- `failures`: list of failed queries with reasons (timeout, parse error, etc.)

### `output/endpoint.json` (curated summary for app)

Concise summary consumed by ae-rdf UI:
- dataset capabilities and size
- type inventory (top-N) + property usage
- key distributions (counts + a few top values)
- issue summary (counts by severity)
- links to full analysis

---

## Analysis Phases

### Phase 0: Capability Detection
- JSON result support
- CORS (browser access)
- SPARQL service description (`sd:`)
- SPARQL 1.1 feature check (subqueries, aggregates, VALUES)

### Phase 1: Graph Inventory
- list named graphs (`GRAPH ?g`) + counts
- counts per graph: triples, distinct subjects/predicates/objects

### Phase 2: Type Inventory
- `rdf:type` counts
- top types + long tail
- subclass hierarchy (`rdfs:subClassOf`)
- inferred closure (lightweight, no full reasoning)

### Phase 3: Property Inventory
- predicate list + usage counts
- property usage per type
- type → property matrix

### Phase 4: Cardinality Analysis
- for each (type, property):
  - min/median/avg/max
  - distribution buckets (0, 1, 2-3, 4-10, 11+)
- identify required vs optional heuristically

### Phase 5: Datatype + Language Analysis
- literal datatypes per property
- language tags per property
- mismatch detection (mixed datatypes for “should-be” properties)

### Phase 6: Value Distributions
- distinct count per property
- top-X literal values with `p` (frequency / total, 0..1)
- numeric ranges + histograms (min/median/avg/max)
- date ranges + gaps
- string length distribution
- IRI namespace distribution (internal vs external)

### Value Distribution Sampling Plan

Sampling is **tiered** and property-aware. Use the property triple count
(`predicateCount`) as the baseline for deciding full vs sampled analysis.

**Light**
- Full if `predicateCount` <= 10k
- Else sample with:
  - `targetRate`: 0.01% (0.0001)
  - `sampleCap`: 2,000 values per property
- If computed `sampleSize` < 200, mark confidence `low`

**Standard**
- Full if `predicateCount` <= 100k
- Else sample with:
  - `targetRate`: 0.1% (0.001)
  - `sampleCap`: 10,000 values per property
- If computed `sampleSize` < 500, mark confidence `low`

**Deep**
- **Always full enumeration** (no sampling)
- Use chunked paging per property to avoid timeouts
- If full enumeration still fails after retries, mark the section `unknown`
  (do not fall back to sampling in deep mode)

**Sampling method**
- Prefer **stable hash sampling** on subjects or values (repeatable).
- Fallback to `ORDER BY RAND() LIMIT N` only if hashing is unsupported.

**Output metadata**
- `sampleMethod`: `full` | `hash` | `rand`
- `sampleRate`: numeric (1.0 for full)
- `sampleSize`
- `confidence`: `high` | `medium` | `low`

**Top-X configuration**
- `topX` is configurable; default `250`.
- Each top value includes `count` and `p = count / total` (0..1).

### Phase 7: Inheritance + Shape Derivation
- property inheritance along `rdfs:subClassOf`
- effective property sets per type
- detect conflicting property usage in hierarchy

### Reasoning Modes (Asserted vs Inferred Rollup)

Default analysis is **asserted-only** (no inference). An optional rollup can
compute **inferred counts** using `rdfs:subClassOf` (and optionally
`rdfs:subPropertyOf`) strictly for summary views.

Recommended output separation:
- `types.asserted`: explicit `rdf:type` counts
- `types.inferredRollup`: superclass counts using subclass closure (deduped)
- `properties.asserted`: explicit predicate usage counts
- `properties.inferredRollup` (optional): includes `subPropertyOf` rollup

Messy data handling:
- Treat **explicit assertions as primary truth**.
- Rollups must **dedupe by subject** to avoid double counting when superclass
  is sometimes explicitly asserted and sometimes not.
- Record **coverage gaps**:
  - `missingSuperclassAssertionRate`: proportion of instances where the
    superclass is *not* explicitly asserted (but inferred via subclass).
  - `mixedAssertionRate`: classes where some instances assert the superclass
    and others do not (indicative of inconsistency).

Rollup mode should be clearly labeled in the UI and output as **inferred**.

### Phase 8: Data Quality / Suspect Values

Checks (all produce evidence + counts):
- missing required/recommended values (from rules + heuristics)
- datatype mismatches
- literal vs IRI range mismatches
- outlier numeric/date values
- invalid language tags
- invalid IRIs / broken prefixes
- duplicate labels per type
- orphaned resources (no inbound/outbound links)
- type-less resources with heavy property usage
- properties used inconsistently across a type

### Phase 9: Trend / Baseline Diff (optional)
- compare against previous `analysis.json`
- highlight regressions or large shifts

---

## Heuristics (when rules are absent)

- **Required property candidate**: coverage >= 95% of instances.
- **Recommended property**: coverage >= 60%.
- **Datatype expectation**: dominant datatype >= 90%.
- **Range expectation**: dominant range (IRI vs literal) >= 90%.
- **Outliers**: values beyond 3x IQR or domain-specific thresholds.

---

## SPARQL Query Templates (Required)

- count triples, distinct s/p/o
- list graphs and graph counts
- list types and counts
- list predicates and counts
- type → property matrix
- cardinality per (type, property)
- datatype distribution per property
- language distribution per property
- distinct count per property
- top-N values per property
- numeric/date stats

All templates must support:
- graph scoping
- paging / sampling
- timeouts + safe limits

---

## Query Strategy (Optimistic vs Safe)

The analysis runner supports **dual query modes**:

### Optimistic (fast path)
- Fewer, broader queries using GROUP BY and aggregates.
- Higher LIMITs and wider scans.
- Uses inferred capabilities (JSON results, aggregates, subqueries).
- Best for small/medium endpoints with good performance.

### Safe (conservative fallback)
- Many small, focused queries (per type / per property).
- Lower LIMITs, stricter timeouts, chunked paging.
- Avoids heavy constructs; degrades to minimal ASK/COUNT when needed.
- Best for large or unstable endpoints.

### Fallback Behavior
- Try **optimistic** first.
- On failure/timeout, retry with **safe** for that section.
- If both fail, mark the section as **unknown** and record failure info.

---

## Performance Strategy

- Sampling tiers (`light`, `standard`, `deep`).
- Use LIMIT + OFFSET or hashed sampling on subjects.
- Cache query results to avoid re-running.
- Timeouts and max-result guards per query.
- For large endpoints, prefer safe-mode queries by default.

---

## Failure Handling + Unknowns

- Each section has a status record: `ok`, `partial`, `failed`, `unknown`.
- Store per-section metadata in `sections`:
  - `strategy`: `optimistic` | `safe` | `mixed`
  - `status`: see above
  - `durationMs`
  - `notes` (optional)
- Record query failures in `failures`:
  - `section`, `queryId`, `reason`, `durationMs`, `sample` (if available)
- If data is unavailable, prefer explicit `unknown` states over nulls.
- (Optional) emit a sidecar `analysis-errors.json` for verbose errors.

---

## UI Expectations (ae-rdf)

- Type tree + counts + inheritance
- Property matrix (types × properties)
- Cardinality charts per property/type
- Datatype + language distributions
- Value histograms (numeric/date) + top values
- Suspect values list with filters + evidence
- Exportable report (JSON/CSV)

---

## Testing

- Query builder unit tests (query shape + parameters)
- Analysis pipeline tests with mocked results
- Integration tests against known endpoints
- Snapshot tests for `analysis.json`

---

## Open Questions

- Preferred output format for charts (bins, percentiles)?
