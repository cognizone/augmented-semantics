/**
 * Generate OWL and SHACL from endpoint analysis plus a base ontology.
 *
 * Usage:
 *   npx tsx analysis/owl-shacl.ts --endpoint ae-rdf/analysis/cordis
 *
 * Options:
 *   --out <path>              Output TTL file (default: <endpoint>/output/ontology.owl.ttl)
 *   --report <path>           Report JSON (default: <endpoint>/output/ontology.report.json)
 *   --config <path>           Config JSON (default: <endpoint>/input/ontology.json)
 *   --fresh                   Ignore previous output and delete existing OWL file
 *
 * Outputs:
 *   - ontology.owl.ttl        OWL ontology
 *   - ontology.shacl.ttl      SHACL shapes derived from OWL + endpoint statistics
 *   - ontology.report.json    Generation report
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { Parser, Writer, DataFactory } from 'n3'

const { namedNode, literal, quad } = DataFactory

const args = process.argv.slice(2)
const argValue = (name: string): string | undefined => {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

const endpointArg = argValue('--endpoint')
const fresh = args.includes('--fresh')
const endpointDir = resolve(process.cwd(), endpointArg ?? '.')
const outPath = resolve(
  process.cwd(),
  argValue('--out') ?? join(endpointDir, 'output', 'ontology.owl.ttl'),
)
const reportPath = resolve(
  process.cwd(),
  argValue('--report') ?? join(endpointDir, 'output', 'ontology.report.json'),
)
const configPath = resolve(
  process.cwd(),
  argValue('--config') ?? join(endpointDir, 'input', 'ontology.json'),
)

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const step = (label: string, detail?: string) => {
  const suffix = detail ? ` ${dim(detail)}` : ''
  console.log(`  ${cyan('•')} ${bold(label)}${suffix}`)
}
const section = (title: string) => {
  console.log('')
  console.log(bold(title))
}
const warn = (label: string, detail?: string) => {
  const suffix = detail ? ` ${dim(detail)}` : ''
  console.log(`  ${yellow('!')} ${bold(label)}${suffix}`)
}
const debugRelatedTypes = process.env.AE_RDF_DEBUG_RELATED === '1'

console.log('')
console.log(bold('OWL + SHACL Generation'))
console.log(dim(endpointDir))
console.log('')
step('Config', configPath)
if (fresh) {
  step('Fresh run', 'existing OWL output will be removed')
}

if (!existsSync(configPath)) {
  throw new Error(`Missing ontology config: ${configPath}`)
}

const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
  ontology?: {
    file?: string
    files?: string[]
    baseIri?: string
    iri?: string
    versionInfo?: string
    reuseOutputAsBase?: boolean
  }
  scope?: {
    classesFromEndpointOnly?: boolean
    propertiesFromEndpointOnly?: boolean
    includeNamespaces?: string[]
    excludeNamespaces?: string[]
    classAllowlist?: string[]
    classDenylist?: string[]
    propertyAllowlist?: string[]
    propertyDenylist?: string[]
    rootClasses?: string[]
    includeSubclasses?: boolean
    includeSuperclasses?: boolean
    includeRelatedTypes?: boolean
    includeSuperproperties?: boolean
    includeInverseProperties?: boolean
  }
  inheritance?: {
    mode?: 'ontology-only' | 'ontology+manual' | 'analysis-fallback'
    manualEdges?: {
      subClassOf?: Array<{ child: string; parent: string }>
      subPropertyOf?: Array<{ child: string; parent: string }>
    }
  }
  generation?: {
    emit?: string[]
    emitLabels?: boolean
    emitComments?: boolean
    emitAnnotations?: boolean
    emitDomains?: boolean
    emitRanges?: boolean
    domainRangePolicy?: 'off' | 'unique' | 'branch'
    rangePolicy?: 'off' | 'unique' | 'branch' | 'datatype-unique' | 'ontology-only'
    policyNotes?: boolean
    policyNotePredicate?: string
    policyNoteTag?: string
  }
}

const analysisPath = join(endpointDir, 'output', 'analysis.json')
const typesDir = join(endpointDir, 'output', 'types')

if (!existsSync(analysisPath)) {
  throw new Error(`Missing analysis.json: ${analysisPath}`)
}

const analysis = JSON.parse(readFileSync(analysisPath, 'utf-8')) as any
step('Analysis', analysisPath)

const observedClasses = new Set<string>()
const observedProperties = new Set<string>()

const typesFromAnalysis = Array.isArray(analysis?.types?.items) ? analysis.types.items : []
for (const typeItem of typesFromAnalysis) {
  if (typeof typeItem?.type === 'string') observedClasses.add(typeItem.type)
}

const propertiesFromAnalysis = Array.isArray(analysis?.properties?.items) ? analysis.properties.items : []
for (const propItem of propertiesFromAnalysis) {
  if (typeof propItem?.property === 'string') observedProperties.add(propItem.property)
}

type PropertyCounts = { iri: number; literal: number }
const propertyCounts = new Map<string, PropertyCounts>()
const propertyDatatypeCounts = new Map<string, Map<string, number>>()
const classPropertyUsage = new Map<string, Map<string, number>>()

// Store endpoint-observed types for URI values per property (aggregated across all classes)
type UriTypeCount = { type: string | null; count: number }
const propertyEndpointRanges = new Map<string, Map<string | null, number>>()

// SHACL: Store cardinality and datatype info per class-property pair
type CardinalityInfo = { min: number; max: number; subjects: number }
type CardinalityCounts = Record<string, number> // e.g., { "0": 100, "1": 500, "2": 50 }
type PropertyShaclInfo = {
  cardinality?: CardinalityInfo
  cardinalityCounts?: CardinalityCounts
  datatypes?: Array<{ datatype: string; count: number }>
  languages?: Array<{ lang: string; count: number }>
}
const classPropertyShaclInfo = new Map<string, Map<string, PropertyShaclInfo>>()
const classInstanceCounts = new Map<string, number>()

if (existsSync(typesDir)) {
  const typeFiles = readdirSync(typesDir)
    .filter((name) => name.endsWith('.json') && name !== 'index.json')
    .map((name) => join(typesDir, name))

  step('Types', `${typeFiles.length} files`)

  for (const file of typeFiles) {
    const data = JSON.parse(readFileSync(file, 'utf-8'))
    const typeIri = typeof data?.type === 'string' ? data.type : undefined
    if (typeIri) observedClasses.add(typeIri)
    // Store instance count for SHACL NodeShape notes
    if (typeIri && typeof data?.typeCount === 'number') {
      classInstanceCounts.set(typeIri, data.typeCount)
    }
    const props = Array.isArray(data?.properties) ? data.properties : []
    const classProps = typeIri ? (classPropertyUsage.get(typeIri) ?? new Map<string, number>()) : null
    // SHACL: prepare per-class property info
    const classShaclProps = typeIri ? (classPropertyShaclInfo.get(typeIri) ?? new Map<string, PropertyShaclInfo>()) : null

    for (const prop of props) {
      if (typeof prop?.property !== 'string') continue
      const iri = prop.property as string
      observedProperties.add(iri)
      if (classProps) {
        let subjectCount: number | undefined = typeof prop.subjectCount === 'number' ? prop.subjectCount : undefined
        if (subjectCount === undefined && prop.cardinalityCounts && typeof prop.cardinalityCounts === 'object') {
          let sum = 0
          for (const [key, value] of Object.entries(prop.cardinalityCounts as Record<string, number>)) {
            if (key === '0') continue
            if (typeof value === 'number') sum += value
          }
          if (sum > 0) subjectCount = sum
        }
        if (subjectCount !== undefined) {
          classProps.set(iri, subjectCount)
        }
      }

      // SHACL: collect cardinality and datatypes per class-property
      if (classShaclProps && typeIri) {
        const shaclInfo: PropertyShaclInfo = {}
        // Cardinality
        if (prop.cardinality && typeof prop.cardinality === 'object') {
          const card = prop.cardinality as { min?: number; max?: number; subjects?: number }
          if (typeof card.min === 'number' && typeof card.max === 'number') {
            shaclInfo.cardinality = {
              min: card.min,
              max: card.max,
              subjects: typeof card.subjects === 'number' ? card.subjects : 0,
            }
          }
        }
        // Cardinality counts (distribution)
        if (prop.cardinalityCounts && typeof prop.cardinalityCounts === 'object') {
          shaclInfo.cardinalityCounts = prop.cardinalityCounts as CardinalityCounts
        }
        // Datatypes
        if (Array.isArray(prop.datatypes)) {
          shaclInfo.datatypes = prop.datatypes
            .filter((dt: any) => typeof dt?.datatype === 'string' && typeof dt?.count === 'number')
            .map((dt: any) => ({ datatype: dt.datatype, count: dt.count }))
        }
        // Languages
        if (Array.isArray(prop.languages)) {
          shaclInfo.languages = prop.languages
            .filter((l: any) => typeof l?.lang === 'string' && typeof l?.count === 'number')
            .map((l: any) => ({ lang: l.lang, count: l.count }))
        }
        if (shaclInfo.cardinality || shaclInfo.datatypes || shaclInfo.languages) {
          classShaclProps.set(iri, shaclInfo)
        }
      }

      if (Array.isArray(prop.datatypes)) {
        for (const dt of prop.datatypes) {
          if (typeof dt?.datatype !== 'string' || typeof dt?.count !== 'number') continue
          const counts = propertyCounts.get(iri) ?? { iri: 0, literal: 0 }
          if (dt.datatype === 'iri') {
            counts.iri += dt.count
            // Collect URI types for this property
            if (Array.isArray(dt.uriTypes)) {
              const rangeBucket = propertyEndpointRanges.get(iri) ?? new Map<string | null, number>()
              for (const ut of dt.uriTypes) {
                const typeKey = ut.type ?? null
                const currentCount = rangeBucket.get(typeKey) ?? 0
                rangeBucket.set(typeKey, currentCount + (ut.count ?? 0))
              }
              propertyEndpointRanges.set(iri, rangeBucket)
            }
          } else {
            counts.literal += dt.count
          }
          propertyCounts.set(iri, counts)

          const dtBucket = propertyDatatypeCounts.get(iri) ?? new Map<string, number>()
          const current = dtBucket.get(dt.datatype) ?? 0
          dtBucket.set(dt.datatype, current + dt.count)
          propertyDatatypeCounts.set(iri, dtBucket)
        }
      }
    }
    if (typeIri && classProps) {
      classPropertyUsage.set(typeIri, classProps)
    }
    if (typeIri && classShaclProps && classShaclProps.size > 0) {
      classPropertyShaclInfo.set(typeIri, classShaclProps)
    }
  }
}

const prefixesFromConfigPath = join(import.meta.dirname, '..', 'ae-rdf', 'src', 'services', 'prefix-map.json')
let prefixMap: Record<string, string> = {}
if (existsSync(prefixesFromConfigPath)) {
  try {
    const nsToPrefix = JSON.parse(readFileSync(prefixesFromConfigPath, 'utf-8')) as Record<string, string>
    prefixMap = Object.fromEntries(Object.entries(nsToPrefix).map(([ns, prefix]) => [prefix, ns]))
  } catch {
    prefixMap = {}
  }
}

const parserPrefixes: Record<string, string> = {}

const ontologyFiles: string[] = []
if (Array.isArray(config.ontology?.files) && config.ontology?.files.length) {
  for (const file of config.ontology.files) {
    if (!file) continue
    ontologyFiles.push(resolve(dirname(configPath), file))
  }
} else if (config.ontology?.file) {
  ontologyFiles.push(resolve(dirname(configPath), config.ontology.file))
}

const reuseOutputAsBase = config.ontology?.reuseOutputAsBase === true && !fresh
if (fresh && existsSync(outPath)) {
  unlinkSync(outPath)
}
if (reuseOutputAsBase && existsSync(outPath)) {
  const resolvedOut = resolve(outPath)
  if (!ontologyFiles.includes(resolvedOut)) {
    ontologyFiles.push(resolvedOut)
  }
}

if (ontologyFiles.length > 0) {
  step('Ontology inputs', ontologyFiles.length.toString())
  for (const file of ontologyFiles) {
    console.log(`    ${dim('·')} ${file}`)
  }
}

type LiteralInfo = { value: string; lang?: string; datatype?: string }
type AnnotationValue =
  | { type: 'literal'; value: string; lang?: string; datatype?: string }
  | { type: 'iri'; value: string }

const ontologyClasses = new Map<string, {
  labels: LiteralInfo[]
  comments: LiteralInfo[]
  annotations: Map<string, AnnotationValue[]>
}>()
const classRestrictionProperties = new Map<string, Set<string>>()
const ontologyProperties = new Map<string, {
  type?: 'object' | 'datatype'
  labels: LiteralInfo[]
  comments: LiteralInfo[]
  annotations: Map<string, AnnotationValue[]>
  domains: Set<string>
  ranges: Set<string>
}>()
const classDomainProperties = new Map<string, Set<string>>()
type RestrictionInfo = { class: string; type: string; value: string }
const propertyRestrictions = new Map<string, RestrictionInfo[]>()
const subclassEdges: Array<{ child: string; parent: string }> = []
const subpropertyEdges: Array<{ child: string; parent: string }> = []
const inverseEdges: Array<{ property: string; inverse: string }> = []
const pendingSubjects = new Map<string, {
  labels: LiteralInfo[]
  comments: LiteralInfo[]
  annotations: Map<string, AnnotationValue[]>
}>()

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const RDFS_CLASS = 'http://www.w3.org/2000/01/rdf-schema#Class'
const OWL_CLASS = 'http://www.w3.org/2002/07/owl#Class'
const OWL_OBJECT_PROPERTY = 'http://www.w3.org/2002/07/owl#ObjectProperty'
const OWL_DATATYPE_PROPERTY = 'http://www.w3.org/2002/07/owl#DatatypeProperty'
const OWL_INVERSE_OF = 'http://www.w3.org/2002/07/owl#inverseOf'
const OWL_RESTRICTION = 'http://www.w3.org/2002/07/owl#Restriction'
const OWL_ON_PROPERTY = 'http://www.w3.org/2002/07/owl#onProperty'
const OWL_ALL_VALUES_FROM = 'http://www.w3.org/2002/07/owl#allValuesFrom'
const OWL_SOME_VALUES_FROM = 'http://www.w3.org/2002/07/owl#someValuesFrom'
const OWL_HAS_VALUE = 'http://www.w3.org/2002/07/owl#hasValue'
const OWL_CARDINALITY = 'http://www.w3.org/2002/07/owl#cardinality'
const OWL_MIN_CARDINALITY = 'http://www.w3.org/2002/07/owl#minCardinality'
const OWL_MAX_CARDINALITY = 'http://www.w3.org/2002/07/owl#maxCardinality'
const OWL_ON_CLASS = 'http://www.w3.org/2002/07/owl#onClass'
const OWL_UNION_OF = 'http://www.w3.org/2002/07/owl#unionOf'
const RDFS_SUBCLASS = 'http://www.w3.org/2000/01/rdf-schema#subClassOf'
const RDFS_SUBPROPERTY = 'http://www.w3.org/2000/01/rdf-schema#subPropertyOf'
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'
const RDFS_COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment'
const RDFS_DOMAIN = 'http://www.w3.org/2000/01/rdf-schema#domain'
const RDFS_RANGE = 'http://www.w3.org/2000/01/rdf-schema#range'
const RDF_FIRST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first'
const RDF_REST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest'
const RDF_NIL = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil'
const XSD_NS = 'http://www.w3.org/2001/XMLSchema#'

const isNamed = (term: any): term is { termType: 'NamedNode'; value: string } => term?.termType === 'NamedNode'
const isBlank = (term: any): term is { termType: 'BlankNode'; value: string } => term?.termType === 'BlankNode'
const isLiteral = (term: any): term is { termType: 'Literal'; value: string; language: string; datatype: { value: string } } =>
  term?.termType === 'Literal'

const ensureClass = (iri: string) => {
  if (!ontologyClasses.has(iri)) {
    ontologyClasses.set(iri, { labels: [], comments: [], annotations: new Map() })
  }
  const pending = pendingSubjects.get(iri)
  if (pending) {
    const entry = ontologyClasses.get(iri)
    if (entry) {
      entry.labels.push(...pending.labels)
      entry.comments.push(...pending.comments)
      for (const [predicate, values] of pending.annotations.entries()) {
        const bucket = entry.annotations.get(predicate) ?? []
        bucket.push(...values)
        entry.annotations.set(predicate, bucket)
      }
    }
    pendingSubjects.delete(iri)
  }
}

const ensureProperty = (iri: string) => {
  if (!ontologyProperties.has(iri)) {
    ontologyProperties.set(iri, { labels: [], comments: [], annotations: new Map(), domains: new Set(), ranges: new Set() })
  }
  const pending = pendingSubjects.get(iri)
  if (pending) {
    const entry = ontologyProperties.get(iri)
    if (entry) {
      entry.labels.push(...pending.labels)
      entry.comments.push(...pending.comments)
      for (const [predicate, values] of pending.annotations.entries()) {
        const bucket = entry.annotations.get(predicate) ?? []
        bucket.push(...values)
        entry.annotations.set(predicate, bucket)
      }
    }
    pendingSubjects.delete(iri)
  }
}

const parseOntologyFile = (filePath: string) => {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ontology file: ${filePath}`)
  }
  const ttl = readFileSync(filePath, 'utf-8')
  const parser = new Parser()
  const quads = parser.parse(ttl)
  if (parser._prefixes) {
    Object.assign(parserPrefixes, parser._prefixes)
  }
  const pendingRangeBlankNodes = new Map<string, Set<string>>()
  const pendingDomainBlankNodes = new Map<string, Set<string>>()
  const unionOfByBlank = new Map<string, string>()
  const listFirst = new Map<string, any>()
  const listRest = new Map<string, any>()
  const restrictionBlanks = new Set<string>()
  const restrictionPropsByBlank = new Map<string, string>()
  const restrictionClassesByBlank = new Map<string, Set<string>>()
  const restrictionDetailsByBlank = new Map<string, { type: string; value: string }>()

  for (const quad of quads) {

    const subject = quad.subject
    const predicate = quad.predicate
    const object = quad.object

    if (isNamed(subject) && predicate.value === RDF_TYPE && isNamed(object)) {
      if (object.value === OWL_CLASS || object.value === RDFS_CLASS) {
        ensureClass(subject.value)
      }
      if (object.value === OWL_OBJECT_PROPERTY) {
        ensureProperty(subject.value)
        const entry = ontologyProperties.get(subject.value)
        if (entry) entry.type = 'object'
      }
      if (object.value === OWL_DATATYPE_PROPERTY) {
        ensureProperty(subject.value)
        const entry = ontologyProperties.get(subject.value)
        if (entry) entry.type = 'datatype'
      }
      continue
    }

    if (isNamed(subject) && predicate.value === RDFS_SUBCLASS && isNamed(object)) {
      ensureClass(subject.value)
      ensureClass(object.value)
      subclassEdges.push({ child: subject.value, parent: object.value })
      continue
    }

    if (isNamed(subject) && predicate.value === RDFS_SUBCLASS && isBlank(object)) {
      const bucket = restrictionClassesByBlank.get(object.value) ?? new Set<string>()
      bucket.add(subject.value)
      restrictionClassesByBlank.set(object.value, bucket)
      continue
    }

    if (isNamed(subject) && predicate.value === RDFS_SUBPROPERTY && isNamed(object)) {
      ensureProperty(subject.value)
      ensureProperty(object.value)
      subpropertyEdges.push({ child: subject.value, parent: object.value })
      continue
    }

    if (isNamed(subject) && predicate.value === OWL_INVERSE_OF && isNamed(object)) {
      ensureProperty(subject.value)
      ensureProperty(object.value)
      inverseEdges.push({ property: subject.value, inverse: object.value })
      continue
    }

    if (isNamed(subject) && predicate.value === RDFS_LABEL && isLiteral(object)) {
      const entry = ontologyClasses.get(subject.value) ?? ontologyProperties.get(subject.value)
      if (entry) {
        entry.labels.push({ value: object.value, lang: object.language || undefined, datatype: object.datatype?.value })
      } else {
        const pending = pendingSubjects.get(subject.value) ?? { labels: [], comments: [], annotations: new Map() }
        pending.labels.push({ value: object.value, lang: object.language || undefined, datatype: object.datatype?.value })
        pendingSubjects.set(subject.value, pending)
      }
      continue
    }

    if (isNamed(subject) && predicate.value === RDFS_COMMENT && isLiteral(object)) {
      const entry = ontologyClasses.get(subject.value) ?? ontologyProperties.get(subject.value)
      if (entry) {
        entry.comments.push({ value: object.value, lang: object.language || undefined, datatype: object.datatype?.value })
      } else {
        const pending = pendingSubjects.get(subject.value) ?? { labels: [], comments: [], annotations: new Map() }
        pending.comments.push({ value: object.value, lang: object.language || undefined, datatype: object.datatype?.value })
        pendingSubjects.set(subject.value, pending)
      }
      continue
    }

    if (isNamed(subject) && isLiteral(object)) {
      const entry = ontologyClasses.get(subject.value) ?? ontologyProperties.get(subject.value)
      if (entry) {
        const key = predicate.value
        if (key !== RDFS_LABEL && key !== RDFS_COMMENT) {
          const bucket = entry.annotations.get(key) ?? []
          bucket.push({ type: 'literal', value: object.value, lang: object.language || undefined, datatype: object.datatype?.value })
          entry.annotations.set(key, bucket)
        }
      } else {
        const key = predicate.value
        if (key !== RDFS_LABEL && key !== RDFS_COMMENT) {
          const pending = pendingSubjects.get(subject.value) ?? { labels: [], comments: [], annotations: new Map() }
          const bucket = pending.annotations.get(key) ?? []
          bucket.push({ type: 'literal', value: object.value, lang: object.language || undefined, datatype: object.datatype?.value })
          pending.annotations.set(key, bucket)
          pendingSubjects.set(subject.value, pending)
        }
      }
      continue
    }

    if (isBlank(subject) && predicate.value === OWL_UNION_OF && (isBlank(object) || isNamed(object))) {
      unionOfByBlank.set(subject.value, object.value)
      continue
    }

    if (isBlank(subject) && predicate.value === RDF_TYPE && isNamed(object) && object.value === OWL_RESTRICTION) {
      restrictionBlanks.add(subject.value)
      continue
    }

    if (isBlank(subject) && predicate.value === OWL_ON_PROPERTY && isNamed(object)) {
      restrictionPropsByBlank.set(subject.value, object.value)
      continue
    }

    // Parse restriction types
    if (isBlank(subject)) {
      const pred = predicate.value
      if (pred === OWL_ALL_VALUES_FROM && (isNamed(object) || isBlank(object))) {
        restrictionDetailsByBlank.set(subject.value, { type: 'allValuesFrom', value: isNamed(object) ? object.value : '_:union' })
        continue
      }
      if (pred === OWL_SOME_VALUES_FROM && (isNamed(object) || isBlank(object))) {
        restrictionDetailsByBlank.set(subject.value, { type: 'someValuesFrom', value: isNamed(object) ? object.value : '_:union' })
        continue
      }
      if (pred === OWL_HAS_VALUE && (isNamed(object) || isLiteral(object))) {
        restrictionDetailsByBlank.set(subject.value, { type: 'hasValue', value: isNamed(object) ? object.value : `"${object.value}"` })
        continue
      }
      if (pred === OWL_CARDINALITY && isLiteral(object)) {
        restrictionDetailsByBlank.set(subject.value, { type: 'cardinality', value: object.value })
        continue
      }
      if (pred === OWL_MIN_CARDINALITY && isLiteral(object)) {
        restrictionDetailsByBlank.set(subject.value, { type: 'minCardinality', value: object.value })
        continue
      }
      if (pred === OWL_MAX_CARDINALITY && isLiteral(object)) {
        restrictionDetailsByBlank.set(subject.value, { type: 'maxCardinality', value: object.value })
        continue
      }
    }

    if (isBlank(subject) && predicate.value === RDF_FIRST) {
      listFirst.set(subject.value, object)
      continue
    }

    if (isBlank(subject) && predicate.value === RDF_REST) {
      listRest.set(subject.value, object)
      continue
    }

    if (isNamed(subject) && predicate.value === RDFS_DOMAIN && isNamed(object)) {
      ensureProperty(subject.value)
      const entry = ontologyProperties.get(subject.value)
      if (entry) entry.domains.add(object.value)
      continue
    }

    if (isNamed(subject) && predicate.value === RDFS_DOMAIN && isBlank(object)) {
      const bucket = pendingDomainBlankNodes.get(subject.value) ?? new Set<string>()
      bucket.add(object.value)
      pendingDomainBlankNodes.set(subject.value, bucket)
      continue
    }

    if (isNamed(subject) && predicate.value === RDFS_RANGE && isNamed(object)) {
      ensureProperty(subject.value)
      const entry = ontologyProperties.get(subject.value)
      if (entry) entry.ranges.add(object.value)
      continue
    }

    if (isNamed(subject) && predicate.value === RDFS_RANGE && isBlank(object)) {
      const bucket = pendingRangeBlankNodes.get(subject.value) ?? new Set<string>()
      bucket.add(object.value)
      pendingRangeBlankNodes.set(subject.value, bucket)
      continue
    }

    if (isNamed(subject) && isNamed(object)) {
      const entry = ontologyClasses.get(subject.value) ?? ontologyProperties.get(subject.value)
      if (entry) {
        const key = predicate.value
        if (key !== RDFS_LABEL && key !== RDFS_COMMENT) {
          const bucket = entry.annotations.get(key) ?? []
          bucket.push({ type: 'iri', value: object.value })
          entry.annotations.set(key, bucket)
        }
      } else {
        const key = predicate.value
        if (key !== RDFS_LABEL && key !== RDFS_COMMENT) {
          const pending = pendingSubjects.get(subject.value) ?? { labels: [], comments: [], annotations: new Map() }
          const bucket = pending.annotations.get(key) ?? []
          bucket.push({ type: 'iri', value: object.value })
          pending.annotations.set(key, bucket)
          pendingSubjects.set(subject.value, pending)
        }
      }
      continue
    }
  }

  const resolveListItems = (head: string): string[] => {
    if (head === RDF_NIL) return []
    const items: string[] = []
    let current: string | null = head
    const visited = new Set<string>()
    while (current && !visited.has(current)) {
      visited.add(current)
      const first = listFirst.get(current)
      if (first && isNamed(first)) {
        items.push(first.value)
      }
      const rest = listRest.get(current)
      if (rest && isNamed(rest) && rest.value === RDF_NIL) {
        break
      }
      if (rest && isBlank(rest)) {
        current = rest.value
        continue
      }
      break
    }
    return items
  }

  const applyBlankNodeRanges = (propertyIri: string, blankNodes: Set<string>, target: 'domain' | 'range') => {
    for (const blankId of blankNodes) {
      const listHead = unionOfByBlank.get(blankId)
      if (!listHead) continue
      const items = resolveListItems(listHead)
      if (items.length === 0) continue
      ensureProperty(propertyIri)
      const entry = ontologyProperties.get(propertyIri)
      if (!entry) continue
      for (const item of items) {
        ensureClass(item)
        if (target === 'domain') entry.domains.add(item)
        else entry.ranges.add(item)
      }
    }
  }

  for (const [propertyIri, blankNodes] of pendingDomainBlankNodes.entries()) {
    applyBlankNodeRanges(propertyIri, blankNodes, 'domain')
  }
  for (const [propertyIri, blankNodes] of pendingRangeBlankNodes.entries()) {
    applyBlankNodeRanges(propertyIri, blankNodes, 'range')
  }

  for (const [blankId, classes] of restrictionClassesByBlank.entries()) {
    if (!restrictionBlanks.has(blankId)) continue
    const prop = restrictionPropsByBlank.get(blankId)
    if (!prop) continue
    const details = restrictionDetailsByBlank.get(blankId)
    for (const classIri of classes) {
      ensureClass(classIri)
      const bucket = classRestrictionProperties.get(classIri) ?? new Set<string>()
      bucket.add(prop)
      classRestrictionProperties.set(classIri, bucket)
      // Also track reverse: property -> restriction details
      const propBucket = propertyRestrictions.get(prop) ?? []
      propBucket.push({
        class: classIri,
        type: details?.type ?? 'unknown',
        value: details?.value ?? '?',
      })
      propertyRestrictions.set(prop, propBucket)
    }
  }
}

if (ontologyFiles.length > 0) {
  for (const file of ontologyFiles) {
    parseOntologyFile(file)
  }
}

if (ontologyFiles.length > 0) {
  step('Ontology parsed', `${ontologyClasses.size} classes, ${ontologyProperties.size} properties`)
  if (subclassEdges.length > 0 || subpropertyEdges.length > 0) {
    console.log(
      `    ${dim('·')} ${subclassEdges.length} subclass edges, ${subpropertyEdges.length} subproperty edges`,
    )
  }
  if (debugRelatedTypes) {
    const sample = 'http://data.europa.eu/s66#hasResult'
    const ranges = ontologyProperties.get(sample)?.ranges
    console.log(`    ${dim('·')} related-types: ${sample} ranges=${ranges ? Array.from(ranges).join(', ') : 'none'}`)
  }
}

for (const [propertyIri, info] of ontologyProperties.entries()) {
  for (const domain of info.domains) {
    const bucket = classDomainProperties.get(domain) ?? new Set<string>()
    bucket.add(propertyIri)
    classDomainProperties.set(domain, bucket)
  }
}

const splitIri = (iri: string): { ns: string; local: string } | null => {
  const match = iri.match(/^(.*[\/#])([^\/#]+)$/)
  if (!match) return null
  return { ns: match[1], local: match[2] }
}

const localName = (iri: string): string => splitIri(iri)?.local ?? iri

const builtinPrefixes: Record<string, string> = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
}
const lookupPrefix = (prefix: string): string | undefined =>
  parserPrefixes[prefix] ?? prefixMap[prefix] ?? builtinPrefixes[prefix]

const nsToPrefix = new Map<string, string>()
for (const [prefix, ns] of Object.entries({ ...builtinPrefixes, ...prefixMap, ...parserPrefixes })) {
  if (!nsToPrefix.has(ns)) nsToPrefix.set(ns, prefix)
}
const toQName = (iri: string): string => {
  const parts = splitIri(iri)
  if (!parts) return iri
  const prefix = nsToPrefix.get(parts.ns)
  return prefix ? `${prefix}:${parts.local}` : iri
}
const unresolvedQNames: string[] = []
const resolveIri = (value: string): string => {
  if (!value) return value
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  const match = value.match(/^([A-Za-z0-9._-]+):(.+)$/)
  if (!match) return value
  const ns = lookupPrefix(match[1])
  if (!ns) {
    unresolvedQNames.push(value)
    return value
  }
  return `${ns}${match[2]}`
}
const resolveList = (values: string[] | undefined): string[] =>
  (values ?? []).map((value) => resolveIri(value))

const parentsByChild = new Map<string, Set<string>>()
const childrenByParent = new Map<string, Set<string>>()
for (const edge of subclassEdges) {
  const parents = parentsByChild.get(edge.child) ?? new Set<string>()
  parents.add(edge.parent)
  parentsByChild.set(edge.child, parents)

  const children = childrenByParent.get(edge.parent) ?? new Set<string>()
  children.add(edge.child)
  childrenByParent.set(edge.parent, children)
}

const propParentsByChild = new Map<string, Set<string>>()
for (const edge of subpropertyEdges) {
  const parents = propParentsByChild.get(edge.child) ?? new Set<string>()
  parents.add(edge.parent)
  propParentsByChild.set(edge.child, parents)
}

const inverseByProperty = new Map<string, Set<string>>()
for (const edge of inverseEdges) {
  const forward = inverseByProperty.get(edge.property) ?? new Set<string>()
  forward.add(edge.inverse)
  inverseByProperty.set(edge.property, forward)
  const backward = inverseByProperty.get(edge.inverse) ?? new Set<string>()
  backward.add(edge.property)
  inverseByProperty.set(edge.inverse, backward)
}

const scope = config.scope ?? {}
const classesFromEndpointOnly = scope.classesFromEndpointOnly !== false
const propertiesFromEndpointOnly = scope.propertiesFromEndpointOnly !== false
const includeNamespaces = new Set(scope.includeNamespaces ?? [])
const excludeNamespaces = new Set(scope.excludeNamespaces ?? [])
const classAllowlist = new Set(resolveList(scope.classAllowlist))
const classDenylist = new Set(resolveList(scope.classDenylist))
const propertyAllowlist = new Set(resolveList(scope.propertyAllowlist))
const propertyDenylist = new Set(resolveList(scope.propertyDenylist))
const rootClasses = new Set(resolveList(scope.rootClasses))
const usingRoots = rootClasses.size > 0
const includeSubclasses = scope.includeSubclasses !== false && usingRoots
const includeSuperclasses = scope.includeSuperclasses === true
const includeRelatedTypes = true
if (scope.includeRelatedTypes === false) {
  step('Note', 'includeRelatedTypes is mandatory; ignoring false')
}
const includeSuperproperties = scope.includeSuperproperties !== false
const includeInverseProperties = scope.includeInverseProperties !== false

const ancestorCache = new Map<string, Set<string>>()
const getAncestors = (iri: string): Set<string> => {
  const cached = ancestorCache.get(iri)
  if (cached) return cached
  const visited = new Set<string>()
  const queue = [iri]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    if (visited.has(current)) continue
    visited.add(current)
    const parents = parentsByChild.get(current)
    if (parents) {
      for (const parent of parents) {
        if (!visited.has(parent)) queue.push(parent)
      }
    }
  }
  ancestorCache.set(iri, visited)
  return visited
}

const depthCache = new Map<string, number>()
const depthVisiting = new Set<string>()
const getDepth = (iri: string): number => {
  const cached = depthCache.get(iri)
  if (cached !== undefined) return cached
  if (depthVisiting.has(iri)) return 0
  depthVisiting.add(iri)
  const parents = parentsByChild.get(iri)
  let maxDepth = 0
  if (parents) {
    for (const parent of parents) {
      maxDepth = Math.max(maxDepth, getDepth(parent) + 1)
    }
  }
  depthVisiting.delete(iri)
  depthCache.set(iri, maxDepth)
  return maxDepth
}

type DiscoveryVia = 'root' | 'subclass' | 'superclass' | 'related'
type DiscoveryInfo = { from?: string; via: DiscoveryVia; property?: string }
const discoveryFirst = new Map<string, DiscoveryInfo>()
const discoveryAll = new Map<string, DiscoveryInfo[]>()
const discoveryEdgeSeen = new Set<string>()
const recordDiscovery = (from: string, to: string, via: DiscoveryVia, property?: string, isNew = false) => {
  const key = `${from}|${to}|${via}|${property ?? ''}`
  if (discoveryEdgeSeen.has(key)) return
  discoveryEdgeSeen.add(key)
  const info: DiscoveryInfo = { from, via, property }
  if (isNew && !discoveryFirst.has(to)) {
    discoveryFirst.set(to, info)
  }
  const all = discoveryAll.get(to) ?? []
  all.push(info)
  discoveryAll.set(to, all)
}

const ontologyClassSet = new Set(ontologyClasses.keys())
const ontologyPropertySet = new Set(ontologyProperties.keys())

let candidateClasses = new Set<string>(usingRoots ? Array.from(rootClasses) : Array.from(observedClasses))
if (!classesFromEndpointOnly) {
  candidateClasses = new Set<string>([...candidateClasses, ...ontologyClassSet])
}

const isClassCandidate = (iri: string): boolean => {
  if (classDenylist.has(iri)) return false
  if (classesFromEndpointOnly && !observedClasses.has(iri)) return false
  const parts = splitIri(iri)
  const ns = parts?.ns
  if (ns && excludeNamespaces.has(ns)) return false
  if (includeNamespaces.size > 0 && ns && !includeNamespaces.has(ns)) return false
  if (classAllowlist.size > 0 && !classAllowlist.has(iri)) return false
  return true
}

const isTraversable = (iri: string): boolean => {
  if (classDenylist.has(iri)) return false
  const parts = splitIri(iri)
  const ns = parts?.ns
  if (ns && excludeNamespaces.has(ns)) return false
  return true
}

const isClassIri = (iri: string): boolean => ontologyClassSet.has(iri) || observedClasses.has(iri)

const isObjectPropertyForTraversal = (iri: string): boolean => {
  const ontologyType = ontologyProperties.get(iri)?.type
  if (ontologyType === 'object') return true
  if (ontologyType === 'datatype') return false
  const counts = propertyCounts.get(iri)
  if (!counts) return false
  return counts.iri > 0
}

const getRelatedRangeClasses = (iri: string): Set<string> => {
  const ranges = new Set<string>()
  const entry = ontologyProperties.get(iri)
  if (entry?.ranges) {
    for (const range of entry.ranges) ranges.add(range)
  }
  const inverses = inverseByProperty.get(iri)
  if (inverses) {
    for (const inverse of inverses) {
      const inverseDomains = ontologyProperties.get(inverse)?.domains
      if (!inverseDomains) continue
      for (const domain of inverseDomains) ranges.add(domain)
    }
  }
  return new Set([...ranges].filter((range) => isClassIri(range)))
}

if ((includeSubclasses && childrenByParent.size > 0) ||
    (includeSuperclasses && parentsByChild.size > 0) ||
    (includeRelatedTypes && classPropertyUsage.size > 0)) {
  const queue = [...candidateClasses]
  const seen = new Set(queue)
  for (const root of rootClasses) {
    discoveryFirst.set(root, { via: 'root' })
  }
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    const canExpand = candidateClasses.has(current) || rootClasses.has(current)
    if (!canExpand) continue

    if (includeSubclasses && childrenByParent.size > 0) {
      const children = childrenByParent.get(current)
      if (children) {
        for (const child of children) {
          if (seen.has(child)) {
            recordDiscovery(current, child, 'subclass')
            continue
          }
          if (!isTraversable(child)) continue
          seen.add(child)
          candidateClasses.add(child)
          recordDiscovery(current, child, 'subclass', undefined, true)
          queue.push(child)
        }
      }
    }

    if (includeSuperclasses && parentsByChild.size > 0) {
      const parents = parentsByChild.get(current)
      if (parents) {
        for (const parent of parents) {
          if (seen.has(parent)) {
            recordDiscovery(current, parent, 'superclass')
            continue
          }
          if (!isTraversable(parent)) continue
          seen.add(parent)
          candidateClasses.add(parent)
          recordDiscovery(current, parent, 'superclass', undefined, true)
          queue.push(parent)
        }
      }
    }

    if (includeRelatedTypes) {
      const props = classPropertyUsage.get(current)
      if (!props) {
        if (debugRelatedTypes) {
          console.log(`    ${dim('·')} related-types: no properties for ${current}`)
        }
        continue
      }
      if (debugRelatedTypes) {
        console.log(`    ${dim('·')} related-types: ${current} has ${props.size} properties`)
      }
      for (const propIri of props.keys()) {
        if (!isObjectPropertyForTraversal(propIri)) continue
        const ranges = getRelatedRangeClasses(propIri)
        if (debugRelatedTypes && ranges.size > 0) {
          console.log(`    ${dim('·')} related-types via ${propIri} -> ${Array.from(ranges).join(', ')}`)
        }
        if (ranges.size === 0) continue
        for (const rangeIri of ranges) {
          if (seen.has(rangeIri)) {
            recordDiscovery(current, rangeIri, 'related', propIri)
            continue
          }
          if (!isTraversable(rangeIri)) continue
          seen.add(rangeIri)
          candidateClasses.add(rangeIri)
          recordDiscovery(current, rangeIri, 'related', propIri, true)
          queue.push(rangeIri)
        }
      }
    }
  }
}

const applyScope = (
  candidates: Set<string>,
  allowlist: Set<string>,
  denylist: Set<string>,
  fromEndpointOnly: boolean,
  observed: Set<string>,
  typeLabel: 'class' | 'property',
  forceInclude?: Set<string>,
) => {
  const included = new Set<string>()
  const excluded: Array<{ iri: string; reason: string }> = []

  for (const iri of candidates) {
    if (denylist.has(iri)) {
      excluded.push({ iri, reason: `${typeLabel}-denylist` })
      continue
    }

    if (fromEndpointOnly && !observed.has(iri) && !forceInclude?.has(iri)) {
      excluded.push({ iri, reason: 'not-in-endpoint' })
      continue
    }

    const parts = splitIri(iri)
    const ns = parts?.ns
    if (ns && excludeNamespaces.has(ns)) {
      excluded.push({ iri, reason: 'namespace-denylist' })
      continue
    }
    if (includeNamespaces.size > 0 && ns && !includeNamespaces.has(ns)) {
      excluded.push({ iri, reason: 'namespace-not-allowed' })
      continue
    }

    if (allowlist.size > 0 && !allowlist.has(iri)) {
      excluded.push({ iri, reason: `${typeLabel}-not-allowed` })
      continue
    }

    included.add(iri)
  }

  return { included, excluded }
}

const classScope = applyScope(
  candidateClasses,
  classAllowlist,
  classDenylist,
  classesFromEndpointOnly,
  observedClasses,
  'class',
)
const classExcludeReason = new Map<string, string>()
for (const entry of classScope.excluded) {
  classExcludeReason.set(entry.iri, entry.reason)
}

const propertiesFromClasses = new Set<string>()
for (const classIri of classScope.included) {
  const props = classPropertyUsage.get(classIri)
  if (!props) continue
  for (const propIri of props.keys()) {
    propertiesFromClasses.add(propIri)
  }
}

let candidateProperties = new Set<string>(propertiesFromClasses)
for (const allowlisted of propertyAllowlist) {
  candidateProperties.add(allowlisted)
}
const superProperties = new Set<string>()
const inverseProperties = new Set<string>()
if (!propertiesFromEndpointOnly) {
  candidateProperties = new Set<string>([...candidateProperties, ...ontologyPropertySet, ...observedProperties])
}

if (includeSuperproperties && propParentsByChild.size > 0) {
  const queue = [...candidateProperties]
  const seen = new Set(queue)
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    const parents = propParentsByChild.get(current)
    if (!parents) continue
    for (const parent of parents) {
      if (seen.has(parent)) continue
      if (!propertiesFromClasses.has(parent) && !propertyAllowlist.has(parent)) continue
      seen.add(parent)
      candidateProperties.add(parent)
      if (!propertiesFromClasses.has(parent)) {
        superProperties.add(parent)
      }
      queue.push(parent)
    }
  }
}

if (includeInverseProperties && inverseByProperty.size > 0) {
  const queue = [...candidateProperties]
  const seen = new Set(queue)
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    const inverses = inverseByProperty.get(current)
    if (!inverses) continue
    for (const inv of inverses) {
      if (seen.has(inv)) continue
      seen.add(inv)
      candidateProperties.add(inv)
      if (!propertiesFromClasses.has(inv)) {
        inverseProperties.add(inv)
      }
      queue.push(inv)
    }
  }
}

const propertyScopePre = applyScope(
  candidateProperties,
  propertyAllowlist,
  propertyDenylist,
  propertiesFromEndpointOnly,
  observedProperties,
  'property',
  new Set([...superProperties, ...inverseProperties]),
)

const getPropAncestors = (iri: string): Set<string> => {
  const visited = new Set<string>()
  const queue = [iri]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    const parents = propParentsByChild.get(current)
    if (!parents) continue
    for (const parent of parents) {
      if (visited.has(parent)) continue
      visited.add(parent)
      queue.push(parent)
    }
  }
  return visited
}

const endpointOnlyProperties = new Set<string>()
for (const iri of propertyScopePre.included) {
  if (!ontologyPropertySet.has(iri)) {
    endpointOnlyProperties.add(iri)
  }
}
const propertyScope = {
  included: new Set<string>([...propertyScopePre.included].filter((iri) => !endpointOnlyProperties.has(iri))),
  excluded: [
    ...propertyScopePre.excluded,
    ...Array.from(endpointOnlyProperties).map((iri) => ({ iri, reason: 'not-in-ontology' })),
  ],
}
const propertyExcludeReason = new Map<string, string>()
for (const entry of propertyScope.excluded) {
  propertyExcludeReason.set(entry.iri, entry.reason)
}

const includedClasses = Array.from(classScope.included).sort()
const includedProperties = Array.from(propertyScope.included).sort()

step('Scope', `${includedClasses.length} classes, ${includedProperties.length} properties`)

// Log endpoint-only classes (in endpoint but not in ontology)
const endpointOnlyClasses = new Set<string>()
for (const iri of observedClasses) {
  if (!ontologyClassSet.has(iri) && isClassCandidate(iri)) {
    endpointOnlyClasses.add(iri)
  }
}
if (endpointOnlyClasses.size > 0) {
  warn('Endpoint-only classes', `${endpointOnlyClasses.size} classes in endpoint but not declared in ontology`)
  for (const iri of Array.from(endpointOnlyClasses).sort((a, b) => toQName(a).localeCompare(toQName(b)))) {
    const status = classScope.included.has(iri) ? 'included' : 'not discovered'
    console.log(`    ${dim('·')} ${toQName(iri)} ${dim(`(${status})`)}`)
  }
}

if (endpointOnlyProperties.size > 0) {
  warn('Endpoint-only properties excluded', `${endpointOnlyProperties.size} properties not declared in ontology`)
  for (const iri of Array.from(endpointOnlyProperties).sort((a, b) => toQName(a).localeCompare(toQName(b)))) {
    const classes = Array.from(classPropertyUsage.entries())
      .filter(([cls, props]) => props.has(iri) && classScope.included.has(cls))
      .map(([cls]) => toQName(cls))
    const usedBy = classes.length > 0 ? classes.join(', ') : '?'
    console.log(`    ${dim('·')} ${toQName(iri)} ${dim(`used by ${usedBy}`)}`)
  }
}

const propertyUsageClasses = new Map<string, Set<string>>()
for (const classIri of classScope.included) {
  const props = classPropertyUsage.get(classIri)
  if (!props) continue
  for (const propIri of props.keys()) {
    if (!propertyScope.included.has(propIri)) continue
    const bucket = propertyUsageClasses.get(propIri) ?? new Set<string>()
    bucket.add(classIri)
    propertyUsageClasses.set(propIri, bucket)
  }
}

const propertyUsageAll = new Map<string, Set<string>>()
for (const [classIri, props] of classPropertyUsage.entries()) {
  for (const propIri of props.keys()) {
    const bucket = propertyUsageAll.get(propIri) ?? new Set<string>()
    bucket.add(classIri)
    propertyUsageAll.set(propIri, bucket)
  }
}

const propertyUsageDetails = includedProperties.map((prop) => {
  const classes = Array.from(propertyUsageClasses.get(prop) ?? [])
  classes.sort()
  return { property: prop, classCount: classes.length, classes }
})
const propertyUsageDetailsGlobal = includedProperties.map((prop) => {
  const classes = Array.from(propertyUsageAll.get(prop) ?? [])
  classes.sort()
  return { property: prop, classCount: classes.length, classes }
})
const singleUseProperties = propertyUsageDetails.filter((entry) => entry.classCount === 1)
const multiUseProperties = propertyUsageDetails.filter((entry) => entry.classCount > 1)
step('Property usage', `${singleUseProperties.length} single-use, ${multiUseProperties.length} multi-use`)

const inheritanceMode = config.inheritance?.mode ?? 'ontology-only'
const manualSubclass = config.inheritance?.manualEdges?.subClassOf ?? []
const manualSubproperty = config.inheritance?.manualEdges?.subPropertyOf ?? []

const subclassEdgesFiltered = subclassEdges
  .filter((edge) => classScope.included.has(edge.child) && classScope.included.has(edge.parent))
  .sort((a, b) => (a.child + a.parent).localeCompare(b.child + b.parent))

const subpropertyEdgesFiltered = subpropertyEdges
  .filter((edge) => propertyScope.included.has(edge.child) && propertyScope.included.has(edge.parent))
  .sort((a, b) => (a.child + a.parent).localeCompare(b.child + b.parent))

const mergedSubclassEdges = inheritanceMode === 'ontology+manual'
  ? [...subclassEdgesFiltered, ...manualSubclass]
  : subclassEdgesFiltered

const mergedSubpropertyEdges = inheritanceMode === 'ontology+manual'
  ? [...subpropertyEdgesFiltered, ...manualSubproperty]
  : subpropertyEdgesFiltered

// Build map for subPropertyOf emission within property loop
const subpropertyParentsByChild = new Map<string, Set<string>>()
for (const edge of mergedSubpropertyEdges) {
  if (!propertyScope.included.has(edge.child) || !propertyScope.included.has(edge.parent)) continue
  const parents = subpropertyParentsByChild.get(edge.child) ?? new Set<string>()
  parents.add(edge.parent)
  subpropertyParentsByChild.set(edge.child, parents)
}

const orderClasses = (classes: string[], edges: Array<{ child: string; parent: string }>): string[] => {
  const included = new Set(classes)
  const childrenByParent = new Map<string, string[]>()
  const parentCounts = new Map<string, number>()
  for (const edge of edges) {
    if (!included.has(edge.child) || !included.has(edge.parent)) continue
    if (edge.child === edge.parent) continue
    const bucket = childrenByParent.get(edge.parent) ?? []
    bucket.push(edge.child)
    childrenByParent.set(edge.parent, bucket)
    parentCounts.set(edge.child, (parentCounts.get(edge.child) ?? 0) + 1)
  }
  for (const [parent, children] of childrenByParent.entries()) {
    children.sort()
    childrenByParent.set(parent, children)
  }
  const roots = classes.filter((iri) => !parentCounts.has(iri)).sort()
  const ordered: string[] = []
  const visited = new Set<string>()
  const visit = (iri: string) => {
    if (visited.has(iri)) return
    visited.add(iri)
    ordered.push(iri)
    const kids = childrenByParent.get(iri)
    if (!kids) return
    for (const child of kids) visit(child)
  }
  for (const root of roots) visit(root)
  const remaining = classes.filter((iri) => !visited.has(iri)).sort()
  for (const iri of remaining) visit(iri)
  return ordered
}

const orderedClasses = orderClasses(includedClasses, mergedSubclassEdges)
const subclassParentsByChild = new Map<string, string[]>()
for (const edge of mergedSubclassEdges) {
  if (!classScope.included.has(edge.child) || !classScope.included.has(edge.parent)) continue
  const bucket = subclassParentsByChild.get(edge.child) ?? []
  if (!bucket.includes(edge.parent)) bucket.push(edge.parent)
  subclassParentsByChild.set(edge.child, bucket)
}
for (const [child, parents] of subclassParentsByChild.entries()) {
  parents.sort()
  subclassParentsByChild.set(child, parents)
}

// toQName already defined above
const summarizeProps = (props?: Set<string>): { count: number; preview: string } => {
  if (!props || props.size === 0) return { count: 0, preview: '' }
  const list = Array.from(props).sort()
  const sample = list.slice(0, 6).map(toQName).join(', ')
  const suffix = list.length > 6 ? `, +${list.length - 6}` : ''
  return { count: list.length, preview: sample ? ` (${sample}${suffix})` : '' }
}

const printDiscoveryTree = () => {
  if (rootClasses.size === 0) return
  const includedSet = classScope.included
  const childrenByParent = new Map<string, string[]>()
  for (const [child, info] of discoveryFirst.entries()) {
    if (info.via === 'root') continue
    if (!info.from) continue
    if (!includedSet.has(child) || !includedSet.has(info.from)) continue
    const bucket = childrenByParent.get(info.from) ?? []
    bucket.push(child)
    childrenByParent.set(info.from, bucket)
  }
  for (const [parent, kids] of childrenByParent.entries()) {
    kids.sort((a, b) => toQName(a).localeCompare(toQName(b)))
    childrenByParent.set(parent, kids)
  }
  const roots = Array.from(rootClasses).filter((root) => includedSet.has(root)).sort((a, b) => toQName(a).localeCompare(toQName(b)))
  if (roots.length === 0) return

  step('Discovery tree', `${roots.length} roots, ${includedSet.size} classes`)
  const renderNode = (iri: string, indent: string) => {
    const info = discoveryFirst.get(iri)
    let label = toQName(iri)
    if (info?.via === 'root') {
      label = `${toQName(iri)}${dim(' (root)')}`
    } else if (info) {
      if (info.via === 'related') {
        const propLabel = info.property ? toQName(info.property) : 'property'
        label = `${dim(propLabel)} ${toQName(iri)}`
      } else {
        label = `${dim(info.via)} ${toQName(iri)}`
      }
      const allPaths = discoveryAll.get(iri) ?? []
      const otherPaths = allPaths.filter((p) => p !== info)
      if (otherPaths.length > 0) {
        const pathStrs = otherPaths.map((p) => {
          if (p.via === 'related' && p.property) {
            return `${toQName(p.property)} from ${toQName(p.from ?? '')}`
          }
          return `${p.via} from ${toQName(p.from ?? '')}`
        })
        label += dim(` (also: ${pathStrs.join(', ')})`)
      }
    }
    console.log(`  ${indent}${label}`)
    const kids = childrenByParent.get(iri) ?? []
    for (const child of kids) {
      renderNode(child, `${indent}- `)
    }
  }
  for (const root of roots) {
    renderNode(root, '')
  }

  // Find classes that are included but not shown in the tree
  const renderedClasses = new Set<string>()
  const collectRendered = (iri: string) => {
    renderedClasses.add(iri)
    for (const child of childrenByParent.get(iri) ?? []) {
      collectRendered(child)
    }
  }
  for (const root of roots) {
    collectRendered(root)
  }
  const notInTree = Array.from(includedSet).filter((c) => !renderedClasses.has(c)).sort((a, b) => toQName(a).localeCompare(toQName(b)))
  if (notInTree.length > 0) {
    console.log(`  ${dim('Not in tree:')}`)
    for (const c of notInTree) {
      const info = discoveryFirst.get(c)
      const via = info ? `${info.via}${info.property ? ' ' + toQName(info.property) : ''}${info.from ? ' from ' + toQName(info.from) : ''}` : 'unknown'
      console.log(`    ${dim('·')} ${toQName(c)} ${dim(`(${via})`)}`)
    }
  }
}

section('Discovery')
printDiscoveryTree()

const formatExcludeReason = (prop: string): string => {
  const reason = propertyExcludeReason.get(prop)
  if (
    reason === 'property-denylist' ||
    reason === 'property-not-allowed' ||
    reason === 'namespace-denylist' ||
    reason === 'namespace-not-allowed'
  ) {
    return 'not allowed'
  }
  return 'not in endpoint'
}

const formatClassExcludeReason = (iri: string): string => {
  const reason = classExcludeReason.get(iri)
  if (
    reason === 'class-denylist' ||
    reason === 'class-not-allowed' ||
    reason === 'namespace-denylist' ||
    reason === 'namespace-not-allowed'
  ) {
    return 'not allowed'
  }
  if (reason === 'not-in-endpoint') return 'not in endpoint'
  if (!candidateClasses.has(iri)) return 'not reachable from roots'
  return 'excluded'
}

const formatPropertyExcludeReason = (iri: string): string => {
  const reason = propertyExcludeReason.get(iri)
  if (
    reason === 'property-denylist' ||
    reason === 'property-not-allowed' ||
    reason === 'namespace-denylist' ||
    reason === 'namespace-not-allowed'
  ) {
    return 'not allowed'
  }
  if (reason === 'not-in-endpoint') return 'not in endpoint'
  if (!candidateProperties.has(iri)) return 'not used by included classes'
  return 'excluded'
}

section('Ontology property checks')
for (const iri of orderedClasses) {
  const domainProps = classDomainProperties.get(iri)
  const restrictionProps = classRestrictionProperties.get(iri)
  const hasDomainOrRestriction = (domainProps && domainProps.size > 0) || (restrictionProps && restrictionProps.size > 0)

  if (!hasDomainOrRestriction) {
    // Class has no direct properties - note that it inherits from parent
    const parents = [...new Set(subclassEdges.filter((e) => e.child === iri).map((e) => toQName(e.parent)))]
    if (parents.length > 0) {
      step(`${toQName(iri)}`, `inherits from ${parents.join(', ')}`)
    } else {
      step(`${toQName(iri)}`, `no domain/restriction properties`)
    }
    continue
  }
  if (hasDomainOrRestriction) {
    const domain = summarizeProps(domainProps)
    const restriction = summarizeProps(restrictionProps)
    const parts: string[] = []
    if (domain.count > 0) parts.push(`domain=${domain.count}`)
    if (restriction.count > 0) parts.push(`restriction=${restriction.count}`)
    warn(`Ontology properties for ${toQName(iri)}`, parts.join(', '))
    const propSources = new Map<string, { domain: boolean; restriction: boolean }>()
    for (const prop of domainProps ?? []) {
      const entry = propSources.get(prop) ?? { domain: false, restriction: false }
      entry.domain = true
      propSources.set(prop, entry)
    }
    for (const prop of restrictionProps ?? []) {
      const entry = propSources.get(prop) ?? { domain: false, restriction: false }
      entry.restriction = true
      propSources.set(prop, entry)
    }
    const orderedProps = Array.from(propSources.keys()).sort()
    const propQNames = orderedProps.map((prop) => toQName(prop))
    const maxPropLen = Math.max(...propQNames.map((q) => q.length))
    for (let i = 0; i < orderedProps.length; i += 1) {
      const prop = orderedProps[i]
      const source = propSources.get(prop)
      const sourceLabel = source?.domain && source?.restriction
        ? 'domain+restriction'
        : source?.domain
          ? 'domain'
          : 'restriction'
      const included = propertyScope.included.has(prop)
      const reason = included
        ? dim(`included: ${sourceLabel}`)
        : yellow(`excluded: ${formatExcludeReason(prop)}`)
      const paddedProp = propQNames[i].padEnd(maxPropLen)
      const sourceNote = included ? '' : ` ${dim(`[source=${sourceLabel}]`)}`
      const line = `${paddedProp} ${reason}${sourceNote}`
      const mark = included ? green('✓') : yellow('✓')
      console.log(`    ${mark} ${line}`)
    }
  }
}

section('Ontology not included')
const excludedOntologyClasses = Array.from(ontologyClassSet).filter((iri) => !classScope.included.has(iri))
const excludedOntologyProperties = Array.from(ontologyPropertySet).filter((iri) => !propertyScope.included.has(iri))
const excludedClassQNames = excludedOntologyClasses.map((iri) => toQName(iri))
const maxExclClassLen = excludedClassQNames.length > 0 ? Math.max(...excludedClassQNames.map((q) => q.length)) : 0
console.log(`  ${dim('Classes')}: ${excludedOntologyClasses.length}`)
for (const iri of excludedOntologyClasses.sort((a, b) => toQName(a).localeCompare(toQName(b)))) {
  const inEndpoint = observedClasses.has(iri)
  const mark = inEndpoint ? yellow('!') : dim('·')
  const endpointTag = inEndpoint ? yellow(' [in endpoint]') : ''
  console.log(`    ${mark} ${toQName(iri).padEnd(maxExclClassLen)} ${dim(formatClassExcludeReason(iri))}${endpointTag}`)
}
const excludedPropQNames = excludedOntologyProperties.map((iri) => toQName(iri))
const maxExclPropLen = excludedPropQNames.length > 0 ? Math.max(...excludedPropQNames.map((q) => q.length)) : 0
console.log(`  ${dim('Properties')}: ${excludedOntologyProperties.length}`)
for (const iri of excludedOntologyProperties.sort((a, b) => toQName(a).localeCompare(toQName(b)))) {
  const inEndpoint = observedProperties.has(iri)
  const mark = inEndpoint ? yellow('!') : dim('·')
  const endpointTag = inEndpoint ? yellow(' [in endpoint]') : ''
  console.log(`    ${mark} ${toQName(iri).padEnd(maxExclPropLen)} ${dim(formatPropertyExcludeReason(iri))}${endpointTag}`)
}

// Compare ontology ranges with endpoint-observed types
section('Range validation')
type RangeValidation = {
  property: string
  ontologyRanges: Set<string>
  endpointTypes: Map<string | null, number>
  intersection: Set<string>
  mismatch: boolean
  untypedCount: number
}
const rangeValidations: RangeValidation[] = []

for (const propIri of includedProperties) {
  const ontologyEntry = ontologyProperties.get(propIri)
  const ontologyRanges = ontologyEntry?.ranges ?? new Set<string>()
  const endpointTypes = propertyEndpointRanges.get(propIri)

  // Skip if no endpoint data or not an object property
  if (!endpointTypes || endpointTypes.size === 0) continue
  const propType = ontologyEntry?.type
  if (propType === 'datatype') continue // Skip datatype properties

  // Calculate intersection
  const endpointTypeIris = new Set<string>()
  let untypedCount = 0
  for (const [typeIri, count] of endpointTypes.entries()) {
    if (typeIri === null) {
      untypedCount = count
    } else {
      endpointTypeIris.add(typeIri)
    }
  }

  const intersection = new Set<string>()
  for (const range of ontologyRanges) {
    if (endpointTypeIris.has(range)) {
      intersection.add(range)
    }
  }

  // Check for mismatch
  const mismatch = ontologyRanges.size > 0 && intersection.size === 0 && endpointTypeIris.size > 0

  rangeValidations.push({
    property: propIri,
    ontologyRanges,
    endpointTypes,
    intersection,
    mismatch,
    untypedCount,
  })
}

// Log warnings
const rangesWithIssues = rangeValidations.filter(v => v.mismatch || v.untypedCount > 0)
if (rangesWithIssues.length > 0) {
  step('Range issues', `${rangesWithIssues.length} properties with potential issues`)
  for (const v of rangesWithIssues) {
    const propQName = toQName(v.property)
    // Use actual IRI count from propertyCounts (not sum of types, which can overlap due to multi-typing)
    const iriTotal = propertyCounts.get(v.property)?.iri ?? 0
    const ratio = (count: number) => iriTotal > 0 ? (count / iriTotal).toFixed(4) : '0.0000'

    // Format declared (ontology) ranges
    const declaredTypes = Array.from(v.ontologyRanges).map(toQName)

    // Format observed (endpoint) types with counts
    const observedEntries = Array.from(v.endpointTypes.entries())
      .filter(([t]) => t !== null)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t, c]) => ({ type: toQName(t!), count: c, ratio: ratio(c) }))

    // Add untyped entry
    if (v.untypedCount > 0 || observedEntries.length === 0) {
      observedEntries.push({ type: 'untyped', count: v.untypedCount, ratio: ratio(v.untypedCount) })
    }

    // Calculate column widths for alignment
    const allTypes = [...declaredTypes, ...observedEntries.map(e => e.type)]
    const maxTypeLen = Math.max(...allTypes.map(t => t.length), 1)
    const maxCountLen = Math.max(...observedEntries.map(e => String(e.count).length), 1)

    // Check for incomplete uriTypes data
    const observedTotal = Array.from(v.endpointTypes.values()).reduce((a, b) => a + b, 0)
    const coverageRatio = iriTotal > 0 ? observedTotal / iriTotal : 0
    const incomplete = coverageRatio < 0.95 && iriTotal > 0

    // Determine issue type
    const issues: string[] = []
    if (v.mismatch) issues.push('mismatch')
    if (v.untypedCount > 0) issues.push('untyped')
    if (incomplete) issues.push('incomplete')

    warn(`${propQName}`, issues.join(', '))
    console.log(`    ${dim('declared')}`)
    if (declaredTypes.length === 0) {
      console.log(`      ${dim('·')} -`)
    } else {
      for (const t of declaredTypes) {
        console.log(`      ${dim('·')} ${t}`)
      }
    }
    const observedLabel = incomplete
      ? `observed ${dim(`${observedTotal}/${iriTotal} = ${coverageRatio.toFixed(4)}`)}`
      : 'observed'
    console.log(`    ${dim(observedLabel)}`)
    for (const e of observedEntries) {
      const paddedType = e.type.padEnd(maxTypeLen)
      const paddedCount = String(e.count).padStart(maxCountLen)
      console.log(`      ${dim('·')} ${paddedType}  ${paddedCount}  ${dim(e.ratio)}`)
    }
  }
} else if (rangeValidations.length > 0) {
  step('Range validation', `${rangeValidations.length} object properties checked, no issues`)
}

// Store validated ranges for use during emission
const validatedPropertyRanges = new Map<string, Set<string>>()
for (const v of rangeValidations) {
  if (v.intersection.size > 0) {
    validatedPropertyRanges.set(v.property, v.intersection)
  } else if (v.ontologyRanges.size > 0 && !v.mismatch) {
    // No endpoint types but ontology has ranges - use ontology
    validatedPropertyRanges.set(v.property, v.ontologyRanges)
  }
}

const generation = config.generation ?? {}
const emitListRaw = Array.isArray(generation.emit) ? generation.emit : null
const resolveEmitTerm = (value: string): string | null => {
  if (!value) return null
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  const match = value.match(/^([A-Za-z0-9._-]+):(.+)$/)
  if (!match) return null
  const ns = lookupPrefix(match[1])
  if (!ns) return null
  return `${ns}${match[2]}`
}
const unknownEmitTerms: string[] = []
const emitAllowlist = emitListRaw
  ? new Set(
    emitListRaw
      .map((value) => {
        const resolved = resolveEmitTerm(value)
        if (!resolved) unknownEmitTerms.push(value)
        return resolved
      })
      .filter((value): value is string => typeof value === 'string'),
  )
  : null
const allowPredicate = (iri: string) => !emitAllowlist || emitAllowlist.has(iri)

const emitLabels = emitAllowlist ? allowPredicate(RDFS_LABEL) : generation.emitLabels !== false
const emitComments = emitAllowlist ? allowPredicate(RDFS_COMMENT) : generation.emitComments !== false
const emitAnnotations = emitAllowlist ? true : generation.emitAnnotations !== false
const domainRangePolicy = generation.domainRangePolicy ?? 'unique'
const rangePolicy = generation.rangePolicy ?? domainRangePolicy
const emitDomains = domainRangePolicy !== 'off'
const emitRanges = rangePolicy !== 'off'
const policyNotesEnabled = generation.policyNotes !== false
const policyNotePredicateIri = resolveIri(generation.policyNotePredicate ?? 'vann:usageNote')
const policyNoteTag = (generation.policyNoteTag ?? 'AE-OWL').trim() || 'AE-OWL'
const blankLineAfterDot = generation.blankLineAfterDot === true

const propertyTypeSummary = {
  object: [] as string[],
  datatype: [] as string[],
  mixed: [] as string[],
  unknown: [] as string[],
}

const inferredDomains: Array<{ property: string; domain: string }> = []
const inferredRanges: Array<{ property: string; range: string }> = []

const propertyTypeFor = (iri: string): 'object' | 'datatype' | 'mixed' | 'unknown' => {
  const fromOntology = ontologyProperties.get(iri)?.type
  if (fromOntology === 'object') return 'object'
  if (fromOntology === 'datatype') return 'datatype'

  const counts = propertyCounts.get(iri)
  if (!counts) return 'unknown'
  const hasIri = counts.iri > 0
  const hasLiteral = counts.literal > 0
  if (hasIri && hasLiteral) return 'mixed'
  if (hasIri) return 'object'
  if (hasLiteral) return 'datatype'
  return 'unknown'
}

const resolveDatatypeRange = (propertyIri: string): string | null => {
  const dtCounts = propertyDatatypeCounts.get(propertyIri)
  if (!dtCounts) return null
  const literalDatatypes = [...dtCounts.entries()]
    .filter(([datatype]) => datatype !== 'iri')
    .sort((a, b) => b[1] - a[1])
  if (literalDatatypes.length === 0) return null
  if (literalDatatypes.length === 1) return literalDatatypes[0][0]
  return null
}

const shouldEmitRange = (usageCount: number, domainCandidate: string | null): boolean => {
  if (rangePolicy === 'off') return false
  if (rangePolicy === 'unique') return usageCount === 1
  if (rangePolicy === 'branch') return domainCandidate !== null
  if (rangePolicy === 'ontology-only') return true
  if (rangePolicy === 'datatype-unique') return true
  return false
}

const emitPolicyNote = (subjectIri: string, message: string) => {
  if (!policyNotesEnabled) return
  if (!policyNotePredicateIri) return
  const tag = policyNoteTag ? `[${policyNoteTag}] ` : ''
  writer.addQuad(quad(namedNode(subjectIri), namedNode(policyNotePredicateIri), literal(`${tag}${message}`, 'en')))
  emitCounts.annotations += 1
}

const resolveDomainCandidate = (propertyIri: string): string | null => {
  const classes = propertyUsageAll.get(propertyIri)
  if (!classes || classes.size === 0) return null
  if (classes.size === 1) {
    return Array.from(classes)[0]
  }
  if (domainRangePolicy !== 'branch') return null

  const classList = Array.from(classes)
  let intersection = new Set<string>(getAncestors(classList[0]))
  for (let i = 1; i < classList.length; i += 1) {
    const next = getAncestors(classList[i])
    intersection = new Set<string>([...intersection].filter((iri) => next.has(iri)))
    if (intersection.size === 0) break
  }

  if (intersection.size === 0) return null
  let best: string | null = null
  let bestDepth = -1
  for (const candidate of intersection) {
    const depth = getDepth(candidate)
    if (depth > bestDepth) {
      bestDepth = depth
      best = candidate
    }
  }
  return best
}

const prefixes: Record<string, string> = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  ...prefixMap,
  ...parserPrefixes,
}

const writer = new Writer({ prefixes })
const emitCounts = {
  classes: 0,
  properties: 0,
  annotations: 0,
  domains: 0,
  ranges: 0,
  subclassEdges: 0,
  subpropertyEdges: 0,
}

const ontologyIri = config.ontology?.iri ?? config.ontology?.baseIri
if (ontologyIri) {
  writer.addQuad(quad(namedNode(ontologyIri), namedNode(RDF_TYPE), namedNode('http://www.w3.org/2002/07/owl#Ontology')))
  if (config.ontology?.versionInfo) {
    writer.addQuad(quad(
      namedNode(ontologyIri),
      namedNode('http://www.w3.org/2002/07/owl#versionInfo'),
      literal(config.ontology.versionInfo),
    ))
  }
}

for (const iri of orderedClasses) {
  writer.addQuad(quad(namedNode(iri), namedNode(RDF_TYPE), namedNode(OWL_CLASS)))
  emitCounts.classes += 1
  const info = ontologyClasses.get(iri)
  if (emitLabels && info?.labels) {
    for (const label of info.labels) {
      writer.addQuad(quad(
        namedNode(iri),
        namedNode(RDFS_LABEL),
        label.lang ? literal(label.value, label.lang) : literal(label.value),
      ))
      emitCounts.annotations += 1
    }
  }
  if (emitComments && info?.comments) {
    for (const comment of info.comments) {
      writer.addQuad(quad(
        namedNode(iri),
        namedNode(RDFS_COMMENT),
        comment.lang ? literal(comment.value, comment.lang) : literal(comment.value),
      ))
      emitCounts.annotations += 1
    }
  }
  if (emitAnnotations && info?.annotations) {
    for (const [predicate, values] of info.annotations.entries()) {
      if (!allowPredicate(predicate)) continue
      for (const value of values) {
        const object = value.type === 'iri'
          ? namedNode(value.value)
          : value.lang
            ? literal(value.value, value.lang)
            : value.datatype
              ? literal(value.value, namedNode(value.datatype))
              : literal(value.value)
        writer.addQuad(quad(namedNode(iri), namedNode(predicate), object))
        emitCounts.annotations += 1
      }
    }
  }
  const parents = subclassParentsByChild.get(iri)
  if (parents) {
    for (const parent of parents) {
      writer.addQuad(quad(namedNode(iri), namedNode(RDFS_SUBCLASS), namedNode(parent)))
      emitCounts.subclassEdges += 1
    }
  }
}

for (const iri of includedProperties) {
  const type = propertyTypeFor(iri)
  if (type === 'object') propertyTypeSummary.object.push(iri)
  else if (type === 'datatype') propertyTypeSummary.datatype.push(iri)
  else if (type === 'mixed') propertyTypeSummary.mixed.push(iri)
  else propertyTypeSummary.unknown.push(iri)

  const typeIri =
    type === 'object' ? OWL_OBJECT_PROPERTY :
    type === 'datatype' ? OWL_DATATYPE_PROPERTY :
    'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property'

  writer.addQuad(quad(namedNode(iri), namedNode(RDF_TYPE), namedNode(typeIri)))
  emitCounts.properties += 1

  // Emit subPropertyOf right after type
  const subpropertyParents = subpropertyParentsByChild.get(iri)
  if (subpropertyParents) {
    for (const parent of subpropertyParents) {
      writer.addQuad(quad(namedNode(iri), namedNode(RDFS_SUBPROPERTY), namedNode(parent)))
      emitCounts.subpropertyEdges += 1
    }
  }

  const info = ontologyProperties.get(iri)
  if (emitLabels && info?.labels) {
    for (const label of info.labels) {
      writer.addQuad(quad(
        namedNode(iri),
        namedNode(RDFS_LABEL),
        label.lang ? literal(label.value, label.lang) : literal(label.value),
      ))
      emitCounts.annotations += 1
    }
  }
  if (emitComments && info?.comments) {
    for (const comment of info.comments) {
      writer.addQuad(quad(
        namedNode(iri),
        namedNode(RDFS_COMMENT),
        comment.lang ? literal(comment.value, comment.lang) : literal(comment.value),
      ))
      emitCounts.annotations += 1
    }
  }
  if (emitAnnotations && info?.annotations) {
    for (const [predicate, values] of info.annotations.entries()) {
      if (!allowPredicate(predicate)) continue
      for (const value of values) {
        const object = value.type === 'iri'
          ? namedNode(value.value)
          : value.lang
            ? literal(value.value, value.lang)
            : value.datatype
              ? literal(value.value, namedNode(value.datatype))
              : literal(value.value)
        writer.addQuad(quad(namedNode(iri), namedNode(predicate), object))
        emitCounts.annotations += 1
      }
    }
  }

  let emittedDomain: string | null = null
  let emittedRange: string | null = null

  if (emitDomains || emitRanges) {
    const domainCandidate = resolveDomainCandidate(iri)
    const domainAllowed = domainCandidate &&
      (classScope.included.has(domainCandidate) || includeSuperclasses || !classesFromEndpointOnly)
    const usageCountAll = propertyUsageAll.get(iri)?.size ?? 0

    if (emitDomains && domainCandidate && domainAllowed) {
      let domainToEmit: string | null = null
      if (info?.domains && info.domains.size > 0) {
        if (info.domains.size === 1) {
          const only = Array.from(info.domains)[0]
          if (only === domainCandidate) domainToEmit = only
        }
      } else {
        domainToEmit = domainCandidate
      }

      if (domainToEmit) {
        writer.addQuad(quad(namedNode(iri), namedNode(RDFS_DOMAIN), namedNode(domainToEmit)))
        inferredDomains.push({ property: iri, domain: domainToEmit })
        emitCounts.domains += 1
        emittedDomain = domainToEmit
      }
    }

    if (emitRanges && shouldEmitRange(usageCountAll, domainCandidate)) {
      let rangeToEmit: string | null = null
      let rangeSource: 'ontology' | 'datatype' | 'validated' | null = null

      // First check for validated ranges (intersection of ontology + endpoint)
      const validatedRanges = validatedPropertyRanges.get(iri)
      if (validatedRanges && validatedRanges.size === 1) {
        rangeToEmit = Array.from(validatedRanges)[0]
        rangeSource = 'validated'
      } else if (info?.ranges && info.ranges.size > 0) {
        // Fall back to ontology ranges if no validated intersection
        if (info.ranges.size === 1) {
          rangeToEmit = Array.from(info.ranges)[0]
          rangeSource = 'ontology'
        }
      } else if (type === 'datatype' && rangePolicy !== 'ontology-only') {
        rangeToEmit = resolveDatatypeRange(iri)
        rangeSource = rangeToEmit ? 'datatype' : null
      }

      if (rangeToEmit) {
        writer.addQuad(quad(namedNode(iri), namedNode(RDFS_RANGE), namedNode(rangeToEmit)))
        inferredRanges.push({ property: iri, range: rangeToEmit })
        emitCounts.ranges += 1
        emittedRange = rangeToEmit
        if (usageCountAll > 1 && rangePolicy !== 'unique') {
          const sourceLabel = rangeSource ?? 'unknown'
          const usageClasses = Array.from(propertyUsageAll.get(iri) ?? []).map(toQName).join(', ')
          emitPolicyNote(
            iri,
            `[WARN] Range emitted for multi-class property (classes=${usageCountAll}: ${usageClasses}) using policy=${rangePolicy} source=${sourceLabel}.`,
          )
        }
      }
    }
  }

  // Emit [INFO] notes for removed ontology constructs
  if (info?.domains && info.domains.size > 0) {
    for (const domain of info.domains) {
      if (domain !== emittedDomain) {
        emitPolicyNote(iri, `[INFO] Domain removed: ${toQName(domain)}.`)
      }
    }
  }
  if (info?.ranges && info.ranges.size > 0) {
    for (const range of info.ranges) {
      if (range !== emittedRange) {
        emitPolicyNote(iri, `[INFO] Range removed: ${toQName(range)}.`)
      }
    }
  }
  const restrictions = propertyRestrictions.get(iri)
  if (restrictions && restrictions.length > 0) {
    for (const r of restrictions) {
      const valueDisplay = r.value.startsWith('http') ? toQName(r.value) : r.value
      emitPolicyNote(iri, `[INFO] Restriction removed: ${r.type}(${valueDisplay}) on ${toQName(r.class)}.`)
    }
  }
}

const outputDir = dirname(outPath)
mkdirSync(outputDir, { recursive: true })

let ttl = await new Promise<string>((resolveTtl, reject) => {
  writer.end((error, result) => {
    if (error) reject(error)
    else resolveTtl(result)
  })
})

// Split multi-value properties onto separate lines for readability
const splitMultiValueProperties = (content: string): string => {
  const lines = content.split('\n')
  const result: string[] = []
  for (const line of lines) {
    // Match lines with property and multiple values (comma-separated)
    const match = line.match(/^(\s*)(\S+\s+)(.+)$/)
    if (match) {
      const [, indent, pred, valuesStr] = match
      // Check if this looks like multiple values (contains commas not inside quotes)
      const hasMultipleValues = valuesStr.includes(',')
      if (hasMultipleValues) {
        // Try to match quoted string values with language tags (for vann:usageNote etc)
        const quotedValues = valuesStr.match(/"[^"]*"@\w+/g)
        if (quotedValues && quotedValues.length > 1) {
          const valueIndent = ' '.repeat(indent.length + pred.length)
          const ending = valuesStr.trimEnd().endsWith('.') ? '.' : valuesStr.trimEnd().endsWith(';') ? ';' : ''
          result.push(indent + pred + quotedValues[0] + ',')
          for (let i = 1; i < quotedValues.length - 1; i++) {
            result.push(valueIndent + quotedValues[i] + ',')
          }
          result.push(valueIndent + quotedValues[quotedValues.length - 1] + ending)
          continue
        }
        // Try to match prefixed IRI values (for sh:property etc), including empty prefix like :Foo
        const iriValues = valuesStr.match(/[\w-]*:[\w-]+/g)
        if (iriValues && iriValues.length > 1) {
          const valueIndent = ' '.repeat(indent.length + pred.length)
          const ending = valuesStr.trimEnd().endsWith('.') ? '.' : valuesStr.trimEnd().endsWith(';') ? ';' : ''
          result.push(indent + pred + iriValues[0] + ',')
          for (let i = 1; i < iriValues.length - 1; i++) {
            result.push(valueIndent + iriValues[i] + ',')
          }
          result.push(valueIndent + iriValues[iriValues.length - 1] + ending)
          continue
        }
      }
    }
    result.push(line)
  }
  return result.join('\n')
}
// Alias for backwards compatibility
const splitUsageNotes = splitMultiValueProperties
ttl = splitUsageNotes(ttl)

const baseIri = config.ontology?.baseIri ?? config.ontology?.iri
if (baseIri) {
  const prefixForBase = Object.entries(prefixes).find(([, ns]) => ns === baseIri)?.[0]
  if (prefixForBase) {
    const escapedBase = baseIri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`rdfs:isDefinedBy\\s+<${escapedBase}>`, 'g')
    ttl = ttl.replace(pattern, `rdfs:isDefinedBy ${prefixForBase}:`)
  }
}

if (blankLineAfterDot) {
  const lines = ttl.split(/\r?\n/)
  const isPrefixLine = (line: string) => /^\s*@prefix\s+/i.test(line) || /^\s*@base\s+/i.test(line)
  const out: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    out.push(line)
    if (line.trim().endsWith('.') && !isPrefixLine(line)) {
      const next = lines[i + 1]
      if (next === undefined || next.trim() !== '') {
        out.push('')
      }
    }
  }

  let lastPrefixIdx = -1
  for (let i = 0; i < out.length; i += 1) {
    if (isPrefixLine(out[i])) lastPrefixIdx = i
  }
  if (lastPrefixIdx >= 0) {
    const result = out.slice(0, lastPrefixIdx + 1)
    let cursor = lastPrefixIdx + 1
    while (cursor < out.length && out[cursor].trim() === '') cursor += 1
    result.push('', '')
    result.push(...out.slice(cursor))
    ttl = result.join('\n')
  } else {
    ttl = out.join('\n')
  }
}

writeFileSync(outPath, ttl)

const ttlBytes = Buffer.byteLength(ttl, 'utf8')
step('Write OWL', `${outPath} (${ttlBytes} bytes)`)

step(
  'Emitted',
  `${emitCounts.classes} classes, ${emitCounts.properties} properties, ` +
  `${emitCounts.annotations} annotations, ${emitCounts.domains} domains, ` +
  `${emitCounts.ranges} ranges`,
)
if (emitCounts.subclassEdges > 0 || emitCounts.subpropertyEdges > 0) {
  console.log(
    `    ${dim('·')} ${emitCounts.subclassEdges} subclass edges, ${emitCounts.subpropertyEdges} subproperty edges`,
  )
}

// ============================================================================
// SHACL Generation
// ============================================================================

section('SHACL Generation')

const SH = 'http://www.w3.org/ns/shacl#'
const SH_NODE_SHAPE = SH + 'NodeShape'
const SH_PROPERTY_SHAPE = SH + 'PropertyShape'
const SH_TARGET_CLASS = SH + 'targetClass'
const SH_NODE = SH + 'node'
const SH_PROPERTY = SH + 'property'
const SH_PATH = SH + 'path'
const SH_MIN_COUNT = SH + 'minCount'
const SH_MAX_COUNT = SH + 'maxCount'
const SH_DATATYPE = SH + 'datatype'
const SH_CLASS = SH + 'class'
const SH_NAME = SH + 'name'
const SH_DESCRIPTION = SH + 'description'

// Remove empty prefix from ontology - we'll use it for shapes namespace
const { '': _unusedEmptyPrefix, ...prefixesWithoutEmpty } = prefixes
const shaclPrefixes = { ...prefixesWithoutEmpty, sh: SH }
const shaclWriter = new Writer({ prefixes: shaclPrefixes })

const shaclOutPath = outPath.endsWith('.owl.ttl')
  ? outPath.replace(/\.owl\.ttl$/, '.shacl.ttl')
  : outPath.replace(/\.ttl$/, '.shacl.ttl')
const shaclCounts = { shapes: 0, propertyShapes: 0, constraints: 0 }
const shaclIssues: Array<{ class: string; property: string; issue: string }> = []

// Track cardinality verification
type CardinalityVerification = {
  class: string
  property: string
  constraint: 'minCount' | 'maxCount'
  value: number
  source: 'owl' | 'endpoint'
  subjectsTotal: number
  subjectsMatching: number
  percentage: number
}
const cardinalityVerifications: CardinalityVerification[] = []

type CardinalityMismatch = {
  class: string
  property: string
  owlType: string
  owlValue: number
  endpointMin: number
  endpointMax: number
}
const cardinalityMismatches: CardinalityMismatch[] = []

// Get base namespace for shape IRIs - use separate /shapes/ namespace
const ontologyBaseIri = config.ontology?.baseIri ?? config.ontology?.iri ?? 'http://example.org/'
const shapeBaseIri = ontologyBaseIri.replace(/#$/, '').replace(/\/$/, '') + '/shapes/'
const shapeBase = shapeBaseIri

// Add shapes prefix
shaclWriter.addPrefix('', shapeBaseIri)

// Generate shape IRI from class IRI
const classToShapeIri = (classIri: string): string => {
  const parts = splitIri(classIri)
  if (!parts) return shapeBase + 'Unknown'
  return shapeBase + parts.local
}

// Generate property shape IRI
const propertyShapeIri = (classIri: string, propIri: string): string => {
  const classParts = splitIri(classIri)
  const propParts = splitIri(propIri)
  if (!classParts || !propParts) return shapeBase + 'Unknown-property'
  return shapeBase + classParts.local + '-' + propParts.local
}

// Get label for a property (for sh:name)
const getPropertyLabel = (propIri: string): string | undefined => {
  const info = ontologyProperties.get(propIri)
  if (info?.labels && info.labels.length > 0) {
    const enLabel = info.labels.find((l) => l.lang === 'en')
    return enLabel?.value ?? info.labels[0].value
  }
  return undefined
}

// Determine the primary datatype for SHACL
const getPrimaryDatatype = (datatypes: Array<{ datatype: string; count: number }>): string | null => {
  if (!datatypes || datatypes.length === 0) return null
  // Sort by count descending
  const sorted = [...datatypes].sort((a, b) => b.count - a.count)
  const top = sorted[0]
  // Skip 'iri' and 'none' - those aren't literal datatypes
  if (top.datatype === 'iri' || top.datatype === 'none') {
    const next = sorted.find((d) => d.datatype !== 'iri' && d.datatype !== 'none')
    return next?.datatype ?? null
  }
  return top.datatype
}

// Get primary class for object properties from endpoint data
const getPrimaryClass = (propIri: string): string | null => {
  const ranges = propertyEndpointRanges.get(propIri)
  if (!ranges || ranges.size === 0) return null
  // Find the most common non-null type
  let maxCount = 0
  let maxType: string | null = null
  for (const [type, count] of ranges.entries()) {
    if (type !== null && count > maxCount) {
      maxCount = count
      maxType = type
    }
  }
  return maxType
}

// Sort notes by priority: ERROR > WARN > INFO > NOTE
const notePriority = (note: string): number => {
  if (note.startsWith('[ERROR]')) return 0
  if (note.startsWith('[WARN]')) return 1
  if (note.startsWith('[INFO]')) return 2
  if (note.startsWith('[NOTE]')) return 3
  return 4
}
const sortNotes = (notes: string[]): string[] => [...notes].sort((a, b) => notePriority(a) - notePriority(b))

// Collect all shape data first, then emit in grouped order
type PropertyShapeData = {
  shapeIri: string
  propIri: string
  propLabel?: string
  minCount?: number
  maxCount?: number
  datatype?: string
  shClass?: string
  notes?: string[]
}

const nodeShapeData: Array<{
  shapeIri: string
  classIri: string
  label?: string
  notes?: string[]
  parentShapeIris?: string[]
  propertyShapes: PropertyShapeData[]
}> = []

// Build subclass map for subclass coverage notes
const subclassesByParent = new Map<string, string[]>()
for (const edge of subclassEdges) {
  const children = subclassesByParent.get(edge.parent) ?? []
  children.push(edge.child)
  subclassesByParent.set(edge.parent, children)
}

for (const classIri of includedClasses) {
  const shapeIri = classToShapeIri(classIri)
  const propertyShapes: PropertyShapeData[] = []
  const shapeNotes: string[] = []

  // Get label for the shape
  let shapeLabel: string | undefined
  const classInfo = ontologyClasses.get(classIri)
  if (classInfo?.labels && classInfo.labels.length > 0) {
    const enLabel = classInfo.labels.find((l) => l.lang === 'en')
    const label = enLabel ?? classInfo.labels[0]
    shapeLabel = label.value + ' Shape'
  }

  // NodeShape notes
  // 1. Instance count
  const instanceCount = classInstanceCounts.get(classIri)
  if (instanceCount !== undefined && instanceCount > 0) {
    shapeNotes.push(`[INFO] ${instanceCount.toLocaleString()} instances.`)
  } else if (ontologyClasses.has(classIri) && !classInstanceCounts.has(classIri)) {
    // 2. No instances warning (class declared in ontology but no instances)
    shapeNotes.push(`[WARN] No instances (class only in ontology).`)
  }

  // 3. Subclass coverage
  const subclasses = subclassesByParent.get(classIri) ?? []
  const includedSubclasses = [...new Set(subclasses.filter((sc) => classScope.included.has(sc)))]
  if (includedSubclasses.length > 0) {
    const subclassNames = includedSubclasses.map((sc) => localName(sc)).join(', ')
    shapeNotes.push(`[NOTE] Subclasses: ${subclassNames}.`)
  }

  // Get properties for this class from endpoint data
  const classShaclProps = classPropertyShaclInfo.get(classIri)
  if (classShaclProps) {
    for (const [propIri, shaclInfo] of classShaclProps.entries()) {
      // Only include properties that are in scope
      if (!propertyScope.included.has(propIri)) continue

      const propShapeIri = propertyShapeIri(classIri, propIri)
      const propData: PropertyShapeData = {
        shapeIri: propShapeIri,
        propIri,
        propLabel: getPropertyLabel(propIri),
        notes: [],
      }

      // Get OWL restrictions for this property on this class
      const owlRestrictions = propertyRestrictions.get(propIri)?.filter((r) => r.class === classIri) ?? []
      const owlMinCard = owlRestrictions.find((r) => r.type === 'minCardinality' || r.type === 'cardinality')
      const owlMaxCard = owlRestrictions.find((r) => r.type === 'maxCardinality' || r.type === 'cardinality')
      const owlAllValuesFrom = owlRestrictions.find((r) => r.type === 'allValuesFrom')

      // Parse OWL cardinality values
      const owlMinVal = owlMinCard ? parseInt(owlMinCard.value, 10) : NaN
      const owlMaxVal = owlMaxCard ? parseInt(owlMaxCard.value, 10) : NaN

      // Helper to calculate % of subjects matching a cardinality constraint
      const calcCardinalityPercentage = (
        counts: CardinalityCounts | undefined,
        constraint: 'min' | 'max',
        value: number
      ): { matching: number; total: number; percentage: number } | null => {
        if (!counts) return null
        let matching = 0
        let total = 0
        for (const [countStr, subjectCount] of Object.entries(counts)) {
          const count = parseInt(countStr, 10)
          if (isNaN(count)) continue
          total += subjectCount
          if (constraint === 'min' && count >= value) {
            matching += subjectCount
          } else if (constraint === 'max' && count <= value) {
            matching += subjectCount
          }
        }
        if (total === 0) return null
        return { matching, total, percentage: (matching / total) * 100 }
      }

      // Cardinality - prioritize OWL restrictions, validate with endpoint data
      if (shaclInfo.cardinality) {
        const { min, max, subjects } = shaclInfo.cardinality
        const counts = shaclInfo.cardinalityCounts

        // Track OWL vs endpoint mismatches
        if (!isNaN(owlMinVal) && min < owlMinVal) {
          cardinalityMismatches.push({
            class: classIri,
            property: propIri,
            owlType: owlMinCard!.type,
            owlValue: owlMinVal,
            endpointMin: min,
            endpointMax: max,
          })
        }
        if (!isNaN(owlMaxVal) && max > owlMaxVal) {
          cardinalityMismatches.push({
            class: classIri,
            property: propIri,
            owlType: owlMaxCard!.type,
            owlValue: owlMaxVal,
            endpointMin: min,
            endpointMax: max,
          })
        }

        // sh:minCount - use OWL if available, otherwise endpoint
        if (!isNaN(owlMinVal) && owlMinVal >= 1) {
          propData.minCount = owlMinVal
          propData.notes!.push(`[INFO] sh:minCount=${owlMinVal} from OWL.${subjects ? ` ${subjects.toLocaleString()} subjects.` : ''}`)
          const pct = calcCardinalityPercentage(counts, 'min', owlMinVal)
          if (pct) {
            cardinalityVerifications.push({
              class: classIri,
              property: propIri,
              constraint: 'minCount',
              value: owlMinVal,
              source: 'owl',
              subjectsTotal: pct.total,
              subjectsMatching: pct.matching,
              percentage: pct.percentage,
            })
            // Add note for low conformance
            if (pct.percentage < 95) {
              const level = pct.percentage < 80 ? 'ERROR' : 'WARN'
              propData.notes!.push(`[${level}] ${pct.percentage.toFixed(1)}% conformance (${pct.matching.toLocaleString()}/${pct.total.toLocaleString()} subjects).`)
            }
          }
          if (min < owlMinVal && pct) {
            const violators = pct.total - pct.matching
            const pctViolators = ((violators / pct.total) * 100).toFixed(1)
            propData.notes!.push(`[WARN] OWL min=${owlMinVal}, endpoint min=${min}. ${violators.toLocaleString()}/${pct.total.toLocaleString()} (${pctViolators}%) violate.`)
          }
        } else if (min >= 1) {
          propData.minCount = min
          const pct = calcCardinalityPercentage(counts, 'min', min)
          if (pct) {
            cardinalityVerifications.push({
              class: classIri,
              property: propIri,
              constraint: 'minCount',
              value: min,
              source: 'endpoint',
              subjectsTotal: pct.total,
              subjectsMatching: pct.matching,
              percentage: pct.percentage,
            })
            // Add note for low conformance
            if (pct.percentage < 95) {
              const level = pct.percentage < 80 ? 'ERROR' : 'WARN'
              propData.notes!.push(`[${level}] ${pct.percentage.toFixed(1)}% conformance (${pct.matching.toLocaleString()}/${pct.total.toLocaleString()} subjects).`)
            }
          }
          propData.notes!.push(`[INFO] sh:minCount=${min} from endpoint. ${subjects.toLocaleString()} subjects.`)
        }

        // sh:maxCount - only emit if max=1 (functional), otherwise just note
        if (!isNaN(owlMaxVal) && owlMaxVal === 1) {
          propData.maxCount = 1
          propData.notes!.push(`[INFO] sh:maxCount=1 from OWL (functional).`)
          const pct = calcCardinalityPercentage(counts, 'max', 1)
          if (pct) {
            cardinalityVerifications.push({
              class: classIri,
              property: propIri,
              constraint: 'maxCount',
              value: 1,
              source: 'owl',
              subjectsTotal: pct.total,
              subjectsMatching: pct.matching,
              percentage: pct.percentage,
            })
            // Add note for low conformance
            if (pct.percentage < 95) {
              const level = pct.percentage < 80 ? 'ERROR' : 'WARN'
              propData.notes!.push(`[${level}] ${pct.percentage.toFixed(1)}% conformance (${pct.matching.toLocaleString()}/${pct.total.toLocaleString()} subjects).`)
            }
          }
          if (max > 1 && pct) {
            const violators = pct.total - pct.matching
            const pctViolators = ((violators / pct.total) * 100).toFixed(1)
            propData.notes!.push(`[WARN] OWL max=1, endpoint max=${max}. ${violators.toLocaleString()}/${pct.total.toLocaleString()} (${pctViolators}%) violate.`)
          }
        } else if (max === 1) {
          propData.maxCount = 1
          const pct = calcCardinalityPercentage(counts, 'max', 1)
          if (pct) {
            cardinalityVerifications.push({
              class: classIri,
              property: propIri,
              constraint: 'maxCount',
              value: 1,
              source: 'endpoint',
              subjectsTotal: pct.total,
              subjectsMatching: pct.matching,
              percentage: pct.percentage,
            })
            // Add note for low conformance
            if (pct.percentage < 95) {
              const level = pct.percentage < 80 ? 'ERROR' : 'WARN'
              propData.notes!.push(`[${level}] ${pct.percentage.toFixed(1)}% conformance (${pct.matching.toLocaleString()}/${pct.total.toLocaleString()} subjects).`)
            }
          }
          propData.notes!.push(`[INFO] sh:maxCount=1 from endpoint. ${subjects.toLocaleString()} subjects.`)
        } else if (max > 1) {
          // Just note the observed cardinality, don't enforce it
          propData.notes!.push(`[NOTE] Max cardinality=${max} not enforced. ${subjects.toLocaleString()} subjects.`)
        }
      } else {
        // No endpoint data - use OWL restrictions if available
        if (!isNaN(owlMinVal) && owlMinVal >= 1) {
          propData.minCount = owlMinVal
          propData.notes!.push(`[INFO] sh:minCount=${owlMinVal} from OWL.`)
          propData.notes!.push(`[WARN] No endpoint data to validate OWL constraint.`)
        }
        if (!isNaN(owlMaxVal) && owlMaxVal === 1) {
          propData.maxCount = 1
          propData.notes!.push(`[INFO] sh:maxCount=1 from OWL (functional).`)
          propData.notes!.push(`[WARN] No endpoint data to validate OWL constraint.`)
        }
      }

      // Property type and constraints
      const propType = propertyTypeFor(propIri)
      if (propType === 'datatype' && shaclInfo.datatypes) {
        const primaryDatatype = getPrimaryDatatype(shaclInfo.datatypes)
        if (primaryDatatype && primaryDatatype !== 'none') {
          propData.datatype = primaryDatatype
          const primaryCount = shaclInfo.datatypes.find((d) => d.datatype === primaryDatatype)?.count ?? 0
          propData.notes!.push(`[INFO] sh:datatype=${toQName(primaryDatatype)} from endpoint. ${primaryCount.toLocaleString()} values.`)

          // Warn about multiple datatypes
          const otherDatatypes = shaclInfo.datatypes.filter(
            (d) => d.datatype !== primaryDatatype && d.datatype !== 'iri' && d.datatype !== 'none'
          )
          if (otherDatatypes.length > 0) {
            const total = shaclInfo.datatypes.reduce((sum, d) => sum + d.count, 0)
            const otherTotal = otherDatatypes.reduce((sum, d) => sum + d.count, 0)
            const pctRaw = (otherTotal / total) * 100
            const pctStr = pctRaw < 0.01 ? '<0.01%' : `${pctRaw.toFixed(2)}%`
            const otherList = otherDatatypes.map((d) => toQName(d.datatype)).join(', ')
            propData.notes!.push(`[WARN] Multiple datatypes: ${otherTotal.toLocaleString()}/${total.toLocaleString()} (${pctStr}) are ${otherList}.`)
          }
        } else {
          shaclIssues.push({ class: classIri, property: propIri, issue: 'no datatype' })
          const valueCount = shaclInfo.datatypes.reduce((sum, d) => sum + d.count, 0)
          propData.notes!.push(`[WARN] No sh:datatype. ${valueCount.toLocaleString()} values, type undetermined.`)
        }
      } else if (propType === 'object') {
        const validatedRanges = validatedPropertyRanges.get(propIri)
        if (validatedRanges && validatedRanges.size === 1) {
          propData.shClass = Array.from(validatedRanges)[0]
          propData.notes!.push(`[INFO] sh:class=${toQName(propData.shClass)} from OWL+endpoint.`)
        } else {
          const primaryClass = getPrimaryClass(propIri)
          if (primaryClass && classScope.included.has(primaryClass)) {
            propData.shClass = primaryClass
            propData.notes!.push(`[INFO] sh:class=${toQName(primaryClass)} from endpoint (most common).`)
          } else {
            shaclIssues.push({ class: classIri, property: propIri, issue: 'no class' })
            if (primaryClass && !classScope.included.has(primaryClass)) {
              propData.notes!.push(`[WARN] No sh:class. Primary class ${toQName(primaryClass)} not in scope.`)
            } else {
              propData.notes!.push(`[WARN] No sh:class. Range undetermined.`)
            }
          }
        }

        // Check for allValuesFrom conflict
        if (owlAllValuesFrom && propData.shClass && owlAllValuesFrom.value !== propData.shClass) {
          const endpointRanges = propertyEndpointRanges.get(propIri)
          const owlClassCount = endpointRanges?.get(owlAllValuesFrom.value) ?? 0
          const emittedClassCount = endpointRanges?.get(propData.shClass) ?? 0
          propData.notes!.push(`[WARN] OWL allValuesFrom=${localName(owlAllValuesFrom.value)} (${owlClassCount.toLocaleString()} values) vs emitted sh:class=${localName(propData.shClass)} (${emittedClassCount.toLocaleString()} values).`)
        }
      } else if (propType === 'mixed') {
        shaclIssues.push({ class: classIri, property: propIri, issue: 'mixed type' })
        const dt = shaclInfo.datatypes ?? []
        const iriCount = dt.find((d) => d.datatype === 'iri')?.count ?? 0
        const literalCount = dt.filter((d) => d.datatype !== 'iri' && d.datatype !== 'none').reduce((sum, d) => sum + d.count, 0)
        const total = iriCount + literalCount
        propData.notes!.push(`[WARN] Mixed types: ${iriCount.toLocaleString()} IRIs + ${literalCount.toLocaleString()} literals.`)
      } else if (propType === 'unknown') {
        shaclIssues.push({ class: classIri, property: propIri, issue: 'unknown type' })
        const valueCount = (shaclInfo.datatypes ?? []).reduce((sum, d) => sum + d.count, 0)
        propData.notes!.push(`[WARN] Unknown type. ${valueCount.toLocaleString()} values, no constraints.`)
      }

      if (propData.notes && propData.notes.length > 0) {
        propData.notes = sortNotes(propData.notes)
      }
      propertyShapes.push(propData)
    }
  }

  nodeShapeData.push({
    shapeIri,
    classIri,
    label: shapeLabel,
    notes: shapeNotes.length > 0 ? sortNotes(shapeNotes) : undefined,
    propertyShapes,
  })
}

const propertyShapeFingerprint = (shape: PropertyShapeData): string => [
  shape.propIri,
  shape.minCount !== undefined ? String(shape.minCount) : '',
  shape.maxCount !== undefined ? String(shape.maxCount) : '',
  shape.datatype ?? '',
  shape.shClass ?? '',
].join('|')

const nodeShapeByClass = new Map<string, typeof nodeShapeData[number]>()
for (const shape of nodeShapeData) {
  nodeShapeByClass.set(shape.classIri, shape)
}

let inheritedParentLinks = 0
let inheritedDuplicatesPruned = 0

for (const nodeShape of nodeShapeData) {
  const directParents = subclassParentsByChild.get(nodeShape.classIri) ?? []
  if (directParents.length > 0) {
    nodeShape.parentShapeIris = directParents
      .filter((parentIri) => classScope.included.has(parentIri))
      .map((parentIri) => classToShapeIri(parentIri))
    inheritedParentLinks += nodeShape.parentShapeIris.length
  }

  const inheritedFingerprints = new Set<string>()
  const ancestorQueue = [...directParents]
  const ancestorSeen = new Set<string>()
  while (ancestorQueue.length > 0) {
    const ancestor = ancestorQueue.shift()
    if (!ancestor || ancestorSeen.has(ancestor)) continue
    ancestorSeen.add(ancestor)
    const ancestorShape = nodeShapeByClass.get(ancestor)
    if (ancestorShape) {
      for (const propShape of ancestorShape.propertyShapes) {
        inheritedFingerprints.add(propertyShapeFingerprint(propShape))
      }
    }
    const parentAncestors = subclassParentsByChild.get(ancestor) ?? []
    for (const parent of parentAncestors) {
      if (!ancestorSeen.has(parent)) ancestorQueue.push(parent)
    }
  }

  if (inheritedFingerprints.size > 0) {
    const before = nodeShape.propertyShapes.length
    nodeShape.propertyShapes = nodeShape.propertyShapes.filter(
      (propShape) => !inheritedFingerprints.has(propertyShapeFingerprint(propShape)),
    )
    inheritedDuplicatesPruned += (before - nodeShape.propertyShapes.length)
  }
}

if (inheritedParentLinks > 0 || inheritedDuplicatesPruned > 0) {
  step(
    'SHACL inheritance',
    `${inheritedParentLinks} parent links, ${inheritedDuplicatesPruned} duplicate inherited property shapes pruned`,
  )
}

// Emit NodeShapes with their PropertyShapes directly below
for (const nodeShape of nodeShapeData) {
  // NodeShape
  shaclWriter.addQuad(quad(namedNode(nodeShape.shapeIri), namedNode(RDF_TYPE), namedNode(SH_NODE_SHAPE)))
  shaclWriter.addQuad(quad(namedNode(nodeShape.shapeIri), namedNode(SH_TARGET_CLASS), namedNode(nodeShape.classIri)))
  if (nodeShape.parentShapeIris && nodeShape.parentShapeIris.length > 0) {
    for (const parentShapeIri of nodeShape.parentShapeIris) {
      shaclWriter.addQuad(quad(namedNode(nodeShape.shapeIri), namedNode(SH_NODE), namedNode(parentShapeIri)))
    }
  }
  if (nodeShape.label) {
    shaclWriter.addQuad(quad(namedNode(nodeShape.shapeIri), namedNode(RDFS_LABEL), literal(nodeShape.label, 'en')))
  }
  // Emit NodeShape notes
  if (nodeShape.notes && nodeShape.notes.length > 0 && policyNotesEnabled) {
    for (const note of nodeShape.notes) {
      shaclWriter.addQuad(quad(namedNode(nodeShape.shapeIri), namedNode(policyNotePredicateIri), literal(note, 'en')))
    }
  }
  // All sh:property links for this shape
  for (const propShape of nodeShape.propertyShapes) {
    shaclWriter.addQuad(quad(namedNode(nodeShape.shapeIri), namedNode(SH_PROPERTY), namedNode(propShape.shapeIri)))
  }
  shaclCounts.shapes += 1

  // PropertyShapes for this NodeShape (directly below)
  for (const propShape of nodeShape.propertyShapes) {
    shaclWriter.addQuad(quad(namedNode(propShape.shapeIri), namedNode(RDF_TYPE), namedNode(SH_PROPERTY_SHAPE)))
    shaclWriter.addQuad(quad(namedNode(propShape.shapeIri), namedNode(SH_PATH), namedNode(propShape.propIri)))
    if (propShape.propLabel) {
      shaclWriter.addQuad(quad(namedNode(propShape.shapeIri), namedNode(SH_NAME), literal(propShape.propLabel, 'en')))
    }
    if (propShape.minCount !== undefined) {
      shaclWriter.addQuad(quad(
        namedNode(propShape.shapeIri),
        namedNode(SH_MIN_COUNT),
        literal(String(propShape.minCount), namedNode('http://www.w3.org/2001/XMLSchema#integer')),
      ))
      shaclCounts.constraints += 1
    }
    if (propShape.maxCount !== undefined) {
      shaclWriter.addQuad(quad(
        namedNode(propShape.shapeIri),
        namedNode(SH_MAX_COUNT),
        literal(String(propShape.maxCount), namedNode('http://www.w3.org/2001/XMLSchema#integer')),
      ))
      shaclCounts.constraints += 1
    }
    if (propShape.datatype) {
      shaclWriter.addQuad(quad(namedNode(propShape.shapeIri), namedNode(SH_DATATYPE), namedNode(propShape.datatype)))
      shaclCounts.constraints += 1
    }
    if (propShape.shClass) {
      shaclWriter.addQuad(quad(namedNode(propShape.shapeIri), namedNode(SH_CLASS), namedNode(propShape.shClass)))
      shaclCounts.constraints += 1
    }
    // Emit usage notes
    if (propShape.notes && propShape.notes.length > 0 && policyNotesEnabled) {
      for (const note of propShape.notes) {
        shaclWriter.addQuad(quad(namedNode(propShape.shapeIri), namedNode(policyNotePredicateIri), literal(note, 'en')))
      }
    }
    shaclCounts.propertyShapes += 1
  }
}

// Write SHACL output
let shaclTtl = await new Promise<string>((resolveTtl, reject) => {
  shaclWriter.end((error, result) => {
    if (error) reject(error)
    else resolveTtl(result)
  })
})

// Split multi-value vann:usageNote lines onto separate lines
shaclTtl = splitUsageNotes(shaclTtl)

// Apply same blank line formatting
if (blankLineAfterDot) {
  const lines = shaclTtl.split(/\r?\n/)
  const isPrefixLine = (line: string) => /^\s*@prefix\s+/i.test(line) || /^\s*@base\s+/i.test(line)
  const out: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    out.push(line)
    if (line.trim().endsWith('.') && !isPrefixLine(line)) {
      out.push('')
    }
  }
  shaclTtl = out.join('\n')
}

writeFileSync(shaclOutPath, shaclTtl)

const shaclBytes = Buffer.byteLength(shaclTtl, 'utf8')
step('Write SHACL', `${shaclOutPath} (${shaclBytes} bytes)`)
step(
  'SHACL Emitted',
  `${shaclCounts.shapes} node shapes, ${shaclCounts.propertyShapes} property shapes, ${shaclCounts.constraints} constraints`,
)

// Log SHACL issues
if (shaclIssues.length > 0) {
  const issuesByType = new Map<string, Array<{ class: string; property: string }>>()
  for (const issue of shaclIssues) {
    const list = issuesByType.get(issue.issue) ?? []
    list.push({ class: issue.class, property: issue.property })
    issuesByType.set(issue.issue, list)
  }
  const summary = Array.from(issuesByType.entries()).map(([t, items]) => `${items.length} ${t}`).join(', ')
  warn('SHACL Issues', `${shaclIssues.length} property shapes: ${summary}`)
  for (const [issueType, items] of issuesByType.entries()) {
    console.log(`    ${dim(issueType)}`)
    const maxPropLen = Math.max(...items.map((i) => toQName(i.property).length))
    for (const item of items) {
      const prop = toQName(item.property).padEnd(maxPropLen)
      console.log(`      ${dim('·')} ${prop} ${dim(`on ${toQName(item.class)}`)}`)
    }
  }
}

// Log cardinality verifications (% of subjects matching constraint)
if (cardinalityVerifications.length > 0) {
  const SUSPICIOUS_THRESHOLD = 95
  const suspicious = cardinalityVerifications.filter((v) => v.percentage < SUSPICIOUS_THRESHOLD)
  const errors = suspicious.filter((v) => v.percentage < 80).length
  const warnings = suspicious.length - errors

  if (suspicious.length > 0) {
    warn('Cardinality', `${suspicious.length}/${cardinalityVerifications.length} constraints <${SUSPICIOUS_THRESHOLD}% (${errors} errors, ${warnings} warnings)`)
    const maxPropLen = Math.max(...suspicious.map((v) => toQName(v.property).length))
    const maxClassLen = Math.max(...suspicious.map((v) => toQName(v.class).length))
    for (const v of suspicious) {
      const pct = v.percentage.toFixed(1).padStart(5)
      const level = v.percentage < 80 ? 'ERR' : 'WRN'
      const prop = toQName(v.property).padEnd(maxPropLen)
      const cls = toQName(v.class).padEnd(maxClassLen)
      console.log(`    ${dim(`${level} ${pct}%`)} ${prop} ${dim(`on`)} ${cls} ${dim(`(${v.constraint}=${v.value})`)}`)
    }
  } else {
    step('Cardinality', `${cardinalityVerifications.length} constraints verified, all >=${SUSPICIOUS_THRESHOLD}%`)
  }
}

// Log OWL vs endpoint cardinality mismatches
if (cardinalityMismatches.length > 0) {
  warn('OWL Mismatch', `${cardinalityMismatches.length} properties differ from endpoint data`)
  const maxPropLen = Math.max(...cardinalityMismatches.map((m) => toQName(m.property).length))
  const maxClassLen = Math.max(...cardinalityMismatches.map((m) => toQName(m.class).length))
  for (const m of cardinalityMismatches) {
    const prop = toQName(m.property).padEnd(maxPropLen)
    const cls = toQName(m.class).padEnd(maxClassLen)
    console.log(`    ${dim('·')} ${prop} ${dim('on')} ${cls} ${dim(`OWL ${m.owlType}=${m.owlValue}, endpoint min=${m.endpointMin.toLocaleString()} max=${m.endpointMax.toLocaleString()}`)}`)
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  endpointDir,
  analysisPath,
  ontologyFiles: ontologyFiles,
  scope: {
    classesFromEndpointOnly,
    propertiesFromEndpointOnly,
    includeNamespaces: Array.from(includeNamespaces),
    excludeNamespaces: Array.from(excludeNamespaces),
    rootClasses: Array.from(rootClasses),
    includeSubclasses,
    includeSuperclasses,
    includeSuperproperties,
    includeInverseProperties,
  },
  classes: {
    included: includedClasses,
    excluded: classScope.excluded,
  },
  properties: {
    included: includedProperties,
    excluded: propertyScope.excluded,
  },
  inheritance: {
    mode: inheritanceMode,
    subClassOfCount: mergedSubclassEdges.length,
    subPropertyOfCount: mergedSubpropertyEdges.length,
  },
  propertyTypes: propertyTypeSummary,
  generation: {
    emit: emitListRaw ?? null,
    unknownEmitTerms,
    domainRangePolicy,
    rangePolicy,
    policyNotes: policyNotesEnabled,
    policyNotePredicate: policyNotePredicateIri,
    policyNoteTag,
    shaclInheritance: {
      parentLinks: inheritedParentLinks,
      duplicatePropertyShapesPruned: inheritedDuplicatesPruned,
    },
  },
  propertyUsage: {
    singleUse: singleUseProperties,
    multiUse: multiUseProperties,
    singleUseGlobal: propertyUsageDetailsGlobal.filter((entry) => entry.classCount === 1),
    multiUseGlobal: propertyUsageDetailsGlobal.filter((entry) => entry.classCount > 1),
  },
  unresolvedQNames,
  inferred: {
    domains: inferredDomains,
    ranges: inferredRanges,
  },
}

writeFileSync(reportPath, JSON.stringify(report, null, 2))

step('Write report', reportPath)
if (unknownEmitTerms.length > 0) {
  console.log(`  ${yellow('!')} ${dim('Unknown emit terms:')} ${unknownEmitTerms.join(', ')}`)
}
console.log('')
console.log(`  ${green('✓')} ${bold('Complete')}`)
