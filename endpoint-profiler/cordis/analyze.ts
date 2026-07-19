/**
 * Template analysis script for ae-rdf endpoints.
 *
 * @see /spec/ae-rdf/rdf00-EndpointAnalysis.md
 *
 * Run with: npx tsx analysis/cordis/analyze.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { analyzeEndpointWithSteps, type StepCallback, type TypeReport } from '../_shared/engine'
import { buildInheritance } from '../inheritance'

const baseDir = import.meta.dirname
const configPath = join(baseDir, 'input', 'config.json')
const rulesPath = join(baseDir, 'input', 'rules.json')
const outputDir = join(baseDir, 'output')
const analysisPath = join(outputDir, 'analysis.json')
const endpointPath = join(outputDir, 'endpoint.json')
const typesDir = join(outputDir, 'types')
const typesIndexPath = join(typesDir, 'index.json')
const namespacesPath = join(outputDir, 'namespaces.json')
const prefixMapPath = join(baseDir, '..', '..', 'ae-rdf', 'src', 'services', 'prefix-map.json')

const config = JSON.parse(readFileSync(configPath, 'utf-8'))
const rules = JSON.parse(readFileSync(rulesPath, 'utf-8'))

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`

const startTime = Date.now()
console.log('')
console.log(bold(config.name))
console.log(dim(config.url))
console.log('')

const STEP_NAME_WIDTH = 22
const RESULT_WIDTH = 12

let activeProgressStep: number | null = null

const stripAnsi = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, '')
let lastLineLength = 0

const formatLine = (
  step: number,
  total: number,
  name: string,
  durationMs: number,
  result: string,
  detail?: string,
) => {
  const stepWidth = `${total}/${total}`.length
  const stepLabel = `${step}/${total}`.padStart(stepWidth)
  const paddedName = name.padEnd(STEP_NAME_WIDTH)
  const paddedResult = cyan(result.padStart(RESULT_WIDTH))
  const duration = `${(durationMs / 1000).toFixed(1)}s`.padStart(6)
  const suffix = detail ? `  ${dim(detail)}` : ''
  return `  ${dim(stepLabel)} ${paddedName}${paddedResult}  ${dim(duration)}${suffix}`
}

const onStep: StepCallback = (step, total, name, durationMs, result, detail) => {
  const line = formatLine(step, total, name, durationMs, result, detail)
  const visibleLength = stripAnsi(line).length
  const isProgress = /^\d+\/\d+$/.test(result)
  if (isProgress) {
    activeProgressStep = step
    const padding = Math.max(lastLineLength - visibleLength, 0)
    process.stdout.write(`\r${line}${' '.repeat(padding)}`)
    lastLineLength = Math.max(lastLineLength, visibleLength)
    return
  }
  if (activeProgressStep === step) {
    process.stdout.write('\r' + ' '.repeat(lastLineLength) + '\r')
    activeProgressStep = null
    lastLineLength = 0
  }
  console.log(line)
}

const typeReports: Record<string, string> = {}
const prefixCache = new Map<string, string | null>()
let localPrefixMap: Record<string, string> = {}
const unresolvedNamespaces = new Set<string>()

try {
  localPrefixMap = JSON.parse(readFileSync(prefixMapPath, 'utf-8')) as Record<string, string>
} catch {
  localPrefixMap = {}
}
const namespaces = new Set<string>()

const splitIri = (iri: string): { ns: string; local: string } | null => {
  const match = iri.match(/^(.*[\/#])([^\/#]+)$/)
  if (!match) return null
  return { ns: match[1], local: match[2] }
}

const collectNamespace = (iri: string | undefined | null) => {
  if (!iri) return
  const parts = splitIri(iri)
  if (parts?.ns) namespaces.add(parts.ns)
}

const fetchPrefix = async (namespace: string): Promise<string | null> => {
  if (prefixCache.has(namespace)) return prefixCache.get(namespace) ?? null
  if (localPrefixMap[namespace]) {
    const prefix = localPrefixMap[namespace]
    prefixCache.set(namespace, prefix)
    return prefix
  }
  unresolvedNamespaces.add(namespace)
  prefixCache.set(namespace, null)
  return null
}

const toQName = async (iri: string): Promise<string | null> => {
  const parts = splitIri(iri)
  if (!parts) return null
  const prefix = await fetchPrefix(parts.ns)
  return prefix ? `${prefix}:${parts.local}` : null
}

const enrichReport = async (report: TypeReport): Promise<TypeReport> => {
  const typeQName = await toQName(report.type)
  const properties = await Promise.all(report.properties.map(async (prop) => {
    const propertyQName = await toQName(prop.property)

    // Enrich datatypes with qnames and nest languages under rdf:langString
    let enrichedDatatypes: Array<{
      datatype: string
      datatypeQName?: string
      count: number
      languages?: Array<{ lang: string; count: number }>
      uriTypes?: Array<{ type: string | null; typeQName?: string; count: number }>
    }> | undefined
    if (prop.datatypes) {
      enrichedDatatypes = await Promise.all(prop.datatypes.map(async (dt) => {
        if (dt.datatype === 'iri') {
          // Enrich uriTypes with QNames
          let enrichedUriTypes: Array<{ type: string | null; typeQName?: string; count: number }> | undefined
          if (dt.uriTypes && dt.uriTypes.length > 0) {
            enrichedUriTypes = await Promise.all(dt.uriTypes.map(async (ut) => {
              if (ut.type === null) {
                return { type: null, count: ut.count }
              }
              const typeQName = await toQName(ut.type)
              return {
                type: ut.type,
                ...(typeQName ? { typeQName } : {}),
                count: ut.count,
              }
            }))
          }
          return {
            datatype: dt.datatype,
            count: dt.count,
            ...(enrichedUriTypes ? { uriTypes: enrichedUriTypes } : {}),
          }
        }
        const qname = await toQName(dt.datatype)
        const isLangString = dt.datatype === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString'
        return {
          datatype: dt.datatype,
          ...(qname ? { datatypeQName: qname } : {}),
          count: dt.count,
          ...(isLangString && prop.languages ? { languages: prop.languages } : {}),
        }
      }))
    }

    return {
      property: prop.property,
      ...(propertyQName ? { propertyQName } : {}),
      ...(prop.count !== undefined ? { count: prop.count } : {}),
      ...(prop.subjectCount !== undefined ? { subjectCount: prop.subjectCount } : {}),
      ...(prop.cardinality ? { cardinality: prop.cardinality } : {}),
      ...(prop.cardinalityCounts ? { cardinalityCounts: prop.cardinalityCounts } : {}),
      ...(prop.topValues ? { topValues: prop.topValues } : {}),
      ...(prop.bnodeCount !== undefined ? { bnodeCount: prop.bnodeCount } : {}),
      ...(prop.distinctCount !== undefined ? { distinctCount: prop.distinctCount } : {}),
      ...(prop.numericRange ? { numericRange: prop.numericRange } : {}),
      ...(prop.dateRange ? { dateRange: prop.dateRange } : {}),
      ...(prop.languages ? { languages: prop.languages } : {}),
      ...(enrichedDatatypes ? { datatypes: enrichedDatatypes } : {}),
    }
  }))
  return {
    type: report.type,
    ...(typeQName ? { typeQName } : {}),
    ...(report.typeCount !== undefined ? { typeCount: report.typeCount } : {}),
    properties,
  }
}

const onTypeReport = async (report: TypeReport) => {
  mkdirSync(typesDir, { recursive: true })
  const enriched = await enrichReport(report)
  collectNamespace(enriched.type)
  for (const prop of enriched.properties) {
    collectNamespace(prop.property)
    if (prop.datatypes) {
      for (const dt of prop.datatypes) {
        if (dt.datatype && dt.datatype !== 'none' && dt.datatype !== 'iri') {
          collectNamespace(dt.datatype)
        }
        // Collect namespaces from URI value types
        if (dt.uriTypes) {
          for (const ut of dt.uriTypes) {
            if (ut.type) {
              collectNamespace(ut.type)
            }
          }
        }
      }
    }
  }
  const qnameBase = enriched.typeQName ? enriched.typeQName.replace(':', '--') : null
  const baseName = qnameBase ?? (report.type.split(/[\/#]/).filter(Boolean).pop() ?? 'type')
  const slug = baseName.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'type'
  const filename = `${slug}.json`
  const filePath = join(typesDir, filename)
  writeFileSync(filePath, JSON.stringify(enriched, null, 2))
  typeReports[report.type] = filename
}

const getTypeLabel = async (iri: string): Promise<string> => {
  const qname = await toQName(iri)
  return qname ?? (iri.split(/[\/#]/).filter(Boolean).pop() ?? iri)
}

const namespacesOnly = process.argv.includes('--namespaces-only')

const analysis = await analyzeEndpointWithSteps(
  config,
  rules,
  onStep,
  namespacesOnly ? undefined : onTypeReport,
  { namespacesOnly, getTypeLabel },
)

mkdirSync(outputDir, { recursive: true })
writeFileSync(analysisPath, JSON.stringify(analysis, null, 2))
writeFileSync(endpointPath, JSON.stringify({ ...config, analysis }, null, 2))

if (!namespacesOnly && Object.keys(typeReports).length > 0) {
  writeFileSync(typesIndexPath, JSON.stringify(typeReports, null, 2))
}

if (namespacesOnly) {
  const types = (analysis as any)?.types?.items ?? []
  for (const typeItem of types) {
    if (typeItem?.type) collectNamespace(typeItem.type)
  }
  const properties = (analysis as any)?.properties?.items ?? []
  for (const propItem of properties) {
    if (propItem?.property) collectNamespace(propItem.property)
  }
}

if (namespaces.size > 0) {
  writeFileSync(namespacesPath, JSON.stringify({ namespaces: Array.from(namespaces).sort() }, null, 2))
}

console.log('')
console.log(`  ${green('✓')} ${bold('Complete')}  ${dim(`${((Date.now() - startTime) / 1000).toFixed(1)}s`)}`)
console.log(`  ${dim('Wrote')} ${analysisPath}`)
console.log(`  ${dim('Wrote')} ${endpointPath}`)
if (!namespacesOnly && Object.keys(typeReports).length > 0) {
  console.log(`  ${dim('Wrote')} ${typesIndexPath}`)
  console.log(`  ${dim('Wrote')} ${typesDir}/... (${Object.keys(typeReports).length} types)`)
}
if (namespaces.size > 0) {
  console.log(`  ${dim('Wrote')} ${namespacesPath}`)
}
if (namespacesOnly) {
  console.log(`  ${dim('Mode')} namespaces-only`)
}
if (unresolvedNamespaces.size > 0) {
  const missingList = Array.from(unresolvedNamespaces).sort()
  console.log(`  ${dim('Missing prefixes')} ${unresolvedNamespaces.size}`)
  for (const ns of missingList) {
    console.log(`  ${dim('·')} ${dim(ns)}`)
  }
}

if (!namespacesOnly && Object.keys(typeReports).length > 0) {
  try {
    await buildInheritance({ endpointDir: baseDir })
    console.log(`  ${dim('Wrote')} ${join(outputDir, 'inheritance.json')}`)
  } catch (err) {
    console.log(`  ${dim('Inheritance')} error`)
  }
}
