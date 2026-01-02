# Ideas

## Implemented

- [x] scrollbar should never be horizontal in tree. do multiline instead
- [x] scrollbar should be vertical in tree if too many items
- [x] languages that are not in the language list should be added automatically in order of language code
- [x] properties which are not in skos should be aligned/styled header same as other sections
- [x] properties which are not in skos need prefix
- [x] prefix must be fetched from prefix.cc (with local common prefixes fallback)
- [x] prefixes must be shown and sorted alphabetically
- [x] properties must be sorted alphabetically wrt prefix:name
- [x] Raw RDF dialog: wider (900px), taller (90vh), smaller font (0.7rem)
- [x] SKOS-XL prefLabel fallback when regular prefLabel not available
- [x] notation + label display consistent everywhere (tree, breadcrumb, details, chips)
- [x] breadcrumb horizontal layout with proper spacing

- [x] spacing between LABELS and Preferred is bigger than SCHEMES and In Scheme - fixed section-header margin
- [x] spacing between Concept label and URI can be a bit smaller - reduced from 0.5rem to 0.25rem

- [x] prefixes not showing (e.g., dct:created) - fixed: COMMON_PREFIXES now checked before cache

- [x] endpoint manager can be a bit wider so name of the endpoint get more space - increased from 700px to 850px
- [x] endpoint add button should show progress (testing connection, analyzing endpoint)

## Backlog

- scheme label should use language priority (code exists, may need endpoint-specific testing)
- duplicate labels showing (e.g., "anarchism en" twice) - see http://localhost:5173/?endpoint=https://data.europa.eu/sparql&scheme=http://eurovoc.europa.eu/100163&concept=http://eurovoc.europa.eu/1829
- SKOS-XL labels: put on new line, collapse duplicates, visual feedback for collapsed state
- endpoint add progress: show elapsed time (e.g., "Testing connection... (3s)")