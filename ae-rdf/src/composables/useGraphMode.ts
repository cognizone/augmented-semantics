/**
 * useGraphMode - detect once per endpoint whether it uses named graphs, and
 * cache it in the browse store so resource queries pick the right shape.
 *
 * One cheap ASK per connect (detectGraphs). Resets to the safe 'named' superset
 * on every endpoint change, then downgrades to 'none' only when the endpoint
 * has no named graphs at all — so correctness never waits on detection, it's
 * purely an optimization (see GraphMode / ae-rdf/PLAN.md "Graph awareness").
 *
 * @see /spec/ae-rdf
 */
import { onMounted, onUnmounted } from 'vue'
import { useEndpointStore, useBrowseStore } from '../stores'
import { detectGraphs, eventBus, logger } from '../services'

export function useGraphMode() {
  const endpointStore = useEndpointStore()
  const browseStore = useBrowseStore()

  async function detect(): Promise<void> {
    const endpoint = endpointStore.current
    if (!endpoint) return
    // Reset to the safe superset before probing — the 'named' query is correct
    // everywhere, so any in-flight resource load stays correct meanwhile.
    browseStore.setGraphMode('named')
    const endpointId = endpoint.id
    try {
      const { supportsNamedGraphs } = await detectGraphs(endpoint)
      if (endpointStore.current?.id !== endpointId) return // endpoint changed mid-probe
      // false = no named graphs; null = GRAPH unsupported → treat both as 'none'.
      browseStore.setGraphMode(supportsNamedGraphs === true ? 'named' : 'none')
      logger.info('useGraphMode', 'Detected graph mode', { mode: browseStore.graphMode, endpoint: endpoint.url })
    } catch (e) {
      logger.warn('useGraphMode', 'Graph detection failed; keeping safe default', { error: e })
    }
  }

  const sub = eventBus.on('endpoint:changed', () => detect())
  onMounted(() => {
    if (endpointStore.current) detect()
  })
  onUnmounted(() => sub.unsubscribe())

  return { detect }
}
