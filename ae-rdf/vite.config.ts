import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execSync } from 'child_process'
import pkg from './package.json'

// Get git commit hash
function getGitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

// Dev-only reverse proxy for SPARQL endpoints whose CORS policy rejects the
// localhost origin (ERA returns 400 "Disallowed CORS origin"). The browser
// talks same-origin to Vite; Vite (Node, no CORS) forwards to ERA with the
// Origin header stripped so the allowlist check passes. Paths MUST stay in
// sync with DEV_ENDPOINT_PROXY in src/services/sparql.ts.
// ponytail: one entry per ERA host — http-proxy has no per-request routing.
function eraProxy(target: string, path: string) {
  return {
    target,
    changeOrigin: true,
    rewrite: () => path,
    configure: (proxy: { on: (e: string, cb: (r: { removeHeader: (h: string) => void }) => void) => void }) => {
      proxy.on('proxyReq', req => req.removeHeader('origin'))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  base: process.env.BASE_URL || '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __GIT_COMMIT__: JSON.stringify(getGitCommit()),
  },
  server: {
    proxy: {
      '/__proxy/rinf': eraProxy('https://rinf.data.era.europa.eu', '/api/v1/sparql/rinf'),
      '/__proxy/evr': eraProxy('https://graph.tst.data.test-era.europa.eu', '/repositories/EVR-KG'),
    },
  },
})
