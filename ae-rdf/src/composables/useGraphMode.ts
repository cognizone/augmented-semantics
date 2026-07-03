/**
 * useGraphMode - resolve the connected endpoint's graph axes into the browse
 * store, so every query builder picks the right scope (see resolveGraphStrategy).
 *
 * Resolution per axis (config wins; unknown = safe superset):
 * - quads: endpoint.graph.quads → SKOS analysis (shared `ae-endpoints`) → one
 *   `detectGraphs` ASK probe.
 * - defaultView: config-declared only ('own' | 'merged'). Unset → treated as
 *   'own' (the safe superset; folding (p,o) dedups any merge). Auto-detecting
 *   merged-vs-own is the parked endpoint-profiler's job; the deployer declares it.
 *
 * @see /spec/ae-rdf/rdf-overview.md (Graph model)
 */
import { onMounted, onUnmounted } from 'vue'
import { useEndpointStore, useBrowseStore } from '../stores'
import { detectGraphs, detectDefaultView, eventBus, logger } from '../services'

export function useGraphMode() {
  const endpointStore = useEndpointStore()
  const browseStore = useBrowseStore()

  async function detect(): Promise<void> {
    const endpoint = endpointStore.current
    if (!endpoint) return
    const endpointId = endpoint.id
    const cfg = endpoint.graph ?? {}

    // quads: config > SKOS analysis > unknown (probe below).
    let quads: boolean | undefined = cfg.quads
    if (quads === undefined) {
      const skos = endpoint.analysis?.supportsNamedGraphs
      if (skos === true || skos === false) quads = skos
    }

    // Publish what we know now (safe superset if unknown).
    browseStore.setGraph({ quads, defaultView: cfg.defaultView })

    // Probe quads only if still unknown.
    if (quads === undefined) {
      try {
        const { supportsNamedGraphs } = await detectGraphs(endpoint)
        if (endpointStore.current?.id !== endpointId) return // endpoint changed mid-probe
        quads = supportsNamedGraphs === true ? true : supportsNamedGraphs === false ? false : undefined
        browseStore.setGraph({ quads, defaultView: cfg.defaultView })
        logger.info('useGraphMode', 'Probed quad support', { quads, endpoint: endpoint.url })
      } catch (e) {
        logger.warn('useGraphMode', 'Quad probe failed; using safe default', { error: e })
      }
    }

    // defaultView: config wins. Else, when named graphs exist, probe whether the
    // default graph is a redundant merge — if so, drop the default branch
    // (NAMED-only) instead of the {GRAPH …} UNION {…} superset that doubles every
    // scan. Only act on a confident 'merged'; 'own'/uncertain/error keep the
    // superset (never silently drop data). One-time, at connect.
    if (quads === true && cfg.defaultView === undefined) {
      try {
        const dv = await detectDefaultView(endpoint)
        if (endpointStore.current?.id !== endpointId) return // endpoint changed mid-probe
        if (dv === 'merged') {
          browseStore.setGraph({ quads, defaultView: 'merged' })
          logger.info('useGraphMode', 'Probed default view: merged → named-only', { endpoint: endpoint.url })
        } else {
          logger.info('useGraphMode', 'Default view own/uncertain → safe superset', { dv, endpoint: endpoint.url })
        }
      } catch (e) {
        logger.warn('useGraphMode', 'Default-view probe failed; using safe superset', { error: e })
      }
    }
  }

  const sub = eventBus.on('endpoint:changed', () => detect())
  onMounted(() => {
    if (endpointStore.current) detect()
  })
  onUnmounted(() => sub.unsubscribe())

  return { detect }
}
