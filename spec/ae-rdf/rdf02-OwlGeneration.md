# rdf02: OWL Generation From Analysis

## Purpose

Define how to generate a **minimal, SEMIC-friendly OWL ontology** from the
ae-rdf analysis outputs, with explicit control over **ontology scope** and
**inheritance** so we do not mix domain classes with system/metadata classes.

This spec is intentionally conservative: it prefers **authoritative ontology
inputs** over heuristics derived from data.

---

## Goals

- Generate a clean OWL file for the domain ontology (classes + properties).
- Allow **manual scoping** to exclude system/metadata vocabularies.
- Use **authoritative inheritance** (rdfs:subClassOf / rdfs:subPropertyOf)
  from a provided ontology file when available.
- Keep **only classes and properties actually present in the endpoint** by default.
- Avoid duplicating or inventing inheritance not present in the ontology.
- Provide a transparent report of what was included/excluded and why.

## Non-Goals

- Full OWL reasoning or restriction reconstruction.
- Automatic ontology alignment across multiple vocabularies.
- Deep domain inference beyond observed data and supplied ontologies.

---

## Inputs

### Required

- `output/analysis.json` and `output/types/*.json` from the endpoint analysis.

### Optional (but strongly recommended)

- A domain ontology Turtle file (e.g., EURIO) that defines:
  - `rdfs:subClassOf` hierarchy
  - `rdfs:subPropertyOf` hierarchy
  - property types (object vs datatype)
  - labels/comments

---

## CLI Usage

```
npx tsx analysis/owl.ts --endpoint ae-rdf/analysis/{endpoint}
```

Options:

| Flag | Default | Description |
|------|---------|-------------|
| `--endpoint <path>` | `.` | Endpoint directory |
| `--out <path>` | `<endpoint>/output/ontology.owl.ttl` | Output TTL file |
| `--report <path>` | `<endpoint>/output/ontology.report.json` | Report JSON |
| `--config <path>` | `<endpoint>/input/ontology.json` | Config JSON |
| `--fresh` | off | Ignore previous output and delete existing OWL file |

---

## Configuration (per endpoint)

Add a new config file in the endpoint input folder:

```
ae-rdf/analysis/{endpoint}/input/ontology.json
```

### Suggested schema

```json
{
  "ontology": {
    "file": "ontology.ttl",
    "baseIri": "http://data.europa.eu/s66#",
    "versionInfo": "generated-2026-02-05",
    "reuseOutputAsBase": true
  },
  "scope": {
    "classesFromEndpointOnly": true,
    "propertiesFromEndpointOnly": true,
    "includeNamespaces": [
      "http://data.europa.eu/s66#",
      "http://www.w3.org/2004/02/skos/core#"
    ],
    "excludeNamespaces": [
      "http://www.openlinksw.com/",
      "http://www.w3.org/ns/ldp#",
      "http://www.openlinksw.com/schemas/virtrdf#"
    ],
    "classAllowlist": [],
    "classDenylist": [],
    "propertyAllowlist": [],
    "propertyDenylist": [],
    "rootClasses": [],
    "includeSubclasses": true,
    "includeSuperclasses": false,
    "includeSuperproperties": true,
    "includeInverseProperties": true
  },
  "inheritance": {
    "mode": "ontology-only",
    "manualEdges": {
      "subClassOf": [],
      "subPropertyOf": []
    }
  },
  "generation": {
    "emit": [
      "rdfs:label",
      "rdfs:comment",
      "rdfs:isDefinedBy",
      "skos:broadMatch",
      "skos:closeMatch",
      "skos:narrowMatch",
      "owl:inverseOf"
    ],
    "domainRangePolicy": "unique",
    "rangePolicy": "datatype-unique",
    "policyNotes": true,
    "policyNotePredicate": "vann:usageNote",
    "policyNoteTag": "SEMIC",
    "blankLineAfterDot": true
  }
}
```

### Notes

- `includeNamespaces` and `excludeNamespaces` are applied to both classes and
  properties. The denylist wins.
- `classesFromEndpointOnly` / `propertiesFromEndpointOnly` enforce endpoint-only
  filtering before allow/deny lists.
- `rootClasses` can be used to force inclusion of specific top-level classes.
- `rootClasses`, allowlists, and denylists accept short URIs (qnames), resolved
  via the prefix map + ontology prefixes.
- `includeSubclasses` recursively includes subclasses of each root (observed only
  when `classesFromEndpointOnly` is true).
- `includeSuperclasses` can optionally keep parents of observed classes (even if
  they are not directly present in the endpoint).
- Related types are **always included**: object-property ranges (from the ontology)
  are followed to add related classes recursively. Inverse properties are used to
  infer ranges when only the inverse has a declared domain.
- `includeSuperproperties` only adds super-properties if they are **used by the
  included classes** (or explicitly allowlisted). This avoids emitting unused
  super-properties that only serve as parents.
- `includeInverseProperties` ensures inverse properties are included whenever
  an included property declares `owl:inverseOf`.
- `reuseOutputAsBase` lets the previously generated OWL file act as an additional
  ontology input (incremental/manual edits preserved). The `--fresh` CLI flag
  disables this and deletes the existing OWL output before running.
- `generation.emit` lists the exact predicates to emit (short URIs/qnames allowed).
  If provided, it overrides the legacy boolean flags.
- `generation.blankLineAfterDot` adds an empty line after each `.` terminator in the
  serialized TTL for readability (post-process step). Prefix lines (`@prefix`/`@base`)
  are excluded, and the formatter ensures two blank lines after the final prefix.
