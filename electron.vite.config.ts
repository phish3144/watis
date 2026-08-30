import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve(__dirname, 'src/shared')
const platform = resolve(__dirname, 'src/platform')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared, '@platform': platform } },
    build: {
      externalizeDeps: true,
      rollupOptions: {
        // The two utilityProcess entries are built as part of the MAIN section on purpose:
        // that gives them the node target, the electron/builtin externals and ssr:true for
        // free, and lands them in out/main/ next to index.js — so resolving them at runtime
        // with path.join(__dirname, 'archive.js') works identically in dev and when packaged.
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          archive: resolve(__dirname, 'src/workers/archive/index.ts'),
          contentIndex: resolve(__dirname, 'src/workers/content-index/index.ts'),
        },
      },
    },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: {
          // The WhatsApp view's preload stays sandboxed, so it must be CommonJS.
          wa: resolve(__dirname, 'src/preload/wa.ts'),
          app: resolve(__dirname, 'src/preload/app.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@shared': shared, '@renderer': resolve(__dirname, 'src/renderer/src') },
    },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
})
