import { defineConfig } from '@playwright/test'

/**
 * The browser extension's end-to-end tests (ADR 0010), separate from the Electron suite: different
 * target, different browser, and they need `npm run build:extension` first, which the script does.
 */
export default defineConfig({
  testDir: './test/extension',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: { trace: 'retain-on-failure' },
})
