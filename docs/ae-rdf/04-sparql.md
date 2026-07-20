---
outline: deep
---

# SPARQL panel

The <img src="./icons/icon-terminal.svg" height="14"> button in the header opens a **read-only SPARQL panel** — a syntax-highlighting editor for running your own queries against the current endpoint.

- **Read-only.** Only `SELECT` and `ASK` queries run. Anything else (`CONSTRUCT`, `DESCRIBE`, `INSERT`, `DELETE`, `LOAD`, …) is refused before any request is sent.
- **Many named tabs.** Keep several queries side by side: **+** opens a new tab, **double-click** a tab to rename it, **✕** closes it. Tabs (and their queries) are remembered per endpoint across reloads and endpoint switches.
- **Automatic LIMIT.** A `SELECT` with no top-level `LIMIT` gets `LIMIT 1000` appended, and the panel tells you when it did. Turn this off with the **Auto-limit** toggle (or in [Settings](08-settings.md)) to run the full result set. At most **1,000 rows** render regardless.
- **Paginated results.** The results table pages (50 per page) so a large result stays navigable.
- **Portable queries.** Full IRIs are written as `prefix:local` with a `PREFIX` prologue, and any prefix you type is auto-declared on **Run** — so the query in the editor is a complete, standalone query you can copy into any SPARQL tool. (Prefixes come from the shared prefix map, scoped to what the endpoint uses.)
- **Run it.** Press **Run**, or <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd>. The query duration is shown on success.
- **Clickable results.** In a `SELECT` table, URI cells are links — click one to open that resource in the browser. `ASK` shows a simple `true` / `false`.

## Open in SPARQL

You don't have to write the query yourself. Above every instance list, a **SPARQL** button hands the current list — with its type, graph scope, text filter, and every active [facet](03-facets.md) applied — to the panel as the exact query behind it, opened in a fresh tab. Use it to see how the filtered view is built, then refine it by hand.

Because the handed-off query is [portable](#sparql-panel) (qnames + `PREFIX` header, dotted triples), you can copy it straight out into another SPARQL client.

---

*Next: [Rich values](05-rich-values.md) →*
