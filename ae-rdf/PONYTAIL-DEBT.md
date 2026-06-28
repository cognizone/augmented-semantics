# Ponytail Debt — AE RDF

Deliberate shortcuts marked with `ponytail:` comments, collected so a deferral
can't quietly become permanent. Regenerate with `/ponytail-debt`.

## Markers

### services/rdfQueries.ts
- **`:64`** — discovery queries scope to named graphs on `named` endpoints, no default-graph union.
  - ceiling: misses triples that live *only* in a separate default graph.
  - upgrade: when a real endpoint needs that completeness → the parked endpoint-profiler.
- **`:147`** — no detection of default-graph semantics (union / separate / empty).
  - ceiling: the `NOT EXISTS` branch always runs.
  - upgrade: detect union-default to drop the branch *if* resource-query perf matters.

### src/style.css
- **`:5`** — PrimeVue overrides copied (trimmed) from ae-skos.
  - ceiling: duplicated CSS across 2 apps.
  - upgrade: extract to `@ae/styles` when a 3rd consumer lands.

### types/events.ts
- **`:5`** — only `endpoint:changed` event declared.
  - ceiling: no browse events.
  - upgrade: add `type:` / `resource:` events if a consumer needs them.

### App.vue
- **`:7`** — trimmed copy of the ae-skos App shell. `no-trigger` (provenance note).

### components/common/EndpointManager.vue
- **`:10`** — compact manager instead of the SKOS analysis wizard. `no-trigger` (justification).

### router/index.ts
- **`:10`** — single-route pattern lifted from ae-skos. `no-trigger` (provenance note).

**7 markers, 3 with no trigger.**

## Resolved
- `stores/settings.ts` — pruned the dead SKOS-only settings; the store now holds
  only `darkMode` + `uriDisplay` (trigger fired: AE RDF has its own settings UI).

## Related (not a `ponytail:` comment)

The largest deferral lives in `ae-rdf/PLAN.md`: the **copy-first vs `@ae/core`**
decision — the endpoint store, SPARQL service, error types, and EndpointManager
are duplicated (trimmed) from ae-skos rather than extracted to a shared package.
- upgrade: extract to `@ae/core` when AE OWL becomes the 3rd consumer, or when a
  fix first has to be applied in two places.
