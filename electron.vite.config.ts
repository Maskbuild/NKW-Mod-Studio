import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const alias = { '@core': resolve(__dirname, 'src/core') }

/** Strict CSP in production; dev additionally allows Vite's HMR preamble and websocket. */
function csp(): Plugin {
  const common = [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: nkw-asset:",
    "media-src 'self' blob: nkw-asset:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'"
  ]
  return {
    name: 'nkw-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const dev = !!ctx.server
        const policy = [
          ...common,
          dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
          dev ? "connect-src 'self' nkw-asset: ws://localhost:* http://localhost:*" : "connect-src 'self' nkw-asset:"
        ].join('; ')
        return html.replace('%NKW_CSP%', policy)
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].js' } } }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { ...alias, '@': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react(), csp()],
    worker: { format: 'es' },
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } }
  }
})
