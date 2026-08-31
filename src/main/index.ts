import { app, globalShortcut, ipcMain } from 'electron'

// This has to happen before app.whenReady() and before anything touches `session`, so it is the
// very first statement in the entry point. Called late, setPath fails silently and the session
// keeps writing into the roaming profile. See paths.ts.
import { appPaths, assertPathsApplied, configurePaths } from './paths'
const paths = configurePaths()

import { join } from 'node:path'
import { APP_ID, DISPLAY_NAME, WA_PARTITION } from '@shared/app-identity'
import { settingsPatchSchema, type Settings } from '@shared/settings'
import { assess } from '@shared/health/degraded'
import { configureLogging, log } from './logging'
import { applyUserAgent } from './user-agent'
import { startEventLoopWatchdog } from './watchdog'
import { createMainWindow, type MainWindow } from './window/main-window'
import { initWindowState } from './window/bounds'
import { WorkerSupervisor } from './workers/supervisor'
import { initSettings, onSettingsChanged, settings, updateSettings } from './config/store'
import { TrayController } from './tray'
import { NotificationManager, type IncomingNotification } from './notifications'
import { UiLayer } from './ui-layer'
import { installDownloadHandler } from './downloads'
import { configureUpdater } from './updater'
import { HealthMonitor } from './health/monitor'
import { BridgeHost } from './bridge/host'
import { Importer } from './archive/importer'
import { BackfillController } from './backfill/controller'
import { startIndexSignals } from './index-signals'
import { MediaFetcher } from './archive/media-fetcher'
import { ExportSchedule } from './export/schedule'
import { clearDisposableCaches, measureStorage } from './storage/overview'
import { platform } from '@platform/current'

// Binds toasts, taskbar grouping and the jump list to this app. Must match electron-builder's
// appId exactly, or Windows notifications fail with no error and no way to reproduce it in dev.
app.setAppUserModelId(APP_ID)
configureLogging()

const supervisor = new WorkerSupervisor()
let mainWindow: MainWindow | undefined
let tray: TrayController | undefined
let notifications: NotificationManager | undefined
let uiLayer: UiLayer | undefined
let health: HealthMonitor | undefined
let bridge: BridgeHost | undefined
let importer: Importer | undefined
let backfill: BackfillController | undefined
let mediaFetcher: MediaFetcher | undefined
let exportSchedule: ExportSchedule | undefined
let stopWatchdog: (() => void) | undefined
let stopIndexSignals: (() => void) | undefined

let activeChat = ''
let pendingDownloadName: string | undefined
let quitting = false

// A second launch focuses the running instance instead of starting a rival that would fight over
// the same session and SQLite WAL.
if (!app.requestSingleInstanceLock()) {
  log.info('another instance holds the lock; exiting')
  app.quit()
} else {
  app.on('second-instance', () => {
    mainWindow?.show()
  })
  void bootstrap()
}

