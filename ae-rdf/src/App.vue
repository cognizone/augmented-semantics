<script setup lang="ts">
// Barebones AE RDF app - just the header for now
</script>

<template>
  <div class="app-container">
    <header class="app-header">
      <div class="header-left">
        <h1 class="app-title">AE RDF</h1>
      </div>
    </header>

    <main class="app-main">
      <div class="placeholder">
        <span class="material-symbols-outlined placeholder-icon">database</span>
        <p>RDF Browser - Coming Soon</p>
      </div>
    </main>
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
  height: 48px;
  padding: 0 1rem;
  background: var(--ae-header-bg);
  border-bottom: 1px solid var(--ae-border-color);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

.app-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--ae-text-primary);
  letter-spacing: 0.02em;
}

.app-main {
  display: flex;
  flex: 1;
  overflow: hidden;
  align-items: center;
  justify-content: center;
}

.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  color: var(--ae-text-muted);
}

.placeholder-icon {
  font-size: 64px;
}
</style>
