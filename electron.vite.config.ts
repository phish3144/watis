import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import {
  SQLITE,
  TESSERACT_COMPONENTS,
  collectPackages,
  mit,
  writeNotices,
} from './scripts/third-party-notices.mjs'

const shared = resolve(__dirname, 'src/shared')
const platform = resolve(__dirname, 'src/platform')

/** Every npm package bundled into main, preload or renderer: their licence files stay behind. */
const bundled = new Set<string>()

/**
 * Writes out/THIRD_PARTY_NOTICES.txt once the renderer, the last of the three builds, is done. The
 * dependencies that stay in node_modules carry their own licence files into the package; this file
 * has the rest — what the bundles took in, and what tesseract.js-core and @transcribe/shout contain
 * without listing it. electron-builder.yml puts it next to app.asar.
 */
function notices(): Plugin {
  return {
    name: 'watis-third-party-notices',
    apply: 'build',
    closeBundle() {
      writeNotices({
        root: __dirname,
        file: resolve(__dirname, 'out/THIRD_PARTY_NOTICES.txt'),
        product: 'WatIs? (desktop app)',
        packages: bundled,
        extras: [
          SQLITE,
          {
            name: 'whisper.cpp (inside @transcribe/shout)',
            licence: 'MIT',
            text: mit('Copyright (c) 2023-2024 The ggml authors'),
          },
          ...TESSERACT_COMPONENTS,
          {
            name: 'OpenAI Whisper model weights (downloaded on request, not part of this package)',
            licence: 'MIT',
            text: mit('Copyright (c) 2022 OpenAI'),
          },
        ],
      })
    },
  }
}

export default defineConfig({
  main: {
    plugins: [collectPackages(bundled)],
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
    plugins: [collectPackages(bundled)],
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
    plugins: [react(), tailwindcss(), collectPackages(bundled), notices()],
    resolve: {
      alias: { '@shared': shared, '@renderer': resolve(__dirname, 'src/renderer/src') },
    },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
})
