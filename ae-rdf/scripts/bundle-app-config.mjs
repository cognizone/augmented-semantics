// Bake a standalone app's config into the built dist/ so the Tauri desktop app
// boots in config mode as that app. Runs as part of `tauri build` (see the
// beforeBuildCommand in the tauri config); cwd = ae-rdf.
//
// Usage: node scripts/bundle-app-config.mjs <app>   (a dir under ../apps/)
import { copyFileSync, existsSync } from 'node:fs'

const app = process.argv[2]
if (!app) {
  console.error('Usage: bundle-app-config.mjs <app>  (a directory under apps/)')
  process.exit(1)
}
const base = `../apps/${app}`
if (!existsSync(`${base}/app.json`)) {
  console.error(`No app config at ${base}/app.json`)
  process.exit(1)
}
copyFileSync(`${base}/app.json`, 'dist/config/app.json')
if (existsSync(`${base}/logo.png`)) copyFileSync(`${base}/logo.png`, 'dist/config/logo.png') // optional
console.log(`Bundled ${app} app config into dist/config/`)
