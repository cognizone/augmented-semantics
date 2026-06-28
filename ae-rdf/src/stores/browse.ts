/**
 * Browse Store - current RDF browsing selection.
 *
 * Holds what the user is looking at (resource, and later type). Kept in sync
 * with the URL (?resource, ?type) by RdfView for deep-linking per com04.
 *
 * @see /spec/ae-rdf
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { GraphMode } from '../services'

export const useBrowseStore = defineStore('browse', () => {
  const currentResource = ref<string | null>(null)
  const currentType = ref<string | null>(null) // populated by T3/T5

  // Graph awareness: whether the current endpoint uses named graphs. Defaults
  // to the safe superset ('named') until detection completes — see GraphMode.
  const graphMode = ref<GraphMode>('named')

  function setResource(uri: string | null) {
    currentResource.value = uri
  }

  function setType(uri: string | null) {
    currentType.value = uri
  }

  function setGraphMode(mode: GraphMode) {
    graphMode.value = mode
  }

  return { currentResource, currentType, graphMode, setResource, setType, setGraphMode }
})
