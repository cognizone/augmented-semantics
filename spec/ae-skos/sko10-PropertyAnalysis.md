# Property Gap Analysis: Concept vs Scheme vs Collection Details

## Executive Summary

Analysis of all properties across the three detail types reveals **some inconsistencies** in property support. ConceptDetails has 34 properties, SchemeDetails has 33 (with 1 unused), and CollectionDetails has 18. Documentation properties (`rdfs:comment`, `dct:description`) are now consistent across all three types.

---

## Namespace Prefixes

| Prefix | Namespace |
|--------|-----------|
| `skos:` | `http://www.w3.org/2004/02/skos/core#` |
| `skosxl:` | `http://www.w3.org/2008/05/skos-xl#` |
| `dct:` | `http://purl.org/dc/terms/` |
| `dc:` | `http://purl.org/dc/elements/1.1/` |
| `rdfs:` | `http://www.w3.org/2000/01/rdf-schema#` |
| `owl:` | `http://www.w3.org/2002/07/owl#` |
| `cc:` | `http://creativecommons.org/ns#` |

---

## Property Comparison Matrix

### 1. Labels (SKOS Core)

| Property | Predicate | Concept | Scheme | Collection | Notes |
|----------|-----------|:-------:|:------:|:----------:|-------|
| prefLabels | `skos:prefLabel` | ✅ | ✅ | ✅ | All consistent |
| altLabels | `skos:altLabel` | ✅ | ✅ | ✅ | All consistent |
| hiddenLabels | `skos:hiddenLabel` | ✅ | ✅ | ✅ | All consistent |
| notations | `skos:notation` | ✅ | ✅ | ✅ | All consistent |

### 2. Labels (SKOS-XL Extended)

| Property | Predicate | Concept | Scheme | Collection | Notes |
|----------|-----------|:-------:|:------:|:----------:|-------|
| prefLabelsXL | `skosxl:prefLabel` | ✅ | ✅ | ✅ | All consistent |
| altLabelsXL | `skosxl:altLabel` | ✅ | ✅ | ✅ | All consistent |
| hiddenLabelsXL | `skosxl:hiddenLabel` | ✅ | ✅ | ✅ | All consistent |

### 3. Alternative Labels (Dublin Core / RDFS)

| Property | Predicate | Concept | Scheme | Collection | Notes |
|----------|-----------|:-------:|:------:|:----------:|-------|
| dctTitles | `dct:title` | ✅ | ✅ | ✅ | All consistent |
| dcTitles | `dc:title` | ✅ | ✅ | ✅ | All consistent |
| rdfsLabels | `rdfs:label` | ✅ | ✅ | ✅ | All consistent |

### 4. Documentation Properties (SKOS)

| Property | Predicate | Concept | Scheme | Collection | Notes |
|----------|-----------|:-------:|:------:|:----------:|-------|
| definitions | `skos:definition` | ✅ | ✅ | ✅ | All consistent |
| scopeNotes | `skos:scopeNote` | ✅ | ✅ | ✅ | All consistent |
| notes | `skos:note` | ✅ | ✅ | ✅ | All consistent |
| historyNotes | `skos:historyNote` | ✅ | ✅ | ✅ | All consistent |
| changeNotes | `skos:changeNote` | ✅ | ✅ | ✅ | All consistent |
| editorialNotes | `skos:editorialNote` | ✅ | ✅ | ✅ | All consistent |
| examples | `skos:example` | ✅ | ✅ | ✅ | All consistent |

### 5. Documentation Properties (RDFS / Dublin Core)

| Property | Predicate | Concept | Scheme | Collection | Notes |
|----------|-----------|:-------:|:------:|:----------:|-------|
| comments | `rdfs:comment` | ✅ | ✅ | ✅ | All consistent |
| description | `dct:description` | ✅ | ✅ | ✅ | All consistent |

### 6. Metadata Properties

