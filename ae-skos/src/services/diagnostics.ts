/**
 * Diagnostic utilities for analyzing SPARQL endpoint data
 *
 * @see /spec/common/com01-EndpointManager.md
 */
import type { SPARQLEndpoint } from '../types'
import { executeSparql, withPrefixes } from './sparql'

export async function diagnoseEndpoint(endpoint: SPARQLEndpoint) {
  console.log('🔍 Diagnosing endpoint:', endpoint.url)

  // Query 1: Total concepts
  const totalQuery = withPrefixes(`
    SELECT (COUNT(DISTINCT ?concept) AS ?count)
    WHERE {
      ?concept a skos:Concept .
    }
  `)
  const totalResults = await executeSparql(endpoint, totalQuery)
  const totalConcepts = parseInt(totalResults.results.bindings[0]?.count?.value || '0', 10)
  console.log('📊 Total concepts:', totalConcepts)

  // Query 2: What properties exist
  const propQuery = withPrefixes(`
    SELECT DISTINCT ?property
    WHERE {
      ?concept a skos:Concept .
      ?concept ?property ?value .
    }
    ORDER BY ?property
  `)
  const propResults = await executeSparql(endpoint, propQuery)

  console.log('\n📋 Properties found:')
  propResults.results.bindings.forEach((binding: any) => {
    const prop = binding.property?.value || ''
    console.log(`  ${prop}`)
  })
}
