import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * The archive's repository and schema tests that go through `test/helpers/sql.ts` run twice: once
 * on better-sqlite3 (the desktop app) and once on SQLite-WASM (the browser extension, ADR 0010).
 * The list is explicit rather than a glob, because a test that opens better-sqlite3 directly
 * (backups, the schema-ownership race, the content index) would run the same engine twice and
 * prove nothing about the second one.
 */
const ON_BOTH_ENGINES = [
  'test/integration/archive-repository.test.ts',
  'test/integration/archive-schema.test.ts',
  'test/integration/gallery.test.ts',
  'test/integration/hit-previews.test.ts',
  'test/integration/name-search.test.ts',
  'test/integration/reminders.test.ts',
  'test/integration/sync-state.test.ts',
]

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@platform': resolve(__dirname, 'src/platform'),
    },
  },
  test: {
    environment: 'node',
    reporters: 'default',
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'sqlite-wasm',
          include: ON_BOTH_ENGINES,
          env: { WATIS_SQL_BACKEND: 'wasm' },
        },
      },
    ],
  },
})
