/**
 * Browse Store - current RDF browsing selection + the resolved endpoint graph.
 *
 * Holds what the user is looking at (resource, type), kept in sync with the URL
 * (?resource, ?type) by RdfView for deep-linking (com04), plus the effective
 * graph axes for the connected endpoint (config + probe, see useGraphMode).
 *
 * @see /spec/ae-rdf
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { EndpointGraph } from '../types'

export const useBrowseStore = defineStore('browse', () => {
  const currentResource = ref<string | null>(null)
  const currentType = ref<string | null>(null)

  // Effective graph axes for the current endpoint. Empty = unknown → query
  // builders treat it as the safe superset (see resolveGraphStrategy).
  const graph = ref<EndpointGraph>({})

  function setResource(uri: string | null) {
    currentResource.value = uri
  }

  function setType(uri: string | null) {
    currentType.value = uri
  }

  function setGraph(g: EndpointGraph) {
    graph.value = g
  }

  return { currentResource, currentType, graph, setResource, setType, setGraph }
})
