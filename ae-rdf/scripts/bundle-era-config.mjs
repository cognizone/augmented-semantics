// Bake the ERA app config (EVR default + ERA endpoints, logo) into the built
// dist/ so the Tauri desktop app boots in config mode as "ERA RDF Browser".
// Runs as part of `tauri build` (see src-tauri/tauri.conf.json), cwd = ae-rdf.
import { copyFileSync } from 'node:fs'

copyFileSync('../apps/era-rdf/app.json', 'dist/config/app.json')
copyFileSync('../apps/era-rdf/logo.png', 'dist/config/logo.png')
console.log('Bundled ERA app config into dist/config/')
