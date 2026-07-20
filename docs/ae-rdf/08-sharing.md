---
outline: deep
---

# Shareable URLs & deep-linking

Every view in AE RDF is a URL. Where you are — the endpoint, the type you're listing, the resource you're viewing, and any active filters — all live in the address bar, so any view is **bookmarkable, shareable, and reachable with browser back/forward**.

## What's in the URL

Clicking a relationship value opens that resource; the active endpoint, type, and resource you're viewing are all kept in the URL (`?endpoint=…`, `?type=…`, `?resource=…`). The **endpoint** appears as a short readable slug (e.g. `?endpoint=cordis-datalab`), so a shared link opens on the right dataset — not whatever the recipient last had selected. That means **browser back/forward work** (including across endpoints), and you can **bookmark or share** any view — opening the link restores exactly what you were looking at. Switching endpoints from the dropdown updates the slug and clears the previous dataset's type/resource (they don't exist in the new one). *(A single-endpoint deployment omits the param — there's nothing to disambiguate.)*

Active [facet](04-facets.md) selections are kept in the URL too (`?filters=…`), so a **filtered** list is shareable and steps through back/forward like everything else.

## Auto-switch across datasets

Because the endpoint is in the URL and each endpoint declares which resource namespaces it serves, opening a resource URI that belongs to a *different* configured dataset **switches to that endpoint automatically**, whether you paste it in the top bar or follow a shared `?resource=` link. See [Opening a resource URI](03-resource-view.md#opening-a-resource-uri) for the details.
