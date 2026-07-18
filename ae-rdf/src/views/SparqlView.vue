<script setup lang="ts">
/**
 * SparqlView - raw, read-only SPARQL panel.
 *
 * A lightweight CodeJar + Prism syntax-highlighting editor (no CodeMirror/Monaco)
 * + a results table. Only SELECT and
 * ASK run (see utils/sparqlGuard); an unbounded SELECT gets a LIMIT appended and
 * at most 1000 rows render. URI cells link into the resource view exactly like
 * PropertyTable. The last query is persisted per endpoint.
 *
 * Selection-invalidation (ae-rdf/CLAUDE.md): every async result is guarded by a
 * request id AND the endpoint it started on, and switching endpoints bumps the
 * id + clears results, so a stale query can never land on the new endpoint.
 *
 * @see /spec/ae-rdf
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import ProgressSpinner from 'primevue/progressspinner'
import { CodeJar } from 'codejar'
import Prism from 'prismjs'
// SPARQL grammar builds on Turtle — import Turtle first so `extend('turtle', …)` resolves.
import 'prismjs/components/prism-turtle'
import 'prismjs/components/prism-sparql'
import { useEndpointStore } from '../stores'
import { useDelayedLoading, useElapsedTime } from '../composables'
import { executeSparql, isNavigableIri, logger, resolveUris, type SPARQLBinding, type SPARQLResults } from '../services'
import { qname as toQname, type ResolvedMap } from '../utils/format'
import { prepareQuery } from '../utils/sparqlGuard'
import { takeSparqlHandoff } from '../utils/sparqlHandoff'
import { URL_PARAMS } from '../router'
import type { AppError } from '../types'

const router = useRouter()
const endpointStore = useEndpointStore()

const endpoint = computed(() => endpointStore.current)
const hasEndpoint = computed(() => !!endpoint.value)

// Both Cmd+Enter and Ctrl+Enter always run (the handler checks metaKey||ctrlKey);
// the HINT just shows the modifier native to the OS so it reads right per platform.
const runKey = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'

// Persist the last query per endpoint. Keyed by endpoint URL (stable across the
// index-based config ids and the uuid user ids).
const STORAGE_KEY = 'ae-rdf-sparql'
const DEFAULT_QUERY = `# Read-only SPARQL. Only SELECT and ASK queries run.
# Press Cmd/Ctrl+Enter to run.
SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 25`

const MAX_ROWS = 1000
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string'

function loadPersisted(url: string | undefined): string | null {
  if (!url) return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const map = JSON.parse(raw) as Record<string, string>
    return typeof map[url] === 'string' ? map[url]! : null
  } catch {
    return null
  }
}

function persist(url: string | undefined, q: string) {
  if (!url) return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const map = (raw ? JSON.parse(raw) : {}) as Record<string, string>
    map[url] = q
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch (e) {
    logger.warn('SparqlView', 'Failed to persist query', { error: e })
  }
}

// A query handed off from the browser ("Open in SPARQL") wins for this mount,
// seeding the editor with the current filtered list query; otherwise the
// per-endpoint persisted query, else the default.
const query = ref<string>(takeSparqlHandoff() ?? loadPersisted(endpoint.value?.url) ?? DEFAULT_QUERY)

// CodeJar highlighting editor. `query` stays the single source of truth: user edits
// flow query←editor via jar.onUpdate; external reassignments (endpoint switch) flow
// query→editor via the watch below. The `!==` guard breaks the feedback loop so a
// self-originated edit never calls updateCode and resets the caret.
const editorEl = ref<HTMLDivElement | null>(null)
let jar: ReturnType<typeof CodeJar> | null = null

function highlight(el: HTMLElement) {
  el.innerHTML = Prism.highlight(el.textContent || '', Prism.languages.sparql as Prism.Grammar, 'sparql')
}

// Cmd/Ctrl+Enter runs. Registered on the editor element BEFORE CodeJar attaches, so at
// the target phase it fires first and preventDefault()s — CodeJar's own keydown handler
// bails on `event.defaultPrevented`, so no stray newline is inserted and run() fires once.
function onEditorKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    run()
  }
}

onMounted(() => {
  const el = editorEl.value
  if (!el) return
  el.addEventListener('keydown', onEditorKeydown)
  jar = CodeJar(el, highlight, { tab: '  ' })
  jar.updateCode(query.value) // seed content before onUpdate is wired (no self-trigger)
  jar.onUpdate(code => {
    query.value = code
  })
})

// External reassignments (endpoint switch loads the persisted/default query) push into
// the editor. The guard skips self-originated edits, preserving the caret.
watch(query, v => {
  if (jar && v !== jar.toString()) jar.updateCode(v)
})

// Result state
const running = ref(false)
const error = ref<string | null>(null)
const errorDetail = ref<string | null>(null)
const notice = ref<string | null>(null)
const durationMs = ref<number | null>(null)
const truncated = ref(false)
const vars = ref<string[]>([])
const rows = ref<SPARQLBinding[]>([])
const askResult = ref<boolean | null>(null)
const resolved = ref<ResolvedMap>(new Map())
const ran = ref(false) // a query has completed at least once (drives empty state)

const showLoading = useDelayedLoading(running)
const { formatted: elapsedText } = useElapsedTime(running)

// Invalidation token: bumped on every run AND on endpoint switch. A result only
// lands if its id is still current and its endpoint is still selected.
const reqId = ref(0)

function clearResults() {
  vars.value = []
  rows.value = []
  askResult.value = null
  resolved.value = new Map()
  error.value = null
  errorDetail.value = null
  notice.value = null
  durationMs.value = null
  truncated.value = false
  ran.value = false
}

// Endpoint switch: invalidate any in-flight query, clear results, and swap in the
// query persisted for the newly-selected endpoint.
watch(
  () => endpointStore.currentId,
  (id, prev) => {
    if (id === prev) return
    reqId.value++
    running.value = false
    clearResults()
    query.value = loadPersisted(endpoint.value?.url) ?? DEFAULT_QUERY
  },
)

async function run() {
  const ep = endpoint.value
  if (!ep) return

  const prepared = prepareQuery(query.value)
  if (!prepared.ok) {
    clearResults()
    error.value = prepared.error ?? 'Invalid query.'
    return
  }

  persist(ep.url, query.value)

  const id = ++reqId.value
  const startedUrl = ep.url
  const isCurrent = () => id === reqId.value && endpointStore.current?.url === startedUrl

  clearResults()
  running.value = true
  const started = performance.now()
  logger.info('SparqlView', 'Running query', { endpoint: ep.url, keyword: prepared.keyword, limitAdded: prepared.limitAdded })

  try {
    const res: SPARQLResults = await executeSparql(ep, prepared.query)
    if (!isCurrent()) {
      logger.debug('SparqlView', 'Discarding stale result (endpoint/selection changed)')
      return
    }

    const notes: string[] = []
    if (prepared.limitAdded) notes.push('No LIMIT found — added LIMIT 100.')

    if (typeof res.boolean === 'boolean') {
      askResult.value = res.boolean
    } else {
      const all = res.results?.bindings ?? []
      if (all.length > MAX_ROWS) {
        truncated.value = true
        notes.push(`Showing the first ${MAX_ROWS.toLocaleString('en-US')} rows.`)
      }
      const shown = all.slice(0, MAX_ROWS)

      // Resolve prefixes for URI cells so they render as short qnames.
      const uris = new Set<string>()
      for (const b of shown) for (const v of Object.values(b)) if (v.type === 'uri') uris.add(v.value)
      const rmap = uris.size ? await resolveUris([...uris]) : new Map()
      if (!isCurrent()) return

      resolved.value = rmap as ResolvedMap
      vars.value = res.head?.vars ?? []
      rows.value = shown
    }

    durationMs.value = performance.now() - started
    notice.value = notes.length ? notes.join(' ') : null
    ran.value = true
    logger.info('SparqlView', 'Query successful', { rows: rows.value.length, ask: askResult.value, ms: Math.round(durationMs.value) })
  } catch (e) {
    if (!isCurrent()) return
    const appErr = e as Partial<AppError>
    error.value = appErr?.message ?? String(e)
    // The detail (e.g. Virtuoso's message) echoes the whole submitted query back
    // after "SPARQL query:" / "define sql:" — drop that noise, keep the diagnostic.
    errorDetail.value = appErr?.details
      ? appErr.details.split(/\n\s*(?:SPARQL query:|define sql:)/)[0]!.trim()
      : null
    ran.value = true
    logger.error('SparqlView', 'Query failed', { error: e })
  } finally {
    // Only the current request owns the spinner — a stale one finishing must not
    // clear the spinner of the request that superseded it.
    if (id === reqId.value) running.value = false
  }
}

// Persist edits so a query survives navigation even without running.
onBeforeUnmount(() => {
  editorEl.value?.removeEventListener('keydown', onEditorKeydown)
  jar?.destroy()
  jar = null
  persist(endpoint.value?.url, query.value)
})

const qname = (uri: string) => toQname(uri, resolved.value)

const durationLabel = computed(() =>
  durationMs.value === null ? null : `${(durationMs.value / 1000).toFixed(2)}s`,
)

/** Navigate a URI cell into the resource view (same target as PropertyTable). */
function openResource(uri: string) {
  router.push({ path: '/', query: { [URL_PARAMS.RESOURCE]: uri } })
}
</script>

