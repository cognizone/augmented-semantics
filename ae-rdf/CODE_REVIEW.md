# AE RDF — Code Review Tracker

Whole-codebase review of `ae-rdf/src` (62 files, ~10k lines) — **2026-07-02**.

**Method:** 17 per-subsystem finders + 3 cross-cutting finders → 95 candidates → independent adversarial per-`(file,line)` verifier → ranked, capped synthesis. 95 verified, 6 refuted; the 25 highest-severity correctness bugs are tracked below (the ~54-item cleanup tail and ~10 lower-ranked correctness items were cut by the report cap — see [Not yet tracked](#not-yet-tracked)).

**Verdict legend:** `CONFIRMED` = trigger + wrong output nameable from the code. `PLAUSIBLE` = mechanism real, trigger depends on runtime/env.

Check a box when the issue is fixed.

---

## 🔴 Security

- [ ] **R01 · `src/components/rdf/ResourceView.vue:203`** (also `views/RdfView.vue:51`, `App.vue:165`) — `CONFIRMED`
  Untrusted `?resource` deep-link param is bound into `<a :href="uri">` with no protocol validation. `sanitizeIri` only gates the SPARQL query, never this DOM sink → a `#/?resource=javascript:…` link is a **reflected XSS** executing in the app origin (holds endpoint creds in memory/localStorage).

- [ ] **R02 · `src/services/sparql.ts:76`** — `CONFIRMED`
  `getAuthHeaders` injects the API key under a header name taken verbatim from `credentials.headerName` with no validation. A CRLF/illegal name makes the `Headers` constructor throw a `TypeError`, which the catch at `:367` **misclassifies as a retriable NETWORK_ERROR** → burns 3 retries, real misconfig never surfaces.

- [ ] **R03 · `src/services/sparql.ts:288`** — `PLAUSIBLE`
  `fetch` uses default `redirect:'follow'`. A cross-origin 3xx redirect **re-sends app-set custom headers** (e.g. `X-API-Key`) to the redirect target per the Fetch spec (`Authorization` is stripped, custom headers are not) → API key leaked. No `redirect:'error'`/manual guard in `executeSparql` or `fetchRawRdf`.

## 🟠 Silent data corruption / config integrity

- [ ] **R04 · `src/components/rdf/ResourceView.vue:116`** — `CONFIRMED`
  `onReorder` rebuilds the persisted `order` from only the predicates present on the current instance; `typeConfig.set` replaces the whole array. Dragging on a **sparse instance permanently erases** configured predicates it lacks — for every instance of that type.

- [ ] **R05 · `src/stores/endpoint.ts:218`** — `CONFIRMED`
  `updateEndpoint` has no config-mode guard (unlike `add`/`remove`). Selecting a config endpoint (updates `lastAccessedAt`/`accessCount` → `saveToStorage`) **writes `config-*` endpoints into `ae-endpoints` localStorage** → ghost endpoints if the config is later absent or fails to load.

- [ ] **R06 · `src/stores/endpoint.ts:227`** — `CONFIRMED`
  `auth: updates.auth ?? existing.auth` ignores `auth:undefined`. Switching an endpoint to "None" is silently dropped → **can't remove auth**; app keeps sending old credentials. Needs the `'auth' in updates` reset pattern used for `graph` two lines above.

- [ ] **R07 · `src/components/common/CredentialsPrompt.vue:29`** — `CONFIRMED`
  Store strips the entire `credentials` object (incl. the non-secret `headerName`) in `saveToStorage`. After reload the prompt falls back to `'X-API-Key'` → API key sent under the **wrong header**, auth fails with no indication the name was reset.

- [ ] **R08 · `src/services/config.ts:152`** — `CONFIRMED`
  Slug-resolved endpoint files are cast to `ConfigEndpoint` with **no validation** (`validateConfig` only ran on the inline manifest at `:82`). A slug file missing `url` maps to `{url: undefined}` and reaches `fetch` → confusing 404/parse error instead of a clear validation message.

- [ ] **R09 · `src/services/config.ts:89`** — `CONFIRMED`
  If every configured endpoint is a slug and all slug files fail to load, `config.endpoints === []` → `hasConfigEndpoints` false → `configMode` false → a **"locked" deployment silently reverts** to the full user-managed endpoint manager.

## 🟠 Stale data across navigation

- [ ] **R10 · `src/composables/useIncomingRelations.ts:39`** — `CONFIRMED`
  `reset()` bumps `countReqId` but **not `requestId`**, so an in-flight `load()` for the previous resource is never invalidated. Navigating A→B before A's list query returns makes `isCurrent()` still true → B's "Referenced by" **paints resource A's relations and count**, never querying B.

- [ ] **R11 · `src/components/rdf/ResourceView.vue:61`** — `CONFIRMED`
  The always-rendered header reads `label`/`types`/`triples`, cleared only *after* the new load resolves. During navigation the header shows the **previous resource's title, type chips, and graph chips** next to the new URI (seconds on slow Virtuoso); clicking a stale type chip navigates to the **wrong type**. Violates graph-provenance-is-core mid-load.

- [ ] **R12 · `src/components/rdf/PropertyTable.vue:229`** — `CONFIRMED`
  `expanded` Set / `rowsExpanded` never reset on `props.groups` change, and the top-level tables (`ResourceView.vue:239/244`) aren't `:key`ed by URI → Vue reuses the instance and **resource B renders A's rows already expanded** (materializes up to 100 rows unasked).

- [ ] **R13 · `src/composables/useInstanceList.ts:130`** — `CONFIRMED`
  The graph-change watcher reloads but **never resets `page`** → `OFFSET` lands past the smaller new result set → empty "No instances of this type" even though instances exist in the new scope.

## 🟡 Label / rendering correctness

- [ ] **R14 · `src/services/rdfQueries.ts:278`** — `CONFIRMED`
  `buildLabelsQuery` collapses all 6 label predicates into one `?lbl` via `VALUES` + `SAMPLE`, **discarding `LABEL_PREDICATES` precedence** → picks the wrong label (e.g. `dc:title` "DOC-123" over `rdfs:label` "Annual Report"), nondeterministically. Fix: per-predicate `COALESCE` like `buildInstanceListQuery`.

- [ ] **R15 · `src/services/rdfQueries.ts:136`** — `CONFIRMED`
  `buildInstanceListQuery` resolves labels from only 3 of 6 `LABEL_PREDICATES` (`SAMPLE`, no SKOS-XL, arbitrary language) → the **instance list label differs from the detail-heading label** for the same resource (e.g. `foaf:name`/`schema:name`-only resources fall back to the raw URI).

- [ ] **R16 · `src/composables/useResourceView.ts:81`** — `CONFIRMED`
  Heading `groupValue` picks `objects[0]` arbitrarily and falls back to `localNameOf` for a URI-valued label field, diverging from `composeLabels` (which language-picks and drops unlabeled URIs) → the **same resource shows two different composed labels** in heading vs link/embed.

- [ ] **R17 · `src/composables/composeLabels.ts:103`** — `CONFIRMED`
  `resolve()` keeps any URI target where `labelMap.has(x.v)`, so a referent with only an **opaque raw `rdfs:label` (e.g. a UUID)** and no composed type gets joined into the parent's label → UUIDs surface in headings and every link.

- [ ] **R18 · `src/composables/useResourceView.ts:271`** — `CONFIRMED`
  A frontier of up to `MAX_EMBED_TOTAL` (150) is all marked `seen` and charged to `embedBudget`, but `buildEmbeddedTriplesQuery` slices `uris` to **64** (`rdfQueries.ts:322`). Objects 65–150 are marked seen but never fetched → they **silently render as plain links** with breadth budget unspent.

- [ ] **R19 · `src/composables/useResourceView.ts:318`** — `PLAUSIBLE`
  `newIris` filters `!labelMap.has(u) && !typeMap.has(u)` — should be `||`. An object with a label but **no type** (reachable: the SKOS-XL pass sets `labelMap` without `typeMap`) is never refetched → missing type badge, and a `render:embed` type renders as a plain link. Sibling `composeLabels.ts:69` correctly uses `||`.

## 🟡 Graph provenance / type sidebar (core invariants)

- [ ] **R20 · `src/components/rdf/ResourceView.vue:148`** — `CONFIRMED`
  The header graph summary iterates only `triples.value` (which excludes `rdf:type`) and never `types.value` → the named graph a resource's **type** lives in is dropped. A type-only resource (`triples.length===0`) hides the whole graph block despite rendering type chips → provenance shown nowhere.

- [ ] **R21 · `src/components/rdf/TypeList.vue:150`** — `CONFIRMED`
  `nestedSubs` nests a subclass under its parent without checking the parent is navigable. A navigable subclass of an **embedded/hidden** superclass is removed from `normalRoots`, but the parent is never `visit()`ed → the subclass (and its instance count) **vanishes from the sidebar** and can't be selected.

## 🟡 Error handling / robustness

- [ ] **R22 · `src/services/sparql.ts:349`** — `CONFIRMED`
  A `200` + JSON content-type + non-SPARQL body (e.g. `{"error":"…"}`) parses to a truthy `data`, skipping the `!data` guards → returned as `SPARQLResults` with no `.results`. Callers (`useResourceView.ts:137`, `useInstanceList.ts:78`) then throw `Cannot read properties of undefined (reading 'bindings')` → graceful endpoint error becomes an **unhandled crash**.

- [ ] **R23 · `src/components/common/ErrorBoundary.vue:18`** — `CONFIRMED`
  `error` is never cleared on route change. After one caught error the boundary keeps the slot hidden across all navigation → the **whole app is wedged** on "Something went wrong" until the user manually clicks "Try Again".

- [ ] **R24 · `src/components/rdf/InstanceList.vue:67`** — `CONFIRMED`
  Paginator is gated on `total > pageSize`. When the separate `COUNT(DISTINCT)` query is slow or fails (swallowed with `logger.warn`), `total` stays `0` → **no paginator renders**, and the rest of a large type is unreachable through the UI.

- [ ] **R25 · `src/composables/useIncomingRelations.ts:101`** — `CONFIRMED`
  `truncated` is derived from the raw binding count, but `buildIncomingQuery` projects `?s ?g ?p` with no `DISTINCT` → quad endpoints multiply rows per named graph → **false "Showing the first 1,000 of N"** warning when nothing was actually dropped.

---

## Refuted (checked, dismissed)

Recorded so they aren't re-investigated:

- `src/composables/useEndpointTest.ts:31` — testConnection request-generation race.
- `src/components/rdf/TypeList.vue:345` — `selectType` dropping other URL params.
- `src/components/common/CredentialsPrompt.vue:24` — non-immediate field-reset watcher.
- `src/views/__tests__/RdfView.e2e.test.ts:89` — non-load-bearing assertion.
- `src/composables/useResourceView.ts:355` — typeMap mutation ordering vs embed BFS.
- `src/components/rdf/InstanceList.vue:19` — pageSize/`setPage` plumbing.

## Not yet tracked

25 of **89** verified findings are tracked above. The remaining 64 were cut by the report cap:

- **~10 lower-ranked correctness items** — e.g. possible SPARQL injection in `fetchRawRdf` (`src/services/sparql.ts:924`, interpolates `conceptUri` without `sanitizeIri`); ARIA announce actions in `src/stores/ui.ts:121` are never called (live regions inert); dead `URL_PARAMS.ENDPOINT` in `src/router/index.ts`.
- **~54 cleanup / dead-code items** — largely AE SKOS copy-paste cruft.

To capture these, re-run the review synthesis with the cap lifted (finders/verifiers are cached).
