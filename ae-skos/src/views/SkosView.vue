<script setup lang="ts">
/**
 * SkosView - Main SKOS browser view
 *
 * Layout with splitter: left panel (tree/search/history) + right panel (details).
 * Handles URL state synchronization for deep linking.
 *
 * @see /spec/common/com04-URLRouting.md
 */
import { computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUIStore, useConceptStore, useSchemeStore, useLanguageStore, useEndpointStore } from '../stores'
import { useConceptSelection } from '../composables'
import { URL_PARAMS } from '../router'
import ConceptTree from '../components/skos/ConceptTree.vue'
import ConceptDetails from '../components/skos/ConceptDetails.vue'
import SchemeDetails from '../components/skos/SchemeDetails.vue'
import CollectionDetails from '../components/skos/CollectionDetails.vue'
import SearchBox from '../components/skos/SearchBox.vue'
import RecentHistory from '../components/skos/RecentHistory.vue'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import TabPanels from 'primevue/tabpanels'
import TabPanel from 'primevue/tabpanel'

const route = useRoute()
const router = useRouter()
const uiStore = useUIStore()
const conceptStore = useConceptStore()
const schemeStore = useSchemeStore()
const languageStore = useLanguageStore()
const endpointStore = useEndpointStore()
const { selectConceptWithScheme, selectCollectionWithScheme } = useConceptSelection()

// Sidebar tab with computed getter/setter for v-model binding
const sidebarTab = computed({
  get: () => uiStore.sidebarTab,
  set: (value: 'browse' | 'search' | 'recent') => uiStore.setSidebarTab(value),
})

// Handle concept selection from tree or details panel - allows cross-scheme navigation
async function selectConceptInScheme(uri: string) {
  await selectConceptWithScheme(uri)
  uiStore.setSidebarTab('browse')
}

async function selectMemberConcept(uri: string) {
  await selectConceptWithScheme(uri, null, undefined, { preserveCollection: true })
  uiStore.setSidebarTab('browse')
}

// Handle concept selection from search - allow cross-scheme navigation
async function selectConceptFromSearch(uri: string) {
  await selectConceptWithScheme(uri)
}

// Handle collection selection
function selectCollection(uri: string) {
  // Store automatically clears concept selection, also clear scheme view
  schemeStore.viewScheme(null)
  conceptStore.selectCollectionWithEvent(uri)
  uiStore.setSidebarTab('browse')
}

// Handle history selection - may need to switch endpoint/scheme
async function selectFromHistory(entry: { uri: string; endpointUrl?: string; schemeUri?: string; type?: 'concept' | 'scheme' | 'collection' }) {
  // Handle scheme entries specially (not a concept selection)
  if (entry.type === 'scheme') {
    conceptStore.selectCollection(null)
    schemeStore.selectScheme(entry.uri)
    conceptStore.selectConcept(null)
    schemeStore.viewScheme(entry.uri)
    uiStore.setSidebarTab('browse')
    return
  }

  // Handle collection entries (with cross-scheme navigation support)
  if (entry.type === 'collection') {
    await selectCollectionWithScheme(entry.uri, entry.schemeUri, entry.endpointUrl)
    return
  }

  // Use unified selection for concepts (handles endpoint/scheme switching)
  // Store automatically clears collection selection
  await selectConceptWithScheme(entry.uri, entry.schemeUri, entry.endpointUrl)
}

// Computed
const showSidebar = computed(() => uiStore.sidebarOpen || uiStore.isDesktop)

// --- URL State Synchronization ---

// Flag to prevent circular updates
let isUpdatingFromUrl = false

// Track previous concept for history push detection
let previousConceptUri: string | null = null

// Update URL when state changes
function updateUrl() {
  if (isUpdatingFromUrl) return

  const query: Record<string, string> = {}

  // Add current endpoint URL (not ID) for shareability
  if (endpointStore.current) {
    query[URL_PARAMS.ENDPOINT] = endpointStore.current.url
  }

  // Add scheme URI (only when in scheme mode)
  if (schemeStore.rootMode === 'scheme' && schemeStore.selectedUri) {
    query[URL_PARAMS.SCHEME] = schemeStore.selectedUri
  }

  // Add concept URI
  if (conceptStore.selectedUri) {
    query[URL_PARAMS.CONCEPT] = conceptStore.selectedUri
  }

  // Add language if different from default
  if (languageStore.preferred && languageStore.preferred !== 'en') {
    query[URL_PARAMS.LANG] = languageStore.preferred
  }

  // Add search query
  if (conceptStore.searchQuery) {
    query[URL_PARAMS.SEARCH] = conceptStore.searchQuery
  }

  // Use push for concept navigation (enables back button), replace for other updates
  const conceptChanged = conceptStore.selectedUri !== previousConceptUri
  previousConceptUri = conceptStore.selectedUri

  if (conceptChanged && conceptStore.selectedUri) {
    router.push({ query })
  } else {
    router.replace({ query })
  }
}

