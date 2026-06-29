---
outline: deep
---

# Browsing

Once you're connected, AE RDF gives you two ways into the data: **browse by type**, or **jump straight to a URI**. Everything is a live query against the endpoint.

## Types sidebar

The left sidebar lists the dataset's `rdf:type`s, most common first, with a **distinct-instance count** next to each. Click any type — including embedded ones — to list its instances in the main pane.

It's a **tree**, not a flat list:

- **Subclasses tuck under their general type.** Where the data says one type is a kind of another (`rdfs:subClassOf`), it nests beneath it — e.g. `Result › ProjectPublication › JournalPaper` — indented, with a chevron to collapse/expand. (Only relationships the data actually states are nested; if the endpoint doesn't declare them, the list stays flat.)
- **Value objects nest under the class that uses them.** A type set to **Embed** (see below) appears beneath the class that composes it — e.g. `PublicBody › Site › PostalAddress` — with a `{}` icon. The count next to a direct child is scoped to that class; for deeper ones, **hover** the row to fetch the exact path-scoped count.
- **Groups.** Types can be collected under a named, collapsible **group** header (e.g. an "Ontology" group for schema classes). Two groups are built in and sit at the bottom, collapsed: **Embedded** (all value-object types) and **Hidden** (all hidden types).

Pinned types float to the top; configured types show small indicator icons (pinned, embedded, label).

Turn on **Config authoring mode** in [Settings](index.md#settings) to reveal a per-type **gear**:

- **Pin** to the top, or **Hide** (hidden types move into the **Hidden** group, where you can unhide them).
- **Render as object** — how it shows when it's a *value* of another resource: **Link** (default), **Embed** (inline its properties — for value objects like amounts, addresses, coordinates), or **Label only**.
- **Group** — assign to an existing group, create a new one, or remove.

Without authoring mode the sidebar is read-only, but the configured effects still apply. The gear and **Export** stay available even when running a deployed config, so you can tweak and re-export.

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
- **Relationships** — properties whose values are other resources. These are **clickable links** <img src="./icons/icon-link.svg" height="14"> — click to walk to that resource. Each link carries a small **type badge** showing the *most specific* type (e.g. `[JournalPaper]`, not the generic `[Result]`) so you can see exactly *what* it points at. Value-object types set to **Embed** (in the [Types gear](#types-sidebar)) show their properties inline instead of a link — e.g. a monetary amount renders as `value 1902.6 · currency EUR` in place, nested as deep as the data goes.

A property with a huge number of values (say a hub node linking thousands of others) shows the first **100** with a *Show all / Show fewer* toggle, so the page stays manageable.

Within each section, properties are ordered by usefulness: labels and identifiers first, then dates, status, and the rest. Predicate names are humanized for readability (`dateEndApplicability` → "Date end applicability") — hover a predicate to see its real qname/URI.

### Readable values

Where a related resource has its own label, AE RDF shows it instead of an opaque code — so `MENV` reads as its full name when the endpoint provides one. A resource with **no** label shows its `prefix:LocalName` (distinct) plus a type badge, so several unlabeled links stay distinguishable. Objects under a predicate are sorted by their display text.

Prefer raw URIs or prefixed qnames? Switch the **URI display** mode in [Settings](index.md#settings) — *Humanized names* (default), *Prefixed* (`skos:Concept`), or *Full URI*. It applies to predicates, links, and type names.

## Walking links & deep-linking

Clicking a relationship value opens that resource; the type and resource you're viewing are kept in the URL (`?type=…`, `?resource=…`). That means **browser back/forward work**, and you can **bookmark or share** any resource view — opening the link restores exactly what you were looking at.

---

*Next: [Graphs](03-graphs.md) →*
