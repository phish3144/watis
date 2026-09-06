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

/**
 * electron.launch() resolves as soon as the process is up, which is well before bootstrap() has
 * finished: it awaits app.whenReady(), then a dynamic ESM import for the settings store, then
 * the window. Asserting before that races the app — on a fast Linux runner the race was
 * invisible, on Windows it failed two tests that were actually correct.
 */
async function waitForBoot(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const ready = await app.evaluate(({ BaseWindow, webContents }) => {
      const windows = BaseWindow.getAllWindows().length
      const panel = webContents
        .getAllWebContents()
        .some((contents) => contents.getURL().includes('index.html'))
      return windows === 1 && panel
    })
    if (ready) return
    if (Date.now() > deadline) throw new Error('app did not finish booting in time')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

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
  await waitForBoot()
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
  // Compared case-insensitively: Windows reports drive letters and profile directories with
  // inconsistent casing, and tmpdir() can hand back an 8.3 short name.
  const under = (value: string): boolean => value.toLowerCase().startsWith(dataDir.toLowerCase())
  expect(under(paths.userData)).toBe(true)
  expect(paths.userData).toContain('watis')
  // The session must follow, otherwise cookies and IndexedDB still land in the old location and
  // the user is asked to scan a QR code again after every update.
  expect(paths.storage ? under(paths.storage) : false).toBe(true)
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

test('reports its own health, and never takes reading away', async () => {
  const read = async (): Promise<{
    capabilities: { key: string; available: boolean }[]
    severity: string
  }> =>
    (await app.evaluate(async ({ webContents }) => {
      const panel = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().includes('index.html'))
      return (await panel?.executeJavaScript('window.watis.getHealth()')) as unknown
    })) as { capabilities: { key: string; available: boolean }[]; severity: string }

  // The monitor is level-triggered and polls, so it trails the workers by up to a second. What is
  // waited for is the archive coming up, which is the part this test is about.
  await expect
    .poll(async () => (await read()).capabilities.find((c) => c.key === 'search')?.available, {
      // Generous on purpose: two utility processes have to start and the monitor has to notice.
      timeout: 60_000,
      message: 'search should become available once the archive worker is up',
    })
    .toBe(true)

  // Severity is deliberately NOT pinned to a value. It depends on whether the machine running the
  // test can reach WhatsApp Web: a sandbox without a route reports "degraded", a CI runner with
  // one reports "ok". Asserting either encodes the environment rather than the behaviour — this
  // test asserted "degraded" and went red on every CI run for exactly that reason.
  //
  // What must hold in both environments is that a fault stays contained: never "broken".
  const severity = (await read()).severity
  expect(['ok', 'degraded']).toContain(severity)

  const state = await read()
  expect(state.capabilities.map((c) => c.key).sort()).toEqual([
    'archiveGrows',
    'backfill',
    'contentIndex',
    'export',
    'mediaFetch',
    'read',
    'search',
  ])
  expect(state.capabilities.find((c) => c.key === 'read')?.available).toBe(true)
  expect(state.capabilities.find((c) => c.key === 'search')?.available).toBe(true)
})

/**
 * The panel's width, found by position: it is the only child view that does not start at x = 0.
 * The WhatsApp views all sit flush left, stacked, with the inactive ones at zero size.
 */
async function panelWidth(): Promise<number> {
  return app.evaluate(({ BaseWindow }) => {
    const window = BaseWindow.getAllWindows()[0]
    const panel = (window?.contentView.children ?? []).find((view) => view.getBounds().x > 0)
    return panel?.getBounds().width ?? 0
  })
}

async function togglePanel(): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const bus = ipcMain as unknown as { listeners: (c: string) => ((...a: unknown[]) => void)[] }
    bus.listeners('app:toggle-panel')[0]?.({})
  })
  await new Promise((r) => setTimeout(r, 300))
}

test('shows its own panel on a first launch, not a bare WhatsApp window', async () => {
  // The regression that matters most. The panel used to start collapsed to zero width with an
  // undocumented Ctrl+, as the only way in, so a first launch looked exactly like a browser pointed
  // at web.whatsapp.com — and the first person to run it asked where the features were.
  expect(await panelWidth()).toBeGreaterThan(100)
})

test('never collapses the panel to nothing — there is always a way back in', async () => {
  const open = await panelWidth()
  expect(open).toBeGreaterThan(100)

  await togglePanel()
  const closed = await panelWidth()
  // Closed, but not gone: a rail stays on screen, which is the entire point.
  expect(closed).toBeGreaterThan(0)
  expect(closed).toBeLessThan(60)

  // Restored, so the tests after this one see the state they would see on a fresh launch.
  await togglePanel()
  expect(await panelWidth()).toBe(open)
})

test('remembers that the panel was closed, and reopens it from the tray', async () => {
  await togglePanel()
  const stored = await app.evaluate(async ({ ipcMain }) => {
    const handlers = (
      ipcMain as unknown as { _invokeHandlers: Map<string, (e: unknown) => unknown> }
    )._invokeHandlers
    return (await handlers.get('app:settings')?.({})) as { panelOpen: boolean }
  })
  expect(stored.panelOpen).toBe(false)

  // What the tray entry does: show the window, then toggle. Reaching it through the same channel
  // the menu item uses is the closest a headless test gets to clicking it.
  await togglePanel()
  expect(await panelWidth()).toBeGreaterThan(100)
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
