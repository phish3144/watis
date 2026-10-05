import { defineConfig } from '@playwright/test'

/**
 * Pictures for the extension stores (test/extension/store-assets.ts), not a test suite: run by
 * `npm run store:assets`, never in CI.
 */
export default defineConfig({
  testDir: './test/extension',
  testMatch: 'store-assets.ts',
  timeout: 240_000,
  workers: 1,
  reporter: [['list']],
})
