import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/**
 * The bridge is built separately from the three electron-vite sections because it is neither main,
 * preload nor renderer: it is a string the main process injects into somebody else's page.
 *
 * That dictates the output — one self-contained IIFE, no imports, no `process`, no Node builtins.
 * Anything the bundle expected from a module system would throw inside a WhatsApp stack frame.
 */
export default defineConfig({
  build: {
    outDir: resolve(__dirname, 'out/bridge'),
    emptyOutDir: true,
    // WhatsApp Web runs on a current Chromium; the bundle rides in the same engine, so there is
    // nothing to down-level for.
    target: 'chrome120',
    lib: {
      entry: resolve(__dirname, 'src/bridge/index.ts'),
      formats: ['iife'],
      name: '__watisBridgeBundle',
      fileName: () => 'bridge.js',
    },
    rollupOptions: {
      // A library build would otherwise warn about an entry with no exports; there is nothing to
      // export, the entry's side effect is the point.
      output: { extend: true },
    },
    minify: false,
    sourcemap: false,
  },
})
