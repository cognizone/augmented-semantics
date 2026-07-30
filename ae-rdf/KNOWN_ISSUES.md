# AE RDF — known issues (open)

Unresolved bugs we want to pick up later. Add newest at the top.

---

## Scroll flicker → tab freeze/crash on CORDIS (UNREPRODUCED)

**Status:** open, not reproduced. Reported 2026-07-22. Neither the user nor an
automated headless repro can trigger it on demand.

### Symptom (as reported)
Browsing the **CORDIS** dataset, "scrolling an instance," the UI **flickers the
whole time**, then the **browser tab hangs (freezes) and disappears/crashes**. Noticed
right after the 2026-07-22 web deploy.

### What changed in that deploy
The deploy diff is **last-deployed ref → tip**, i.e. `5e3b76b..00e18dd` (**23 commits**,
NOT just the day's commits — don't diff by date). It's dominated by the
**faceted-browsing + SPARQL-request-gate rewrite**: `stores/facets.ts` (+267),
`services/http.ts` (+177), `services/sparql.ts` (+190), `services/rdfQueries.ts` (+199),
`components/rdf/FacetPanel.vue`, `components/rdf/InstanceList.vue`,
`composables/useRdfTypes.ts`, `views/RdfView.vue`. CORDIS is the endpoint with facets
configured, so this rewrite is the prime suspect surface.

### Ruled OUT (with evidence)
- **Deep blank-node render (`abceef3`, depth-4 bnode chains).** On CORDIS, Project
  *instances* have **0** blank-node objects → the bnode query never fires. *Classes*
  reach ≤14 bnodes, fast, bounded. LINDAS worst case = 43 bnodes, stable labels, no
  cycles. Render cycle guard in `PropertyTable` (`ancestors` path) holds. Not the cause.
- **Async class-label fetch (`088993c`).** `useRdfTypes` is instantiated once; no
  self-retriggering watcher found. Module-scoped `classLabels` ref is read-shared, not a
  write loop.
- **Automated headless dev repro** (Playwright + Chrome, DEV build = full Vue warnings),
  at BOTH `00e18dd` (broken queries live) and `4ad71f1` (fixed): **no** freeze, **no**
  `Maximum recursive updates exceeded`, **no** `pageerror`, **no** SPARQL query re-firing
  (request count settled to +0 when idle), DOM bounded (≤~1300 nodes even on the two
  ~208-`hasInvolvedParty` mega-Projects; `MAX_EMBED_TOTAL=150` holds). Main thread stayed
  responsive through: endpoint select, type select, Filters rail open, facet toggles,
  instance-list scroll, resource-view scroll, click-into resources
  (Project/Organisation/FundingScheme/Grant/OrganisationRole), rapid open/back stress.
- **Code review of the suspect paths** — all race-guarded (`requestId`/`isCurrent`),
  idempotent, no infinite reactive loop: `facets.ts` `load()` (lazy + panel-gated +
  spurious-fire bail), `useInstanceList`, `useResourceView` (one-shot, depth+breadth
  capped), `useRdfTypes`, `services/http.ts` request gate (idempotent release, bounded
  pump, queued aborts splice out).

### Real bugs found while hunting (these are NOT the hang — headless caught them but
### the app catches the 500 and only shows missing data, no freeze)
- **Subclass-closure query 500** on Virtuoso ("transitive start not given") — fixed in
  `4ad71f1`.
- **Date-band facet query 500** on Virtuoso — was `SP031` alias-twice (fixed `3c38788`),
  then `SR586 "Incomplete RDF box … for year()"` because `YEAR()` throws on an `xsd:date`
  box inside `GROUP BY`. Fixed by extracting the year from the lexical form
  (`SUBSTR(STR(?v),1,4)` + integer cast) in `buildFacetRangesQuery`. Verified live.

### Still-open hypotheses (untested)
1. **Production-build-only.** Repro was dev-build. Vue prod build strips warnings and
   schedules differently — reproduce on `pnpm --filter ae-rdf build && vite preview`.
2. **Specific resource URI / UI state** the headless sweep didn't hit.
3. **Real continuous trackpad scroll / hover.** Many elements carry PrimeVue tooltips
   (`v-tooltip` on every URI link + facet chip); rapid hover churn on scroll could thrash
   — headless synthetic scroll doesn't exercise this.
4. **Environment-specific** — browser extension, HTTP/2 connection reuse, etc.

### How to pick this up
- Get from the user: the **exact resource URI**, the **endpoint view** (type selected?
  Filters rail open or Types?), and whether it's **scroll vs click-into-resource**.
- Reproduce on a **production build**, not dev.
- If a freeze is imminent, `__logger.dump()` in the console *just before* it locks (the
  logger keeps history) may show the last action / a repeating log line.
- Consider a repeated-network-request detector (same query body fired >N×/sec = loop).
- The earlier headless repro scripts lived in the session scratchpad (ephemeral — gone).
