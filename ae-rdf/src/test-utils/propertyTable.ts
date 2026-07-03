/**
 * Shared mount helper + RDF-term factories for the PropertyTable tests.
 * Centralizes the PrimeVue/Tooltip global config and the term shims that were
 * copy-pasted across every PropertyTable.*.test.ts.
 */
import { mount, type ComponentMountingOptions } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import PropertyTable from '../components/rdf/PropertyTable.vue'

/** A navigable URI term. */
export const link = (v: string) => ({ termType: 'uri' as const, value: v, graphs: [] })
/** A literal term. */
export const lit = (v: string) => ({ termType: 'literal' as const, value: v, graphs: [] })

/** Mount PropertyTable with the PrimeVue plugin + tooltip directive every test needs. */
export function mountPropertyTable(props: ComponentMountingOptions<typeof PropertyTable>['props']) {
  return mount(PropertyTable, {
    props,
    global: { plugins: [PrimeVue], directives: { tooltip: Tooltip } },
  })
}
