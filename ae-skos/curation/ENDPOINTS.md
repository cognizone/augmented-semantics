# SPARQL Endpoints Status

## Working Endpoints

| Endpoint | URL | Concepts | Schemes | Notes |
|----------|-----|----------|---------|-------|
| AgroPortal | https://sparql.agroportal.lirmm.fr/sparql | 1M+ | 194 | Agronomy ontology repository |
| AGROVOC | https://agrovoc.fao.org/sparql | 44k+ | 1 | FAO agricultural vocabulary |
| BnF | https://data.bnf.fr/sparql | 21M+ | 1 | Bibliothèque nationale de France |
| Cordis Datalab | https://cordis.europa.eu/datalab/sparql | 208k | 2 | EU research projects |
| data.europa.eu | https://data.europa.eu/sparql | 26k | 179 | EU open data portal (custom curation) |
| DBpedia | https://dbpedia.org/sparql | 2.5M | 0 | Wikipedia structured data |
| ERA Data Interop | https://data-interop.era.europa.eu/api/sparql | 3k | 3 | EU railway agency |
| EU Publications Office | https://publications.europa.eu/webapi/rdf/sparql | 129k | 79 | EU official publications |
| Fedlex | https://fedlex.data.admin.ch/sparql | 3k | 3 | Swiss federal law |
| Finto | https://api.finto.fi/sparql | 892k | 102 | Finnish thesauri and ontologies |
| Getty Vocabularies | http://vocab.getty.edu/sparql | 3.4M+ | 9 | AAT, TGN, ULAN (custom curation) |
| Legilux | https://data.legilux.public.lu/sparql | 2k | 9 | Luxembourg legislation |
| Linked Open Vocabularies | https://lov.linkeddata.es/dataset/lov/sparql | 5k | 200+ | Vocabulary registry |
| NERC Vocabulary Server | https://vocab.nerc.ac.uk/sparql/ | 362k | 22 | Oceanography vocabularies |
| STW Economics | https://zbw.eu/beta/sparql/stw/query | 8k | 1 | Economics thesaurus (ZBW) |
| UNESCO Thesaurus | https://vocabularies.unesco.org/sparql | - | 1 | Education, culture, sciences (GET only) |

## Failed Endpoints

| Endpoint | URL | Status | Reason | Tested |
|----------|-----|--------|--------|--------|
| Library of Congress | http://id.loc.gov/sparql.php | 404 | Endpoint not found | 2026-01-17 |
| Library of Congress (https) | https://id.loc.gov/sparql.php | 403 | Access forbidden | 2026-01-17 |
| UNESCO Thesaurus (http) | http://vocabularies.unesco.org/sparql | 200 | Needs HTTPS + GET (now working) | 2026-01-17 |
| GEMET | https://www.eionet.europa.eu/gemet/sparql | 400 | Not a SPARQL endpoint | 2026-01-17 |
| STW Economics (http) | http://zbw.eu/beta/sparql/stw/query | 301 | Redirects to HTTPS (now working) | 2026-01-17 |
| TheSoz | http://lod.gesis.org/thesoz/sparql | 200 | Returns HTML, not SPARQL | 2026-01-17 |
| GND (DNB) | https://d-nb.info/sparql | 404 | Endpoint not found | 2026-01-17 |
| BARTOC | https://bartoc.org/sparql | 404 | No SPARQL endpoint | 2026-01-17 |
| Europeana | https://sparql.europeana.eu/ | 406 | Not acceptable | 2026-01-17 |
| OpenLink LOD | http://lod.openlinksw.com/sparql | - | Timeout | 2026-01-17 |
| Bioportal | http://sparql.bioontology.org/sparql | - | Timeout | 2026-01-17 |
| Norwegian National Library | https://data.nb.no/sparql | - | Connection failed | 2026-01-17 |
| Periodo | https://data.perio.do/sparql | 404 | Not found | 2026-01-17 |
| Pleiades | https://pleiades.stoa.org/sparql | 404 | Not found | 2026-01-17 |
| British Museum | https://collection.britishmuseum.org/sparql | - | Connection failed | 2026-01-17 |
| ChEMBL | https://www.ebi.ac.uk/rdf/services/sparql | 404 | Not found | 2026-01-17 |
| Swedish National Data | https://www.dataportal.se/sparql | 405 | Method not allowed | 2026-01-17 |
| Italian Open Data | https://dati.gov.it/sparql | 404 | Not found | 2026-01-17 |
| REEGLE | http://sparql.reegle.info/ | 405 | Method not allowed | 2026-01-17 |
| FINTO (http) | http://api.finto.fi/sparql | 301 | Redirects to HTTPS (now working) | 2026-01-17 |
| OpenAIRE | https://graph.openaire.eu/sparql | 404 | Not found | 2026-01-17 |
| Isidore | https://isidore.science/sparql | 404 | Not found | 2026-01-17 |
| AgroPortal (http) | http://sparql.agroportal.lirmm.fr/sparql | 301 | Redirects to HTTPS (now working) | 2026-01-17 |
| BioPortal (data) | https://data.bioontology.org/sparql | 401 | Auth required | 2026-01-17 |

## Endpoints Without SKOS Content

| Endpoint | URL | Notes | Tested |
|----------|-----|-------|--------|
| Wikidata | https://query.wikidata.org/sparql | No skos:Concept types | 2026-01-17 |
| LinkedGeoData | http://linkedgeodata.org/sparql | Geographic data, no SKOS | 2026-01-17 |
| YAGO | https://yago-knowledge.org/sparql/query | Knowledge graph, no SKOS | 2026-01-17 |
| UK Parliament | https://api.parliament.uk/sparql | Parliamentary data, no SKOS | 2026-01-17 |
| Dutch National Library | http://data.bibliotheken.nl/sparql | Library data, no SKOS | 2026-01-17 |
| UniProt | https://sparql.uniprot.org/sparql | Protein data, no SKOS | 2026-01-17 |

## Candidates to Investigate

- OCLC/VIAF - Need to find correct SPARQL endpoint
- GeoNames - http://sws.geonames.org/sparql/ (needs testing)
- ESCO (EU Skills) - Only downloadable, no SPARQL
- EuroVoc - Might be accessible via EU Publications Office

## Notes

- Some endpoints require specific Accept headers or query formats
- Getty requires query trimming (no leading whitespace) and uses XML responses
- data.europa.eu requires custom curation to filter DCAT graphs
- Large endpoints (Getty, BnF) may timeout on language detection queries
- Some endpoints only accept GET requests (UNESCO, FINTO, STW) - auto-detected via HTML response
- HTTP endpoints often redirect to HTTPS - use HTTPS URLs
