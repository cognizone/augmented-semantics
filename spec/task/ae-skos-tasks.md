# AE SKOS Implementation Tasks

## Tech Stack

- Vue 3 + Composition API
- TypeScript
- Vite (build tool)
- Pinia (state management)
- Vue Router (URL routing)
- PrimeVue (UI components)

---

## Tasks

### Phase 1: Project Setup

| # | Task | Spec Reference | Status |
|---|------|----------------|--------|
| 1 | Initialize Vue 3 + Vite + TypeScript project | - | pending |
| 2 | Set up PrimeVue and configure theme | - | pending |
| 3 | Set up Pinia store structure | com02-StateManagement | pending |
| 4 | Set up Vue Router | com04-URLRouting | pending |
| 5 | Create project folder structure matching specs | sko00-overview | pending |

### Phase 2: Core Services

| # | Task | Spec Reference | Status |
|---|------|----------------|--------|
| 6 | Implement SPARQL service (fetch, error handling, retry) | com05-SPARQLPatterns | pending |
| 7 | Implement security utilities (sanitize, escape, validate) | com06-Security | pending |
| 8 | Implement EndpointManager store + UI | com01-EndpointManager | pending |

### Phase 3: Common Components

| # | Task | Spec Reference | Status |
|---|------|----------------|--------|
| 9 | Implement LanguageSelector store + UI | sko01-LanguageSelector | pending |
| 10 | Implement SchemeSelector store + UI | sko02-SchemeSelector | pending |

### Phase 4: SKOS Components

| # | Task | Spec Reference | Status |
|---|------|----------------|--------|
| 11 | Implement ConceptTree component | sko03-ConceptTree | pending |
| 12 | Implement ConceptDetails component | sko04-ConceptDetails | pending |
| 13 | Implement SearchBox component | sko05-SearchBox | pending |
| 14 | Implement Utilities (copy, history, raw view) | sko06-Utilities | pending |

### Phase 5: UX Polish

| # | Task | Spec Reference | Status |
|---|------|----------------|--------|
| 15 | Implement responsive layout (mobile/tablet/desktop) | sko00-overview | pending |
| 16 | Implement error handling UI (toasts, inline errors) | com03-ErrorHandling | pending |
| 17 | Implement loading states (spinners, skeletons) | com03-ErrorHandling | pending |

### Phase 6: State & Persistence

| # | Task | Spec Reference | Status |
|---|------|----------------|--------|
| 18 | Implement URL deep linking and state restoration | com04-URLRouting | pending |
| 19 | Add localStorage persistence | com02-StateManagement | pending |

### Phase 7: Testing & Deploy

| # | Task | Spec Reference | Status |
|---|------|----------------|--------|
| 20 | Security review (per com06 checklist) | com06-Security | pending |
| 21 | Test with real SPARQL endpoints | - | pending |
| 22 | Build and deploy | - | pending |

---

## Folder Structure (Target)

```
ae-skos/
├── src/
│   ├── components/
│   │   ├── common/
│   │   │   ├── EndpointManager.vue
│   │   │   ├── LanguageSelector.vue
│   │   │   └── ErrorDisplay.vue
│   │   └── skos/
│   │       ├── SchemeSelector.vue
│   │       ├── ConceptTree.vue
│   │       ├── ConceptDetails.vue
│   │       ├── SearchBox.vue
│   │       └── Breadcrumb.vue
│   ├── stores/
│   │   ├── endpoint.ts
│   │   ├── language.ts
│   │   ├── scheme.ts
│   │   ├── concept.ts
│   │   └── ui.ts
│   ├── services/
│   │   ├── sparql.ts
│   │   └── security.ts
│   ├── types/
│   │   ├── endpoint.ts
│   │   ├── skos.ts
│   │   └── state.ts
│   ├── router/
│   │   └── index.ts
│   ├── App.vue
│   └── main.ts
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Dependencies

### Production
- vue ^3.4
- vue-router ^4
- pinia ^2
- primevue ^4
- primeicons
- dompurify ^3.0

### Development
- typescript ^5
- vite ^5
- @vitejs/plugin-vue
- @types/node
- @types/dompurify ^3.0

---

## Notes

- All components should follow specs in `/spec/common/` and `/spec/ae-skos/`
- Use Composition API with `<script setup>` syntax
- TypeScript strict mode enabled
- SPARQL queries from com05-SPARQLPatterns
- State structure from com02-StateManagement
- Error handling from com03-ErrorHandling
- Security patterns from com06-Security