| Property | Predicate | Concept | Scheme | Collection | Notes |
|----------|-----------|:-------:|:------:|:----------:|-------|
| deprecated | `owl:deprecated` | ✅ | ✅ | ❌ | **GAP: Collection missing** |
| created | `dct:created` | ✅ | ✅ | ❌ | **GAP: Collection missing** |
| modified | `dct:modified` | ✅ | ✅ | ❌ | **GAP: Collection missing** |
| status | `dct:status` | ✅ | ❌ | ❌ | **GAP: Only Concept has it** |
| identifier | `dc:identifier` | ✅ | ❌ | ❌ | **GAP: Only Concept has it** |
| creator | `dct:creator` | ❌ | ✅ | ❌ | **GAP: Only Scheme has it** |
| publisher | `dct:publisher` | ❌ | ✅ | ❌ | **GAP: Only Scheme has it** |
| issued | `dct:issued` | ❌ | ✅ | ❌ | **GAP: Only Scheme has it** |
| versionInfo | `owl:versionInfo` | ❌ | ✅ | ❌ | **GAP: Only Scheme has it** |
| rights | `dct:rights` | ❌ | ✅ | ❌ | **GAP: Only Scheme has it** |
| license | `dct:license` | ❌ | ✅ | ❌ | **GAP: Only Scheme has it** |
| ccLicense | `cc:license` | ❌ | ✅ | ❌ | **GAP: Only Scheme has it** |
| seeAlso | `rdfs:seeAlso` | ✅ | ✅ | ❌ | **GAP: Collection missing** |

### 7. Relations (SKOS)

| Property | Predicate | Concept | Scheme | Collection | Notes |
|----------|-----------|:-------:|:------:|:----------:|-------|
| broader | `skos:broader` | ✅ | N/A | N/A | Concept-only |
| narrower | `skos:narrower` | ✅ | N/A | N/A | Concept-only |
| related | `skos:related` | ✅ | N/A | N/A | Concept-only |
| inScheme | `skos:inScheme` | ✅ | N/A | N/A | Concept-only |
| collections | `skos:member` (inverse) | ✅ | N/A | N/A | Concept-only |

### 8. Mappings (SKOS)

| Property | Predicate | Concept | Scheme | Collection | Notes |
|----------|-----------|:-------:|:------:|:----------:|-------|
| exactMatch | `skos:exactMatch` | ✅ | N/A | N/A | Concept-only |
| closeMatch | `skos:closeMatch` | ✅ | N/A | N/A | Concept-only |
| broadMatch | `skos:broadMatch` | ✅ | N/A | N/A | Concept-only |
| narrowMatch | `skos:narrowMatch` | ✅ | N/A | N/A | Concept-only |
| relatedMatch | `skos:relatedMatch` | ✅ | N/A | N/A | Concept-only |

### 9. Other

| Property | Predicate | Concept | Scheme | Collection | Notes |
|----------|-----------|:-------:|:------:|:----------:|-------|
| otherProperties | (all other predicates) | ✅ | ✅ | ✅ | All consistent |

---

## Gap Summary

### Gaps in CollectionDetails (Missing 5 properties)

| Property | Predicate | Priority | Rationale |
|----------|-----------|----------|-----------|
| deprecated | owl:deprecated | HIGH | Real-world data may have deprecated collections |
| created | dct:created | MEDIUM | Metadata completeness |
| modified | dct:modified | MEDIUM | Metadata completeness |
| seeAlso | rdfs:seeAlso | LOW | Rarely used for collections |

### Gaps in ConceptDetails (Missing 5 properties from Scheme)

| Property | Predicate | Priority | Rationale |
|----------|-----------|----------|-----------|
| creator | dct:creator | LOW | Usually scheme-level metadata |
| publisher | dct:publisher | LOW | Usually scheme-level metadata |
| issued | dct:issued | LOW | Usually scheme-level metadata |
| versionInfo | owl:versionInfo | LOW | Usually scheme-level metadata |
| rights/license | dct:rights/license | LOW | Usually scheme-level metadata |

### Gaps in SchemeDetails (Missing 2 properties from Concept)

| Property | Predicate | Priority | Rationale |
|----------|-----------|----------|-----------|
| status | dct:status | LOW | Rarely used for schemes |
| identifier | dc:identifier | MEDIUM | Could be useful for scheme identification |

---

## Recommendations

### HIGH Priority (Should Fix)

1. **Add `deprecated` to CollectionDetails** - Important for data quality indication

### MEDIUM Priority (Consider Adding)

2. **Add `created`/`modified` to CollectionDetails** - Metadata completeness
3. **Add `identifier` to SchemeDetails** - Useful for scheme identification

### LOW Priority (Skip Unless Requested)

4. Publishing metadata for Concepts (creator, publisher, etc.) - Typically scheme-level
5. Status for Schemes - Rarely used

---

## Completed Improvements

The following gaps have been addressed:

- ✅ **`comments` (rdfs:comment) added to ConceptDetails and CollectionDetails** - Now consistent with SchemeDetails
- ✅ **`description` (dct:description) added to ConceptDetails and CollectionDetails** - Now consistent with SchemeDetails
