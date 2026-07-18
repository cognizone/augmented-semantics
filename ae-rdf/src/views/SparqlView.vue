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
import Paginator from 'primevue/paginator'
import { CodeJar } from 'codejar'
import Prism from 'prismjs'
// SPARQL grammar builds on Turtle — import Turtle first so `extend('turtle', …)` resolves.
import 'prismjs/components/prism-turtle'
import 'prismjs/components/prism-sparql'
import { useEndpointStore } from '../stores'
import { useDelayedLoading, useElapsedTime } from '../composables'
import { executeSparql, isNavigableIri, logger, resolveUris, type SPARQLBinding, type SPARQLResults } from '../services'
import { qname as toQname, type ResolvedMap } from '../utils/format'
import { prepareQuery, DEFAULT_LIMIT } from '../utils/sparqlGuard'
import { takeSparqlHandoff } from '../utils/sparqlHandoff'
import { initTabs, persistTabs, makeTab, nextName, type QueryTab } from '../utils/sparqlTabs'
import { URL_PARAMS } from '../router'
import type { AppError } from '../types'

const router = useRouter()
const endpointStore = useEndpointStore()

const endpoint = computed(() => endpointStore.current)
const hasEndpoint = computed(() => !!endpoint.value)

// Both Cmd+Enter and Ctrl+Enter always run (the handler checks metaKey||ctrlKey);
// the HINT just shows the modifier native to the OS so it reads right per platform.
const runKey = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'

const DEFAULT_QUERY = `# Read-only SPARQL. Only SELECT and ASK queries run.
# Press Cmd/Ctrl+Enter to run.
SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 25`

const MAX_ROWS = 1000
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string'

// ── Query tabs (per endpoint) ───────────────────────────────────────────────
// Many named tabs, each its own query; the active tab drives the editor. Storage
// + legacy migration live in utils/sparqlTabs (pure, unit-tested).
const initial = initTabs(endpoint.value?.url, DEFAULT_QUERY, takeSparqlHandoff())
const tabs = ref<QueryTab[]>(initial.tabs)
const activeId = ref<string>(initial.activeId)
const activeTab = computed(() => tabs.value.find(t => t.id === activeId.value) ?? tabs.value[0])

// The editor binds to a PLAIN ref (caret-stable with CodeJar — a computed with a
// side-effecting setter fought the editor and froze typing). It mirrors the active
// tab both ways: typing persists into the tab (watch(query) below), switching tabs
// loads the tab's query (watch(activeTab) below).
const query = ref<string>(activeTab.value?.query ?? '')

// Switch/replace the active tab → load its query into the editor. Fires only when
// the active tab OBJECT changes (switch/add/close/endpoint-swap), NOT when the
// current tab's text mutates (that keeps the same object ref), so typing never
// reloads the editor from under the caret.
watch(activeTab, t => {
  const q = t?.query ?? ''
  if (q !== query.value) query.value = q
})

// Persist tabs on any change (debounced — this also fires per keystroke via query).
let persistTimer: ReturnType<typeof setTimeout> | undefined
const saveTabs = (url = endpoint.value?.url) => persistTabs(url, tabs.value, activeId.value)
watch([tabs, activeId], () => {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => saveTabs(), 400)
}, { deep: true })

function selectTab(id: string) { activeId.value = id }
function addTab() {
  const t = makeTab(nextName(tabs.value), DEFAULT_QUERY)
  tabs.value = [...tabs.value, t]
  activeId.value = t.id
}
function closeTab(id: string) {
  if (tabs.value.length <= 1) return // never zero tabs
  const idx = tabs.value.findIndex(t => t.id === id)
  tabs.value = tabs.value.filter(t => t.id !== id)
  if (activeId.value === id) activeId.value = tabs.value[Math.max(0, idx - 1)]!.id
}

// Inline rename: double-click a tab → edit its name in place.
const editingId = ref<string | null>(null)
const editingName = ref('')
function startRename(t: QueryTab) { editingId.value = t.id; editingName.value = t.name }
function commitRename() {
  const t = tabs.value.find(x => x.id === editingId.value)
  const n = editingName.value.trim()
  if (t && n) t.name = n
  editingId.value = null
}
function cancelRename() { editingId.value = null }

// Autofocus + select the rename input when it appears (script-setup exposes this
// as the v-focus directive).
const vFocus = {
  mounted: (el: HTMLInputElement) => { el.focus(); el.select() },
}

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

function attachEditor(el: HTMLDivElement) {
  el.addEventListener('keydown', onEditorKeydown)
  jar = CodeJar(el, highlight, { tab: '  ' })
  jar.updateCode(query.value) // seed content before onUpdate is wired (no self-trigger)
  jar.onUpdate(code => {
    query.value = code
  })
}

onMounted(() => {
  if (editorEl.value) attachEditor(editorEl.value)
})

// The editor lives inside v-if="hasEndpoint": on a cold load the endpoint config
// isn't resolved at mount, so the element appears LATER and onMounted misses it —
// CodeJar would never attach and the field stays inert. Attach (and re-attach on
// remount) whenever the element itself appears/disappears.
watch(editorEl, el => {
  if (!el) { jar?.destroy(); jar = null; return }
  if (!jar) attachEditor(el)
})

