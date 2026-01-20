import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useConceptNavigation } from '../useConceptNavigation'
import { useSchemeStore, useConceptStore } from '../../stores'

describe('useConceptNavigation', () => {
  let emit: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setActivePinia(createPinia())
    emit = vi.fn()
  })

  describe('navigateTo', () => {
    it('emits selectConcept event with concept URI', () => {
      const { navigateTo } = useConceptNavigation(emit)

      navigateTo({ uri: 'http://example.org/concept/1', label: 'Concept 1' })

      expect(emit).toHaveBeenCalledWith('selectConcept', 'http://example.org/concept/1')
    })

    it('works with concept without label', () => {
      const { navigateTo } = useConceptNavigation(emit)

      navigateTo({ uri: 'http://example.org/concept/2' })

      expect(emit).toHaveBeenCalledWith('selectConcept', 'http://example.org/concept/2')
    })
  })

  describe('isLocalScheme', () => {
    it('returns true when scheme exists in store', () => {
      const schemeStore = useSchemeStore()
      schemeStore.schemes = [
        { uri: 'http://example.org/scheme/1', label: 'Scheme 1' },
        { uri: 'http://example.org/scheme/2', label: 'Scheme 2' },
      ]

      const { isLocalScheme } = useConceptNavigation(emit)

      expect(isLocalScheme('http://example.org/scheme/1')).toBe(true)
    })

    it('returns false when scheme does not exist', () => {
      const schemeStore = useSchemeStore()
      schemeStore.schemes = [
        { uri: 'http://example.org/scheme/1', label: 'Scheme 1' },
      ]

      const { isLocalScheme } = useConceptNavigation(emit)

      expect(isLocalScheme('http://external.org/scheme')).toBe(false)
    })

    it('returns false when no schemes loaded', () => {
      const { isLocalScheme } = useConceptNavigation(emit)

      expect(isLocalScheme('http://example.org/scheme')).toBe(false)
    })
  })

  describe('navigateToScheme', () => {
    it('selects scheme in scheme store', () => {
      const schemeStore = useSchemeStore()
      const selectSchemeSpy = vi.spyOn(schemeStore, 'selectScheme')

      const { navigateToScheme } = useConceptNavigation(emit)
      navigateToScheme({ uri: 'http://example.org/scheme/1', label: 'Scheme' })

      expect(selectSchemeSpy).toHaveBeenCalledWith('http://example.org/scheme/1')
    })

    it('selects scheme URI in concept store to show details', () => {
      const conceptStore = useConceptStore()
      const selectConceptSpy = vi.spyOn(conceptStore, 'selectConcept')

      const { navigateToScheme } = useConceptNavigation(emit)
      navigateToScheme({ uri: 'http://example.org/scheme/1', label: 'Scheme' })

      expect(selectConceptSpy).toHaveBeenCalledWith('http://example.org/scheme/1')
    })
  })

  describe('handleSchemeClick', () => {
    it('navigates to local scheme', () => {
      const schemeStore = useSchemeStore()
      schemeStore.schemes = [
        { uri: 'http://example.org/scheme/1', label: 'Local Scheme' },
      ]
      const selectSchemeSpy = vi.spyOn(schemeStore, 'selectScheme')

      const { handleSchemeClick } = useConceptNavigation(emit)
      handleSchemeClick({ uri: 'http://example.org/scheme/1', label: 'Local Scheme' })

      expect(selectSchemeSpy).toHaveBeenCalledWith('http://example.org/scheme/1')
    })

    it('opens external link for non-local scheme', () => {
      const schemeStore = useSchemeStore()
      schemeStore.schemes = []
      const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

      const { handleSchemeClick } = useConceptNavigation(emit)
      handleSchemeClick({ uri: 'http://external.org/scheme', label: 'External' })

      expect(windowOpenSpy).toHaveBeenCalledWith('http://external.org/scheme', '_blank')
      windowOpenSpy.mockRestore()
    })
  })

  describe('openExternal', () => {
    it('opens URI in new tab', () => {
      const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

      const { openExternal } = useConceptNavigation(emit)
      openExternal('http://example.org/resource')

      expect(windowOpenSpy).toHaveBeenCalledWith('http://example.org/resource', '_blank')
      windowOpenSpy.mockRestore()
    })
  })

  describe('navigateToCollection', () => {
    it('selects collection URI in concept store', () => {
      const conceptStore = useConceptStore()
      const selectCollectionSpy = vi.spyOn(conceptStore, 'selectCollection')

      const { navigateToCollection } = useConceptNavigation(emit)
      navigateToCollection({ uri: 'http://example.org/collection/1', label: 'Collection' })

      expect(selectCollectionSpy).toHaveBeenCalledWith('http://example.org/collection/1')
    })

    it('works with collection without label', () => {
      const conceptStore = useConceptStore()
      const selectCollectionSpy = vi.spyOn(conceptStore, 'selectCollection')

      const { navigateToCollection } = useConceptNavigation(emit)
      navigateToCollection({ uri: 'http://example.org/collection/2' })

      expect(selectCollectionSpy).toHaveBeenCalledWith('http://example.org/collection/2')
    })
  })
})
