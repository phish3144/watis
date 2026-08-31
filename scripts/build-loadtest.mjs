#!/usr/bin/env node
// Bundles the modules the load test measures into out/loadtest/ (PLAN.md §8).
//
// The load test has to run the SHIPPING code — the real repository, the real schema, the real
// queue — or it measures a copy that can quietly diverge from what users get. Those modules are
// TypeScript with path aliases, so they are bundled here rather than imported directly.
//
// This exists because the bundles were previously built by hand and `out/` is gitignored: the
// release gate did not run at all on a fresh clone, which is the one machine where it matters.

import { build } from 'esbuild'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

const ENTRIES = {
  normalise: 'src/shared/search/normalise.ts',
  query: 'src/shared/search/query.ts',
  schema: 'src/workers/archive/schema.ts',
  repository: 'src/workers/archive/repository.ts',
  queue: 'src/workers/content-index/queue.ts',
  pdfeng: 'src/workers/content-index/pdf-engine.ts',
}

await Promise.all(
  Object.entries(ENTRIES).map(([name, entry]) =>
    build({
      entryPoints: [resolve(root, entry)],
      outfile: resolve(root, 'out/loadtest', `${name}.mjs`),
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      // Native and heavy dependencies stay external: the load test provides its own better-sqlite3
      // handle, and bundling pdfjs would take longer than the run it supports.
      external: ['better-sqlite3', 'pdfjs-dist', 'tesseract.js', 'electron'],
      alias: {
        '@shared': resolve(root, 'src/shared'),
        '@platform': resolve(root, 'src/platform'),
      },
      logLevel: 'warning',
    }),
  ),
)

console.log(
  `ok    built ${String(Object.keys(ENTRIES).length)} load-test bundles into out/loadtest/`,
)
