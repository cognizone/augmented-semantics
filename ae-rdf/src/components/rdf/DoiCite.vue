<script setup lang="ts">
/**
 * Citation shown inline under a DOI badge. Rendered only when the `doiCitations`
 * setting is on; the fetch is deferred until the element scrolls into view
 * (IntersectionObserver), so a resource citing hundreds of DOIs only fetches the
 * ones actually looked at. Result is cached per DOI in the service.
 *
 * @see /spec/ae-rdf — DOI value rendering
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { fetchDoiCitation, getConfig, type DoiCitation } from '../../services'

const props = defineProps<{ id: string }>()

// Per-field visibility from app.json (omitted field ⇒ shown).
const doiCfg = computed(() => getConfig()?.doi ?? {})
const show = (field: string) => (doiCfg.value as Record<string, unknown>)[field] !== false
const abstractText = computed(() => {
  const a = citation.value?.abstract
  if (!a) return ''
  const max = doiCfg.value.abstractMaxChars ?? 280
  return a.length > max ? a.slice(0, max).trimEnd() + '…' : a
})

const CATEGORY_SHOWN = 8
const catsExpanded = ref(false)
const shownCategories = computed(() =>
  catsExpanded.value ? citation.value?.categories ?? [] : (citation.value?.categories ?? []).slice(0, CATEGORY_SHOWN),
)
const hiddenCategoryCount = computed(() => Math.max(0, (citation.value?.categories.length ?? 0) - CATEGORY_SHOWN))

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
      <span v-if="show('authors') && citation.authors" class="ci-auth">{{ citation.authors }}</span><span v-if="show('year') && citation.year" class="ci-year"> ({{ citation.year }}).</span>
      <span v-if="show('title')" class="ci-title"> {{ citation.title }}</span>
      <span v-if="show('container') && citation.container" class="ci-cont"> — {{ citation.container }}</span>
      <span v-if="show('publisher') && citation.publisher" class="ci-pub"> · {{ citation.publisher }}</span>
      <span v-if="show('type') && citation.type" class="ci-type">{{ citation.type }}</span>

      <span v-if="show('abstract') && abstractText" class="ci-abstract">{{ abstractText }}</span>

      <span v-if="show('categories') && citation.categories.length" class="ci-cats">
        <span v-for="c in shownCategories" :key="c" class="ci-cat">{{ c }}</span>
        <button v-if="hiddenCategoryCount && !catsExpanded" class="ci-cat ci-cat-more" @click.stop="catsExpanded = true">+{{ hiddenCategoryCount }} more</button>
      </span>

      <span v-if="(show('copyright') && citation.copyright) || (show('url') && citation.url)" class="ci-foot">
        <span v-if="show('copyright') && citation.copyright" class="ci-copyright">{{ citation.copyright }}</span>
        <a v-if="show('url') && citation.url" :href="citation.url" target="_blank" rel="noopener" class="ci-url">landing page ↗</a>
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
  padding: 0.05rem 0.45rem;
  font-size: 0.75rem;
  border-radius: 999px;
  background: var(--ae-bg-page);
  color: var(--ae-text-secondary);
  border: 1px solid var(--ae-border-color);
}
.ci-cat-more {
  cursor: pointer;
  color: var(--ae-accent);
}
.ci-cat-more:hover {
  border-color: var(--ae-accent);
}
.ci-abstract {
  display: block;
  margin-top: 0.4rem;
  color: var(--ae-text-secondary);
}
.ci-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
  margin-top: 0.4rem;
  font-size: 0.6875rem;
  color: var(--ae-text-secondary);
}
.ci-url {
  color: var(--ae-accent);
  text-decoration: none;
}
.ci-url:hover {
  text-decoration: underline;
}
</style>
