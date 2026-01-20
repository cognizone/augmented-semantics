# Property Gap Analysis: Concept vs Scheme vs Collection Details

## Executive Summary

Analysis of all properties across the three detail types reveals **consistent property support**. All metadata properties are now supported across ConceptDetails, SchemeDetails, and CollectionDetails.

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
| deprecated | `owl:deprecated` | ✅ | ✅ | ✅ | All consistent |
| created | `dct:created` | ✅ | ✅ | ✅ | All consistent |
| modified | `dct:modified` | ✅ | ✅ | ✅ | All consistent |
| issued | `dct:issued` | ✅ | ✅ | ✅ | All consistent |
| versionInfo | `owl:versionInfo` | ✅ | ✅ | ✅ | All consistent |
| status | `dct:status` | ✅ | ✅ | ✅ | All consistent |
| identifier | `dc:identifier` | ✅ | ✅ | ✅ | All consistent |
| creator | `dct:creator` | ✅ | ✅ | ✅ | All consistent |
| publisher | `dct:publisher` | ✅ | ✅ | ✅ | All consistent |
| rights | `dct:rights` | ✅ | ✅ | ✅ | All consistent |
| license | `dct:license` | ✅ | ✅ | ✅ | All consistent |
| ccLicense | `cc:license` | ✅ | ✅ | ✅ | All consistent |
| seeAlso | `rdfs:seeAlso` | ✅ | ✅ | ✅ | All consistent |

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

**All gaps have been addressed.** All metadata properties are now consistent across Concept, Scheme, and Collection detail types.

---

## Completed Improvements

The following improvements have been implemented:

### Documentation Properties
- ✅ **`comments` (rdfs:comment)** - Consistent across all types
- ✅ **`description` (dct:description)** - Consistent across all types

### Metadata Properties Added to ConceptDetails
- ✅ **`issued` (dct:issued)** - Publication date
- ✅ **`versionInfo` (owl:versionInfo)** - Version information
- ✅ **`creator` (dct:creator)** - Creator URIs
- ✅ **`publisher` (dct:publisher)** - Publisher URIs
- ✅ **`rights` (dct:rights)** - Rights URIs
- ✅ **`license` (dct:license)** - License URIs
- ✅ **`ccLicense` (cc:license)** - Creative Commons license URIs

### Metadata Properties Added to SchemeDetails
- ✅ **`status` (dct:status)** - Status (extracts URI fragment)
- ✅ **`identifier` (dc:identifier)** - Identifiers

### Metadata Properties Added to CollectionDetails
- ✅ **`deprecated` (owl:deprecated)** - Deprecation flag
- ✅ **`created` (dct:created)** - Creation date
- ✅ **`modified` (dct:modified)** - Modification date
- ✅ **`issued` (dct:issued)** - Publication date
- ✅ **`versionInfo` (owl:versionInfo)** - Version information
- ✅ **`status` (dct:status)** - Status (extracts URI fragment)
- ✅ **`identifier` (dc:identifier)** - Identifiers
- ✅ **`creator` (dct:creator)** - Creator URIs
- ✅ **`publisher` (dct:publisher)** - Publisher URIs
- ✅ **`rights` (dct:rights)** - Rights URIs
- ✅ **`license` (dct:license)** - License URIs
- ✅ **`ccLicense` (cc:license)** - Creative Commons license URIs
- ✅ **`seeAlso` (rdfs:seeAlso)** - Related resource URIs