<template>
  <div class="sparql-view">
    <div v-if="!hasEndpoint" class="empty-state">
      <span class="material-symbols-outlined empty-icon">database</span>
      <h2>No endpoint selected</h2>
      <p>Pick or add a SPARQL endpoint from the menu in the header to run a query.</p>
    </div>

    <template v-else>
      <div class="editor-pane">
        <div class="editor-head">
          <h2 class="pane-title">SPARQL — <span class="mono">{{ endpoint?.name }}</span></h2>
          <span class="editor-hint">Read-only · SELECT / ASK · <kbd>{{ runKey }}</kbd>+<kbd>Enter</kbd> to run</span>
        </div>
        <div
          ref="editorEl"
          class="query-editor"
          role="textbox"
          aria-multiline="true"
          aria-label="SPARQL query"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          autocorrect="off"
          data-placeholder="SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 25"
        ></div>
        <div class="editor-actions">
          <button class="run-btn" :disabled="running || !query.trim()" @click="run">
            <span class="material-symbols-outlined">play_arrow</span>
            Run
          </button>
          <span v-if="showLoading" class="run-status">
            Running{{ elapsedText() ? ` (${elapsedText()})` : '' }}…
          </span>
          <span v-else-if="durationLabel" class="run-status">Ran in {{ durationLabel }}</span>
        </div>
        <p v-if="notice" class="query-notice">{{ notice }}</p>
      </div>

      <div class="results-pane">
        <div v-if="showLoading" class="state">
          <ProgressSpinner style="width: 32px; height: 32px" strokeWidth="4" />
        </div>

        <div v-else-if="error" class="state error">
          <span class="material-symbols-outlined">error</span>
          <p class="error-msg">{{ error }}</p>
          <pre v-if="errorDetail" class="error-detail">{{ errorDetail }}</pre>
        </div>

        <!-- ASK result -->
        <div v-else-if="askResult !== null" class="ask-result">
          <span class="material-symbols-outlined" :class="askResult ? 'ask-true' : 'ask-false'">
            {{ askResult ? 'check_circle' : 'cancel' }}
          </span>
          <span class="ask-value">{{ askResult }}</span>
        </div>

        <!-- SELECT results -->
        <div v-else-if="rows.length" class="table-scroll">
          <table class="result-table">
            <thead>
              <tr>
                <th v-for="v in vars" :key="v">{{ v }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, ri) in rows" :key="ri">
                <td v-for="v in vars" :key="v">
                  <template v-if="row[v]">
                    <!-- URI: navigable → link to the resource view, else plain text -->
                    <a
                      v-if="row[v]!.type === 'uri' && isNavigableIri(row[v]!.value)"
                      class="uri-link"
                      :title="row[v]!.value"
                      @click="openResource(row[v]!.value)"
                    >{{ qname(row[v]!.value) }}</a>
                    <span
                      v-else-if="row[v]!.type === 'uri'"
                      class="uri-static"
                      :title="row[v]!.value"
                    >{{ qname(row[v]!.value) }}</span>

                    <!-- Blank node -->
                    <span v-else-if="row[v]!.type === 'bnode'" class="bnode">[ bnode ]</span>

                    <!-- Literal + lang / datatype tag -->
                    <span v-else class="literal">
                      {{ row[v]!.value }}
                      <span v-if="row[v]!['xml:lang']" class="tag lang-tag">@{{ row[v]!['xml:lang'] }}</span>
                      <span
                        v-else-if="row[v]!.datatype && row[v]!.datatype !== XSD_STRING"
                        class="tag datatype-tag"
                      >{{ qname(row[v]!.datatype!) }}</span>
                    </span>
                  </template>
                  <span v-else class="unbound">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Empty result set (after a successful run) -->
        <div v-else-if="ran" class="state">
          <span class="material-symbols-outlined empty-icon">search_off</span>
          <p>No results</p>
        </div>

        <!-- Nothing run yet -->
        <div v-else class="state">
          <span class="material-symbols-outlined empty-icon">terminal</span>
          <p>Write a SELECT or ASK query and run it.</p>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sparql-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
  min-width: 0;
  overflow: hidden;
}

