# rdf01: Query Library + Capability Gating

## Purpose

Define the **query library** and **capability gating rules** for endpoint analysis.
All analysis sections must declare:
- required capabilities
- safe fallback strategy
- failure behavior (unknown/partial)

This spec is separate so the query library can evolve without rewriting the main analysis spec.

---

## Concepts

### Query Definition (standard fields)

Each query in the library is described with:
- `id`: stable identifier
- `section`: analysis section name
- `mode`: `optimistic` | `safe`
- `capabilities`: list of required capabilities
- `priority`: `high` | `normal` | `low`
- `timeoutMs`
- `resultFormat`: `bindings` | `boolean`
- `notes`

### Capabilities (detected)

Minimum capability set:
- `jsonResults`: supports SPARQL JSON results
- `xmlResults`: supports SPARQL XML results
- `cors`: browser-accessible CORS
- `namedGraphs`: supports GRAPH pattern queries
- `aggregates`: supports COUNT/SUM/AVG/GROUP BY
- `subqueries`: supports subselects
- `values`: supports VALUES
- `bind`: supports BIND
- `propertyPaths`: supports property paths (e.g., `rdf:rest*/rdf:first`)
- `orderBy`: supports ORDER BY
- `limitOffset`: supports LIMIT/OFFSET
- `serviceDescription`: exposes `sd:` metadata

Capabilities should be detected once and cached per endpoint.

### Query Modes

- **Optimistic**: broader scans, heavier aggregates, fewer queries.
- **Safe**: smaller scoped queries, chunked paging, minimal constructs.

---

## Minimal Acceptable Capability Set

To consider an endpoint **usable for full analysis**, require:
- result parsing: `jsonResults` **or** `xmlResults`
- `aggregates`, `orderBy`, `limitOffset`
- `values`, `subqueries`, `propertyPaths`
- `namedGraphs`

If any of these are missing, the endpoint is marked **limited** and the
analysis runner should prefer **safe mode** and mark impacted sections
as `partial` or `unknown`.

If both `jsonResults` and `xmlResults` are unavailable, the endpoint is **unsupported**
and all sections should be marked `unknown` with a failure record.

---

## Result Format Detection (JSON/XML) + Fallback

Run a tiny `ASK { ?s ?p ?o }` query with:
- `Accept: application/sparql-results+json, application/sparql-results+xml;q=0.9`
- include `format=json` on POST/GET to support endpoints that ignore Accept

Detection behavior:
- If response parses as JSON → `jsonResults: true`
- If response parses as XML → `xmlResults: true`
- If neither → mark both false and record failure

Execution behavior:
- Prefer JSON parsing when both are supported
- Fallback to XML parsing when JSON fails

Reuse suggestion:
- Use the `executeSparql` + XML parsing logic from `ae-skos/curation/_shared/analyze.ts`
  as a shared helper in ae-rdf analysis (move to `ae-rdf/analysis/_shared/`).

---

## Capability Gating Rules

### Global Rules

- If both `jsonResults` and `xmlResults` are false, **abort** all analysis and record `unknown` for all sections.
- If `jsonResults` is false but `xmlResults` is true, proceed using XML parser.
- If `aggregates` is false, fallback to **safe** variants that avoid GROUP BY where possible.
- If `subqueries` is false, avoid nested SELECT; run multi-step queries instead.
- If `values` is false, replace VALUES lists with UNION blocks (safe mode only).
- If `propertyPaths` is false, skip list traversal queries and mark those fields `unknown`.
- If `namedGraphs` is false, skip graph inventory and treat all queries as default-graph.

### Section-level Rules

Each section must declare:
- `requiredCapabilities`
- `fallbackMode` (`safe` or `skip`)
- `partialAllowed` (`true`/`false`)

Example:

| Section | Required | Fallback | Partial | Notes |
|---------|----------|----------|---------|-------|
| Graph inventory | namedGraphs, aggregates | skip | false | No graph listing without GRAPH support |
| Type inventory | aggregates | safe | true | safe uses per-type queries |
| Cardinality | aggregates | safe | true | safe uses per-type/per-property counts |
| Datatypes | aggregates | safe | true | safe reduces to top-N only |
| Value distributions | aggregates, orderBy | safe | true | safe uses per-property LIMITs |

---

## Query Library Sections

### Capability Probes
- Minimal ASK/SELECT queries to detect features.
- Must be very small and fast.

### Graph Inventory
- List graphs + counts (optimistic)
- Safe: per-graph COUNT with hard limits

### Type Inventory
- Optimistic: `SELECT ?type (COUNT(*) AS ?count)`
- Safe: page over types, count per type

### Predicate Inventory
- Optimistic: `SELECT ?p (COUNT(*) AS ?count)`
- Safe: per-predicate counts in chunks

