<script setup lang="ts">
/**
 * PropertyTable - renders a resource's predicate/object triples.
 *
 * Object URIs are clickable (emit `navigate`) so the user can walk links.
 * Literals show language and (non-string) datatype tags.
 *
 * @see /spec/ae-rdf
 */
import { computed } from 'vue'
import { isNavigableIri } from '../../services'
import { useSettingsStore } from '../../stores'
import { qname as toQname, displayPredicate, displayObject, displayType, type ResolvedMap } from '../../utils/format'
import type { PropertyGroup, ResourceObject } from '../../composables'

const props = defineProps<{
  groups: PropertyGroup[]
  resolved: ResolvedMap
  /** Object IRI → human label (Phase 2). Falls back to the qname when absent. */
  labels?: Map<string, string>
  /** Object IRI → a type IRI, shown as a badge / fallback text. */
  objectTypes?: Map<string, string>
  /** Reveal a graph chip on every triple. Multi-graph triples always show one. */
  showGraphs?: boolean
}>()

const emit = defineEmits<{ navigate: [uri: string] }>()

const settings = useSettingsStore()
const mode = computed(() => settings.uriDisplay)

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string'

const qname = (uri: string) => toQname(uri, props.resolved)

/** Predicate label, per the URI-display mode; qname/URI stays on hover. */
function predicateLabel(uri: string): string {
  return displayPredicate(uri, props.resolved, mode.value)
}

// Always show the object's own identity (label, else qname — distinct) as the
// primary text; the type is a context badge. (A generic type like "Concept"
// repeated N times is useless as the value itself.)
function objectText(uri: string): string {
  return displayObject(uri, props.resolved, mode.value, props.labels?.get(uri))
}

/** Type badge text for a linked resource (context), or null. */
function objectBadge(uri: string): string | null {
  const t = props.objectTypes?.get(uri)
  return t ? displayType(t, props.resolved, mode.value) : null
}

/** Objects of a predicate, sorted by display text (label/qname, else literal). */
function sortedObjects(group: PropertyGroup): ResourceObject[] {
  const key = (o: ResourceObject) => (o.termType === 'uri' ? objectText(o.value) : o.value).toLowerCase()
  return [...group.objects].sort((a, b) => key(a).localeCompare(key(b)))
}

// Graphs are always KNOWN; this controls whether they're painted. Multi-graph
// triples are always surfaced (silence there would mislead).
function showGraphsFor(o: ResourceObject): boolean {
  return !!props.showGraphs || o.graphs.length > 1
}

// Hover always reveals the graph(s), even when chips are hidden — aware always.
function graphTitle(o: ResourceObject): string {
  return o.graphs.length ? `Graph(s): ${o.graphs.map(qname).join(', ')}` : 'Default graph'
}
</script>

<template>
  <table class="prop-table">
    <tbody>
      <tr v-for="group in groups" :key="group.predicate">
        <th class="prop-key" v-tooltip.top="{ value: qname(group.predicate), showDelay: 120 }">{{ predicateLabel(group.predicate) }}</th>
        <td class="prop-values">
          <div v-for="(o, i) in sortedObjects(group)" :key="i" class="prop-value" :title="graphTitle(o)">
            <!-- URI object: clickable -->
            <a
              v-if="o.termType === 'uri' && isNavigableIri(o.value)"
              class="uri-link"
              v-tooltip.top="{ value: o.value, showDelay: 120 }"
              @click="emit('navigate', o.value)"
            >{{ objectText(o.value) }}</a>

            <!-- URI we can't navigate to (e.g. mailto:) -->
            <span
              v-else-if="o.termType === 'uri'"
              class="uri-static"
              v-tooltip.top="{ value: o.value, showDelay: 120 }"
            >{{ objectText(o.value) }}</span>

            <!-- Blank node -->
            <span v-else-if="o.termType === 'bnode'" class="bnode">[ anonymous node ]</span>

            <!-- Literal -->
            <span v-else class="literal">
              {{ o.value }}
              <span v-if="o.lang" class="tag lang-tag">@{{ o.lang }}</span>
              <span v-else-if="o.datatype && o.datatype !== XSD_STRING" class="tag datatype-tag">{{ qname(o.datatype) }}</span>
            </span>

            <!-- Type badge for a linked resource (when not already the primary text) -->
            <span v-if="o.termType === 'uri' && objectBadge(o.value)" class="tag type-badge">{{ objectBadge(o.value) }}</span>

            <!-- Graph provenance (always known; shown per option a) -->
            <span v-if="showGraphsFor(o)" class="graph-tags">
              <template v-if="o.graphs.length">
                <span
                  v-for="g in o.graphs"
                  :key="g"
                  class="tag graph-tag"
                  :class="{ multi: o.graphs.length > 1 }"
                  :title="g"
                >{{ qname(g) }}</span>
              </template>
              <span v-else class="tag graph-tag default" title="Default graph">default graph</span>
            </span>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.prop-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.prop-table tr {
  border-bottom: 1px solid var(--ae-border-color);
}

.prop-table tr:last-child {
  border-bottom: none;
}

.prop-key {
  text-align: left;
  vertical-align: top;
  font-weight: 600;
  color: var(--ae-text-secondary);
  font-family: var(--ae-font-mono);
  padding: 0.5rem 1rem 0.5rem 0;
  white-space: nowrap;
  width: 1%;
}

.prop-values {
  padding: 0.5rem 0;
}

.prop-value {
  padding: 0.125rem 0;
  word-break: break-word;
}

.uri-link {
  color: var(--ae-accent);
  cursor: pointer;
  font-family: var(--ae-font-mono);
}

.uri-link:hover {
  text-decoration: underline;
}

.uri-static {
  color: var(--ae-text-primary);
  font-family: var(--ae-font-mono);
}

.bnode {
  color: var(--ae-text-muted);
  font-style: italic;
}

.literal {
  color: var(--ae-text-primary);
}

.tag {
  display: inline-block;
  margin-left: 0.375rem;
  padding: 0 0.375rem;
  border-radius: 4px;
  font-size: 0.6875rem;
  font-family: var(--ae-font-mono);
  background: var(--ae-bg-hover);
  color: var(--ae-text-secondary);
  vertical-align: middle;
}

.graph-tags {
  display: inline-flex;
  gap: 0.25rem;
  vertical-align: middle;
}

.graph-tag {
  border: 1px solid var(--ae-border-color);
  background: transparent;
}

/* A triple in >1 graph is the case silence would hide — make it noticeable. */
.graph-tag.multi {
  border-color: var(--ae-accent);
  color: var(--ae-accent);
}

.graph-tag.default {
  font-style: italic;
}

/* Type badge alongside a linked resource (e.g. "Conservation… [Project]") */
.type-badge {
  border: 1px solid var(--ae-border-color);
  background: var(--ae-bg-elevated);
  color: var(--ae-text-secondary);
}

</style>