// Restore state from URL on mount
function restoreFromUrl() {
  isUpdatingFromUrl = true

  const params = route.query

  // Restore language
  const lang = params[URL_PARAMS.LANG] as string | undefined
  if (lang) {
    languageStore.setPreferred(lang)
  }

  // Restore endpoint by URL
  const endpointUrl = params[URL_PARAMS.ENDPOINT] as string | undefined
  if (endpointUrl) {
    const endpoint = endpointStore.endpoints.find(e => e.url === endpointUrl)
    if (endpoint) {
      endpointStore.selectEndpoint(endpoint.id)
    }
  }

  // Restore scheme (will be applied after schemes load)
  const schemeUri = params[URL_PARAMS.SCHEME] as string | undefined
  if (schemeUri && schemeStore.rootMode === 'scheme') {
    // Store for later when schemes are loaded
    schemeStore.selectScheme(schemeUri)
  }

  // Restore concept (will be applied after tree loads)
  const conceptUri = params[URL_PARAMS.CONCEPT] as string | undefined
  if (conceptUri) {
    if (schemeStore.rootMode === 'collection') {
      void conceptStore.selectConceptWithEvent(conceptUri)
    } else {
      conceptStore.selectConcept(conceptUri)
    }
    // Initialize tracking to avoid pushing history on restore
    previousConceptUri = conceptUri
  }

  // Restore search
  const search = params[URL_PARAMS.SEARCH] as string | undefined
  if (search) {
    conceptStore.setSearchQuery(search)
  }

  isUpdatingFromUrl = false
}

// Watch state changes to update URL
watch(
  () => [
    endpointStore.current?.url,
    schemeStore.rootMode,
    schemeStore.selectedUri,
    conceptStore.selectedUri,
    languageStore.preferred,
    conceptStore.searchQuery,
  ],
  () => {
    updateUrl()
  },
  { deep: true }
)

// Watch route changes (back/forward navigation)
watch(
  () => route.query,
  (newQuery, oldQuery) => {
    // Only restore if concept changed (back/forward navigation)
    const newConcept = newQuery[URL_PARAMS.CONCEPT] as string | undefined
    const oldConcept = oldQuery?.[URL_PARAMS.CONCEPT] as string | undefined

    if (newConcept !== oldConcept) {
      isUpdatingFromUrl = true
      previousConceptUri = newConcept || null

      if (newConcept) {
        if (schemeStore.rootMode === 'collection') {
          void conceptStore.selectConceptWithEvent(newConcept)
        } else {
          conceptStore.selectConcept(newConcept)
        }
      } else {
        conceptStore.selectConcept(null)
      }

      isUpdatingFromUrl = false
    }
  }
)

// Restore state from URL on mount
onMounted(() => {
  restoreFromUrl()
})
</script>

<template>
  <div class="skos-view">
    <Splitter class="main-splitter" :gutterSize="4">
      <!-- Left Panel: Tree, Search, History -->
      <SplitterPanel
        v-if="showSidebar"
        :size="30"
        :minSize="20"
        class="left-panel"
      >
        <Tabs v-model:value="sidebarTab" class="sidebar-tabs">
          <TabList>
            <Tab value="browse">Browse</Tab>
            <Tab value="search">Search</Tab>
            <Tab value="recent">Recent</Tab>
          </TabList>
          <TabPanels>
            <TabPanel value="browse">
              <ConceptTree @select-concept="selectConceptInScheme" @select-collection="selectCollection" />
            </TabPanel>
            <TabPanel value="search">
              <SearchBox @select-concept="selectConceptFromSearch" />
            </TabPanel>
            <TabPanel value="recent">
              <RecentHistory @select-concept="selectFromHistory" />
            </TabPanel>
          </TabPanels>
        </Tabs>
      </SplitterPanel>

      <!-- Right Panel: Scheme, Collection, or Concept Details -->
      <SplitterPanel :size="70" :minSize="40" class="right-panel">
        <SchemeDetails
          v-if="schemeStore.viewingSchemeUri"
        />
        <ConceptDetails
          v-else-if="schemeStore.rootMode === 'collection' && conceptStore.selectedUri"
          @select-concept="selectConceptInScheme"
        />
        <CollectionDetails
          v-else-if="conceptStore.selectedCollectionUri"
          :collection-uri="conceptStore.selectedCollectionUri"
          @select-concept="selectConceptInScheme"
          @select-member="selectMemberConcept"
          @select-collection="selectCollection"
        />
        <ConceptDetails v-else @select-concept="selectConceptInScheme" />
      </SplitterPanel>
    </Splitter>
  </div>
</template>

<style scoped>
.skos-view {
  display: flex;
  flex: 1;
  overflow: hidden;
  height: 100%;
}

.main-splitter {
  width: 100%;
  height: 100%;
  border: none;
}

.left-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--ae-bg-elevated);
  border-right: 1px solid var(--ae-border-color);
}

.sidebar-tabs {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* Tab list styling */
:deep(.p-tablist) {
  background: transparent;
  border-bottom: 1px solid var(--ae-border-color);
}

:deep(.p-tab) {
  flex: 1;
  justify-content: center;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--ae-text-secondary);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s, background-color 0.15s;
}

:deep(.p-tab:hover) {
  color: var(--ae-text-primary);
  background: var(--ae-bg-base);
}

:deep(.p-tab[data-p-active="true"]) {
  color: var(--ae-text-primary);
  background: var(--ae-bg-base);
  border-bottom-color: var(--ae-accent);
}

:deep(.p-tabpanels) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0;
  background: transparent;
}

:deep(.p-tabpanel) {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}

.right-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--ae-bg-base);
}

/* Mobile: hide sidebar by default */
@media (max-width: 767px) {
  .left-panel {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 300px;
    z-index: 100;
    box-shadow: 2px 0 10px rgba(0, 0, 0, 0.2);
  }
}
</style>