async function bootstrap(): Promise<void> {
  await app.whenReady()

  assertPathsApplied()
  const config = await initSettings()
  if (!config.downloadDir) {
    updateSettings({ downloadDir: join(app.getPath('downloads'), 'WhatsApp') })
  }

  log.info(`${DISPLAY_NAME} ${app.getVersion()} starting`)
  log.info(`data root: ${paths.root}`)
  log.info(`user agent: ${applyUserAgent()}`)
  log.info(`platform: ${platform().id}`)

  stopWatchdog = startEventLoopWatchdog()
  supervisor.start('archive')
  supervisor.start('contentIndex')

  await initWindowState()
  const startMinimised = process.argv.includes('--minimised') || settings().startMinimised
  mainWindow = createMainWindow({ startMinimised })

  notifications = new NotificationManager(
    () => mainWindow?.window,
    () => mainWindow?.wa.webContents,
  )
  uiLayer = new UiLayer(() => mainWindow?.wa.webContents)
  tray = new TrayController({
    window: () => mainWindow?.window,
    showWindow: () => mainWindow?.show(),
    togglePanel: () => mainWindow?.togglePanel(),
    isPaused: () => notifications?.isPaused() ?? false,
    setPaused: (paused) => notifications?.setPaused(paused),
    quit: () => {
      quitting = true
      app.quit()
    },
  })
  tray.start()

  installDownloadHandler(
    // The WhatsApp view's session, not the default one.
    mainWindow.wa.webContents.session,
    {
      activeChat: () => activeChat,
      takeSuggestedName: () => {
        const name = pendingDownloadName
        pendingDownloadName = undefined
        return name
      },
    },
  )

  registerIpcHandlers()
  installWindowBehaviour()
  applyGlobalShortcut(settings().globalShortcut)
  platform().setAutostart({
    enabled: settings().autostart,
    minimised: settings().startMinimised,
  })

  // Re-apply the CSS layer on every document load: insertCSS survives WhatsApp's SPA route
  // changes but not a reload.
  mainWindow.wa.webContents.on('did-finish-load', () => {
    void uiLayer?.apply(settings())
  })

  onSettingsChanged((next) => {
    void uiLayer?.apply(next)
    applyGlobalShortcut(next.globalShortcut)
    tray?.rebuildMenu()
    mainWindow?.panel.webContents.send('app:settings', next)
  })

  health = new HealthMonitor({
    workerReady: (name) => supervisor.isReady(name),
    // A document that failed to load, or never loaded, is indistinguishable to the user from
    // WhatsApp being offline — and it is the same advice either way.
    whatsappLoaded: () => mainWindow?.wa.webContents.getURL().startsWith('https://') === true,
  })
  health.onChange((state) => {
    mainWindow?.panel.webContents.send('app:health', state)
  })
  health.start()

  mainWindow.wa.webContents.on('did-fail-load', (_event, code, description) => {
    log.warn(`WhatsApp view failed to load: ${description} (${code})`)
    health?.refresh()
  })
  mainWindow.wa.webContents.on('did-finish-load', () => health?.refresh())

  // Bridge -> importer -> archive worker. The importer is what keeps the main process out of the
  // per-message path: events land in its ring buffer and leave in batches (§3.1).
  importer = new Importer((request) => supervisor.request('archive', request))
  importer.start()

  bridge = new BridgeHost({
    onEvents: (events) => {
      for (const event of events) importer?.push(event)
    },
    onHealth: (report) => {
      health?.set('bridge-unavailable', !report.ok)
      mainWindow?.panel.webContents.send('app:bridge', report)
    },
    onSnapshotDone: () => {
      log.info('bridge finished its initial snapshot')
    },
  })
  bridge.attach(mainWindow.wa.webContents)

  backfill = new BackfillController({
    bridge,
    archive: (request) => supervisor.request('archive', request),
    onChange: (snapshot) => {
      mainWindow?.panel.webContents.send('app:backfill', snapshot)
    },
  })

  mediaFetcher = new MediaFetcher({
    bridge,
    archive: (request) => supervisor.request('archive', request),
  })
  mediaFetcher.start()

  exportSchedule = new ExportSchedule({
    archive: (request) => supervisor.request('archive', request),
  })
  void exportSchedule.start()

  stopIndexSignals = startIndexSignals(supervisor)

  configureUpdater({ enabled: true })

  app.on('activate', () => {
    mainWindow?.show()
  })
}

function installWindowBehaviour(): void {
  const window = mainWindow?.window
  if (!window) return

  window.on('close', (event) => {
    // Close-to-tray is what makes this a day client: the window goes away, the process stays,
    // notifications keep arriving.
    if (!quitting && settings().closeToTray) {
      event.preventDefault()
      window.hide()
    }
  })
}

let registeredShortcut: string | undefined

