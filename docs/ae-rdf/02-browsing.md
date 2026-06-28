---
outline: deep
---

# Browsing

Once you're connected, AE RDF gives you two ways into the data: **browse by type**, or **jump straight to a URI**. Everything is a live query against the endpoint.

## Types sidebar

The left sidebar lists every `rdf:type` in the dataset, most common first, with a **distinct-instance count** next to each. Names are shown as `prefix:LocalName` where the prefix is known (e.g. `skos:Concept`), otherwise the local name.

Click a type to list its instances in the main pane. Hover a type for a **gear** to configure it: **pin** it to the top, **hide** it from the list (a "show N hidden" toggle brings hidden types back), or set how it renders when it's a *value* of another resource — **Link** (default), **Embed** (inline its properties — for value objects like amounts and coordinates), or **Label only**.

::: tip Counts are distinct
Counts are the number of *distinct* subjects of that type. On large datasets the sidebar may take a few seconds to compute — that's the price of a correct count rather than an inflated one.
:::

## Instance list

Selecting a type shows a paged list of its instances (100 per page), each with its best available label (falling back to the URI). Use the pager at the bottom to move through pages. Click an instance to open it.

## The resource view

Opening an instance — or pasting a URI in the top bar and pressing **Go** — shows the resource:

- **Header** — the resource's label (or local name if it has none), its full URI with a copy <img src="./icons/icon-copy.svg" height="14"> button and an external-link <img src="./icons/icon-open-in-new.svg" height="14"> to dereference it, plus its **type chips** and a [graph summary](03-graphs.md).
- **Type chips** — the resource's `rdf:type`s, lifted out of the property list. Click a chip to browse all instances of that type.
- **Attributes** — properties whose values are literals (dates, statuses, text), shown with language and datatype tags.
- **Relationships** — properties whose values are other resources. These are **clickable links** <img src="./icons/icon-link.svg" height="14"> — click to walk to that resource. Each link carries a small **type badge** (e.g. `Conservation of… [Project]`) so you can see *what* it points at. Value-object types set to **Embed** (in the [Types gear](#types-sidebar)) show their properties inline instead of a link — e.g. a monetary amount renders as `value 1902.6 · currency EUR` in place.

Within each section, properties are ordered by usefulness: labels and identifiers first, then dates, status, and the rest. Predicate names are humanized for readability (`dateEndApplicability` → "Date end applicability") — hover a predicate to see its real qname/URI.

### Readable values

Where a related resource has its own label, AE RDF shows it instead of an opaque code — so `MENV` reads as its full name when the endpoint provides one. A resource with **no** label shows its `prefix:LocalName` (distinct) plus a type badge, so several unlabeled links stay distinguishable. Objects under a predicate are sorted by their display text.

Prefer raw URIs or prefixed qnames? Switch the **URI display** mode in [Settings](index.md#settings) — *Humanized names* (default), *Prefixed* (`skos:Concept`), or *Full URI*. It applies to predicates, links, and type names.

## Walking links & deep-linking

Clicking a relationship value opens that resource; the type and resource you're viewing are kept in the URL (`?type=…`, `?resource=…`). That means **browser back/forward work**, and you can **bookmark or share** any resource view — opening the link restores exactly what you were looking at.

---

*Next: [Graphs](03-graphs.md) →*
