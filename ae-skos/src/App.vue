<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { RouterView } from 'vue-router'
import { useUIStore, useConceptStore } from './stores'
import Toast from 'primevue/toast'

import EndpointSelector from './components/common/EndpointSelector.vue'
import EndpointManager from './components/common/EndpointManager.vue'
import LanguageSelector from './components/common/LanguageSelector.vue'
import SchemeSelector from './components/skos/SchemeSelector.vue'
import ConceptBreadcrumb from './components/skos/ConceptBreadcrumb.vue'

const uiStore = useUIStore()
const conceptStore = useConceptStore()
const showEndpointManager = ref(false)

function selectConcept(uri: string) {
  if (uri) {
    conceptStore.selectConcept(uri)
  } else {
    conceptStore.selectConcept(null)
  }
}

onMounted(() => {
  uiStore.initResponsive()
})

onUnmounted(() => {
  uiStore.destroyResponsive()
})
</script>

<template>
  <div class="app-container">
    <!-- Header / Toolbar -->
    <header class="app-header">
      <div class="header-left">
        <button
          v-if="!uiStore.isDesktop"
          class="menu-button"
          @click="uiStore.toggleSidebar()"
        >
          <i class="pi pi-bars"></i>
        </button>
        <h1 class="app-title">AE SKOS</h1>
      </div>
      <div class="header-center">
        <EndpointSelector @manage="showEndpointManager = true" />
        <SchemeSelector />
        <LanguageSelector />
      </div>
      <div class="header-right">
        <!-- Reserved for future actions -->
      </div>
    </header>

    <!-- Breadcrumb -->
    <ConceptBreadcrumb @select-concept="selectConcept" />

    <!-- Main Content -->
    <main class="app-main">
      <RouterView />
    </main>

    <!-- Toast notifications -->
    <Toast />

    <!-- Endpoint Manager Dialog -->
    <EndpointManager v-model:visible="showEndpointManager" />
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 1rem;
  background: var(--p-surface-0);
  border-bottom: 1px solid var(--p-surface-200);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.menu-button {
  background: none;
  border: none;
  padding: 0.5rem;
  cursor: pointer;
  font-size: 1.25rem;
  color: var(--p-text-color);
}

.app-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--p-primary-color);
}

.header-center {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1rem;
}

.header-right {
  display: flex;
  align-items: center;
}

.app-main {
  display: flex;
  flex: 1;
  overflow: hidden;
}


/* Mobile adjustments */
@media (max-width: 767px) {
  .header-center {
    display: none;
  }
}
</style>
