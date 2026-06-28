---
outline: deep
---

# Troubleshooting

## CORS: the endpoint won't load

The most common issue. AE RDF runs **in your browser**, so the endpoint must send
CORS headers (`Access-Control-Allow-Origin`) permitting browser access. If it
doesn't, queries fail with a **CORS** error and the Types sidebar stays empty.

- A successful **Test** in the [Endpoint Manager](01-endpoints.md#test-before-saving) (or a populated Types sidebar) means CORS is fine.
- If it fails: the endpoint owner needs to enable CORS, or you need to reach it through a CORS-enabled proxy. This isn't something AE RDF can work around from the browser.

## The Types sidebar is empty

- **CORS / connection** — see above; check the browser console (F12) for a `CORS_BLOCKED` or network error.
- **Authentication** — a protected endpoint needs credentials set on the endpoint ([Authentication](01-endpoints.md#authentication)).
- **Data only in a separate default graph** — on a graph-using endpoint whose
  data sits only in the default graph, the type list can come up short. Try
  opening a known resource by URI in the top bar; if it shows triples, the data
  is reachable even when the list isn't. See [Graphs](03-graphs.md#how-it-works-and-its-limits).

## "No outgoing triples for this resource"

The URI you opened genuinely has no statements *about* it at this endpoint. Common causes:

- A typo or a non-existent URI (check the exact spelling, including any trailing segment).
- The resource is only referenced *by* others (incoming links) but has no outgoing triples — an incoming-link view is planned but not in this version.

## The sidebar is slow

Computing **distinct** instance counts across a large dataset can take a few
seconds. The count is correct (not inflated by graph duplication); a spinner
shows while it runs. Instance pages and resource views are fast.

## Values show as codes, not names

A related resource only shows a human label when the endpoint provides one
(`rdfs:label`, `skos:prefLabel`, `dct:title`, …). Resources without any label
keep showing their `prefix:LocalName`. This is endpoint data, not a bug.

## Diagnostics

In development builds, open the browser console (F12) and run `__logger.dump()`
to see recent query activity, including failures and timings.

---

*Back to [Overview](index.md).*