.editor-pane {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  border-bottom: 1px solid var(--ae-border-color);
  flex-shrink: 0;
}

.editor-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.pane-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--ae-text-primary);
}

.mono {
  font-family: var(--ae-font-mono);
}

.editor-hint {
  font-size: 0.6875rem;
  color: var(--ae-text-secondary);
}

.editor-hint kbd {
  font-family: var(--ae-font-mono);
  font-size: 0.65rem;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 3px;
  padding: 0 0.25rem;
}

.query-editor {
  width: 100%;
  min-height: 120px;
  resize: vertical;
  overflow: auto;
  font-family: var(--ae-font-mono);
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--ae-text-primary);
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 6px;
  padding: 0.625rem 0.75rem;
  tab-size: 2;
  /* contenteditable: preserve whitespace/newlines and wrap long lines like the textarea did */
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

.query-editor:focus {
  outline: none;
  border-color: var(--ae-accent);
}

/* contenteditable has no native placeholder — reproduce it while empty. */
.query-editor:empty::before {
  content: attr(data-placeholder);
  color: var(--ae-text-muted);
  pointer-events: none;
}

/* Prism token theming — :deep() because the highlighted spans are injected via innerHTML
   and carry no scope attribute. Colours use --ae-* vars so they flip with .dark-mode. */
