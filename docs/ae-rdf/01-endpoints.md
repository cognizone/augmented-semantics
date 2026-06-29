---
outline: deep
---

# Managing Endpoints

AE RDF talks directly to SPARQL endpoints from your browser. Endpoints you add are saved locally and **shared across the Augmented Semantics tools** — an endpoint added in AE SKOS shows up here, and vice versa (they use the same browser storage).

## The Endpoint Manager

Open it from the endpoint badge in the header → **Manage endpoints…**. From here you can add, edit, test, select, and remove endpoints.

- **Suggested endpoints** — curated public endpoints appear as one-click entries. Click one to add and connect to it immediately.
- **Add endpoint** — opens a small form for a custom endpoint (see below).
- Each saved endpoint shows a status dot (green = currently selected) and **edit** / **delete** actions. Delete asks for a quick confirm.

Selecting an endpoint connects to it and loads its [type inventory](02-browsing.md).

## Adding a custom endpoint

The form needs just two things:

| Field | Notes |
|-------|-------|
| **Name** | A label for your own reference. |
| **SPARQL endpoint URL** | The full query URL, e.g. `https://example.org/sparql`. |

A warning appears if the URL is plain `http://` (your queries could be intercepted) — fine for `localhost`, risky for public endpoints.

### Authentication

If the endpoint is protected, choose an **Authentication** type:

| Type | Fields |
|------|--------|
| None | — (default) |
| Basic | Username + password |
| API key | Header name + key |
| Bearer token | Token |

Credentials are sent with each query and kept in your browser only.

### Graph behaviour (authoring mode)

With [Config authoring mode](index.md#settings) on, the edit form gains a **Graph
behaviour** section: whether the endpoint uses **named graphs (quads)** and what
its **default (no-`GRAPH`) view** is — *Own* triples or a *Merged* view of the
quads. Leave both **Auto** unless you know the endpoint; see [Graphs](03-graphs.md).
It's saved with the endpoint and exported in `app.json`.

### Test before saving

Click **Test** to run a tiny `SELECT … LIMIT 1` against the endpoint. You'll get a green success (with response time) or a clear error — most often a [CORS](04-troubleshooting.md#cors-the-endpoint-wont-load) or authentication problem. Then **Save**.

## Switching endpoints

Click the endpoint badge in the header to switch between saved endpoints. Switching reloads the [Types](02-browsing.md) sidebar for the newly selected endpoint.

---

*Next: [Browsing](02-browsing.md) →*
