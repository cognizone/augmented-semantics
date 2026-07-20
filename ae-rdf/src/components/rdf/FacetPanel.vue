<script setup lang="ts">
/**
 * FacetPanel - the config-driven faceted-browsing UI, living in the sidebar's
 * Filters rail (TypeList). Reads the FACET STORE (the single source of truth for
 * facet state), which is driven by the current type / endpoint / graph — not by
 * the instance list's lifecycle. Value facets show top-N values with counts; range
 * facets show configured buckets. A facet's counts reflect the OTHER facets'
 * selections (classic faceted search); the instance list's total reflects ALL of
 * them.
 *
 * @see /spec/ae-rdf
 */
import { computed } from 'vue'
import { useFacetStore } from '../../stores'
import { useDelayedLoading } from '../../composables'

const facetStore = useFacetStore()
const showLoading = useDelayedLoading(computed(() => facetStore.loading))
</script>

<template>
  <section class="facet-panel" aria-label="Filters">
    <div class="facet-panel-head">
      <span class="facet-panel-title">Filters</span>
      <span v-if="showLoading" class="facet-loading">updating…</span>
      <button v-if="facetStore.hasSelections" class="facet-clear" @click="facetStore.clearAll()">Clear filters</button>
    </div>

    <div v-for="f in facetStore.results" :key="f.predicate" class="facet-block">
      <div class="facet-heading">
        <span>{{ f.label }}</span>
        <span v-if="f.pending" class="facet-spinner" aria-label="updating" />
      </div>
      <div class="facet-chips">
        <template v-if="f.kind === 'value'">
          <button
            v-for="v in f.values!.filter(x => x.count > 0)"
            :key="v.key"
            class="facet-chip"
            :class="{ active: facetStore.isValueSelected(f.predicate, v.key) }"
            :aria-pressed="facetStore.isValueSelected(f.predicate, v.key)"
            :title="v.term.isUri ? v.term.value : v.label"
            @click="facetStore.toggleValue(f.predicate, v)"
          >
            <span class="facet-chip-label">{{ v.label }}</span>
            <span class="facet-chip-count">{{ v.count.toLocaleString('en-US') }}</span>
          </button>
          <span v-if="f.pending" class="facet-note">…</span>
          <span v-if="f.truncated" class="facet-note">top {{ f.limit }} shown</span>
        </template>
        <template v-else>
          <button
            v-for="b in f.ranges!"
            :key="b.index"
            class="facet-chip"
            :class="{ active: facetStore.isRangeSelected(f.predicate, b.index), loading: b.count === null }"
            :aria-pressed="facetStore.isRangeSelected(f.predicate, b.index)"
            @click="facetStore.toggleRange(f.predicate, b.index)"
          >
            <span class="facet-chip-label">{{ b.label }}</span>
            <span class="facet-chip-count">{{ b.count === null ? '…' : b.count.toLocaleString('en-US') }}</span>
          </button>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Fills the sidebar rail below the segmented toggle and scrolls on its own — the
   whole point of the move: facets get the full sidebar height, not a 40% cap. */
.facet-panel {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.5rem 0.75rem 0.75rem;
}

.facet-panel-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.375rem;
}

.facet-panel-title {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--ae-text-secondary);
}

.facet-loading {
  font-size: 0.6875rem;
  color: var(--ae-text-muted);
  font-style: italic;
}

.facet-clear {
  margin-left: auto;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-size: 0.6875rem;
  color: var(--ae-accent);
}

.facet-clear:hover {
  color: var(--ae-accent-hover);
  text-decoration: underline;
}

.facet-block {
  margin-top: 0.5rem;
}

.facet-heading {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--ae-text-primary);
  margin-bottom: 0.3rem;
}

/* Tiny spinner beside the heading while this facet's counts are still loading —
   shown on first load AND on refresh (when the old counts stay on screen). */
.facet-spinner {
  width: 9px;
  height: 9px;
  border: 1.5px solid var(--ae-border-color);
  border-top-color: var(--ae-accent);
  border-radius: 50%;
  animation: facet-spin 0.6s linear infinite;
}

@keyframes facet-spin {
  to { transform: rotate(360deg); }
}

.facet-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
}

.facet-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
  font-size: 0.75rem;
  padding: 0.15rem 0.45rem;
  background: var(--ae-bg-base);
  border: 1px solid var(--ae-border-color);
  border-radius: 10px;
  cursor: pointer;
  color: var(--ae-text-secondary);
  max-width: 100%;
}

.facet-chip:hover {
  background: var(--ae-bg-hover);
  color: var(--ae-text-primary);
}

.facet-chip.active {
  color: var(--ae-accent);
  border-color: var(--ae-accent);
  background: var(--ae-bg-hover);
}

.facet-chip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 14rem;
}

.facet-chip-count {
  font-size: 0.625rem;
  font-variant-numeric: tabular-nums;
  color: var(--ae-text-muted);
}

.facet-chip.active .facet-chip-count {
  color: var(--ae-accent);
}

/* Band whose count is still loading — dimmed until its number lands. */
.facet-chip.loading {
  opacity: 0.55;
}

.facet-note {
  font-size: 0.625rem;
  color: var(--ae-text-muted);
  font-style: italic;
}
</style>