// Typing (jar.onUpdate → query) persists into the active tab; programmatic changes
// (tab switch) push into the editor. The `!==` guards skip self-originated work so
// the caret never resets and there's no update loop.
watch(query, v => {
  const t = activeTab.value
  if (t && t.query !== v) t.query = v
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

// Client-side paging over the fetched rows (≤ MAX_ROWS). ponytail: page what we
// already have — no LIMIT/OFFSET re-query, which can't paginate an arbitrary
// user query safely. Raise MAX_ROWS / DEFAULT_LIMIT if server paging is needed.
const RESULT_PAGE_SIZE = 50
const pageFirst = ref(0)
const pagedRows = computed(() => rows.value.slice(pageFirst.value, pageFirst.value + RESULT_PAGE_SIZE))
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
  pageFirst.value = 0
  askResult.value = null
  resolved.value = new Map()
  error.value = null
  errorDetail.value = null
  notice.value = null
  durationMs.value = null
  truncated.value = false
  ran.value = false
}

// Endpoint switch: save the tabs of the endpoint we're leaving, invalidate any
// in-flight query, clear results, and swap in the newly-selected endpoint's tabs.
watch(
  () => endpointStore.currentId,
  (id, prev) => {
    if (id === prev) return
    const prevUrl = endpointStore.endpoints.find(e => e.id === prev)?.url
    if (prevUrl) saveTabs(prevUrl)
    reqId.value++
    running.value = false
    clearResults()
    const next = initTabs(endpoint.value?.url, DEFAULT_QUERY)
    tabs.value = next.tabs
    activeId.value = next.activeId
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

  saveTabs(ep.url)

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
    if (prepared.limitAdded) notes.push(`No LIMIT found — added LIMIT ${DEFAULT_LIMIT}.`)

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
  clearTimeout(persistTimer)
  saveTabs()
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
        <div class="tab-bar" role="tablist">
          <div
            v-for="t in tabs"
            :key="t.id"
            class="tab"
            :class="{ active: t.id === activeId }"
            role="tab"
            :aria-selected="t.id === activeId"
            @click="selectTab(t.id)"
          >
            <input
              v-if="editingId === t.id"
              v-model="editingName"
              class="tab-rename"
              :aria-label="`Rename ${t.name}`"
              @click.stop
              @keyup.enter="commitRename"
              @keyup.escape="cancelRename"
              @blur="commitRename"
              v-focus
            />
            <template v-else>
              <span class="tab-name" :title="'Double-click to rename'" @dblclick.stop="startRename(t)">{{ t.name }}</span>
              <button
                v-if="tabs.length > 1"
                class="tab-close"
                :aria-label="`Close ${t.name}`"
                @click.stop="closeTab(t.id)"
              >
                <span class="material-symbols-outlined">close</span>
              </button>
            </template>
          </div>
          <button class="tab-add" aria-label="New query tab" title="New query tab" @click="addTab">
            <span class="material-symbols-outlined">add</span>
          </button>
        </div>
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
        <div v-else-if="rows.length" class="result-block">
          <div class="table-scroll">
          <table class="result-table">
            <thead>
              <tr>
                <th v-for="v in vars" :key="v">{{ v }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, ri) in pagedRows" :key="ri">
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
          <Paginator
            v-if="rows.length > RESULT_PAGE_SIZE"
            :rows="RESULT_PAGE_SIZE"
            :totalRecords="rows.length"
            :first="pageFirst"
            @page="(e: { first: number }) => (pageFirst = e.first)"
          />
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

.tab-bar {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
  max-width: 16rem;
  padding: 0.25rem 0.35rem 0.25rem 0.6rem;
  font-size: 0.75rem;
  color: var(--ae-text-secondary);
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-color);
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  white-space: nowrap;
}

.tab:hover {
  color: var(--ae-text-primary);
  background: var(--ae-bg-hover);
}

.tab.active {
  color: var(--ae-text-primary);
  background: var(--ae-bg-base, var(--ae-bg-elevated));
  border-bottom-color: var(--ae-accent);
  box-shadow: inset 0 -2px 0 var(--ae-accent);
}

.tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 12rem;
}

.tab-rename {
  font: inherit;
  color: var(--ae-text-primary);
  background: var(--ae-bg-base, var(--ae-bg-elevated));
  border: 1px solid var(--ae-accent);
  border-radius: 3px;
  padding: 0 0.25rem;
  width: 8rem;
}

.tab-rename:focus {
  outline: none;
}

.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  width: 16px;
  height: 16px;
  border: none;
  background: none;
  color: var(--ae-text-muted);
  cursor: pointer;
  border-radius: 3px;
}

.tab-close:hover {
  color: var(--ae-text-primary);
  background: var(--ae-bg-hover);
}

.tab-close .material-symbols-outlined {
  font-size: 14px;
}

.tab-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border: 1px solid var(--ae-border-color);
  background: var(--ae-bg-elevated);
  color: var(--ae-text-secondary);
  border-radius: 6px;
  cursor: pointer;
}

.tab-add:hover {
  color: var(--ae-text-primary);
  background: var(--ae-bg-hover);
}

.tab-add .material-symbols-outlined {
  font-size: 16px;
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

.result-block {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.table-scroll {
  overflow: auto;
  width: 100%;
  flex: 1;
  min-height: 0;
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