.query-editor :deep(.token.keyword) {
  color: var(--ae-accent);
  font-weight: 600;
}

.query-editor :deep(.token.punctuation) {
  color: var(--ae-text-secondary);
}

.query-editor :deep(.token.string) {
  color: var(--ae-status-success);
}

.query-editor :deep(.token.variable) {
  color: var(--ae-text-primary);
}

.query-editor :deep(.token.comment) {
  color: var(--ae-text-muted);
  font-style: italic;
}

.query-editor :deep(.token.number),
.query-editor :deep(.token.boolean) {
  color: var(--ae-status-warning);
}

/* Prefixed names (qnames like rdf:type): local-name in primary, prefix dimmed. */
.query-editor :deep(.token.function) {
  color: var(--ae-text-primary);
}

.query-editor :deep(.token.function .token.prefix) {
  color: var(--ae-text-secondary);
}

/* Full IRIs <…>: present but calm, angle brackets dimmed. */
.query-editor :deep(.token.url) {
  color: var(--ae-text-primary);
}

.query-editor :deep(.token.url .token.punctuation) {
  color: var(--ae-text-muted);
}

/* Language tags (@en). */
.query-editor :deep(.token.tag) {
  color: var(--ae-text-secondary);
}

.editor-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.run-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.8125rem;
  font-weight: 600;
  padding: 0.35rem 0.85rem;
  background: var(--ae-accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.run-btn:hover:not(:disabled) {
  background: var(--ae-accent-hover);
}

.run-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.run-btn .material-symbols-outlined {
  font-size: 18px;
}

.run-status {
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
}

.query-notice {
  margin: 0;
  font-size: 0.75rem;
  color: var(--ae-status-warning);
}

.results-pane {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.table-scroll {
  overflow-x: auto;
  width: 100%;
}

.result-table {
  border-collapse: collapse;
  font-size: 0.8125rem;
  width: 100%;
}

.result-table th {
  position: sticky;
  top: 0;
  text-align: left;
  font-family: var(--ae-font-mono);
  font-weight: 600;
  color: var(--ae-text-secondary);
  background: var(--ae-header-bg, var(--ae-bg-elevated));
  border-bottom: 1px solid var(--ae-border-color);
  padding: 0.5rem 1rem;
  white-space: nowrap;
}

.result-table td {
  vertical-align: top;
  padding: 0.375rem 1rem;
  border-bottom: 1px solid var(--ae-border-color);
  word-break: break-word;
}

.uri-link {
  color: var(--ae-accent);
  cursor: pointer;
  font-family: var(--ae-font-mono);
}

.uri-link:hover {
  text-decoration: underline;
}

.uri-static {
  color: var(--ae-text-primary);
  font-family: var(--ae-font-mono);
}

.bnode {
  color: var(--ae-text-muted);
  font-style: italic;
}

.literal {
  color: var(--ae-text-primary);
}

.unbound {
  color: var(--ae-text-muted);
}

.tag {
  display: inline-block;
  margin-left: 0.375rem;
  padding: 0 0.375rem;
  border-radius: 4px;
  font-size: 0.6875rem;
  font-family: var(--ae-font-mono);
  background: var(--ae-bg-hover);
  color: var(--ae-text-secondary);
  vertical-align: middle;
}

.ask-result {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1.5rem;
  font-size: 1.125rem;
}

.ask-value {
  font-family: var(--ae-font-mono);
  font-weight: 600;
  color: var(--ae-text-primary);
}

.ask-result .material-symbols-outlined {
  font-size: 28px;
}

.ask-true {
  color: var(--ae-status-success);
}

.ask-false {
  color: var(--ae-text-muted);
}

.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem;
  color: var(--ae-text-secondary);
  font-size: 0.875rem;
  text-align: center;
}

.state.error {
  color: var(--ae-status-error);
}

/* Constrain the error so a long endpoint message doesn't run edge-to-edge. */
.error-msg {
  margin: 0;
  max-width: 640px;
  font-weight: 600;
}

/* The endpoint's raw diagnostic: monospace, wrapped, width-capped, scrollable if
   still too tall. Left-aligned (error text isn't prose). */
.error-detail {
  margin: 0;
  max-width: min(720px, 100%);
  max-height: 240px;
  overflow: auto;
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--ae-font-mono);
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--ae-text-secondary);
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 6px;
  padding: 0.6rem 0.75rem;
}

.empty-icon {
  font-size: 48px;
  color: var(--ae-text-muted);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  text-align: center;
  color: var(--ae-text-secondary);
  flex: 1;
  padding: 2rem;
}

.empty-state h2 {
  margin: 0;
  font-size: 1.125rem;
  color: var(--ae-text-primary);
}

.empty-state p {
  margin: 0;
  font-size: 0.875rem;
  max-width: 420px;
}

.empty-state .empty-icon {
  font-size: 56px;
}
</style>
