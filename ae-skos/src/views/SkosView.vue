<script setup lang="ts">
import { computed } from 'vue'
import { useUIStore, useConceptStore } from '../stores'
import ConceptTree from '../components/skos/ConceptTree.vue'
import ConceptDetails from '../components/skos/ConceptDetails.vue'
import SearchBox from '../components/skos/SearchBox.vue'
import RecentHistory from '../components/skos/RecentHistory.vue'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import TabPanels from 'primevue/tabpanels'
import TabPanel from 'primevue/tabpanel'

const uiStore = useUIStore()
const conceptStore = useConceptStore()

// Handle concept selection from any component
function selectConcept(uri: string) {
  if (uri) {
    conceptStore.selectConcept(uri)
  } else {
    conceptStore.selectConcept(null)
  }
}

// Computed
const showSidebar = computed(() => uiStore.sidebarOpen || uiStore.isDesktop)
</script>

<template>
  <div class="skos-view">
    <Splitter class="main-splitter" :gutterSize="4">
      <!-- Left Panel: Tree, Search, History -->
      <SplitterPanel
        :size="30"
        :minSize="20"
        class="left-panel"
        v-show="showSidebar"
      >
        <Tabs value="browse" class="sidebar-tabs">
          <TabList>
            <Tab value="browse">Browse</Tab>
            <Tab value="search">Search</Tab>
            <Tab value="recent">Recent</Tab>
          </TabList>
          <TabPanels>
            <TabPanel value="browse">
              <ConceptTree />
            </TabPanel>
            <TabPanel value="search">
              <div class="search-panel">
                <SearchBox @select-concept="selectConcept" />
              </div>
            </TabPanel>
            <TabPanel value="recent">
              <RecentHistory @select-concept="selectConcept" />
            </TabPanel>
          </TabPanels>
        </Tabs>
      </SplitterPanel>

      <!-- Right Panel: Concept Details -->
      <SplitterPanel :size="70" :minSize="40" class="right-panel">
        <ConceptDetails @select-concept="selectConcept" />
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
  background: var(--p-surface-0);
  border-right: 1px solid var(--p-surface-200);
}

.sidebar-tabs {
  height: 100%;
  display: flex;
  flex-direction: column;
}

:deep(.sidebar-tabs .p-tabview-panels) {
  flex: 1;
  overflow: hidden;
  padding: 0;
}

:deep(.sidebar-tabs .p-tabview-panel) {
  height: 100%;
  overflow: auto;
}

.search-panel {
  padding: 0.5rem;
  height: 100%;
  overflow: auto;
}

.right-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--p-surface-0);
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
    box-shadow: 2px 0 10px rgba(0, 0, 0, 0.1);
  }
}
</style>
