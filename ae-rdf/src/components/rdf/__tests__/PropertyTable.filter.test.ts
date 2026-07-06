/**
 * Per-predicate value filter: a big flat object list (> OBJECT_CAP) gets a filter
 * box once expanded. All objects are already loaded, so the box narrows them
 * client-side by a substring match over each object's display label/URI, and the
 * status line reflects the match count (capped at 100 rendered rows).
 */
import { describe, it, expect } from 'vitest'
import { link, mountPropertyTable } from '../../../test-utils/propertyTable'
import type { PropertyGroup } from '../../../composables'

const REL = 'http://ex/hasGrant'

// 120 "Alpha" + 30 "Beta" = 150 objects (> 100 ⇒ big), each with a resolved label.
const objects = [
  ...Array.from({ length: 120 }, (_, i) => link(`http://ex/a${i}`)),
  ...Array.from({ length: 30 }, (_, i) => link(`http://ex/b${i}`)),
]
const labels = new Map<string, string>([
  ...Array.from({ length: 120 }, (_, i) => [`http://ex/a${i}`, `Alpha ${i}`] as const),
  ...Array.from({ length: 30 }, (_, i) => [`http://ex/b${i}`, `Beta ${i}`] as const),
])
const groups: PropertyGroup[] = [{ predicate: REL, objects }]

async function mountExpanded() {
  const wrapper = mountPropertyTable({ groups, resolved: new Map(), labels })
  // Big lists start collapsed to a count; expand to reveal rows + the filter box.
  await wrapper.find('.show-more').trigger('click')
  return wrapper
}

describe('PropertyTable per-predicate filter', () => {
  it('shows the filter box only once a big list is expanded', async () => {
    const wrapper = mountPropertyTable({ groups, resolved: new Map(), labels })
    expect(wrapper.find('.prop-filter').exists()).toBe(false) // collapsed
    await wrapper.find('.show-more').trigger('click')
    expect(wrapper.find('.prop-filter').exists()).toBe(true)
    expect(wrapper.findAll('.uri-link')).toHaveLength(100) // capped even unfiltered
  })

  it('narrows to matching objects and shows the match count when ≤ 100', async () => {
    const wrapper = await mountExpanded()
    await wrapper.find('.prop-filter').setValue('beta')
    expect(wrapper.findAll('.uri-link')).toHaveLength(30)
    expect(wrapper.find('.prop-more-count').text()).toContain('30 matches')
  })

  it('caps rendered matches at 100 and reports the true match total', async () => {
    const wrapper = await mountExpanded()
    await wrapper.find('.prop-filter').setValue('alpha')
    expect(wrapper.findAll('.uri-link')).toHaveLength(100)
    expect(wrapper.find('.prop-more-count').text()).toContain('120 matches')
  })

  it('reports no matches for a term that matches nothing', async () => {
    const wrapper = await mountExpanded()
    await wrapper.find('.prop-filter').setValue('zzz-nothing')
    expect(wrapper.findAll('.uri-link')).toHaveLength(0)
    expect(wrapper.find('.prop-more-count').text()).toContain('No values match')
  })
})
