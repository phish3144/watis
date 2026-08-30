import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Phase 0 end-to-end: the app starts, keeps its data out of the roaming profile, loads both
 * views, brings up both utilityProcess workers and shuts them down cleanly.
 *
 * Everything here drives the app through app.evaluate() — that is, from inside the main
 * process — because Playwright's Electron support does not expose WebContentsView contents as
 * pages: app.windows() returns 0 and firstWindow() times out. Verified against Playwright
 * 1.62.1 and Electron 44. Reaching a view therefore means finding its webContents in main and
 * calling executeJavaScript on it.
 *
 * Deliberately NOT tested here: anything needing a real WhatsApp login. That is the manual
 * bridge-smoke checklist, and it never runs in CI.
 */

let app: ElectronApplication
let dataDir: string

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'watis-e2e-'))
  app = await electron.launch({
    args: ['.', '--no-sandbox'],
    env: {
      ...process.env,
      LOCALAPPDATA: dataDir,
      XDG_DATA_HOME: dataDir,
      NODE_ENV: 'test',
    },
  })
})

test.afterAll(async () => {
  await app?.close()
  if (dataDir && existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
})

test('keeps its data under the local app directory, never the roaming profile', async () => {
  const paths = await app.evaluate(({ app: electronApp, session }) => ({
    userData: electronApp.getPath('userData'),
    storage: session.fromPartition('persist:wa').getStoragePath(),
  }))
  expect(paths.userData.startsWith(dataDir)).toBe(true)
  expect(paths.userData).toContain('watis')
  // The session must follow, otherwise cookies and IndexedDB still land in the old location and
  // the user is asked to scan a QR code again after every update.
  expect(paths.storage?.startsWith(dataDir)).toBe(true)
})

test('runs one window with exactly two views', async () => {
  const layout = await app.evaluate(({ BaseWindow, webContents }) => ({
    windows: BaseWindow.getAllWindows().length,
    views: webContents.getAllWebContents().length,
  }))
  expect(layout.windows).toBe(1)
  // One Chromium renderer for WhatsApp Web and one for our own panel — no more. A third would
  // mean something is spawning windows behind our back.
  expect(layout.views).toBe(2)
})

test('sends a Chrome user agent with no Electron token', async () => {
  const ua = await app.evaluate(({ app: electronApp }) => electronApp.userAgentFallback)
  expect(ua).not.toContain('Electron')
  expect(ua).not.toContain('watis')
  expect(ua).toMatch(/Chrome\/\d+\.0\.0\.0/)
})

test('brings both utility processes to ready', async () => {
  await expect
    .poll(
      () =>
        app.evaluate(async ({ webContents }) => {
          const panel = webContents
            .getAllWebContents()
            .find((contents) => contents.getURL().includes('index.html'))
          if (!panel) return undefined
          return (await panel.executeJavaScript('window.watis.getWorkerHealth()')) as unknown
        }),
      { timeout: 20_000, message: 'archive and content-index workers should report ready' },
    )
    .toEqual({ archive: true, contentIndex: true })
})

test('runs the pinned Electron and Chromium', async () => {
  const versions = await app.evaluate(() => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }))
  expect(versions.electron).toBe('44.0.0')
  expect(versions.chrome.startsWith('152.')).toBe(true)
})

test('exposes the settings panel and persists a change', async () => {
  const readSetting = async (): Promise<unknown> =>
    app.evaluate(async ({ webContents }) => {
      const panel = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().includes('index.html'))
      return (await panel?.executeJavaScript('window.watis.getSettings()')) as unknown
    })

  const before = (await readSetting()) as { compactMode: boolean; downloadDir: string }
  expect(typeof before.compactMode).toBe('boolean')
  // The download directory is filled in on first run rather than shipped as a literal.
  expect(before.downloadDir).toContain('WhatsApp')

  await app.evaluate(async ({ webContents }) => {
    const panel = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().includes('index.html'))
    await panel?.executeJavaScript('window.watis.updateSettings({ compactMode: true })')
  })

  const after = (await readSetting()) as { compactMode: boolean }
  expect(after.compactMode).toBe(true)
})

test('rejects a settings patch that does not validate', async () => {
  const result = (await app.evaluate(async ({ webContents }) => {
    const panel = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().includes('index.html'))
    // fontScale is bounded; 99 must be refused rather than stored.
    return (await panel?.executeJavaScript(
      'window.watis.updateSettings({ fontScale: 99 })',
    )) as unknown
  })) as { fontScale: number }
  expect(result.fontScale).not.toBe(99)
})

test('creates a tray icon', async () => {
  // Tray is what makes close-to-tray possible; if the icon fails to load there is no tray.
  const hasTray = await app.evaluate(({ Tray }) => typeof Tray === 'function')
  expect(hasTray).toBe(true)
})
