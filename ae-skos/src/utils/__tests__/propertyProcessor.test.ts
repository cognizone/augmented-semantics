/**
 * Property Processor Tests
 *
 * Tests for declarative SPARQL binding processing.
 * @see /spec/ae-skos/sko06-ConceptDetails.md
 */
import { describe, it, expect } from 'vitest'
import {
  processPropertyBindings,
  CONCEPT_PROPERTY_MAP,
  SCHEME_PROPERTY_MAP,
  type SparqlBinding,
  type PropertyMapping,
} from '../propertyProcessor'
import { PRED } from '../../constants/predicates'
import type { LabelValue, NotationValue, ConceptRef } from '../../types'

describe('propertyProcessor', () => {
  describe('processPropertyBindings', () => {
    // Helper to create a target object with all necessary arrays
    function createTarget() {
      return {
        prefLabels: [] as LabelValue[],
        altLabels: [] as LabelValue[],
        hiddenLabels: [] as LabelValue[],
        rdfsLabels: [] as LabelValue[],
        dctTitles: [] as LabelValue[],
        dcTitles: [] as LabelValue[],
        comments: [] as LabelValue[],
        description: [] as LabelValue[],
        definitions: [] as LabelValue[],
        scopeNotes: [] as LabelValue[],
        historyNotes: [] as LabelValue[],
        changeNotes: [] as LabelValue[],
        editorialNotes: [] as LabelValue[],
        notes: [] as LabelValue[],
        examples: [] as LabelValue[],
        notations: [] as NotationValue[],
        broader: [] as ConceptRef[],
        narrower: [] as ConceptRef[],
        related: [] as ConceptRef[],
        inScheme: [] as ConceptRef[],
        exactMatch: [] as string[],
        closeMatch: [] as string[],
        broadMatch: [] as string[],
        narrowMatch: [] as string[],
        relatedMatch: [] as string[],
        identifier: [] as string[],
        creator: [] as string[],
        publisher: [] as string[],
        rights: [] as string[],
        license: [] as string[],
        ccLicense: [] as string[],
        seeAlso: [] as string[],
        created: undefined as string | undefined,
        modified: undefined as string | undefined,
        issued: undefined as string | undefined,
        versionInfo: undefined as string | undefined,
        status: undefined as string | undefined,
        deprecated: undefined as boolean | undefined,
      }
    }

    describe('label handler', () => {
      it('adds labels with language to target array', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.prefLabel }, value: { value: 'Hello', 'xml:lang': 'en' } },
          { property: { value: PRED.prefLabel }, value: { value: 'Bonjour', 'xml:lang': 'fr' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.prefLabels).toHaveLength(2)
        expect(target.prefLabels[0]).toEqual({ value: 'Hello', lang: 'en' })
        expect(target.prefLabels[1]).toEqual({ value: 'Bonjour', lang: 'fr' })
      })

      it('handles labels without language', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.prefLabel }, value: { value: 'No Lang Label' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.prefLabels[0]).toEqual({ value: 'No Lang Label', lang: undefined })
      })

      it('adds altLabels to correct target', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.altLabel }, value: { value: 'Alternative', 'xml:lang': 'en' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.altLabels).toHaveLength(1)
        expect(target.altLabels[0].value).toBe('Alternative')
      })

      it('adds hiddenLabels to correct target', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.hiddenLabel }, value: { value: 'Hidden', 'xml:lang': 'en' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.hiddenLabels).toHaveLength(1)
        expect(target.hiddenLabels[0].value).toBe('Hidden')
      })
    })

    describe('notation handler', () => {
      it('adds notations with datatype', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.notation }, value: { value: '1.2.3', datatype: 'http://www.w3.org/2001/XMLSchema#string' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.notations).toHaveLength(1)
        expect(target.notations[0]).toEqual({
          value: '1.2.3',
          datatype: 'http://www.w3.org/2001/XMLSchema#string',
        })
      })

      it('deduplicates notations by value', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.notation }, value: { value: 'ABC' } },
          { property: { value: PRED.notation }, value: { value: 'ABC' } },
          { property: { value: PRED.notation }, value: { value: 'DEF' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.notations).toHaveLength(2)
        expect(target.notations.map(n => n.value)).toEqual(['ABC', 'DEF'])
      })

      it('handles notations without datatype', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.notation }, value: { value: 'plain' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.notations[0]).toEqual({ value: 'plain', datatype: undefined })
      })
    })

    describe('ref handler', () => {
      it('adds broader refs', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.broader }, value: { value: 'http://ex.org/c1' } },
          { property: { value: PRED.broader }, value: { value: 'http://ex.org/c2' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.broader).toHaveLength(2)
        expect(target.broader[0]).toEqual({ uri: 'http://ex.org/c1' })
        expect(target.broader[1]).toEqual({ uri: 'http://ex.org/c2' })
      })

      it('deduplicates refs by URI', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.broader }, value: { value: 'http://ex.org/c1' } },
          { property: { value: PRED.broader }, value: { value: 'http://ex.org/c1' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.broader).toHaveLength(1)
      })

      it('adds narrower refs to correct target', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.narrower }, value: { value: 'http://ex.org/n1' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.narrower).toHaveLength(1)
        expect(target.narrower[0].uri).toBe('http://ex.org/n1')
      })

      it('adds related refs to correct target', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.related }, value: { value: 'http://ex.org/r1' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.related).toHaveLength(1)
        expect(target.related[0].uri).toBe('http://ex.org/r1')
      })

      it('adds inScheme refs to correct target', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.inScheme }, value: { value: 'http://ex.org/scheme/1' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.inScheme).toHaveLength(1)
        expect(target.inScheme[0].uri).toBe('http://ex.org/scheme/1')
      })
    })

    describe('uri handler', () => {
      it('adds mapping URIs', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.exactMatch }, value: { value: 'http://other.org/concept' } },
          { property: { value: PRED.closeMatch }, value: { value: 'http://another.org/concept' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.exactMatch).toEqual(['http://other.org/concept'])
        expect(target.closeMatch).toEqual(['http://another.org/concept'])
      })

      it('deduplicates URIs', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.exactMatch }, value: { value: 'http://ex.org/same' } },
          { property: { value: PRED.exactMatch }, value: { value: 'http://ex.org/same' } },
          { property: { value: PRED.exactMatch }, value: { value: 'http://ex.org/different' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.exactMatch).toHaveLength(2)
      })

      it('handles broadMatch and narrowMatch', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.broadMatch }, value: { value: 'http://ex.org/broad' } },
          { property: { value: PRED.narrowMatch }, value: { value: 'http://ex.org/narrow' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.broadMatch).toEqual(['http://ex.org/broad'])
        expect(target.narrowMatch).toEqual(['http://ex.org/narrow'])
      })

      it('handles seeAlso URIs', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.seeAlso }, value: { value: 'http://ex.org/see' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.seeAlso).toEqual(['http://ex.org/see'])
      })
    })

    describe('single handler', () => {
      it('sets single value properties', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.dctCreated }, value: { value: '2024-01-15' } },
          { property: { value: PRED.dctModified }, value: { value: '2024-06-20' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.created).toBe('2024-01-15')
        expect(target.modified).toBe('2024-06-20')
      })

      it('keeps first value for single properties (no overwrite)', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.dctCreated }, value: { value: 'first' } },
          { property: { value: PRED.dctCreated }, value: { value: 'second' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.created).toBe('first')
      })

      it('handles versionInfo', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.versionInfo }, value: { value: '1.0.0' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.versionInfo).toBe('1.0.0')
      })
    })

    describe('singleUri handler', () => {
      it('extracts fragment from URI for status', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.dctStatus }, value: { value: 'http://purl.org/adms/status/Completed' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.status).toBe('Completed')
      })

      it('handles non-URI values', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.dctStatus }, value: { value: 'active' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.status).toBe('active')
      })
    })

    describe('boolean handler', () => {
      it('sets true for "true" string', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.deprecated }, value: { value: 'true' } },
        ]

        processPropertyBindings(bindings, target, SCHEME_PROPERTY_MAP)

        expect(target.deprecated).toBe(true)
      })

      it('sets true for "1" string', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.deprecated }, value: { value: '1' } },
        ]

        processPropertyBindings(bindings, target, SCHEME_PROPERTY_MAP)

        expect(target.deprecated).toBe(true)
      })

      it('sets false for other values', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.deprecated }, value: { value: 'false' } },
        ]

        processPropertyBindings(bindings, target, SCHEME_PROPERTY_MAP)

        expect(target.deprecated).toBe(false)
      })
    })

    describe('rdf:type collection', () => {
      it('returns rdf:type values', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.type }, value: { value: 'http://www.w3.org/2004/02/skos/core#Concept' } },
          { property: { value: PRED.type }, value: { value: 'http://www.w3.org/2002/07/owl#Thing' } },
        ]

        const types = processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(types).toHaveLength(2)
        expect(types).toContain('http://www.w3.org/2004/02/skos/core#Concept')
        expect(types).toContain('http://www.w3.org/2002/07/owl#Thing')
      })

      it('does not add rdf:type to target properties', () => {
        const target = createTarget() as any
        target.types = []
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.type }, value: { value: 'http://ex.org/Type' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        // rdf:type is returned, not added to target
        expect(target.types).toHaveLength(0)
      })
    })

    describe('unmapped properties', () => {
      it('ignores properties not in mapping', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: 'http://unknown.org/property' }, value: { value: 'ignored' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        // Should not throw and target should remain unchanged
        expect(target.prefLabels).toHaveLength(0)
      })
    })

    describe('invalid bindings', () => {
      it('skips bindings without property', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { value: { value: 'orphan value' } },
          { property: { value: PRED.prefLabel }, value: { value: 'Valid' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.prefLabels).toHaveLength(1)
        expect(target.prefLabels[0].value).toBe('Valid')
      })

      it('skips bindings without value', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.prefLabel } },
          { property: { value: PRED.prefLabel }, value: { value: 'Valid' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.prefLabels).toHaveLength(1)
      })
    })

    describe('custom variable names', () => {
      it('uses custom property variable name', () => {
        const target = createTarget()
        const bindings = [
          { pred: { value: PRED.prefLabel }, val: { value: 'Custom Label', 'xml:lang': 'en' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP, {
          propertyVar: 'pred',
          valueVar: 'val',
        })

        expect(target.prefLabels).toHaveLength(1)
        expect(target.prefLabels[0].value).toBe('Custom Label')
      })
    })

    describe('documentation properties', () => {
      it('handles definition property', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.definition }, value: { value: 'A formal definition', 'xml:lang': 'en' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.definitions).toHaveLength(1)
        expect(target.definitions[0].value).toBe('A formal definition')
      })

      it('handles scopeNote property', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.scopeNote }, value: { value: 'Use this for...', 'xml:lang': 'en' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.scopeNotes).toHaveLength(1)
        expect(target.scopeNotes[0].value).toBe('Use this for...')
      })

      it('handles multiple note types', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.historyNote }, value: { value: 'Historical context' } },
          { property: { value: PRED.changeNote }, value: { value: 'Changed in v2' } },
          { property: { value: PRED.editorialNote }, value: { value: 'Editor note' } },
          { property: { value: PRED.note }, value: { value: 'General note' } },
          { property: { value: PRED.example }, value: { value: 'Example usage' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.historyNotes).toHaveLength(1)
        expect(target.changeNotes).toHaveLength(1)
        expect(target.editorialNotes).toHaveLength(1)
        expect(target.notes).toHaveLength(1)
        expect(target.examples).toHaveLength(1)
      })

      it('handles rdfs:comment and dct:description', () => {
        const target = createTarget()
        const bindings: SparqlBinding[] = [
          { property: { value: PRED.comment }, value: { value: 'A comment', 'xml:lang': 'en' } },
          { property: { value: PRED.dctDescription }, value: { value: 'A description', 'xml:lang': 'en' } },
        ]

        processPropertyBindings(bindings, target, CONCEPT_PROPERTY_MAP)

        expect(target.comments).toHaveLength(1)
        expect(target.comments[0].value).toBe('A comment')
        expect(target.description).toHaveLength(1)
        expect(target.description[0].value).toBe('A description')
      })
    })
  })

  describe('CONCEPT_PROPERTY_MAP', () => {
    it('includes all expected label properties', () => {
      expect(CONCEPT_PROPERTY_MAP[PRED.prefLabel]).toBeDefined()
      expect(CONCEPT_PROPERTY_MAP[PRED.altLabel]).toBeDefined()
      expect(CONCEPT_PROPERTY_MAP[PRED.hiddenLabel]).toBeDefined()
      expect(CONCEPT_PROPERTY_MAP[PRED.label]).toBeDefined()
    })

    it('includes hierarchy properties', () => {
      expect(CONCEPT_PROPERTY_MAP[PRED.broader]).toBeDefined()
      expect(CONCEPT_PROPERTY_MAP[PRED.narrower]).toBeDefined()
      expect(CONCEPT_PROPERTY_MAP[PRED.related]).toBeDefined()
      expect(CONCEPT_PROPERTY_MAP[PRED.inScheme]).toBeDefined()
    })

    it('includes mapping properties', () => {
      expect(CONCEPT_PROPERTY_MAP[PRED.exactMatch]).toBeDefined()
      expect(CONCEPT_PROPERTY_MAP[PRED.closeMatch]).toBeDefined()
      expect(CONCEPT_PROPERTY_MAP[PRED.broadMatch]).toBeDefined()
      expect(CONCEPT_PROPERTY_MAP[PRED.narrowMatch]).toBeDefined()
      expect(CONCEPT_PROPERTY_MAP[PRED.relatedMatch]).toBeDefined()
    })

    it('includes metadata properties', () => {
      expect(CONCEPT_PROPERTY_MAP[PRED.dctCreated]).toBeDefined()
      expect(CONCEPT_PROPERTY_MAP[PRED.dctModified]).toBeDefined()
      expect(CONCEPT_PROPERTY_MAP[PRED.versionInfo]).toBeDefined()
    })
  })

  describe('SCHEME_PROPERTY_MAP', () => {
    it('includes label properties', () => {
      expect(SCHEME_PROPERTY_MAP[PRED.prefLabel]).toBeDefined()
      expect(SCHEME_PROPERTY_MAP[PRED.dctTitle]).toBeDefined()
    })

    it('includes deprecated property', () => {
      expect(SCHEME_PROPERTY_MAP[PRED.deprecated]).toBeDefined()
      expect(SCHEME_PROPERTY_MAP[PRED.deprecated].type).toBe('boolean')
    })

    it('does not include hierarchy properties', () => {
      expect(SCHEME_PROPERTY_MAP[PRED.broader]).toBeUndefined()
      expect(SCHEME_PROPERTY_MAP[PRED.narrower]).toBeUndefined()
    })
  })
})