function applyGlobalShortcut(accelerator: string): void {
  if (registeredShortcut === accelerator) return
  if (registeredShortcut) globalShortcut.unregister(registeredShortcut)
  registeredShortcut = undefined
  if (!accelerator) return
  try {
    const ok = globalShortcut.register(accelerator, () => {
      const window = mainWindow?.window
      if (!window) return
      if (window.isVisible() && window.isFocused()) window.hide()
      else mainWindow?.show()
    })
    if (ok) registeredShortcut = accelerator
    else log.warn(`global shortcut ${accelerator} is already taken by another application`)
  } catch (error: unknown) {
    log.warn(`invalid global shortcut ${accelerator}: ${String(error)}`)
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('app:versions', () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }))

  ipcMain.handle('app:worker-health', () => ({
    archive: supervisor.isReady('archive'),
    contentIndex: supervisor.isReady('contentIndex'),
  }))

  ipcMain.handle('app:paths', () => ({ ...appPaths() }))
  ipcMain.handle('app:settings', () => settings())

  ipcMain.handle('app:update-settings', (_event, patch: unknown): Settings => {
    const parsed = settingsPatchSchema.safeParse(patch)
    if (!parsed.success) {
      log.warn(`rejected invalid settings patch: ${parsed.error.message}`)
      return settings()
    }
    const next = updateSettings(parsed.data)
    if (parsed.data.autostart !== undefined || parsed.data.startMinimised !== undefined) {
      platform().setAutostart({ enabled: next.autostart, minimised: next.startMinimised })
    }
    return next
  })

  // One channel for the whole archive data plane. The renderer never speaks to the worker
  // directly, and the worker validates the payload itself — see archive-protocol.ts.
  ipcMain.handle('archive:request', async (_event, payload: unknown): Promise<unknown> => {
    try {
      return await supervisor.request('archive', payload)
    } catch (error: unknown) {
      // The renderer gets the rejection either way; the monitor turns the ones it recognises —
      // a full disk, a locked database — into something the user can read and act on.
      health?.report(error)
      throw error
    }
  })

  ipcMain.handle('app:health', () => health?.state() ?? assess([]))

  // Backpressure, so the panel can show a mirror that is falling behind instead of silently
  // dropping events (PLAN.md Phase 3).
  ipcMain.handle('app:import-stats', () => importer?.stats() ?? null)

  ipcMain.handle('app:storage', () => measureStorage())
  ipcMain.handle('app:clear-caches', async () => {
    await clearDisposableCaches()
    return measureStorage()
  })

  ipcMain.handle('app:export-schedule', () => exportSchedule?.state() ?? null)
  ipcMain.handle('app:export-now', () => exportSchedule?.tick(true) ?? false)

  ipcMain.handle('app:backup', async (_event, payload: unknown) => {
    const args = payload as { targetDir?: unknown; includeBlobs?: unknown }
    if (typeof args?.targetDir !== 'string') throw new Error('targetDir is required')
    return supervisor.request('archive', {
      op: 'backup',
      targetDir: args.targetDir,
      includeBlobs: args.includeBlobs !== false,
    })
  })

  ipcMain.handle('app:media-stats', () => mediaFetcher?.stats() ?? null)

  // "Videos on click" (§10): the automatic rules leave big files alone, and this is the user
  // saying they want this one.
  ipcMain.handle('media:fetch-now', async (_event, payload: unknown) => {
    const candidate = payload as { id?: unknown }
    if (typeof candidate?.id !== 'string') throw new Error('id is required')
    if (!mediaFetcher) throw new Error('not ready')
    return mediaFetcher.fetchNow(candidate as { id: string })
  })

  ipcMain.handle('app:index-status', () => supervisor.request('contentIndex', { op: 'status' }))
  ipcMain.handle('app:reindex', (_event, payload: unknown) => {
    const kind = (payload as { kind?: unknown })?.kind
    if (typeof kind !== 'string') throw new Error('kind is required')
    return supervisor.request('contentIndex', { op: 'reindex', kind })
  })

  // The initial mirror is a user action, not something that runs on its own at startup: it walks
  // every collection WhatsApp has in memory and the user should decide when to pay for that.
  ipcMain.handle('bridge:snapshot', async () => {
    if (!bridge?.ready) throw new Error('bridge is not available')
    return bridge.send('snapshot')
  })

  // "Im WhatsApp-Chat öffnen" (Phase 4). Opening a chat is a user action, so WhatsApp marking it
  // read is accepted — ADR 0006. That is also why the panel closes first: what happens next has to
  // be visible to the person who asked for it.
  ipcMain.handle('bridge:open-chat', async (_event, payload: unknown) => {
    const args = payload as { chatId?: unknown; msgId?: unknown }
    if (typeof args?.chatId !== 'string') throw new Error('chatId is required')
    if (!bridge?.ready) throw new Error('bridge is not available')
    mainWindow?.setPanelVisible(false)
    mainWindow?.show()
    return bridge.send('openChat', {
      chatId: args.chatId,
      ...(typeof args.msgId === 'string' ? { msgId: args.msgId } : {}),
    })
  })

  // The backfill only ever runs because somebody pressed start: it opens chats, and opening a chat
  // marks it read (ADR 0006).
  ipcMain.handle('backfill:state', () => ({
    ...backfill?.snapshot(),
    pauseReason: backfill?.pauseReason(),
  }))

  ipcMain.handle('backfill:start', async (_event, payload: unknown) => {
    const args = payload as { chatIds?: unknown }
    const chatIds = Array.isArray(args?.chatIds)
      ? args.chatIds.filter((id): id is string => typeof id === 'string')
      : []
    if (!backfill) throw new Error('not ready')
    await backfill.restore(chatIds)
    return backfill.start()
  })

  ipcMain.handle('backfill:stop', () => {
    backfill?.stop()
    return true
  })

  ipcMain.handle('bridge:load-older', async (_event, payload: unknown) => {
    const args = payload as { chatId?: unknown }
    if (typeof args?.chatId !== 'string') throw new Error('chatId is required')
    if (!bridge?.ready) throw new Error('bridge is not available')
    return bridge.send('loadOlder', { chatId: args.chatId })
  })

  ipcMain.on('app:toggle-panel', () => {
    mainWindow?.togglePanel()
  })

  // --- from the WhatsApp view ------------------------------------------------

  ipcMain.on('wa:notification', (_event, payload: unknown) => {
    const notification = payload as IncomingNotification
    if (typeof notification?.id !== 'string') return
    notifications?.handle(notification)
  })

  ipcMain.on('wa:unread', (_event, payload: unknown) => {
    const counts = payload as { unread?: number; mutedUnread?: number }
    const unread = typeof counts?.unread === 'number' ? counts.unread : 0
    const muted = typeof counts?.mutedUnread === 'number' ? counts.mutedUnread : 0
    tray?.setUnread(unread, settings().mutedChatsNotify ? muted : 0)
    mainWindow?.panel.webContents.send('app:unread', { unread, mutedUnread: muted })
  })

  ipcMain.on('wa:active-chat', (_event, title: unknown) => {
    if (typeof title !== 'string') return
    activeChat = title
    notifications?.setActiveChat(title)
  })

  ipcMain.on('wa:download-name', (_event, name: unknown) => {
    if (typeof name === 'string' && name.trim()) pendingDownloadName = name.trim()
  })
}

app.on('window-all-closed', () => {
  // With close-to-tray the window can be gone while the app keeps running on purpose.
  if (process.platform !== 'darwin' && !settings().closeToTray) app.quit()
})

app.on('before-quit', () => {
  quitting = true
})

// The workers must be down before the process goes away. A worker still holding the SQLite WAL
// at update time is what produces the "application cannot be closed" dialog and a failed update.
let shuttingDown = false
app.on('will-quit', (event) => {
  globalShortcut.unregisterAll()
  if (shuttingDown) return
  event.preventDefault()
  shuttingDown = true
  stopWatchdog?.()
  stopIndexSignals?.()
  health?.stop()
  notifications?.dispose()
  backfill?.stop()
  mediaFetcher?.stop()
  exportSchedule?.stop()
  bridge?.dispose()
  void importer?.stop()
  tray?.dispose()
  void supervisor.stopAll('app quitting').finally(() => {
    app.exit(0)
  })
})

export { WA_PARTITION }