### Type → Property Matrix
- Optimistic: GROUP BY on `?type ?p`
- Safe: per-type property listing + per-property counts

### Cardinality
- Optimistic: `AVG`, `MIN`, `MAX` on per-subject counts
- Safe: per-subject counts sampled + bucketed

### Datatypes + Languages
- Optimistic: GROUP BY `DATATYPE()` / `LANG()`
- Safe: per-property top datatypes / langs only

### Value Distributions
- Optimistic: distinct counts + top-N values
- Safe: top-N only, skip distinct if expensive

### Suspect Value Checks
- Optimistic: coverage checks via aggregates
- Safe: sampled checks or per-type targeted queries

---

## Gating Algorithm

1) Detect capabilities.
2) For each section:
   - If required capabilities missing, apply fallback mode.
   - If fallback fails, mark section `unknown`.
3) For each query:
   - If it fails or times out, retry safe variant (if available).
   - Record failure and partial results.

---

## Example: Type Inventory Queries

**Optimistic**
```
SELECT ?type (COUNT(?s) AS ?count)
WHERE { ?s a ?type }
GROUP BY ?type
ORDER BY DESC(?count)
```

**Safe**
```
SELECT DISTINCT ?type WHERE { ?s a ?type } LIMIT 1000 OFFSET 0
```
Then run per-type counts in small batches.

---

## Output Requirements

Each section records:
- `status`: ok | partial | failed | unknown
- `strategy`: optimistic | safe | mixed
- `capabilitiesUsed`
- `durationMs`
- `notes` (if downgraded)

All query failures are recorded in `failures` with:
- `queryId`, `section`, `reason`, `durationMs`, `mode`

---

## Capabilities Output Example

```json
{
  "capabilities": {
    "jsonResults": true,
    "xmlResults": true,
    "cors": false,
    "namedGraphs": true,
    "aggregates": true,
    "subqueries": true,
    "values": true,
    "bind": true,
    "propertyPaths": true,
    "orderBy": true,
    "limitOffset": true,
    "serviceDescription": false
  },
  "notes": [
    "JSON parsing preferred; XML available as fallback.",
    "No service description detected; graph list derived via GRAPH queries."
  ]
}
```

---

## Query Definition JSON Examples

### Minimal Schema (informal)
```json
{
  "id": "string",
  "section": "string",
  "mode": "optimistic | safe",
  "capabilities": ["string", "..."],
  "priority": "high | normal | low",
  "timeoutMs": "number",
  "resultFormat": "bindings | boolean",
  "query": "string",
  "params": ["string", "..."],
  "paging": {
    "limit": "number",
    "offsetStart": "number",
    "offsetStep": "number"
  },
  "notes": "string"
}
```

### Optimistic Query (aggregate)
```json
{
  "id": "type-inventory-optimistic",
  "section": "types",
  "mode": "optimistic",
  "capabilities": ["jsonResults", "aggregates"],
  "priority": "high",
  "timeoutMs": 20000,
  "resultFormat": "bindings",
  "query": "SELECT ?type (COUNT(?s) AS ?count) WHERE { ?s a ?type } GROUP BY ?type ORDER BY DESC(?count)",
  "notes": "Broad aggregate query; fails fast on weak endpoints."
}
```

### Safe Query (paged discovery)
```json
{
  "id": "type-inventory-safe",
  "section": "types",
  "mode": "safe",
  "capabilities": ["jsonResults"],
  "priority": "high",
  "timeoutMs": 8000,
  "resultFormat": "bindings",
  "query": "SELECT DISTINCT ?type WHERE { ?s a ?type } LIMIT 1000 OFFSET 0",
  "paging": { "limit": 1000, "offsetStart": 0, "offsetStep": 1000 },
  "notes": "Discovers types in pages; follow-up per-type counts run separately."
}
```

### Safe Query with Graph Scope
```json
{
  "id": "graph-count-safe",
  "section": "graphs",
  "mode": "safe",
  "capabilities": ["jsonResults", "namedGraphs"],
  "priority": "normal",
  "timeoutMs": 8000,
  "resultFormat": "bindings",
  "query": "SELECT (COUNT(*) AS ?count) WHERE { GRAPH <{graphUri}> { ?s ?p ?o } }",
  "params": ["graphUri"],
  "notes": "Per-graph count; used after graph discovery."
}
```

### Failure Record Example
```json
{
  "queryId": "datatype-distribution-optimistic",
  "section": "datatypes",
  "mode": "optimistic",
  "reason": "timeout",
  "durationMs": 20000,
  "message": "Query exceeded timeout; safe fallback scheduled."
}
```

---

## Open Questions

- How to expose partial/unknown status in the UI?
