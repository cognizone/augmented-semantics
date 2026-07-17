<script setup lang="ts">
/**
 * "cite" toggle next to a DOI badge: on click, lazily fetches the DOI's citation
 * from doi.org (cached) and shows it inline. Rendered only when the `doiCitations`
 * setting is on. Fetch is per-click, so enabling the setting never bulk-fetches.
 *
 * @see /spec/ae-rdf — DOI value rendering
 */
import { ref } from 'vue'
import { fetchDoiCitation, type DoiCitation } from '../../services'

const props = defineProps<{ id: string }>()

const open = ref(false)
const loading = ref(false)
const failed = ref(false)
const citation = ref<DoiCitation | null>(null)

async function toggle() {
  if (open.value) { open.value = false; return }
  open.value = true
  if (citation.value || failed.value) return // already resolved (cached in state)
  loading.value = true
  const c = await fetchDoiCitation(props.id)
  loading.value = false
  if (c) citation.value = c
  else failed.value = true
}
</script>

<template>
  <span class="doi-cite">
    <button class="doi-cite-btn" @click.stop="toggle">{{ open ? 'hide' : 'cite' }}</button>

    <span v-if="open && loading" class="doi-cite-card muted">Loading citation…</span>
    <span v-else-if="open && failed" class="doi-cite-card muted">Citation unavailable</span>
    <span v-else-if="open && citation" class="doi-cite-card">
      <span v-if="citation.authors" class="ci-auth">{{ citation.authors }}</span><span v-if="citation.year" class="ci-year"> ({{ citation.year }}).</span>
      <span class="ci-title"> {{ citation.title }}</span>
      <span v-if="citation.container" class="ci-cont"> — {{ citation.container }}</span>
      <span v-if="citation.type" class="tag ci-type">{{ citation.type }}</span>
    </span>
  </span>
</template>

<style scoped>
.doi-cite {
  display: inline;
}
.doi-cite-btn {
  margin-left: 0.3rem;
  padding: 0;
  border: none;
  background: none;
  font-size: 0.6875rem;
  color: var(--ae-accent);
  cursor: pointer;
  text-decoration: underline;
}
.doi-cite-card {
  display: block;
  margin-top: 0.35rem;
  padding: 0.4rem 0.5rem;
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--ae-text-primary);
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 4px;
}
.doi-cite-card.muted {
  color: var(--ae-text-secondary);
  font-style: italic;
}
.ci-auth { font-weight: 600; }
.ci-title { font-style: italic; }
.ci-cont { color: var(--ae-text-secondary); }
.ci-type {
  display: inline-block;
  margin-left: 0.4rem;
  padding: 0.02rem 0.3rem;
  font-size: 0.625rem;
  border: 1px solid var(--ae-border-color);
  border-radius: 4px;
  background: var(--ae-bg-page);
  color: var(--ae-text-secondary);
}
</style>