- `inheritance.mode`:
  - `ontology-only` uses only the provided ontology for inheritance.
  - `ontology+manual` uses ontology plus manual edges.
  - `analysis-fallback` allows heuristics if ontology missing (last resort).
    **Not yet implemented.**

---

## OWL Generation Algorithm

### Step 1: Load inputs

- Read `analysis.json` and all `types/*.json`.
- If `ontology.file` is present, parse Turtle and extract:
  - Named classes
  - Named properties (object + datatype)
  - `rdfs:subClassOf` and `rdfs:subPropertyOf`
  - `rdfs:label`, `rdfs:comment`, `owl:versionInfo`

### Step 2: Build candidate class set

- If `rootClasses` is provided, start from those classes.
- Otherwise start from all `types.items[].type` in `analysis.json`.
- If `includeSubclasses` is enabled, add descendants from the ontology tree
  (observed only if `classesFromEndpointOnly` is true).
- If `includeSuperclasses` is enabled, add ancestors from the ontology tree.
- If `classesFromEndpointOnly` is false, also include ontology-defined classes.

### Step 3: Build candidate property set

- Collect all properties used by included classes from `types/*.json`.
- If `includeSuperproperties` is enabled, add parent properties **only when the
  parent is also used by included classes** (or explicitly allowlisted).
- If `propertiesFromEndpointOnly` is false, also include ontology properties.
- If a **super-property is used** by the included classes, **drop its subproperties**
  to avoid duplication (unless explicitly allowlisted).

### Step 4: Apply scope rules

Filter candidates by:

1. `excludeNamespaces`
2. `classDenylist` / `propertyDenylist`
3. If `includeNamespaces` is set, keep only those namespaces
4. If allowlists are provided, keep only those

Anything filtered out is recorded as **excluded** with a reason.

### Step 5: Determine inheritance

Default behavior:

- Use `rdfs:subClassOf` and `rdfs:subPropertyOf` from the ontology file.
- Ignore anonymous restrictions (`owl:Restriction`, blank nodes).
- If `inheritance.manualEdges` exists, merge those edges.
- If `includeSuperclasses` is false, keep only inheritance edges where both
  parent and child are included in the endpoint-derived class set.

If no ontology file is present and `inheritance.mode` is `analysis-fallback`
(**not yet implemented**):

- Optionally use analysis-derived subclass suggestions.
- Mark these edges as `heuristic` in the report.

### Step 6: Determine property type (object vs datatype)

Priority order:

1. Ontology file (`rdf:type owl:ObjectProperty` / `owl:DatatypeProperty`)
2. Analysis output:
   - If property values are all IRIs => object property
   - If property values include literals => datatype property
3. If mixed, keep as `rdf:Property` only and emit a warning.

### Step 7: Domains and ranges

Priority order:

1. **Only emit** when the property is used by a **single class** (within the
   included class set). If a property is used by multiple classes, omit both
   `rdfs:domain` and `rdfs:range`.
   This includes cases where the property appears on both a class and its
   superclass/subclass (still treated as multi‑use).
2. If eligible (single-class usage), prefer ontology (`rdfs:domain`, `rdfs:range`)
   when it is **single-valued**.
3. If no ontology range is present and the property is a datatype property,
   emit the single literal datatype **only if unambiguous**.

### Step 8: Emit OWL

- Emit `owl:Ontology` header:
  - `owl:versionInfo` from config if provided
- Emit classes:
  - `rdf:type owl:Class`
  - `rdfs:subClassOf` per inheritance graph
  - `rdfs:label` / `rdfs:comment` when available
  - other annotations when included in `generation.emit`
- Emit properties:
  - `rdf:type owl:ObjectProperty` or `owl:DatatypeProperty`
  - `rdfs:subPropertyOf` per inheritance graph
  - `rdfs:domain` / `rdfs:range` when known
  - other annotations when included in `generation.emit`

If `rdfs:isDefinedBy` is emitted and the object equals `ontology.baseIri`,
the generator will prefer the matching prefix form (e.g., `eurio:`) in the TTL.

`owl:disjointWith` is intentionally not emitted unless explicitly added to
`generation.emit`.

`rdfs:domain` is **not controlled by** `generation.emit`.
It follows `generation.domainRangePolicy`:
- `off`: never emit domain/range
- `unique`: emit only when a property is used by **exactly one class across the
  entire endpoint**
- `branch`: emit the **lowest common ancestor** of usage classes (when available)
  to cover cases where a property is specific to one inheritance branch

`rdfs:range` follows `generation.rangePolicy`:
- `off`: never emit range
- `unique`: emit only when a property is used by exactly one class across the endpoint
- `branch`: emit range only when the property maps to a single inheritance branch
- `ontology-only`: emit single named ranges from the ontology (ignore usage count)
- `datatype-unique`: emit range when the datatype is unambiguous (even if multi‑class)

When range is emitted for a multi‑class property, a policy note is added to the
property (predicate configurable via `policyNotePredicate`, defaults to
`vann:usageNote` to avoid mixing with `rdfs:comment`).
The note is prefixed by `[policyNoteTag]` (default `AE-OWL`).

---

## Output Artifacts

Per endpoint, write:

```
ae-rdf/analysis/{endpoint}/output/ontology.owl.ttl
ae-rdf/analysis/{endpoint}/output/ontology.report.json
```

### Report fields (suggested)

- included/excluded classes + reasons
- included/excluded properties + reasons
- inheritance edges used (ontology/manual/heuristic)
- property type decisions and conflicts
- domain/range decisions and confidence

---

## Notes on SEMIC Alignment

- Keep vocabulary clean and minimal.
- Avoid system vocabularies (e.g., vendor namespaces).
- Favor explicit ontology input over inference.
- Document any heuristics used in the report.
