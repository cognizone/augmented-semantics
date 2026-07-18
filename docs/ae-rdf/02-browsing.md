---
outline: deep
---

# Browsing

Once you're connected, AE RDF gives you two ways into the data: **browse by type**, or **jump straight to a URI**. Everything is a live query against the endpoint.

## Types sidebar

The left sidebar lists the dataset's `rdf:type`s, most common first, with a **distinct-instance count** next to each. Click any navigable type — including embedded ones — to list its instances in the main pane. (Blank-node types — whose instances are anonymous nodes with no page — sit in the **Hidden** group and aren't clickable; you only ever see them inlined under a resource that uses them.)

It's a **tree**, not a flat list:

- **Subclasses tuck under their general type.** Where the data says one type is a kind of another (`rdfs:subClassOf`), it nests beneath it — e.g. `Result › ProjectPublication › JournalPaper` — indented, with a chevron to collapse/expand. (Only relationships the data actually states are nested; if the endpoint doesn't declare them, the list stays flat.)
- **Value objects nest under the class that uses them.** A type set to **Embed** (see the [Configuration Guide](configuration.md#per-type-configuration)) appears beneath the class that composes it — e.g. `PublicBody › Site › PostalAddress` — with a `{}` icon. The count next to a direct child is scoped to that class; for deeper ones, **hover** the row to fetch the exact path-scoped count.
- **Groups.** Types can be collected under a named, collapsible **group** header (e.g. an "Ontology" group for schema classes). Two groups are built in and sit at the bottom: **Embedded** (all value-object types, **expanded** by default) and **Hidden** (all hidden types, **collapsed** by default).

Pinned types float to the top; configured types show small indicator icons (pinned, embedded, label).

The **Types** header has a `{}` toggle to show or hide embedded types nested under their class (they always stay listed in the **Embedded** group either way). Drag the sidebar's right edge to resize it — the width is remembered.

Types can be **configured** — pinned, hidden, grouped, or rendered as embedded value objects / labels. That's curator work, done via a per-type gear in authoring mode; see the [Configuration Guide](configuration.md#per-type-configuration). Without authoring mode the sidebar is read-only, but the configured effects still apply.

::: tip Counts are distinct
Counts are the number of *distinct* subjects of that type. On large datasets the sidebar may take a few seconds to compute — that's the price of a correct count rather than an inflated one.
:::

## Instance list

Selecting a type shows a paged list of its instances (25 per page), each with its best available label (falling back to the URI). Use the pager at the bottom to move through pages. Click an instance to open it.

When a type configures [list columns](configuration.md#instance-list-columns), the list becomes a compact **table** — the name plus a column per configured property (e.g. a Project's acronym, status, start/end, total cost), each filled in just after the rows appear. Click any row to open it.

### Filtering the list

A **filter box** sits above the list — type to narrow it to instances whose **name or URI** contains what you type. It matches the same label fields AE RDF uses to name things (a type's configured **label** fields if set, otherwise the usual `rdfs:label` / `skos:prefLabel` / `dcterms:title` / `foaf:name` family), plus the URI itself — so you can find a resource by a word in its title *or* by a fragment of its identifier.

- The filter runs against the **whole type on the server**, not just the current page — so it finds matches on page 40 without you paging there. The instance count updates to the filtered total.
- It's **debounced** — AE RDF waits until you pause typing before querying, so a fast typist doesn't fire a query per keystroke.
- Press **Esc** or the **✕** to clear it. The box stays visible as you switch types, so a filter is never a hidden constraint.

::: tip Custom search fields
A type can pin exactly which predicates the filter searches via its **search** fields in the [config](configuration.md#per-type-configuration) — useful when the default label fields aren't what you want to match on.
:::

### Facets

When a type has facets configured, the sidebar's header gains a **Filters** tab next to **Types** — switch to it for a full-height panel of clickable **facets** over chosen properties. A *value* facet lists a property's most common values (each with a count); a *range* facet offers numeric bands (e.g. total cost). Click a value or band to narrow the list; click again to deselect. You can pick several values in one facet (matches **any** of them) and combine facets (matches **all** of them). Each facet's counts update to show what you'd get by adding it, and the instance count tracks the filtered total. Use **Clear filters** to reset. Your selections are kept in the URL (`?filters=…`), so a filtered list is **bookmarkable and shareable** — and back/forward step through them.

### Open in SPARQL

Above the instance list, a **SPARQL** button hands the current list — with its type, graph scope, text filter, and every active facet applied — to the **SPARQL panel** as the exact query behind it. Use it to see how the filtered view is built, then refine it by hand.

The **Filters** tab is greyed out for types with no facets, and shows a small **count badge** when filters are active — so you can see from the **Types** side that a filter is narrowing the list. Selecting a type never yanks you off the tab you're on; switching to a type with no facets simply drops you back to **Types**. Which types have facets — and over which properties — is set by the curator in the [config](configuration.md#facets).

### Unreferenced instances (orphans)

For a **value-object type** (one set to **Embed** with an owning predicate — e.g. a `PostalAddress` reached via `hasAddress`), an **Unreferenced** toggle appears. Turn it on to list just the instances that *no* resource points at through that predicate — the dangling value objects with no owner. It's off by default and resets when you switch types.

## The resource view

### Opening a resource URI

Paste a resource URI in the top bar and press **Go** to inspect it. If the URI belongs to a *different* configured dataset (matched against each endpoint's [`resourceNamespaces`](configuration.md#endpoint-configuration-file)), the app **switches to that endpoint automatically** and opens the resource there — a brief "Switched to …" note confirms the change. For example, pasting a `https://energy.ld.admin.ch/…` URI while on CORDIS switches to LINDAS and loads it. Deep links (a shared `?resource=` URL) switch the same way.

Opening an instance — or pasting a URI in the top bar and pressing **Go** — shows the resource:

- **Header** — the resource's label (or local name if it has none), its full URI (click it to dereference — opens in a new tab) with a copy <img src="./icons/icon-copy.svg" height="14"> button next to it, plus its **type chips** and a [graph summary](03-graphs.md).
- **Type chips** — the resource's `rdf:type`s, lifted out of the property list. Click a chip to browse all instances of that type.
- **Attributes** — properties whose values are literals (dates, statuses, text), shown with language and datatype tags.
- **Relationships** — properties whose values are other resources. These are **clickable links** <img src="./icons/icon-link.svg" height="14"> — click to walk to that resource. Each link carries a small **type badge** showing the *most specific* type (e.g. `[JournalPaper]`, not the generic `[Result]`) so you can see exactly *what* it points at. Value-object types set to **Embed** (in the [Types gear](#types-sidebar)) show their properties inline instead of a link — e.g. a monetary amount renders as `value 1902.6 · currency EUR` in place, nested as deep as the data goes.

A property with a huge number of values (say a funding scheme linking thousands of grants) starts collapsed to a count with a **Show first 100** link, so the page stays manageable. Once expanded, a **filter box** appears above the values — type to narrow the list by name or URI (matched against every value, not just the 100 shown, since they're all already loaded). The status line reports how many match; **Esc** or the **✕** clears it.

### Referenced by (incoming links)

Relationships above point *outward*. To see what points **at** this resource — which grants fund it, which organisations are involved, which results it produced — expand the **Referenced by** section at the bottom. It loads on demand (incoming links can be huge), shows how many resources reference this one, and lists them grouped by predicate with an inbound **↤** marker. A URI referrer is a clickable link, so you can walk the graph *backwards* too; a **blank-node referrer** (e.g. an `owl:Restriction` that points here via `owl:onProperty`) has no page of its own, so its own properties are **inlined** in place — `onProperty … someValuesFrom Class` — rather than shown as a bare anonymous id. Very heavily-referenced resources show the first 1,000.

Within each section, properties are ordered by usefulness: labels and identifiers first, then dates, status, and the rest. Predicate names are humanized for readability (`dateEndApplicability` → "Date end applicability") — hover a predicate to see its real qname/URI.

### Readable values

Where a related resource has its own label, AE RDF shows it instead of an opaque code — so `MENV` reads as its full name when the endpoint provides one. A resource with **no** label shows its `prefix:LocalName` (distinct) plus a type badge, so several unlabeled links stay distinguishable. Objects under a predicate are sorted by their display text.

Prefer raw URIs or prefixed qnames? Switch the **URI display** mode in [Settings](index.md#settings) — *Humanized names* (default), *Prefixed* (`skos:Concept`), or *Full URI*. It applies to predicates, links, and type names.

### Rich values (media, DOIs, geometry)

AE RDF recognises what certain values *are* and shows them richly, not just as links:

- **Media files** — a value (or a viewed resource) whose URL is an image, video, or audio file renders **inline**: images as a thumbnail (click to open full size in a new tab), video/audio with player controls. Detected by file extension, `http(s)` only.
- **DOIs** — a DOI in any form (a `doi.org` URL, `doi:10.…`, or a bare `10.…/…` literal) gets a blue **DOI ↗** badge linking to the resolver. With the **DOI citations** [setting](index.md#settings) on, an inline **citation card** appears as the value scrolls into view — authors, year, title, publisher, subject categories, a truncated abstract, and a landing-page link — fetched from doi.org on demand and cached. If a registrar has no metadata, the badge simply stays a link. Deployers can toggle individual card fields via the [`doi` config section](configuration.md#appjson-reference).
- **Geometry (WKT)** — a `geo:wktLiteral` value gets a green **map ↗** badge opening the location on OpenStreetMap. With the **Geometry maps** [setting](index.md#settings) on, an **embedded map** renders the point/line/polygon itself — swisstopo basemap for Swiss coordinates, OpenStreetMap elsewhere, switchable in the map's corner. Only WGS84 (longitude/latitude) coordinates are mapped; projected coordinates (e.g. Swiss LV95) show the raw value, never a wrong pin.

The two features that call external services — DOI citations and geometry maps — are **off by default** and fetch lazily (only what you actually scroll to), so browsing stays private and light unless you opt in.

## Walking links & deep-linking

Clicking a relationship value opens that resource; the active endpoint, type, and resource you're viewing are all kept in the URL (`?endpoint=…`, `?type=…`, `?resource=…`). The **endpoint** appears as a short readable slug (e.g. `?endpoint=cordis-datalab`), so a shared link opens on the right dataset — not whatever the recipient last had selected. That means **browser back/forward work** (including across endpoints), and you can **bookmark or share** any view — opening the link restores exactly what you were looking at. Switching endpoints from the dropdown updates the slug and clears the previous dataset's type/resource (they don't exist in the new one). *(A single-endpoint deployment omits the param — there's nothing to disambiguate.)*

---

*Next: [Graphs](03-graphs.md) →*
