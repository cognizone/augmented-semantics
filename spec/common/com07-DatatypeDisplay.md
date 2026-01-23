# com07 - Datatype Display Rules

This document defines how literal datatypes are stored and rendered across the app.

## Scope

Applies to all SKOS resource detail views (concept, scheme, collection) and all
sections that render literal values:

- Labels (pref/alt/hidden + dct:title/dc:title/rdfs:label)
- Documentation (definition, notes, etc.)
- SKOS-XL labels (literalForm)
- Metadata (created/modified/issued/versionInfo, etc.)
- Other properties (non-SKOS predicates)

## Core rules

1. **Datatype capture**
   - Every literal should retain its `datatype` if present in the SPARQL binding.
   - Language-tagged literals keep their `lang` and may also have a `datatype` if provided.

2. **RDF 1.1 plain literals**
   - A literal with no `lang` and no `datatype` is treated as `xsd:string`.
   - This inferred `xsd:string` is only shown if the user enables "Show xsd:string".

3. **Language-tagged literals**
   - If a literal has a language tag, **do not** fabricate or display a datatype tag.
   - The language tag is the primary qualifier for these values.

4. **Datatype tag visibility**
   - A datatype tag is shown only when "Show datatypes" is enabled.
   - `xsd:string` is hidden unless "Show xsd:string" is enabled.

5. **Value formatting**
   - Only temporal datatypes (`xsd:date`, `xsd:dateTime`, `xsd:time`) use
     specialized formatting for display.
   - All other datatypes render their literal value as-is.

6. **URI values**
   - URI values do not display datatype tags.
   - URI rendering uses standard link/fragment display rules.

## Rationale

These rules ensure consistent, datatype-aware rendering across all detail views
while respecting RDF 1.1 semantics and keeping the UI noise controlled by user
settings.

## Detail rendering (label loading)

To avoid visual flashing in detail views, labels that are fast to resolve are
loaded **before** rendering the details panel. Progressive loading is reserved
only for potentially large or slow sections (e.g., large narrower lists,
collections, or other heavy queries).

Implementation guideline:
- Do **not** render detail headers/label sections with URI fragment fallbacks.
- Await fast label loads (preferred label + small reference lists) before
  setting `details.value`.
- Keep progressive loading only for large lists or secondary sections.
