<script setup lang="ts">
/**
 * Embedded map for a WGS84 WKT geometry, rendered only when the `wktMaps` setting
 * is on. Leaflet + swisstopo WebMercator tiles (free, no key, © swisstopo — covers
 * Switzerland). The map is created only once the element scrolls into view, so a
 * resource with many geometries doesn't spin up dozens of maps or fetch tiles for
 * geometries never looked at.
 *
 * Non-WGS84 / projected geometries produce no GeoJSON (see wktToGeoJson) and this
 * component isn't rendered for them.
 *
 * @see /spec/ae-rdf — WKT value rendering
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { wktToGeoJson, parseWkt } from '../../utils/format'
import { logger } from '../../services'

const props = defineProps<{ value: string; datatype?: string }>()

const host = ref<HTMLElement>()
let map: L.Map | undefined
let observer: IntersectionObserver | undefined

const SWISSTOPO = 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg'
const OSM = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
// swisstopo tiles only cover Switzerland — default to it for Swiss geometries,
// OSM (global) otherwise, and let the user switch via the layers control.
const CH_BOUNDS = { latMin: 45.8, latMax: 47.9, lonMin: 5.9, lonMax: 10.6 }
const inSwitzerland = (lat: number, lon: number) =>
  lat >= CH_BOUNDS.latMin && lat <= CH_BOUNDS.latMax && lon >= CH_BOUNDS.lonMin && lon <= CH_BOUNDS.lonMax

function init() {
  if (map || !host.value) return
  const geom = wktToGeoJson(props.value, props.datatype)
  if (!geom) return
  try {
    map = L.map(host.value, { attributionControl: true, scrollWheelZoom: false })
    const swisstopo = L.tileLayer(SWISSTOPO, { maxZoom: 19, attribution: '© swisstopo' })
    const osm = L.tileLayer(OSM, { maxZoom: 19, attribution: '© OpenStreetMap contributors' })
    const c = parseWkt(props.value, props.datatype)
    const useSwiss = c?.lat !== undefined && c.lon !== undefined && inSwitzerland(c.lat, c.lon)
    ;(useSwiss ? swisstopo : osm).addTo(map)
    L.control.layers({ swisstopo, OpenStreetMap: osm }).addTo(map)
    const layer = L.geoJSON(geom as GeoJSON.GeoJsonObject, {
      pointToLayer: (_f, latlng) => L.circleMarker(latlng, { radius: 6, color: '#234fa2', weight: 2, fillOpacity: 0.5 }),
      style: { color: '#234fa2', weight: 2, fillOpacity: 0.15 },
    }).addTo(map)
    const bounds = layer.getBounds()
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 })
    // Container was display:none-ish until visible; Leaflet needs a size recalc.
    map.invalidateSize()
  } catch (error) {
    logger.warn('GeoMap', 'Failed to render geometry', { error })
  }
}

onMounted(() => {
  if (!host.value) return
  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      observer?.disconnect()
      init()
    }
  })
  observer.observe(host.value)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  map?.remove()
  map = undefined
})
</script>

<template>
  <div ref="host" class="geo-map"></div>
</template>

<style scoped>
.geo-map {
  height: 260px;
  margin-top: 0.4rem;
  border: 1px solid var(--ae-border-color);
  border-radius: 4px;
  overflow: hidden;
}
</style>
