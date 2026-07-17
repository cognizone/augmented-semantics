<script setup lang="ts">
/**
 * Citation shown inline under a DOI badge. Rendered only when the `doiCitations`
 * setting is on; the fetch is deferred until the element scrolls into view
 * (IntersectionObserver), so a resource citing hundreds of DOIs only fetches the
 * ones actually looked at. Result is cached per DOI in the service.
 *
 * @see /spec/ae-rdf — DOI value rendering
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { fetchDoiCitation, type DoiCitation } from '../../services'

const props = defineProps<{ id: string }>()

const el = ref<HTMLElement>()
const loading = ref(false)
const failed = ref(false)
const citation = ref<DoiCitation | null>(null)
let observer: IntersectionObserver | undefined

async function load() {
  if (loading.value || citation.value || failed.value) return
  loading.value = true
  const c = await fetchDoiCitation(props.id)
  loading.value = false
  if (c) citation.value = c
  else failed.value = true
}

onMounted(() => {
  if (!el.value) return
  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      observer?.disconnect()
      void load()
    }
  })
  observer.observe(el.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <span ref="el" class="doi-cite">
    <span v-if="loading" class="doi-cite-card muted">Loading citation…</span>
    <span v-else-if="failed" class="doi-cite-card muted">Citation unavailable</span>
    <span v-else-if="citation" class="doi-cite-card">
      <span v-if="citation.authors" class="ci-auth">{{ citation.authors }}</span><span v-if="citation.year" class="ci-year"> ({{ citation.year }}).</span>
      <span class="ci-title"> {{ citation.title }}</span>
      <span v-if="citation.container" class="ci-cont"> — {{ citation.container }}</span>
      <span v-if="citation.publisher" class="ci-pub"> · {{ citation.publisher }}</span>
      <span v-if="citation.type" class="ci-type">{{ citation.type }}</span>
      <span v-if="citation.categories.length" class="ci-cats">
        <span v-for="c in citation.categories" :key="c" class="ci-cat">{{ c }}</span>
      </span>
    </span>
  </span>
</template>

<style scoped>
.doi-cite {
  display: block;
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
.ci-cont,
.ci-pub { color: var(--ae-text-secondary); }
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
.ci-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.35rem;
}
.ci-cat {
  padding: 0.02rem 0.35rem;
  font-size: 0.625rem;
  border-radius: 999px;
  background: var(--ae-bg-page);
  color: var(--ae-text-secondary);
  border: 1px solid var(--ae-border-color);
}
</style>
