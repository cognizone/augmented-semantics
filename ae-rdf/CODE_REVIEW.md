# AE RDF — Code Review Tracker

Whole-codebase review of `ae-rdf/src` (62 files, ~10k lines) — **2026-07-02**.

**Method:** 17 per-subsystem finders + 3 cross-cutting finders → 95 candidates → independent adversarial per-`(file,line)` verifier → ranked, capped synthesis. 89 findings survived verification, tracked below as 87 entries (a couple folded as same-root-cause notes): **51 correctness** (R01–R51) then **36 cleanup / dead-code** items (R52–R87). 6 findings were refuted.

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

- [x] **R10 · `src/composables/useIncomingRelations.ts:39`** — `CONFIRMED`
  `reset()` bumps `countReqId` but **not `requestId`**, so an in-flight `load()` for the previous resource is never invalidated. Navigating A→B before A's list query returns makes `isCurrent()` still true → B's "Referenced by" **paints resource A's relations and count**, never querying B.

- [x] **R11 · `src/components/rdf/ResourceView.vue:61`** — `CONFIRMED`
  The always-rendered header reads `label`/`types`/`triples`, cleared only *after* the new load resolves. During navigation the header shows the **previous resource's title, type chips, and graph chips** next to the new URI (seconds on slow Virtuoso); clicking a stale type chip navigates to the **wrong type**. Violates graph-provenance-is-core mid-load.

- [x] **R12 · `src/components/rdf/PropertyTable.vue:229`** — `CONFIRMED`
  `expanded` Set / `rowsExpanded` never reset on `props.groups` change, and the top-level tables (`ResourceView.vue:239/244`) aren't `:key`ed by URI → Vue reuses the instance and **resource B renders A's rows already expanded** (materializes up to 100 rows unasked).

- [x] **R13 · `src/composables/useInstanceList.ts:130`** — `CONFIRMED`
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

## 🟡 Additional correctness findings

Ranked below R01–R25 by the review (mostly `PLAUSIBLE`, plus a few `CONFIRMED` that fell outside the original 25-cap). Same severity scale.

- [ ] **R26 · `src/App.vue:165`** — `PLAUSIBLE`
  `documentationUrl` from the loaded config is bound to `<a :href="docsUrl" target="_blank">` (and logoUrl to `:src` at line 143) with no validateURI/protocol check, so a config served to the app can inject a `javascript:` href — config values reach a DOM URL sink un-vetted even though validateURI exists for exactly this.
  _Impact:_ A deployment (or a config file served from a location an attacker can influence, e.g. a shared/static host) sets `documentationUrl: "javascript:alert(document.cookie)"`. config.ts loads it unvalidated (ConfigEndpoint/AppConfig strings are never protocol-checked), App.vue renders `<a href="javascript:...">`; clicking the docs icon runs script in the app origin.

- [ ] **R27 · `src/composables/useIncomingRelations.ts:162`** — `CONFIRMED`
  When the incoming list query succeeds but its parallel count query fails (countRes===null), load() sets count.value=null at the end, erasing a correct value that the eager loadCount() had already populated — the 'Referenced by (N)' headline loses its number after the user expands the section.
  _Impact:_ On resource load, loadCount() runs and sets count.value=12000 (headline shows 'Referenced by 12,000'). User clicks to expand; load() runs, listRes succeeds but the COUNT(DISTINCT) query times out and is caught to null. Line 162 executes count.value = countRes ? … : null, so count becomes null and the headline collapses to just 'Referenced by' with no count, even though a valid count was on screen a moment earlier.

- [ ] **R28 · `src/composables/useResourceView.ts:87`** — `CONFIRMED`
  The heading's composed-label type (deriveLabel: first type alphabetically that has a label config) is picked by a different rule than ResourceView's cfgType (first type with order OR hide OR label config), so on a multi-typed resource the heading and the edit-panel label toggles operate on different type configs.
  _Impact:_ A resource has rdf:types A and B (A sorts before B). Type A is configured only { hide:[...] }; type B only { label:[somePred] }. useResourceView.deriveLabel picks labelType=B and renders B's composed label in the heading, but ResourceView.cfgType picks A (it has hide config), so labelList=A.label=[] . Clicking the 'title' toggle in the edit panel writes to A's config and the heading (driven by B) never changes; the highlighted label predicates in the panel also don't match the ones actually composing the heading.

