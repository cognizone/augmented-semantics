---
outline: deep
---

# Managing Endpoints

AE RDF talks directly to SPARQL endpoints from your browser. On a **deployed instance** the available endpoints come from the app's bundled configuration (`config/app.json`) — pick one and connect. Adding, editing, and testing endpoints is part of the **standalone / authoring** build, where you assemble the config you then export and deploy.

> **Deployed vs. authoring** — A deployed AE RDF runs in **config mode**: its endpoint list is fixed by `config/app.json`. The add / edit / delete controls below don't persist there (a custom URL you type lasts only for the current session), and each tool ships its own config — so endpoints are **not** shared between AE SKOS and AE RDF. To change the shipped endpoints, edit the config and redeploy (see [Exporting a deployment config](configuration.md#exporting-a-deployment-config)). The rest of this page describes the full manager as it works in the standalone / authoring build.

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

Credentials are **never saved** — leave them blank and AE RDF asks for them when it connects, holding them in memory for that session only. They're sent only to the endpoint, with each query.

### Graph behaviour (authoring mode)

With authoring mode on, the edit form gains a **Graph behaviour** section — see
the [Configuration Guide](configuration.md#graph-behaviour) and [Graphs](06-graphs.md).

### Test before saving

Click **Test** to run a tiny `SELECT … LIMIT 1` against the endpoint. You'll get a green success (with response time) or a clear error — most often a [CORS](09-troubleshooting.md#cors-the-endpoint-wont-load) or authentication problem. Then **Save**.

## Switching endpoints

Click the endpoint badge in the header to switch between saved endpoints. Switching reloads the [Types](02-browsing.md) sidebar for the newly selected endpoint.

---

*Next: [Browsing](02-browsing.md) →*
