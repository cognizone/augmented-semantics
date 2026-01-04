# Component Refactoring Notes

## Components Identified for Future Refactoring

| Component | Lines | Priority |
|-----------|-------|----------|
| ConceptTree.vue | 1,173 | Critical |
| ConceptDetails.vue | 913 | High |
| SchemeDetails.vue | 727 | Medium-High |
| SearchBox.vue | 618 | Medium |
| EndpointFormDialog.vue | 438 | Medium |

## ConceptTree.vue - Top Priority

**Current issues:**
- Pagination, queries, navigation all mixed
- 5 watchers managing different concerns
- 200+ lines of utility functions
- Duplicate query logic

**Refactoring approach:**
- Extract `useConceptTreeQueries` composable
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
