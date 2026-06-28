<script setup lang="ts">
/**
 * PropertyTable - renders a resource's predicate/object triples.
 *
 * Object URIs are clickable (emit `navigate`) so the user can walk links.
 * Literals show language and (non-string) datatype tags.
 *
 * @see /spec/ae-rdf
 */
import { isNavigableIri } from '../../services'
import type { PropertyGroup } from '../../composables'

import type { ResourceObject } from '../../composables'

const props = defineProps<{
  groups: PropertyGroup[]
  resolved: Map<string, { prefix: string; localName: string }>
  /** Reveal a graph chip on every triple. Multi-graph triples always show one. */
  showGraphs?: boolean
}>()

const emit = defineEmits<{ navigate: [uri: string] }>()

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string'

function qname(uri: string): string {
  const r = props.resolved.get(uri)
  if (r && r.prefix) return `${r.prefix}:${r.localName}`
  if (r && r.localName) return r.localName
  return uri
}

function datatypeLabel(uri: string): string {
  return qname(uri)
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
        <th class="prop-key" :title="group.predicate">{{ qname(group.predicate) }}</th>
        <td class="prop-values">
          <div v-for="(o, i) in group.objects" :key="i" class="prop-value" :title="graphTitle(o)">
            <!-- URI object: clickable -->
            <a
              v-if="o.termType === 'uri' && isNavigableIri(o.value)"
              class="uri-link"
              :title="o.value"
              @click="emit('navigate', o.value)"
            >{{ qname(o.value) }}</a>

            <!-- URI we can't navigate to (e.g. mailto:) -->
            <span v-else-if="o.termType === 'uri'" class="uri-static" :title="o.value">{{ qname(o.value) }}</span>

            <!-- Blank node -->
            <span v-else-if="o.termType === 'bnode'" class="bnode">[ anonymous node ]</span>

            <!-- Literal -->
            <span v-else class="literal">
              {{ o.value }}
              <span v-if="o.lang" class="tag lang-tag">@{{ o.lang }}</span>
              <span v-else-if="o.datatype && o.datatype !== XSD_STRING" class="tag datatype-tag">{{ datatypeLabel(o.datatype) }}</span>
            </span>

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
</style>
