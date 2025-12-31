<script setup lang="ts">
import { useUIStore } from '../stores'

const uiStore = useUIStore()
</script>

<template>
  <div class="home-view">
    <!-- Mobile Tabs -->
    <nav v-if="uiStore.isMobile" class="mobile-tabs">
      <button
        :class="{ active: uiStore.mobileTab === 'tree' }"
        @click="uiStore.setMobileTab('tree')"
      >
        Tree
      </button>
      <button
        :class="{ active: uiStore.mobileTab === 'details' }"
        @click="uiStore.setMobileTab('details')"
      >
        Details
      </button>
      <button
        :class="{ active: uiStore.mobileTab === 'search' }"
        @click="uiStore.setMobileTab('search')"
      >
        Search
      </button>
    </nav>

    <!-- Sidebar (Concept Tree) -->
    <aside
      v-if="uiStore.isDesktop || uiStore.sidebarOpen"
      class="app-sidebar"
      :class="{ overlay: !uiStore.isDesktop }"
    >
      <div class="sidebar-content">
        <!-- ConceptTree will go here -->
        <p class="placeholder">Concept Tree</p>
      </div>
    </aside>

    <!-- Overlay backdrop for mobile/tablet -->
    <div
      v-if="!uiStore.isDesktop && uiStore.sidebarOpen"
      class="sidebar-backdrop"
      @click="uiStore.setSidebarOpen(false)"
    ></div>

    <!-- Content (Concept Details) -->
    <section class="app-content">
      <!-- ConceptDetails will go here -->
      <p class="placeholder">Select a concept to view details</p>
    </section>
  </div>
</template>

<style scoped>
.home-view {
  display: flex;
  flex: 1;
  overflow: hidden;
  position: relative;
}

.mobile-tabs {
  display: flex;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  background: var(--p-surface-50);
  border-bottom: 1px solid var(--p-surface-200);
  z-index: 10;
}

.mobile-tabs button {
  flex: 1;
  padding: 0.75rem;
  border: none;
  background: none;
  cursor: pointer;
  font-weight: 500;
  color: var(--p-text-muted-color);
  border-bottom: 2px solid transparent;
}

.mobile-tabs button.active {
  color: var(--p-primary-color);
  border-bottom-color: var(--p-primary-color);
}

.app-sidebar {
  width: 320px;
  flex-shrink: 0;
  background: var(--p-surface-0);
  border-right: 1px solid var(--p-surface-200);
  overflow-y: auto;
}

.app-sidebar.overlay {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 100;
  box-shadow: 4px 0 16px rgba(0, 0, 0, 0.1);
}

.sidebar-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 99;
}

.sidebar-content {
  padding: 1rem;
}

.app-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  background: var(--p-surface-50);
}

.placeholder {
  color: var(--p-text-muted-color);
  font-style: italic;
}

/* Mobile adjustments */
@media (max-width: 767px) {
  .home-view {
    padding-top: 44px; /* Space for mobile tabs */
  }
}

/* Tablet adjustments */
@media (min-width: 768px) and (max-width: 1023px) {
  .app-sidebar {
    width: 280px;
  }
}
</style>
