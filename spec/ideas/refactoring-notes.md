# Component Refactoring Notes

## Current Large Components

| Component | Lines | Status |
|-----------|-------|--------|
| ConceptTree.vue | 868 | Partially refactored ✓ |
| EndpointWizard.vue | 920 | New - monitor |
| ConceptDetails.vue | 789 | Refactored ✓ |
| SchemeDetails.vue | 682 | Refactored ✓ |
| SearchBox.vue | 605 | Acceptable |
| EndpointManager.vue | 513 | Refactored ✓ |

## ConceptTree.vue - Partially Done

**Completed (Jan 2025):**
- Extracted `utils/concept-tree.ts` with `pickBestNotation` and `compareNodes`
- Created `composables/useConceptBindings.ts` for SPARQL result processing
- Removed ~185 lines of duplicate result processing code
- Added comprehensive tests for both utilities and composable
- Created `composables/useConceptTreeQueries.ts` for SPARQL query building (106 lines removed)
- Shared label resolution pattern between top concepts and children queries
- Added 16 tests for query structure validation

**Remaining opportunities:**
- Extract `useConceptTreePagination` composable
- Create `ConceptTreeNode.vue` child component
- Create `ConceptTreeGotoUri.vue` child component

## ConceptDetails.vue - Done

**Completed (Jan 2025):**
- Added `getSorted` factory function for DRY computed properties
- Created `documentationConfig` array to replace 6 duplicate template blocks
- Created `mappingsConfig` array to replace 5 duplicate template blocks
- Reduced from 913 to 789 lines (~14% reduction)

## SchemeDetails.vue - Done

**Completed (Jan 2025):**
- Added `metadataLinksConfig` array for creator, publisher, rights, license
- Replaced 4 duplicate template blocks with single config-driven loop
- Already had `getSorted` factory, `documentationConfig`, `labelConfig`
- Reduced from 727 to 682 lines (~6% reduction)

## Completed Refactoring

- **EndpointManager** (Jan 2025): Split into EndpointWizard + composables
  - Created: `useEndpointForm`, `useEndpointTest`, `useEndpointAnalysis`, `useEndpointCapabilities`, `useLanguagePriorities`
  - Removed: `EndpointFormDialog.vue`, `EndpointLanguageDialog.vue`, `EndpointCapabilitiesDialog.vue`
