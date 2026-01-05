# Component Refactoring Notes

## Current Large Components

| Component | Lines | Status |
|-----------|-------|--------|
| ConceptTree.vue | 974 | Partially refactored ✓ |
| EndpointWizard.vue | 920 | New - monitor |
| ConceptDetails.vue | 913 | Needs refactoring |
| SchemeDetails.vue | 727 | Needs refactoring |
| SearchBox.vue | 605 | Acceptable |
| EndpointManager.vue | 513 | Refactored ✓ |

## ConceptTree.vue - Partially Done

**Completed (Jan 2025):**
- Extracted `utils/concept-tree.ts` with `pickBestNotation` and `compareNodes`
- Created `composables/useConceptBindings.ts` for SPARQL result processing
- Removed ~185 lines of duplicate result processing code
- Added comprehensive tests for both utilities and composable

**Remaining opportunities:**
- Extract `useConceptTreeQueries` composable (SPARQL queries)
- Extract `useConceptTreePagination` composable
- Create `ConceptTreeNode.vue` child component
- Create `ConceptTreeGotoUri.vue` child component

## ConceptDetails.vue - Second Priority

**Current issues:**
- 5 identical mapping section blocks
- 15+ computed properties for sorting
- 700+ lines of template

**Refactoring approach:**
- Extract child components for each section (Labels, Documentation, Hierarchy, Mappings)
- Create reusable `MappingLink.vue` component

## SchemeDetails.vue - Third Priority

**Current issues:**
- Similar structure to ConceptDetails
- Large template with repeated patterns

**Refactoring approach:**
- Follow same pattern as ConceptDetails refactoring
- Extract composables for data fetching

## Completed Refactoring

- **EndpointManager** (Jan 2025): Split into EndpointWizard + composables
  - Created: `useEndpointForm`, `useEndpointTest`, `useEndpointAnalysis`, `useEndpointCapabilities`, `useLanguagePriorities`
  - Removed: `EndpointFormDialog.vue`, `EndpointLanguageDialog.vue`, `EndpointCapabilitiesDialog.vue`
