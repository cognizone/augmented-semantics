/**
 * Build inheritance insights from per-type reports plus live co-typing checks.
 *
 * Usage:
 *   npx tsx analysis/inheritance.ts --endpoint ae-rdf/analysis/cordis
 *
 * Options:
 *   --out <path>              Output file (default: <endpoint>/output/inheritance.json)
 *   --no-suggestions          Skip similarity-based suggestions
 *   --min-similarity <num>    Default: 0.35
 *   --max-suggestions <num>   Default: 3
 *   --max-types <num>         Limit suggestions to first N types (by count asc). Default: 300
 *   --max-edges <num>         Limit asserted edges processed (for co-typing). Default: unlimited
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { executeSparql } from './_shared/engine'

const args = process.argv.slice(2)

const argValue = (name: string): string | undefined => {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

const endpointArg = argValue('--endpoint')
const endpointDir = resolve(process.cwd(), endpointArg ?? '.')
const outPath = resolve(
  process.cwd(),
  argValue('--out') ?? join(endpointDir, 'output', 'inheritance.json'),
)

const noSuggestions = args.includes('--no-suggestions')
const minSimilarity = Number(argValue('--min-similarity') ?? 0.35)
const maxSuggestions = Number(argValue('--max-suggestions') ?? 3)
const maxTypesForSuggestions = Number(argValue('--max-types') ?? 300)
const maxEdges = argValue('--max-edges') ? Number(argValue('--max-edges')) : undefined

type PropertyVector = Map<string, number>

interface TypeInfo {
  type: string
  count?: number
  properties: PropertyVector
}

const similarity = (a: PropertyVector, b: PropertyVector): { score: number | null; shared: number } => {
  if (a.size === 0 && b.size === 0) return { score: null, shared: 0 }
  let minSum = 0
  let maxSum = 0
  let shared = 0

  const keys = new Set<string>([...a.keys(), ...b.keys()])
  for (const key of keys) {
    const av = a.get(key) ?? 0
    const bv = b.get(key) ?? 0
    if (av > 0 && bv > 0) shared += 1
    minSum += Math.min(av, bv)
    maxSum += Math.max(av, bv)
  }

  if (maxSum === 0) return { score: null, shared }
  return { score: minSum / maxSum, shared }
}

export async function buildInheritance(options: {
  endpointDir: string
  outPath?: string
  noSuggestions?: boolean
  minSimilarity?: number
  maxSuggestions?: number
  maxTypesForSuggestions?: number
  maxEdges?: number
}): Promise<void> {
  const endpointDirResolved = resolve(process.cwd(), options.endpointDir)
  const outPathResolved = resolve(
    process.cwd(),
    options.outPath ?? join(endpointDirResolved, 'output', 'inheritance.json'),
  )

  const configPath = join(endpointDirResolved, 'input', 'config.json')
  const typesDir = join(endpointDirResolved, 'output', 'types')

  if (!existsSync(configPath)) {
    throw new Error(`Missing config: ${configPath}`)
  }

  if (!existsSync(typesDir)) {
    throw new Error(`Missing types dir: ${typesDir}`)
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'))
  const endpointUrl = config.url as string

  const localNoSuggestions = options.noSuggestions ?? false
  const localMinSimilarity = options.minSimilarity ?? 0.35
  const localMaxSuggestions = options.maxSuggestions ?? 3
  const localMaxTypesForSuggestions = options.maxTypesForSuggestions ?? 300
  const localMaxEdges = options.maxEdges

  const typeMap = new Map<string, TypeInfo>()

  const typeFiles = readdirSync(typesDir)
    .filter((name) => name.endsWith('.json') && name !== 'index.json')
    .map((name) => join(typesDir, name))

  for (const file of typeFiles) {
    const data = JSON.parse(readFileSync(file, 'utf-8'))
    if (!data?.type) continue

    const type = String(data.type)
    const typeCount = typeof data.typeCount === 'number' ? data.typeCount : undefined
    const props = new Map<string, number>()

    const properties = Array.isArray(data.properties) ? data.properties : []
    for (const prop of properties) {
      const property = prop?.property ? String(prop.property) : undefined
      if (!property) continue

      let subjectCount: number | undefined = typeof prop.subjectCount === 'number' ? prop.subjectCount : undefined
      if (subjectCount === undefined && prop.cardinalityCounts && typeof prop.cardinalityCounts === 'object') {
        let sum = 0
        for (const [key, value] of Object.entries(prop.cardinalityCounts as Record<string, number>)) {
          if (key === '0') continue
          if (typeof value === 'number') sum += value
        }
        subjectCount = sum
      }

      if (subjectCount !== undefined && typeCount && typeCount > 0) {
        props.set(property, subjectCount / typeCount)
      }
    }

    typeMap.set(type, {
      type,
      count: typeCount,
      properties: props,
    })
  }

  const subclassQuery =
    `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> ` +
    `SELECT DISTINCT ?child ?parent WHERE { ?child rdfs:subClassOf ?parent }`

  const subclassData = await executeSparql(endpointUrl, subclassQuery)
  const subclassBindings = (subclassData as any)?.results?.bindings ?? []
  const assertedEdges: Array<{
    child: string
    parent: string
    childCount?: number
    parentCount?: number
    coTypeCount?: number
    missingSuperclassAssertionRate?: number
    mixedAssertion?: boolean
    propertySimilarity?: number | null
    sharedProperties?: number
  }> = []

  const edges = subclassBindings
    .map((row: any) => ({
      child: row.child?.value as string | undefined,
      parent: row.parent?.value as string | undefined,
    }))
    .filter((row: any) => typeof row.child === 'string' && typeof row.parent === 'string')

  const edgeLimit = localMaxEdges && localMaxEdges > 0 ? Math.min(edges.length, localMaxEdges) : edges.length

  for (let i = 0; i < edgeLimit; i += 1) {
    const edge = edges[i]
    const childInfo = typeMap.get(edge.child)
    const parentInfo = typeMap.get(edge.parent)
    const childCount = childInfo?.count
    const parentCount = parentInfo?.count

    let coTypeCount: number | undefined
    try {
      const coTypeQuery =
        `SELECT (COUNT(DISTINCT ?s) AS ?count) WHERE { ?s a <${edge.child}> ; a <${edge.parent}> }`
      const coTypeData = await executeSparql(endpointUrl, coTypeQuery)
      const coTypeBindings = (coTypeData as any)?.results?.bindings ?? []
      const countValue = coTypeBindings[0]?.count?.value
      if (countValue !== undefined) {
        const parsed = Number(countValue)
        if (Number.isFinite(parsed)) coTypeCount = parsed
      }
    } catch {
      // ignore co-type failures
    }

    let missingSuperclassAssertionRate: number | undefined
    let mixedAssertion: boolean | undefined
    if (childCount !== undefined && coTypeCount !== undefined && childCount > 0) {
      missingSuperclassAssertionRate = 1 - coTypeCount / childCount
      mixedAssertion = coTypeCount > 0 && coTypeCount < childCount
    }

    let propertySimilarity: number | null | undefined
    let sharedProperties: number | undefined
    if (childInfo && parentInfo) {
      const sim = similarity(childInfo.properties, parentInfo.properties)
      propertySimilarity = sim.score
      sharedProperties = sim.shared
    }

    assertedEdges.push({
      child: edge.child,
      parent: edge.parent,
      childCount,
      parentCount,
      coTypeCount,
      missingSuperclassAssertionRate,
      mixedAssertion,
      propertySimilarity,
      sharedProperties,
    })
  }

  let suggestions: Array<{
    child: string
    candidate: string
    similarity: number
    sharedProperties: number
  }> = []

  if (!localNoSuggestions) {
    const types = Array.from(typeMap.values()).sort((a, b) => {
      const aCount = typeof a.count === 'number' ? a.count : Number.POSITIVE_INFINITY
      const bCount = typeof b.count === 'number' ? b.count : Number.POSITIVE_INFINITY
      return aCount - bCount
    })

    const limitedTypes = types.slice(0, Math.min(types.length, localMaxTypesForSuggestions))

    const parentSetByChild = new Map<string, Set<string>>()
    for (const edge of assertedEdges) {
      const set = parentSetByChild.get(edge.child) ?? new Set<string>()
      set.add(edge.parent)
      parentSetByChild.set(edge.child, set)
    }

    for (const child of limitedTypes) {
      const candidates: Array<{ candidate: string; similarity: number; sharedProperties: number }> = []
      for (const parent of limitedTypes) {
        if (child.type === parent.type) continue
        const assertedParents = parentSetByChild.get(child.type)
        if (assertedParents && assertedParents.has(parent.type)) continue

        const sim = similarity(child.properties, parent.properties)
        if (sim.score === null) continue
        if (sim.score >= localMinSimilarity) {
          candidates.push({
            candidate: parent.type,
            similarity: sim.score,
            sharedProperties: sim.shared,
          })
        }
      }

      candidates.sort((a, b) => b.similarity - a.similarity)
      for (const entry of candidates.slice(0, localMaxSuggestions)) {
        suggestions.push({
          child: child.type,
          candidate: entry.candidate,
          similarity: entry.similarity,
          sharedProperties: entry.sharedProperties,
        })
      }
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    endpoint: {
      name: config.name,
      url: config.url,
    },
    thresholds: {
      minSimilarity: localMinSimilarity,
      maxSuggestions: localMaxSuggestions,
      maxTypesForSuggestions: localMaxTypesForSuggestions,
      suggestionsEnabled: !localNoSuggestions,
    },
    assertedEdges,
    suggestedParents: suggestions,
  }

  writeFileSync(outPathResolved, JSON.stringify(output, null, 2))
}

async function main(): Promise<void> {
  await buildInheritance({
    endpointDir,
    outPath,
    noSuggestions,
    minSimilarity,
    maxSuggestions,
    maxTypesForSuggestions,
    maxEdges,
  })
  console.log(`Wrote ${outPath}`)
}

const invokedAsScript = process.argv[1]?.includes('inheritance.ts')
if (invokedAsScript) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
