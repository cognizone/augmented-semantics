/**
 * Deprecation Detection Composable
 *
 * Provides utilities for detecting and displaying deprecated concepts
 * based on configurable rules stored in settings.
 *
 * @see /spec/ae-skos/sko04-ConceptDetails.md
 */
import { computed } from 'vue'
import { useSettingsStore, type DeprecationRule } from '../stores/settings'
import type { OtherProperty } from '../types'

/**
 * Generate a variable name for a deprecation rule in SPARQL
 */
function ruleVarName(rule: DeprecationRule): string {
  return `deprec_${rule.id.replace(/[^a-zA-Z0-9]/g, '_')}`
}

/**
 * Composable for deprecation detection
 */
export function useDeprecation() {
  const settingsStore = useSettingsStore()

  /**
   * Get only enabled deprecation rules
   */
  const enabledRules = computed(() =>
    settingsStore.deprecationRules.filter(r => r.enabled)
  )

  /**
   * Whether to show deprecation indicators
   */
  const showIndicator = computed(() => settingsStore.showDeprecationIndicator)

  /**
   * Build SPARQL OPTIONAL clauses for deprecation detection.
   * Each enabled rule generates an OPTIONAL clause to fetch the relevant predicate.
   *
   * @param conceptVar - The SPARQL variable for the concept (e.g., "?concept" or "<uri>")
   * @returns SPARQL fragment with OPTIONAL clauses
   */
  function getDeprecationSparqlClauses(conceptVar: string): string {
    const clauses: string[] = []

    for (const rule of enabledRules.value) {
      const varName = ruleVarName(rule)
      clauses.push(`OPTIONAL { ${conceptVar} <${rule.predicate}> ?${varName} }`)
    }

    return clauses.join('\n      ')
  }

  /**
   * Get the SPARQL SELECT variables needed for deprecation detection
   */
  function getDeprecationSelectVars(): string {
    return enabledRules.value
      .map(rule => `?${ruleVarName(rule)}`)
      .join(' ')
  }

  /**
   * Parse a SPARQL result binding to determine if the concept is deprecated.
   * Checks all enabled rules and returns true if any rule matches.
   *
   * @param binding - SPARQL result binding object
   * @returns true if the concept is deprecated according to any enabled rule
   */
  function isDeprecatedFromBinding(binding: Record<string, { value?: string; type?: string }>): boolean {
    for (const rule of enabledRules.value) {
      const varName = ruleVarName(rule)
      const bindingValue = binding[varName]

      if (!bindingValue?.value && rule.condition !== 'exists') {
        // For 'not-equals', absence of value means not deprecated
        // (we can't determine status without the value)
        continue
      }

      switch (rule.condition) {
        case 'exists':
          // Deprecated if the predicate exists with any value
          if (bindingValue?.value !== undefined) {
            return true
          }
          break

        case 'equals':
          // Deprecated if value equals the configured value
          if (rule.value && bindingValue?.value === rule.value) {
            return true
          }
          break

        case 'not-equals':
          // Deprecated if value exists and does NOT equal the configured value
          if (bindingValue?.value !== undefined && rule.value && bindingValue.value !== rule.value) {
            return true
          }
          break
      }
    }

    return false
  }

  /**
   * Check if a concept is deprecated based on its otherProperties.
   * This is used in ConceptDetails where properties are already loaded.
   *
   * @param otherProperties - Array of other (non-SKOS) properties
   * @returns true if deprecated according to any enabled rule
   */
  function isDeprecatedFromProperties(otherProperties: OtherProperty[]): boolean {
    for (const rule of enabledRules.value) {
      const prop = otherProperties.find(p => p.predicate === rule.predicate)

      if (!prop && rule.condition !== 'exists') {
        // For 'not-equals', absence of property means we can't determine status
        continue
      }

      switch (rule.condition) {
        case 'exists':
          if (prop && prop.values.length > 0) {
            return true
          }
          break

        case 'equals':
          if (prop && rule.value && prop.values.some(v => v.value === rule.value)) {
            return true
          }
          break

        case 'not-equals':
          if (prop && rule.value && prop.values.some(v => v.value !== rule.value)) {
            return true
          }
          break
      }
    }

    return false
  }

  return {
    enabledRules,
    showIndicator,
    getDeprecationSparqlClauses,
    getDeprecationSelectVars,
    isDeprecatedFromBinding,
    isDeprecatedFromProperties,
  }
}
