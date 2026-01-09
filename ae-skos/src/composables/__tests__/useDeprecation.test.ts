/**
 * useDeprecation Composable Tests
 *
 * Tests for deprecation detection utilities.
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDeprecation } from '../useDeprecation'
import { useSettingsStore, DEFAULT_DEPRECATION_RULES } from '../../stores/settings'
import type { OtherProperty } from '../../types'

describe('useDeprecation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('enabledRules', () => {
    it('returns only enabled rules', () => {
      const settingsStore = useSettingsStore()
      // Default: both rules enabled
      const { enabledRules } = useDeprecation()

      expect(enabledRules.value).toHaveLength(2)
    })

    it('filters out disabled rules', () => {
      const settingsStore = useSettingsStore()
      settingsStore.setDeprecationRules([
        { ...DEFAULT_DEPRECATION_RULES[0], enabled: false },
        { ...DEFAULT_DEPRECATION_RULES[1], enabled: true },
      ])

      const { enabledRules } = useDeprecation()

      expect(enabledRules.value).toHaveLength(1)
      expect(enabledRules.value[0].id).toBe('euvoc-status')
    })

    it('returns empty when all rules disabled', () => {
      const settingsStore = useSettingsStore()
      settingsStore.setDeprecationRules([
        { ...DEFAULT_DEPRECATION_RULES[0], enabled: false },
        { ...DEFAULT_DEPRECATION_RULES[1], enabled: false },
      ])

      const { enabledRules } = useDeprecation()

      expect(enabledRules.value).toHaveLength(0)
    })
  })

  describe('showIndicator', () => {
    it('reflects settings store value', () => {
      const settingsStore = useSettingsStore()
      const { showIndicator } = useDeprecation()

      expect(showIndicator.value).toBe(true) // default

      settingsStore.setShowDeprecationIndicator(false)
      expect(showIndicator.value).toBe(false)
    })
  })

  describe('getDeprecationSparqlClauses', () => {
    it('generates OPTIONAL clauses for enabled rules', () => {
      const { getDeprecationSparqlClauses } = useDeprecation()

      const clauses = getDeprecationSparqlClauses('?concept')

      expect(clauses).toContain('OPTIONAL')
      expect(clauses).toContain('?concept')
      expect(clauses).toContain('owl#deprecated')
      expect(clauses).toContain('euvoc#status')
    })

    it('uses provided concept variable', () => {
      const { getDeprecationSparqlClauses } = useDeprecation()

      const clauses = getDeprecationSparqlClauses('<http://example.org/concept>')

      expect(clauses).toContain('<http://example.org/concept>')
    })

    it('returns empty string when no rules enabled', () => {
      const settingsStore = useSettingsStore()
      settingsStore.setDeprecationRules([])

      const { getDeprecationSparqlClauses } = useDeprecation()

      expect(getDeprecationSparqlClauses('?concept')).toBe('')
    })
  })

  describe('getDeprecationSelectVars', () => {
    it('generates variable names for enabled rules', () => {
      const { getDeprecationSelectVars } = useDeprecation()

      const vars = getDeprecationSelectVars()

      expect(vars).toContain('?deprec_owl_deprecated')
      expect(vars).toContain('?deprec_euvoc_status')
    })

    it('returns empty string when no rules enabled', () => {
      const settingsStore = useSettingsStore()
      settingsStore.setDeprecationRules([])

      const { getDeprecationSelectVars } = useDeprecation()

      expect(getDeprecationSelectVars()).toBe('')
    })
  })

  describe('isDeprecatedFromBinding', () => {
    it('returns true for owl:deprecated = true (equals condition)', () => {
      const { isDeprecatedFromBinding } = useDeprecation()

      const binding = {
        deprec_owl_deprecated: { value: 'true' },
      }

      expect(isDeprecatedFromBinding(binding)).toBe(true)
    })

    it('returns false for owl:deprecated = false', () => {
      const { isDeprecatedFromBinding } = useDeprecation()

      const binding = {
        deprec_owl_deprecated: { value: 'false' },
      }

      expect(isDeprecatedFromBinding(binding)).toBe(false)
    })

    it('returns true for euvoc:status != CURRENT (not-equals condition)', () => {
      const { isDeprecatedFromBinding } = useDeprecation()

      const binding = {
        deprec_euvoc_status: { value: 'http://publications.europa.eu/resource/authority/concept-status/DEPRECATED' },
      }

      expect(isDeprecatedFromBinding(binding)).toBe(true)
    })

    it('returns false for euvoc:status = CURRENT', () => {
      const { isDeprecatedFromBinding } = useDeprecation()

      const binding = {
        deprec_euvoc_status: { value: 'http://publications.europa.eu/resource/authority/concept-status/CURRENT' },
      }

      expect(isDeprecatedFromBinding(binding)).toBe(false)
    })

    it('returns false when no deprecation values present', () => {
      const { isDeprecatedFromBinding } = useDeprecation()

      const binding = {}

      expect(isDeprecatedFromBinding(binding)).toBe(false)
    })

    it('handles exists condition', () => {
      const settingsStore = useSettingsStore()
      settingsStore.setDeprecationRules([
        {
          id: 'test-exists',
          label: 'Test Exists',
          predicate: 'http://example.org/deprecated',
          condition: 'exists',
          enabled: true,
        },
      ])

      const { isDeprecatedFromBinding } = useDeprecation()

      // Has value -> deprecated
      expect(isDeprecatedFromBinding({
        deprec_test_exists: { value: 'anything' },
      })).toBe(true)

      // No value -> not deprecated
      expect(isDeprecatedFromBinding({})).toBe(false)
    })
  })

  describe('isDeprecatedFromProperties', () => {
    it('returns true for owl:deprecated = true in properties', () => {
      const { isDeprecatedFromProperties } = useDeprecation()

      const properties: OtherProperty[] = [
        {
          predicate: 'http://www.w3.org/2002/07/owl#deprecated',
          values: [{ value: 'true', isUri: false }],
        },
      ]

      expect(isDeprecatedFromProperties(properties)).toBe(true)
    })

    it('returns false for owl:deprecated = false', () => {
      const { isDeprecatedFromProperties } = useDeprecation()

      const properties: OtherProperty[] = [
        {
          predicate: 'http://www.w3.org/2002/07/owl#deprecated',
          values: [{ value: 'false', isUri: false }],
        },
      ]

      expect(isDeprecatedFromProperties(properties)).toBe(false)
    })

    it('returns true for euvoc:status != CURRENT', () => {
      const { isDeprecatedFromProperties } = useDeprecation()

      const properties: OtherProperty[] = [
        {
          predicate: 'http://publications.europa.eu/ontology/euvoc#status',
          values: [{ value: 'http://publications.europa.eu/resource/authority/concept-status/DEPRECATED', isUri: true }],
        },
      ]

      expect(isDeprecatedFromProperties(properties)).toBe(true)
    })

    it('returns false for euvoc:status = CURRENT', () => {
      const { isDeprecatedFromProperties } = useDeprecation()

      const properties: OtherProperty[] = [
        {
          predicate: 'http://publications.europa.eu/ontology/euvoc#status',
          values: [{ value: 'http://publications.europa.eu/resource/authority/concept-status/CURRENT', isUri: true }],
        },
      ]

      expect(isDeprecatedFromProperties(properties)).toBe(false)
    })

    it('returns false when no matching properties', () => {
      const { isDeprecatedFromProperties } = useDeprecation()

      const properties: OtherProperty[] = [
        {
          predicate: 'http://example.org/other',
          values: [{ value: 'test', isUri: false }],
        },
      ]

      expect(isDeprecatedFromProperties(properties)).toBe(false)
    })

    it('returns false for empty properties array', () => {
      const { isDeprecatedFromProperties } = useDeprecation()

      expect(isDeprecatedFromProperties([])).toBe(false)
    })
  })
})