- [ ] **R29 · `src/services/rdfQueries.ts:267`** — `CONFIRMED`
  VALUES-list builders filter with isNavigableIri(u) (which trims before validating) but interpolate the RAW untrimmed u, so a URI with surrounding whitespace passes the guard yet emits a malformed `<  http://x  >`.
  _Impact:_ A resource/type URI arriving with leading or trailing whitespace (common from copy-paste, config JSON, or some endpoints' bindings) passes isNavigableIri and is embedded as `<  http://e.org/x  >`; Virtuoso/most engines reject the space-containing IRI so the whole labels/composition/subclass/embed query 400s or returns nothing, and labels/embeds silently vanish. sanitizeIri(u) returns the trimmed safe form and is what the single-IRI builders (buildResourceTriplesQuery etc.) use; the VALUES builders (buildLabelsQuery L263-268, buildCompositionQuery L153, buildSubclassQuery L242, buildSkosxlLabelsQuery L295, buildValuesQuery L306-307, buildEmbeddedTriplesQuery L319-324, buildEmbedOrphanQuery L197-198) should too.

- [ ] **R30 · `src/services/sparql.ts:924`** — `PLAUSIBLE`
  fetchRawRdf interpolates conceptUri into the CONSTRUCT query without sanitizeIri, unlike every other query builder — SPARQL injection via a crafted resource URI.
  _Impact:_ A resource whose IRI (from an untrusted endpoint, deep-link, or history) contains `>` — e.g. `http://x/a> } ; DROP ...` or `...> ?p ?o } WHERE { ?s ?p ?o` — is passed to fetchRawRdf. encodeURIComponent on line 941 does NOT neutralize this because the metacharacters are inside the SPARQL string, not the URL: the `>` closes the `<...>` IRI early, so the injected text becomes live query syntax sent to the remote endpoint. Every other builder in rdfQueries.ts guards this exact case with sanitizeIri()/isNavigableIri() (which reject the `<>"{}|\^\` chars in UNSAFE_IRI); fetchRawRdf is the one path that skips it.

- [ ] **R31 · `src/components/rdf/ResourceView.vue:207`** — `CONFIRMED`
  The 'Show graphs' toggle is nested inside the .resource-graphs block gated on triples.length, but the 'Referenced by' incoming section renders whenever there is no load/error — so a resource with incoming relations but zero outgoing triples can never enable showGraphs.
  _Impact:_ Navigate to a resource that is only ever an object (it has incoming references but no outgoing triples — e.g. a shared code/category whose own definition lives in an unqueried graph). triples.length===0, so the whole graph block including the 'Show graphs' button is hidden, yet the incoming section still renders and its PropertyTable receives :show-graphs="false". Single-graph incoming rows then display no graph chip (showGraphsFor only auto-reveals multi-graph rows) and the user has no control to reveal provenance — the graph-provenance-is-core invariant is unsatisfiable for such resources.

- [ ] **R32 · `src/components/rdf/InstanceList.vue:23`** — `CONFIRMED`
  rangeLabel returns '0' whenever `total` is 0, but the list still renders a full page of instances during (and after a failed) lazy count.
  _Impact:_ On every fresh type selection useInstanceList resets `total` to 0 and fills it in only when the count lands. During that window (and permanently if the count query fails) the header badge shows '0' even though 25 instance rows are visibly listed below it, so the count badge contradicts the visible list.

- [ ] **R33 · `src/views/RdfView.vue:44`** — `PLAUSIBLE`
  The ?type watcher sets browseStore.currentType but never clears currentResource; combined with ResourceView taking template precedence over InstanceList, selecting a type via a URL that still carries ?resource keeps showing the old resource instead of the newly selected type's instance list.
  _Impact:_ URL is ?resource=X (ResourceView showing X). A deep link or history entry navigates to ?type=T&resource=X (both params present). The ?type watcher sets currentType=T, but currentResource stays X because nothing cleared it; RdfView's v-if chain renders ResourceView (currentResource truthy) so the user sees resource X, not T's instance list, despite having 'selected' type T.

- [ ] **R34 · `src/views/RdfView.vue:39`** — `CONFIRMED`
  The ?resource watcher sets uriInput when a resource is present but never clears it when the resource is dropped from the URL.
  _Impact:_ User inspects resource X (URI bar shows X), then clicks a type in the sidebar; selectType pushes only ?type, dropping ?resource. The resource watcher fires with r=null and skips the assignment (guarded by `if (uri)`), so the URI input keeps displaying the previously-viewed resource X while the instance list is shown — a stale, misleading input value.

- [ ] **R35 · `src/utils/configExport.ts:21`** — `CONFIRMED`
  endpointSlug returns an empty string for names with no ASCII alphanumerics, yielding a filename of literally ".json".
  _Impact:_ An endpoint named in a non-Latin script or symbols only (e.g. "日本語", "!!!", or whitespace) produces endpointSlug(name) === "". exportEndpoint (App.vue:45) then downloads `${slug}.json` = ".json" — a dot-file with no basename. Two such endpoints both export to ".json" and collide, and the app.json manifest can't reference them by a distinct slug. Any config/endpoints/&lt;slug>.json lookup for that endpoint targets '/config/endpoints/.json'.

- [ ] **R36 · `src/services/security.ts:203`** — `CONFIRMED`
  assessEndpointTrust's localhost check omits the IPv6 loopback [::1] that the sibling checkEndpointSecurity recognizes.
  _Impact:_ A developer adds an endpoint http://[::1]:8890/sparql (IPv6 loopback, common for local Virtuoso). parsed.hostname is "[::1]". checkEndpointSecurity treats it as localhost (no warning), but assessEndpointTrust only compares against 'localhost' and '127.0.0.1', so it pushes 'Uses HTTP (insecure)' and sets level='warning'. The endpoint form shows a spurious insecurity warning for a purely local dev endpoint, and the two security helpers disagree about the same URL.

- [ ] **R37 · `src/utils/format.ts:70`** — `CONFIRMED`
  humanizeLocalName mis-splits a known acronym immediately followed by a lowercase word, producing a wrong word boundary.
  _Impact:_ A predicate/type local name like `URIref` (a multi-letter acronym directly followed by a lowercase segment with no camelCase capital) hits the `([A-Z]+)([A-Z][a-z])` rule: `URIref` becomes `UR` + `Iref` -> displayed as "UR iref" instead of "URI ref"/"URIref". Users see a garbled humanized predicate label in the resource view for such IRIs. (camelCase forms like `hasURIValue`/`EUProject` are handled correctly; only acronym+lowercase-run names break.)

- [ ] **R38 · `src/composables/useEndpointTest.ts:43`** — `CONFIRMED`
  The 3s success auto-dismiss setTimeout is never cleared on unmount or on a subsequent test, so it fires after teardown and can clear a newer result.
  _Impact:_ User tests an endpoint (success shown), then within 3s closes the dialog or starts a second test that also succeeds; the first test's stale timer fires and sets testResult.value = null, blanking the currently-displayed success message (and mutating reactive state after the component may be unmounted). No clearTimeout is stored, so overlapping tests each leave a dangling timer.

- [ ] **R39 · `src/services/rdfQueries.ts:133`** — `PLAUSIBLE`
  buildInstanceListQuery places the label OPTIONALs (?s rdfs:label ?l1 …) outside any GRAPH block, but under the merged-quads strategy (useNamed && !useDefault) the DISTINCT ?s subquery is GRAPH-scoped; on a pure quad store whose labels live only in named graphs the OPTIONALs match nothing, so every instance in the list falls back to its raw URI as its label.
  _Impact:_ Endpoint declares graph.quads=true and defaultView='merged' → strategy {useNamed:true, useDefault:false}. membership wraps ?s a &lt;Type> in GRAPH ?g, but the three label OPTIONALs (?s rdfs:label ?l1 etc.) run against the default graph only. On a store where rdfs:label triples are inside named graphs, ?l1/?l2/?l3 stay unbound, BIND(COALESCE(...,STR(?s))) yields the URI, and InstanceList shows every row's label as its full URI instead of its human label.

- [ ] **R40 · `src/services/sparql.ts:361`** — `PLAUSIBLE`
  Caller-initiated abort via config.signal is treated as a timeout and retried, so a user-cancelled request keeps re-firing instead of stopping.
  _Impact:_ A caller passes config.signal and aborts it (navigation away / new query). controller.abort() fires (line 284), fetch rejects with AbortError, and the handler at line 361-365 unconditionally sets lastError='TIMEOUT' and `continue`s the retry loop — it never distinguishes an external cancel from the internal timeout. The cancelled request then retries up to `retries` more times (with exponential backoff), issuing extra network calls the user explicitly cancelled and delaying the final rejection. (No caller passes a signal today, so this is latent, but the signal API is exported and documented.)

- [ ] **R41 · `src/services/sparql.ts:283`** — `PLAUSIBLE`
  The abort listener added to the external config.signal is never removed and is re-added on every retry attempt, leaking listeners on a reused signal.
  _Impact:_ Because the loop runs once per attempt (up to retries+1 times) and each iteration calls `config.signal.addEventListener('abort', ...)` (line 284) with no matching removeEventListener and no `{ once: true }`, a single executeSparql call registers up to 4 listeners on the caller's signal, each closing over a stale AbortController. If a caller reuses one long-lived AbortSignal across many queries (a common pattern), listeners accumulate unboundedly for the life of that signal, and every past controller's abort() is invoked when it finally fires — a slow memory/listener leak proportional to query count.

- [ ] **R42 · `src/stores/endpoint.ts:119`** — `PLAUSIBLE`
  loadFromStorage calls parsed.map(...) without verifying parsed is an array; a non-array value under 'ae-endpoints' throws and is swallowed, silently wiping the endpoint list.
  _Impact:_ If localStorage 'ae-endpoints' holds valid JSON that is not an array (legacy/corrupted value, or a different feature writing an object/string to the same key), JSON.parse succeeds but parsed.map is not a function -> throws. The catch at line 121 only logs, so endpoints.value stays [] and the user sees an empty endpoint list with no visible error, appearing to have lost all their saved endpoints.

- [ ] **R43 · `src/services/config.ts:68`** — `PLAUSIBLE`
  A valid config served with a JSON-ish but non-'application/json' content-type is silently discarded as 'no config'.
  _Impact:_ A static host serves config/app.json with Content-Type 'application/ld+json' or 'text/json' (misconfiguration, or an LD-aware host). The check !contentType.includes('application/json') is true, so loadConfig treats a present, valid config as absent and returns configMode:false with no error — the deployer's locked config is silently ignored and the app behaves as an unconfigured default deployment, hard to diagnose because there's only a debug log.

- [ ] **R44 · `src/services/eventBus.ts:66`** — `PLAUSIBLE`
  unsubscribe() closes over the entries array captured at subscribe time; after off()/clear() recreates the event's array, it splices a detached array and can never remove the handler from the live list.
  _Impact:_ eventBus.clear() (or off('endpoint:changed')) is called (e.g. from a test setup or a future teardown), then a new subscriber calls on('endpoint:changed') — on() finds no map entry and creates a fresh array. A pre-existing subscription's unsubscribe() still targets the old detached array, so its splice is a no-op: the handler is either already orphaned (silently stops firing) or, in the recreation order, leaks and keeps firing after the component that owns it unmounted. Fix: resolve this.handlers.get(event) inside unsubscribe instead of capturing `entries`.

- [ ] **R45 · `src/composables/useEndpointForm.ts:127`** — `PLAUSIBLE`
  buildEndpoint constructs the SPARQLEndpoint without the graph field even though buildGraph() exists, silently dropping quads/defaultView config.
  _Impact:_ Any caller that persists via buildEndpoint(id) (it is exported for that purpose) saves an endpoint whose deployer-configured graph behaviour (quads=yes/no, defaultView=own/merged) is lost, so query construction falls back to auto/safe and can query the wrong (or a redundant merged) graph. Currently latent because the only live caller (EndpointManager.save) bypasses buildEndpoint and calls buildGraph() inline.

- [ ] **R46 · `src/main.ts:56`** — `PLAUSIBLE`
  bootstrap() is invoked as a floating promise with no .catch(); a synchronous throw during app.use/app.mount surfaces only as an unhandled rejection.
  _Impact:_ loadConfig() swallows its own errors, but if app.use(PrimeVue,...) or app.mount('#app') throws (e.g. a plugin init error or a missing #app mount node), the rejection escapes bootstrap() with no handler. The user sees a blank page and nothing is routed through logger.error (the app.config.errorHandler only catches errors inside mounted components, not bootstrap failures), so the failure is invisible in the log history the CLAUDE.md debugging workflow relies on. Wrap the body in try/catch or add .catch(e => logger.error(...)).

- [ ] **R47 · `src/services/prefix.ts:314`** — `PLAUSIBLE`
  getDisplayPrefixes/getKnownPrefixes invert the map to prefix->namespace with out[p]=ns, so two namespaces sharing one prefix (e.g. http://schema.org/ and https://schema.org/ both 'schema') silently drop one entry.
  _Impact:_ COMMON_PREFIXES declares both http://schema.org/ and https://schema.org/ as 'schema' (L39-40); getDisplayPrefixes emits only one of them (whichever iterates last) into the prefix legend, and getKnownPrefixes bakes only one into the exported app.json — so a deployment using the other schema.org scheme loses its qname mapping and renders full URIs. Any user-configured prefix that collides with a resolved/common one is likewise dropped from the legend.

- [ ] **R48 · `src/stores/ui.ts:143`** — `PLAUSIBLE`
  announceSuccess and announceLoading both write loadingAnnouncement with different clear timeouts (3000ms vs 1000ms), so a repeated identical message is cleared early by the wrong timer.
  _Impact:_ If these were wired up (per the com03 mandate): announceLoading('Loading…') schedules a 1000ms clear; if the same 'Loading…' string is announced again, the still-pending 1000ms timer from the first call fires and, because loadingAnnouncement.value still === 'Loading…', clears the second announcement after ~1s instead of the intended window. More generally, sharing one ref between a 'loading'/'success' channel with mismatched timeouts means an earlier timer can wipe a later message of the same text, so a screen-reader user misses the announcement. Give success its own state or track a per-message token instead of comparing by string equality.

- [ ] **R49 · `src/components/common/ErrorBoundary.vue:49`** — `PLAUSIBLE`
  reportIssue() injects the full error message and stack trace into an external github.com URL query string and opens it with window.open(..., '_blank') without 'noopener', risking leakage of sensitive data and reverse tabnabbing.
  _Impact:_ If a thrown error's message or stack contains sensitive strings (e.g. a SPARQL query with an embedded token, a credential value that surfaced in an exception, or private IRIs), clicking 'Report Issue' places them in the URL sent to github.com and browser history. Separately, `window.open` without 'noopener,noreferrer' hands the opened page a `window.opener` reference, allowing the navigated-to page to redirect this app's tab (reverse tabnabbing).

- [ ] **R50 · `src/App.vue:165`** — `PLAUSIBLE`
  Documentation link opens with target="_blank" but no rel="noopener", unlike the rest of the codebase's external links.
  _Impact:_ docsUrl comes from operator config (config.value.config?.documentationUrl). When a deployment sets a documentationUrl on a page the operator does not fully control, clicking the Documentation icon opens it in a new tab that receives a live window.opener handle, enabling reverse-tabnabbing (the opened page can navigate this tab to a phishing clone). The codebase already established the fix convention at ResourceView.vue:203 (rel="noopener"); this anchor and the GitHub anchor at line 240 omit it. Add rel="noopener".

- [ ] **R51 · `src/services/__tests__/prefix.test.ts:10`** — `CONFIRMED`
  The "resolve without hitting prefix.cc" test never asserts that fetch was not called, and fetch is globally unmocked, so it does not actually guard the behavior it names.
  _Impact:_ If config-prefix short-circuiting in prefix.ts regressed (e.g. getCommonPrefix stopped consulting configNsToPrefix), resolveUris('http://data.europa.eu/s66#Project') would fall through to fetchPrefix and call the real fetch('https://prefix.cc/reverse?...') in happy-dom. Depending on network, the test would either flakily hit an external service (slow/CI-dependent) or throw an unrelated network error, instead of failing with a clear 'config prefix not applied' assertion. setup.ts stubs localStorage/crypto/navigator but not fetch, so nothing catches the escaped network call. Add a vi.spyOn(globalThis,'fetch') and assert it was not called.

## 🧹 Cleanup / dead code

Largely AE SKOS copy-paste carry-over: unused exports, duplicated types/helpers, and unmemoized render-path work. Low risk; safe to delete/simplify.

- [ ] **R52 · `src/views/__tests__/RdfView.e2e.test.ts:54`** — `CONFIRMED`
  No test exercises the requestId/isCurrent() stale-response race guard that every data composable (useResourceView/useInstanceList/useRdfTypes/useIncomingRelations) relies on.
  _Impact:_ The e2e mock resolves executeSparql synchronously and the test drives it with flushPromises, so queries never interleave — a slow response for resource/endpoint A resolving after the user switched to B is never simulated. The isCurrent() checks (id === requestId && endpointStore.current?.id === endpointId) guarding against stale writes are therefore untested; a regression that dropped or inverted one of those guards (overwriting newer state with an older query's result) would ship green. Add a test that starts load A, switches selection to B before A resolves, then resolves A and asserts A's stale bindings do not overwrite B's state.

- [ ] **R53 · `src/stores/ui.ts:121`** — `CONFIRMED`
  The announceLoading/announceError/announceSuccess screen-reader actions are never called anywhere, so the ARIA live regions in App.vue are permanently empty and the whole ARIA-announcement feature is inert.
  _Impact:_ App.vue lines 266-267 render aria-live regions bound to uiStore.loadingAnnouncement / errorAnnouncement, but grep shows no component ever calls announceLoading/announceError/announceSuccess. The values stay '' forever, so screen readers announce nothing on load/error/success. This directly violates the com03 accessibility pattern in CLAUDE.md that mandates using uiStore.announceLoading/announceError/announceSuccess. Either wire these into the loading/error paths or delete the dead action trio (and the loadingAnnouncement/errorAnnouncement refs) rather than shipping a copied-from-ae-skos surface that does nothing.

- [ ] **R54 · `src/components/common/EndpointManager.vue:105`** — `CONFIRMED`
  addSuggested() calls the generic endpointStore.addEndpoint({ name, url }) instead of the purpose-built endpointStore.addSuggestedEndpoint(s), discarding the suggestion's `suggestedLanguagePriorities` (a field that IS consumed live for label language selection) and leaving addSuggestedEndpoint as dead code.
  _Impact:_ The store exposes addSuggestedEndpoint(suggested: SuggestedEndpoint) which copies `suggestedLanguagePriorities` into `languagePriorities` (consumed by useResourceView/useInstanceList/useIncomingRelations via labelLangs). EndpointManager instead narrows the SuggestedEndpoint to {name,url} and calls addEndpoint, so any language priorities on a suggested endpoint are silently dropped and the dedicated store action is never called — dead code plus latent loss of per-endpoint label-language configuration. Fix: call endpointStore.addSuggestedEndpoint(s).

- [ ] **R55 · `src/stores/typeConfig.ts:28`** — `CONFIRMED`
  set()'s 'prune empties' loop only deletes keys whose value is undefined, so array-valued config toggled back to empty ([]) is persisted forever and keeps the type entry alive in endpoint.types.
  _Impact:_ toggleInList (utils/propertyOrder.ts) returns [] when the last item is toggled off, and ResourceView.vue/PropertyTable.vue call e.g. typeConfig.set(type, { hide: toggleInList(...) }). When the user un-hides the last hidden predicate, next becomes { hide: [] }; the prune loop skips it (value is [] not undefined), Object.keys(next).length is 1 (truthy), so all[type] = { hide: [] } and the type entry never collapses to undefined. The same happens for label:[], groupByType:[], order:[]. Result: exported app.json accumulates dead 'hide':[]/'label':[]/'groupByType':[] entries and stale per-type records that the 'prune empties' comment promises to remove. Fix: also treat empty arrays as empty when pruning (e.g. delete when value is undefined or an empty array).

- [ ] **R56 · `src/stores/settings.ts:76`** — `CONFIRMED`
  loadSettings runs after the watchers are registered, so restoring stored settings triggers each watch and re-persists the just-loaded values (and applies dark mode twice) on every app start.
  _Impact:_ Watchers (lines 68-74) are registered before loadSettings() at line 76. loadSettings assigns darkMode/uriDisplay/editMode/showHidden from storage, each assignment fires its watch -> saveSettings() runs up to 4 times per startup writing back the values just read, and applyDarkMode runs twice (once directly at line 44, once via the darkMode watch). Wasted localStorage writes and redundant DOM class toggling on every load; register the watchers after loadSettings, or guard load with a flag.

- [ ] **R57 · `src/composables/useRdfTypes.ts:273`** — `CONFIRMED`
  loadTypes runs twice on every endpoint switch: once from the endpoint:changed subscription and again from the graph watcher fired by useGraphMode's setGraph.
  _Impact:_ On endpoint:changed, useRdfTypes.loadTypes() fires (line 270) while useGraphMode (separately subscribed to endpoint:changed) calls detect() -> setGraph(), which assigns a fresh object to browseStore.graph and triggers the watch at line 273 -> loadTypes() again. For an unknown-quads endpoint the async probe calls setGraph a second time, firing loadTypes a third time. Since the first load hasn't cached typeInventory yet, the redundant loads re-issue the full COUNT(DISTINCT) type-inventory query against the remote endpoint; the requestId guard discards all but the last result, so it is wasted round-trips, not a wrong-data bug. Deduping (e.g. drop the endpoint:changed subscription and rely solely on the graph watch, or gate the watch on a value change) would remove the duplicate queries.

- [ ] **R58 · `src/services/security.ts:257`** — `CONFIRMED`
  The entire sessionStorage credential-storage subsystem is dead code, and the module header advertises a feature the app doesn't use.
  _Impact:_ storeCredentials, getCredentials, clearCredentials, the private getStoredCredentials, the CREDENTIALS_KEY constant, and the StoredCredentials interface have zero callers anywhere in src (verified by grep across .ts/.vue). The app actually holds credentials in memory only, via useEndpointStore.provideCredentials, and stores/endpoint.ts explicitly comments 'Never persist credentials'. This dead subsystem (plus the file header bullet 'Credential storage (sessionStorage)') misleads readers into thinking credentials are persisted to sessionStorage; it should be deleted to remove the maintenance burden and the false security claim. (Bonus latent bug it hides: btoa(JSON.stringify(...)) throws 'Invalid character' on any non-Latin1 password, so the code wouldn't even work if wired up.)

- [ ] **R59 · `src/services/diagnostics.ts:9`** — `CONFIRMED`
  diagnoseEndpoint is exported and re-exported through services/index.ts (line 6) but never called anywhere; it is stale AE SKOS code (hardcodes skos:Concept), uses console.log instead of the mandated logger, and types bindings as `any`.
  _Impact:_ Dead code: an entire SKOS-specific diagnostic query pair ships in the general RDF browser bundle and is publicly re-exported, so maintainers must reason about it. It also violates two CLAUDE.md rules at once (use the logger service, not console.log; strict TS, not `any` on binding at line 35) and queries `a skos:Concept`, which returns nothing on non-SKOS endpoints. Delete the file and its barrel export.

- [ ] **R60 · `src/stores/ui.ts:20`** — `CONFIRMED`
  Most of the UI store is dead code copied from ae-skos: openDialogs/closeAllDialogs, settingsDialog*, viewMode, mobileTab, sidebarTab, setLoading, isLoading, triggerSearchFocus/searchFocusTrigger, sidebarOpen/toggleSidebar, and isMobile/isTablet/isDesktop all have zero external consumers.
  _Impact:_ Grepping the whole src tree for each exported member finds no .vue/.ts consumer for openDialogs, closeAllDialogs, settingsDialogOpen, setSettingsDialogOpen, settingsSection, setSettingsSection, openSettingsDialog, viewMode, setViewMode, mobileTab, setMobileTab, sidebarTab, setSidebarTab, setLoading, isLoading, triggerSearchFocus, searchFocusTrigger, sidebarOpen, toggleSidebar, setSidebarOpen, isMobile, isTablet, isDesktop. Even initResponsive/destroyResponsive (the only invoked actions) only mutate isMobile/isTablet, which nothing reads, so the resize listener does no observable work. ~130 lines of state/actions plus the ViewMode/MobileTab/SidebarTab/SettingsSection type unions are maintenance noise that misleads readers into thinking the app has dialog/mobile-tab/view-mode features it does not.

- [ ] **R61 · `src/services/security.ts:21`** — `CONFIRMED`
  Five exported sanitization/escape helpers are unused; the real SPARQL-injection guard lives elsewhere.
  _Impact:_ escapeSparqlString, escapeSparqlRegex, sanitizeSearchInput, sanitizeHtml, and isValidURI have no callers outside security.ts (barrel `export * from './security'` hides this from tsc's unused check). The actual IRI-injection guard used by query builders is sanitizeIri + UNSAFE_IRI in services/rdfQueries.ts, and there is no v-html in the app for sanitizeHtml to guard. Carrying these dead exports invites future callers to reach for the weaker escapeSparqlString (which does not reject the control/brace characters that sanitizeIri blocks) instead of the guard that is actually wired up.

- [ ] **R62 · `src/components/common/ErrorBoundary.vue:27`** — `CONFIRMED`
  The logged component name uses `instance?.$options?.name`, which is undefined for &lt;script setup> SFCs (the app's convention), so the 'component' field is effectively always 'Unknown'.
  _Impact:_ Every component in this codebase uses `<script setup lang="ts">`, which does not populate `$options.name` unless a separate name is declared. So logger.error always records component:'Unknown', making the boundary's error logs useless for pinpointing which component threw. Using instance?.type?.__name (or __file) would recover the real component identity.

- [ ] **R63 · `src/composables/useClipboard.ts:28`** — `CONFIRMED`
  The clipboard failure catch binds (e) but never logs it, violating the CLAUDE.md mandate to log both success and failure paths via the logger service.
  _Impact:_ When navigator.clipboard.writeText rejects (insecure context / permissions denied), the only trace is a transient toast; there is no logger.error('useClipboard', ...) entry, so __logger.dump() shows nothing and the failure is undiagnosable from the console history the project relies on for debugging.

- [ ] **R64 · `src/components/rdf/ResourceView.vue:257`** — `CONFIRMED`
  The incoming-relations spinner binds incomingLoading (the composable's raw loading ref) directly, bypassing useDelayedLoading, unlike every other spinner in the app which honors the com03 300ms delay.
  _Impact:_ Expanding 'Referenced by' against a fast endpoint that returns in &lt;300ms flashes the ProgressSpinner for a few frames on every expand, whereas the main resource view, instance list, and type list all wrap their loading in useDelayedLoading(loading) and show nothing for sub-300ms operations. The inconsistency violates the com03 delayed-loading convention and produces visible flicker specifically in the incoming section.

- [ ] **R65 · `src/components/rdf/PropertyTable.vue:356`** — `CONFIRMED`
  embedGroups() is called up to 3 times per embedded URI row on every render (v-if at 356, :groups prop at 360, badge-suppression check at 421), each time re-doing a Map lookup, ancestors scan, typeConfig lookup, hide-filter, and orderedByConfig() sort.
  _Impact:_ For a resource with embedded value objects, each render re-executes embedGroups three times per row. When the embed type has an `order` config, orderedByConfig returns a brand-new array (via [...items].sort with indexOf inside the comparator), so the :groups prop passed to the child PropertyTable is a fresh reference on every parent render — defeating the child's computed memoization and forcing full re-render of every nested embed table on any reactive change. Cost: redundant sorting/allocation on a recursive render hot path plus unnecessary child re-renders. Compute embedGroups once per row (e.g. fold it into displayRows / a per-row precomputed field) instead of calling it three times inline.

- [ ] **R66 · `src/components/rdf/PropertyTable.vue:340`** — `CONFIRMED`
  displayRows(group) is invoked directly in the template v-for, so its work — including a full sortedObjects() sort (and, in grouped mode, building a Map plus a second section sort) — reruns for every group on every render with no memoization.
  _Impact:_ Any reactive change in the component (hover tooltip state, a drag ref update, an unrelated settings toggle) re-runs displayRows for every property group, each call re-sorting that group's objects with localeCompare. For a resource with many predicates this is repeated O(n log n) work on the render path. Precompute the rows (computed keyed by group) instead of calling displayRows inline in the v-for.

- [ ] **R67 · `src/components/rdf/PropertyTable.vue:386`** — `CONFIRMED`
  isDangling(row.o.value) is evaluated three times per URI row per render (class binding at 386, tooltip ternary at 387, marker v-if at 411), each re-checking isNavigableIri + three Map lookups.
  _Impact:_ Every render of a URI value recomputes isDangling three times, each running isNavigableIri (which try/catches through sanitizeIri) plus embedded/labels/objectTypes Map gets. Redundant work multiplied across all URI rows on the render path; compute it once per row (e.g. a precomputed boolean on the DisplayRow) and reuse.

- [ ] **R68 · `src/composables/useResourceView.ts:225`** — `CONFIRMED`
  Object types are prefix-resolved twice: once eagerly for typeMap.values() at line 225 (typeIris) and again at line 343 (for t of typeMap.values()) after the embed walk, both feeding the same resolvedMap via resolveUris; the first pass is redundant work since the second re-adds every type.
  _Impact:_ For a resource with 40 distinct object types, resolveUris is invoked at line 227 for the initial typeMap types, then the embed/compose passes add more types, and line 344 re-lists every type (the line-344 filter !resolvedMap.has(u) drops the already-resolved ones but line 225-229 already spent a full resolveUris round-trip that the later pass would have covered anyway), so the extra await at 226-230 is avoidable latency on every resource load.

- [ ] **R69 · `src/services/eventBus.ts:104`** — `CONFIRMED`
  emit() awaits handlers sequentially, so independent subscribers are serialized instead of running concurrently.
  _Impact:_ On endpoint:changed, useRdfTypes' loadTypes() cannot start until useGraphMode's detect() fully resolves (including its detectGraphs network round-trip), roughly doubling the latency before types appear even though the two handlers are independent. Since each handler is already wrapped in its own try/catch, they could run via Promise.allSettled to overlap the round-trips.

- [ ] **R70 · `src/services/sparql.ts:807`** — `CONFIRMED`
  analyzeEndpoint runs Steps 4-7 (count concepts, relationships EXISTS, scheme detection, label predicates) strictly sequentially though they are independent whole-dataset queries.
  _Impact:_ Steps 4 (line 816), 5 (845), 6 (869) and 7 (872) each await a self-contained query with no data dependency between them, yet run one after another. On a slow/remote endpoint each round-trip adds to wall-clock connect time; batching the independent ones with Promise.all (Steps 1-3 must stay ordered because 2/3 depend on graph detection) would cut endpoint-analysis latency roughly in proportion to the number of serial queries.

- [ ] **R71 · `src/services/eventBus.ts:78`** — `CONFIRMED`
  The once() method, `once` option, HandlerEntry.once field, and the once-removal branch in emit() are speculative/unused — no .once() call and no once:true registration exists in the codebase.
  _Impact:_ Dead flexibility: the only two subscribers use on() with default options, so the entire once path (lines 100, 109-118 plus once() at 78-84) is never exercised yet complicates emit() with a mutation-during-iteration removal step that must be re-audited on every change. Drop once support until a caller needs it.

- [ ] **R72 · `src/stores/endpoint.ts:24`** — `CONFIRMED`
  needsCredentials re-implements the per-auth-type credential-completeness logic that already exists in two other places.
  _Impact:_ The rule for which fields make each auth type complete (basic=username+password, bearer=token, apikey=apiKey) is duplicated across needsCredentials (endpoint.ts:24), getAuthHeaders (services/sparql.ts:83) and the `valid` computed in CredentialsPrompt.vue:37. Three copies must be kept in sync; adding a new auth type or changing required fields (e.g. making headerName mandatory) risks them diverging. Extract one shared predicate (e.g. an authComplete(auth) helper next to the EndpointAuth type) and call it from all three.

- [ ] **R73 · `src/components/rdf/TypeList.vue:251`** — `CONFIRMED`
  pathKey re-derives the nested-embed count key as chain.join('>'), duplicating the identical key format hardcoded in useRdfTypes.requestPathCount.
  _Impact:_ The write side (useRdfTypes.ts:94, `const key = chain.join('>')`) and the read side (TypeList.vue:251 pathKey) each spell out `chain.join('>')` independently. If either separator is ever changed, embedCount() will look up a key that was never stored, so nested-embed hover counts silently resolve to null forever with no error. Extract one shared helper (e.g. a pathCountKey(chain) export) and call it from both sides instead of duplicating the join literal.

- [ ] **R74 · `src/utils/format.ts:8`** — `CONFIRMED`
  Exported `ResolvedMap` type is re-declared verbatim in three composables instead of imported.
  _Impact:_ `export type ResolvedMap = Map<string, { prefix: string; localName: string }>` is exported here but useResourceView.ts:37, useIncomingRelations.ts:19, and useRdfTypes.ts:20 each redeclare the identical `type ResolvedMap = ...` inline. The shape is duplicated in 4 places; a change to the resolution-map shape (e.g. adding a field from resolveUris) must be edited in every copy, and the local redeclarations shadow the canonical exported one. Import `ResolvedMap` from `../utils/format` instead.

- [ ] **R75 · `src/services/prefix.ts:186`** — `CONFIRMED`
  resolveUri (single-URI resolver) is exported but has zero callers anywhere in the codebase (only the batch resolveUris is used).
  _Impact:_ Dead code: ~37 lines (L186-222) duplicating the common-prefix/cache/fetch logic that resolveUris already implements, kept in sync for no consumer — extra maintenance surface and misleading API. Grep confirms no reference outside its own definition; delete it (and route any future single lookups through resolveUris).

- [ ] **R76 · `src/services/prefix.ts:292`** — `CONFIRMED`
  formatQualifiedName is exported but never called anywhere in the app or tests.
  _Impact:_ Dead code (L292-297): an exported helper with no consumer. It suggests a supported API for turning a ResolvedUri into 'prefix:local' that nothing uses, so it rots out of sync with how callers actually format qnames. Remove it.

- [ ] **R77 · `src/composables/useElapsedTime.ts:17`** — `CONFIRMED`
  useElapsedTime is exported from composables/index.ts but has no consumer anywhere in ae-rdf — dead code.
  _Impact:_ ~65 lines of timer/interval logic (plus its index.ts export) are carried and maintained with zero call sites; grep for useElapsedTime / .formatted across src finds only the definition and the re-export. Delete it or wire it into a long-running progress indicator.

- [ ] **R78 · `src/composables/useEndpointForm.ts:86`** — `CONFIRMED`
  useExample is exported but never called anywhere in the repo — dead code.
  _Impact:_ The function and its index-less export sit unused (EndpointManager uses addSuggested on the store instead); grep for useExample finds only the definition and the return-object entry. It also only sets name/url/authType and would leave stale credential fields, so if ever wired up it would misbehave — remove it.

- [ ] **R79 · `src/router/index.ts:28`** — `CONFIRMED`
  URL_PARAMS.ENDPOINT is exported and documented as a deep-linking key but is never read or written anywhere in the app.
  _Impact:_ Dead code + misleading documentation: the file header (lines 4-6) promises `?endpoint` deep-linking ("endpoint: SPARQL endpoint URL") per com04, but grepping the whole ae-rdf/src shows only URL_PARAMS.RESOURCE and URL_PARAMS.TYPE are ever consumed (RdfView.vue, TypeList.vue, InstanceList.vue, ResourceView.vue); ENDPOINT has zero consumers. A maintainer reading this believes endpoint state is shareable via URL and may build on a param that nothing populates. Remove the ENDPOINT key and the stale doc line, or implement the feature.

- [x] **R80 · `src/services/sparql.ts:743`** — `CONFIRMED`
  The parseExists helper for EXISTS results is defined twice, verbatim, in detectLabelPredicates (738) and analyzeEndpoint (849).
  _Impact:_ Identical `const parseExists = (value?: string): boolean => { if (!value) return false; return value === 'true' || value === '1' }` is duplicated at lines 738-741 and 849-852. If endpoints appear that encode EXISTS as e.g. `"1"^^xsd:boolean` or uppercase `TRUE`, the fix must be applied in two places and one will drift. Hoist a single module-level `parseExists` (or export from a shared util) and call it from both.

- [x] **R81 · `src/types/endpoint.ts:80`** — `CONFIRMED`
  TypeCount, TypeProperty, and CompositionEntry are three structurally identical `{ uri: string; count: number }` interfaces.
  _Impact:_ TypeCount (l.80), TypeProperty (l.90), and CompositionEntry (l.112) all declare exactly `{ uri: string; count: number }`. Three separate declarations of the same shape (plus their re-exports in config.ts) triple the maintenance surface for what is one `{uri,count}` pair; a shared base like `interface UriCount { uri: string; count: number }` that the three extend/alias would remove the duplication while keeping the distinct names.

- [x] **R82 · `src/types/config.ts:21`** — `CONFIRMED`
  config.ts re-exports endpoint types that index.ts already surfaces via `export * from './endpoint'`.
  _Impact:_ index.ts does `export * from './endpoint'` and `export * from './config'`, and this line re-exports TypeConfig/TypeRender/TypeSidebar/TypeCount/TypeProperty/TypeProfile/CompositionEntry from './endpoint' again. Every one of these names is thus surfaced through '../types' twice; the re-export list must be kept in sync by hand whenever an endpoint type is added/removed, for no functional gain (the `export *` already covers it). It is redundant boilerplate that can be deleted.

- [ ] **R83 · `src/services/prefix.ts:205`** — `CONFIRMED` · ⚠️ **WON'T FIX (false positive)**
  resolveUri's `prefix === null || prefix === undefined` check duplicates the cache-miss vs stored-null distinction the `namespace in cache` guard on L203 already established, making the undefined branch unreachable.
  _Impact:_ Minor over-complication: line 203 only enters when `namespace in cache`, and the cache only ever stores string|null (fetchPrefix result), so `=== undefined` can never be true here — a redundant condition that obscures the intended null-sentinel semantics. Simplify to `if (prefix === null)`. (Low priority; compounds the fact that this whole function is unused.)
  _Correction (verified):_ `@vue/tsconfig` sets `noUncheckedIndexedAccess`, so `cache[namespace]` is typed `string | null | undefined` and TS's `in` operator does not narrow index-access. The `=== undefined` branch is load-bearing for the `string` return type — removing it fails `vue-tsc`. Left as-is. (The real fix is R75: delete the whole unused `resolveUri`.)

- [x] **R84 · `src/components/rdf/__tests__/PropertyTable.grouping.test.ts:15`** — `CONFIRMED`
  The `link` object-factory and the identical `global: { plugins: [PrimeVue], directives: { tooltip: Tooltip } }` mount config are copy-pasted across all four PropertyTable test files.
  _Impact:_ `const link = (v) => ({ termType: 'uri', value: v, graphs: [] })` is duplicated verbatim in PropertyTable.cycle.test.ts:18, PropertyTable.embedVia.test.ts:22, and PropertyTable.grouping.test.ts:15, and the PrimeVue+Tooltip mount options appear in every mount() call across the four files. A change to ResourceObject's shape (e.g. a new required field) or to the required global plugins must be edited in 4+ places. Extract a shared test-utils helper (e.g. src/test-utils/propertyTable.ts exporting `link`, `lit`, and a `mountPropertyTable(props)` wrapper) and import it.

- [x] **R85 · `src/components/rdf/__tests__/PropertyTable.grouping.test.ts:18`** — `CONFIRMED`
  beforeEach(() => setActivePinia(createPinia())) is redundant — setup.ts already calls setActivePinia(createPinia()) in a global beforeEach for every test.
  _Impact:_ Duplicated Pinia setup: src/test-utils/setup.ts (the configured setupFile) runs setActivePinia(createPinia()) before every test, so the identical line here (and in PropertyTable.cycle.test.ts:21 and PropertyTable.duplication.test.ts:19) is dead boilerplate. It costs an extra Pinia instance per test and misleads readers into thinking these files need bespoke store setup. Delete the three lines and rely on setup.ts.

- [x] **R86 · `src/components/rdf/__tests__/PropertyTable.cycle.test.ts:37`** — `CONFIRMED`
  The cycle test's only assertion (`.uri-link` count > 0) is too weak to prove the cycle was broken correctly; the real check is the absence of a thrown stack overflow.
  _Impact:_ expect(findAll('.uri-link').length).toBeGreaterThan(0) passes for almost any render outcome — it cannot distinguish 'A and B each inlined once, the back-edge to A rendered as a link' (the intended behavior) from a degenerate render that inlines nothing or inlines the wrong node. The test's actual guarantee comes solely from mount() not throwing 'Maximum call stack size exceeded'. Strengthen it by asserting the expected structure (e.g. exactly one .embed-table for B under A, and a .uri-link whose text resolves to A on the back-edge) so a future regression that breaks the cycle differently is caught.

- [x] **R87 · `src/components/common/EndpointManager.vue:88`** — `CONFIRMED`
  runTest() calls `endpointStore.clearError?.()` with optional chaining, but clearError is an unconditional method on the store — the `?.` is dead defensiveness that suggests the method might be absent.
  _Impact:_ clearError is always defined and exported by useEndpointStore (see stores/endpoint.ts return object). The optional-chaining call `clearError?.()` can never short-circuit, so it only adds misleading noise implying the method is optional; a maintainer may waste time reasoning about when the store lacks clearError. Replace with `endpointStore.clearError()`.
