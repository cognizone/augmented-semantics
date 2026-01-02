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

- [x] scheme label now uses full language priority list (not just preferred/fallback)
- [x] duplicate labels fixed via deduplication in sortLabels composable
- [x] SKOS-XL labels: displayed on new line, grouped by literalForm, collapse count shown for duplicates
- [x] endpoint add progress: shows elapsed time (e.g., "Testing connection... (3s)")

- [x] recent concepts now uses full screen height (removed Listbox max-height)
- [x] SKOS-XL format: width fit-content, not full width
- [x] concept scheme shown as root in tree with sitemap icon, auto-expanded
- [x] other properties: added deduplication by value+lang
- [x] prefixes in other properties: already working via resolveUris

- [x] test connection success message auto-dismisses after 3 seconds
- [x] created useElapsedTime composable for progress indicators (shows after 2s delay)
- [x] endpoint add uses generic elapsed time composable
- [x] URI of concept moved closer to label (margin-top reduced to 0.125rem)
- [x] labels have visual separator (middle dot ·) between them
- [x] recent concepts uses full vertical space (Listbox height fixes)
- [x] language settings added to EndpointManager:
  - globe button in actions column opens language dialog
  - detects languages with counts from endpoint
  - drag-drop reorderable priority list
  - auto-adds detected languages (sorted alphabetically)
  - per-endpoint configuration persisted to localStorage
- [x] test connection success message fades out slowly (1s transition)
- [x] elapsed time shows on language detection progress (after 2s delay)
- [x] removed LIMIT 50 on language detection query

- [x] SKOS-XL labels hidden when value matches regular SKOS label, with "(N XL hidden)" indicator
- [x] language selection now uses full priority list (not just preferred/fallback)
- [x] ConceptTree, ConceptDetails, SearchBox all use full priorities + current override
- [x] ConceptTree watch now triggers on priorities array or current change
- [x] elapsed time delay reduced from 2s to 1s for faster feedback
- [x] prefix display bug fixed: empty prefix string no longer treated as falsy

- [x] concept scheme labels now follow same rendering rules as concepts:
  - SKOS-XL support (skosxl:prefLabel/skosxl:literalForm)
  - priority order: prefLabel > xlPrefLabel > title > rdfsLabel
  - uses current language override + full priorities list
  - watch triggers on language changes

- [x] elapsed time shown on endpoint connecting (EndpointSelector)
- [x] elapsed time shown on concept tree loading

- [x] documentation properties (Definition, Scope Note, etc.) show language tag first
- [x] documentation properties use grid layout: lang tag aligned, text wraps below itself

## Backlog

(none) 