import { app, globalShortcut, ipcMain, nativeImage, powerMonitor, shell } from 'electron'

// This has to happen before app.whenReady() and before anything touches `session`, so it is the
// very first statement in the entry point. Called late, setPath fails silently and the session
// keeps writing into the roaming profile. See paths.ts.
import { appPaths, assertPathsApplied, configurePaths } from './paths'
import { resourcePath } from './resources'
const paths = configurePaths()

import { join } from 'node:path'
import { APP_ID, DISPLAY_NAME, WA_PARTITION } from '@shared/app-identity'
import { settingsPatchSchema, type Settings } from '@shared/settings'
import { assess } from '@shared/health/degraded'
import {
  chatUrlFor,
  normaliseNumber,
  parseWhatsAppUrl,
  type ParsedTarget,
} from '@shared/extras/phone'
import { configureLogging, log } from './logging'
import { applyUserAgent } from './user-agent'
import { startEventLoopWatchdog } from './watchdog'
import { createMainWindow, type MainWindow } from './window/main-window'
import { initWindowState } from './window/bounds'
import { WorkerSupervisor } from './workers/supervisor'
import { initSettings, onSettingsChanged, settings, updateSettings } from './config/store'
import {
  accounts as accountList,
  activeAccountId,
  addAccount,
  initAccounts,
  removeAccount,
  renameAccount,
  setActiveAccount,
} from './config/accounts'
import { TrayController } from './tray'
import { NotificationManager, type IncomingNotification } from './notifications'
import { UiLayer } from './ui-layer'
import { installDownloadHandler } from './downloads'
import { configureUpdater } from './updater'
import { HealthMonitor } from './health/monitor'
import { AccountPipeline } from './accounts/pipeline'
import { startIndexSignals } from './index-signals'
import { applySpellcheck, availableLanguages } from './session/spellcheck'
import {
  installDisplayPicker,
  labelFor,
  type PickerResult,
  type PickerSource,
} from './media/display-picker'
import { ExportSchedule } from './export/schedule'
import { createReminderService, type ReminderService } from './reminders'
import { AppLock } from './lock'
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
/** One per account, keyed by account id. The active account's is the one the panel talks to. */
const pipelines = new Map<string, AccountPipeline>()
const unreadByAccount = new Map<string, { unread: number; mutedUnread: number }>()

/** Which account a message from a WhatsApp view belongs to, by matching the view's webContents. */
function accountIdOfSender(webContentsId: number): string | undefined {
  return mainWindow?.views().find((v) => v.view.webContents.id === webContentsId)?.accountId
}
let exportSchedule: ExportSchedule | undefined
let reminders: ReminderService | undefined
const appLock = new AppLock()
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
  app.on('second-instance', (_event, argv) => {
    mainWindow?.show()
    handleProtocolArgv(argv)
  })
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleProtocolArgv([url])
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

  // One worker pair per account: each account has its own database file, and one worker serving
  // several archives would mean a filter deciding which messages somebody sees (PLAN.md Phase 8).
  const accountState = await initAccounts()
  for (const account of accountState.accounts) {
    supervisor.start('archive', account.id)
    supervisor.start('contentIndex', account.id)
  }

  await appLock.load()
  await initWindowState()
  const startMinimised = process.argv.includes('--minimised') || settings().startMinimised
  mainWindow = createMainWindow({
    startMinimised,
    accountIds: accountState.accounts.map((a) => a.id),
    activeAccountId: accountState.activeId,
  })

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

  // Screen sharing. Without a handler Chromium's picker never appears in an Electron app and the
  // share fails silently, which reads as a broken feature rather than a missing one.
  installDisplayPicker(mainWindow.wa.webContents.session, askForDisplaySource)

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
    // The speller lives on the session, not the view, so it is re-applied here rather than in the
    // CSS layer — and switching it off has to take effect without a restart.
    const waSession = mainWindow?.wa.webContents.session
    if (waSession) applySpellcheck(waSession, next.spellcheckLanguages)
    applyGlobalShortcut(next.globalShortcut)
    tray?.rebuildMenu()
    mainWindow?.panel.webContents.send('app:settings', next)
  })

  health = new HealthMonitor({
    workerReady: (name) => supervisor.isReady(name, activeAccountId()),
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

  // One pipeline per account: bridge -> importer -> that account's archive worker. Every account
  // mirrors, including the ones behind — an unread badge over an archive that stopped growing is
  // worse than having no second account at all.
  for (const account of accountState.accounts) buildPipeline(account.id)

  exportSchedule = new ExportSchedule({
    archive: (request) => supervisor.request('archive', request, { accountId: activeAccountId() }),
  })
  void exportSchedule.start()

  reminders = createReminderService({
    archive: (request) => supervisor.request('archive', request, { accountId: activeAccountId() }),
    openChat: (chatId, msgId) => {
      mainWindow?.setPanelVisible(false)
      mainWindow?.show()
      void pipelines.get(activeAccountId())?.bridge.send('openChat', { chatId, msgId })
    },
  })
  reminders.start()

  applyLockToWindow()
  startLockIdleWatch()

  stopIndexSignals = startIndexSignals(supervisor, () => accountList().map((a) => a.id))

  // whatsapp:// and wa.me links open here instead of the browser. HKCU only — never HKLM, which
  // would need admin rights the project does not ask for.
  if (settings().handleWhatsappLinks) {
    for (const scheme of ['whatsapp']) {
      const ok = platform().registerProtocolHandler(scheme)
      log.info(`protocol handler for ${scheme}: ${ok ? 'registered' : 'refused'}`)
    }
  }

  configureUpdater({ enabled: true })

  app.on('activate', () => {
    mainWindow?.show()
  })

  // A link that started this instance, rather than one handed to a running one.
  handleProtocolArgv(process.argv)
}

/**
 * Asks the user which screen or window to share.
 *
 * A native message box rather than a custom window: it is modal to the right window, it cannot be
 * missed behind the WhatsApp view, and a share request is exactly the moment not to be inventing
 * interface. `useSystemPicker` means this is only reached where the OS has no picker of its own.
 */
async function askForDisplaySource(sources: PickerSource[]): Promise<PickerResult> {
  const window = mainWindow?.window
  if (!window || sources.length === 0) return { cancelled: true }

  const { dialog } = await import('electron')
  const labels = sources.map((source) => labelFor(source.name, source.kind))
  const result = await dialog.showMessageBox(window, {
    type: 'question',
    title: 'Bildschirm teilen',
    message: 'Was soll geteilt werden?',
    detail: 'WhatsApp bekommt nur das ausgewählte Bild. Ton wird nicht mit übertragen.',
    buttons: [...labels, 'Abbrechen'],
    cancelId: labels.length,
    defaultId: 0,
    noLink: true,
  })

  const chosen = sources[result.response]
  return chosen ? { source: chosen } : { cancelled: true }
}

/** Wires one account's view to its own archive. Called at start and when an account is added. */
function buildPipeline(accountId: string): void {
  const view = mainWindow?.viewFor(accountId)
  if (!view || pipelines.has(accountId)) return

  pipelines.set(
    accountId,
    new AccountPipeline({
      accountId,
      view,
      archive: (request) => supervisor.request('archive', request, { accountId }),
      onBridge: (id, report) => {
        // Only the account in front decides the banner: a background account's bridge being down
        // is worth knowing, but not worth covering the chat somebody is reading.
        if (id === activeAccountId()) health?.set('bridge-unavailable', !report.ok)
        mainWindow?.panel.webContents.send('app:bridge', { accountId: id, ...report })
      },
      onBackfill: (id, snapshot) => {
        mainWindow?.panel.webContents.send('app:backfill', { accountId: id, ...snapshot })
      },
    }),
  )
}

/** The pipeline of the account currently in front, which is what the panel's channels act on. */
function activePipeline(): AccountPipeline | undefined {
  return pipelines.get(activeAccountId())
}

function numberTarget(raw: string): ParsedTarget | undefined {
  const number = normaliseNumber(raw)
  return number ? { number } : undefined
}

function openNumber(target: ParsedTarget): void {
  mainWindow?.setPanelVisible(false)
  mainWindow?.show()
  void mainWindow?.wa.webContents.loadURL(chatUrlFor(target))
}

/**
 * A `whatsapp://` link handed over by the OS.
 *
 * On Windows it arrives as an argument to a second launch, which the single-instance lock turns
 * into `second-instance`; on macOS it arrives as `open-url`. Both end up here.
 */
function handleProtocolArgv(argv: readonly string[]): void {
  const link = argv.find((arg) => arg.startsWith('whatsapp:') || arg.includes('wa.me/'))
  if (!link) return
  const target = parseWhatsAppUrl(link)
  if (target) openNumber(target)
  else log.warn(`could not make sense of the link ${link.slice(0, 120)}`)
}

/**
 * Blurs the WhatsApp view, or takes the blur away.
 *
 * `insertCSS` returns a key and the only way to undo it is `removeInsertedCSS`; inserting an empty
 * stylesheet does nothing at all, which would leave the blur on forever. So the key is held.
 *
 * A CSS filter rather than a screenshot or an overlay window: it survives resizing, costs nothing,
 * and cannot get out of step with what is underneath.
 */
let blurKey: string | undefined

async function setBlur(on: boolean, block: boolean): Promise<void> {
  const contents = mainWindow?.wa.webContents
  if (!contents) return
  if (blurKey) {
    await contents.removeInsertedCSS(blurKey).catch(() => undefined)
    blurKey = undefined
  }
  if (!on) return
  const pointer = block ? 'pointer-events:none!important;' : ''
  blurKey = await contents.insertCSS(`html{filter:blur(18px) saturate(0.6)!important;${pointer}}`)
}

/** Puts the window into or out of the locked state. The panel hosts the unlock screen. */
function applyLockToWindow(): void {
  const locked = appLock.isLocked
  // Locked: the panel must be on screen, because that is where the PIN is entered. Unlocked: leave
  // it however the user had it.
  if (locked) mainWindow?.setPanelVisible(true)
  void setBlur(locked, true)
  mainWindow?.panel.webContents.send('app:lock', appLock.state())
}

/** Locks again after the configured idle time. Polled, because idle time has no event. */
function startLockIdleWatch(): void {
  const timer = setInterval(() => {
    if (!appLock.state().configured) return
    let idle: number
    try {
      idle = powerMonitor.getSystemIdleTime()
    } catch {
      // No idle information on this platform: the lock then only applies at start, which is what
      // the setting already allows for.
      return
    }
    if (appLock.lockIfIdle(idle)) applyLockToWindow()
  }, 15_000)
  timer.unref?.()
}

function installWindowBehaviour(): void {
  const window = mainWindow?.window
  if (!window) return

  // Losing focus with a PIN set means somebody may be looking at the screen who should not be.
  window.on('blur', () => {
    if (!appLock.state().configured || appLock.isLocked) return
    void mainWindow?.wa.webContents.insertCSS('html{filter:blur(18px) saturate(0.6)!important}')
  })
  window.on('focus', () => {
    if (appLock.isLocked) return
    void mainWindow?.wa.webContents.insertCSS('')
  })

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
    archive: supervisor.isReady('archive', activeAccountId()),
    contentIndex: supervisor.isReady('contentIndex', activeAccountId()),
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
      // The panel always speaks to the account in front. Nothing it can send names an account,
      // which is deliberate: an id crossing that boundary would be one more thing that could point
      // at the wrong person's messages.
      return await supervisor.request('archive', payload, { accountId: activeAccountId() })
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
  ipcMain.handle('app:import-stats', () => activePipeline()?.stats() ?? null)

  ipcMain.handle('app:spellcheck-languages', () => {
    const waSession = mainWindow?.wa.webContents.session
    return waSession ? availableLanguages(waSession) : []
  })

  // --- accounts -------------------------------------------------------------
  ipcMain.handle('app:accounts', () => ({
    accounts: accountList(),
    activeId: activeAccountId(),
  }))

  ipcMain.handle('app:account-add', async (_event, payload: unknown) => {
    const label = (payload as { label?: unknown })?.label
    const account = await addAccount(typeof label === 'string' ? label : '')
    // Workers first, then the view: the panel switches to the new account as soon as it appears,
    // and an archive that is not open yet would greet it with an error.
    supervisor.start('archive', account.id)
    supervisor.start('contentIndex', account.id)
    mainWindow?.addAccountView(account.id)
    return { accounts: accountList(), activeId: activeAccountId() }
  })

  ipcMain.handle('app:account-rename', async (_event, payload: unknown) => {
    const args = payload as { id?: unknown; label?: unknown }
    if (typeof args?.id !== 'string' || typeof args.label !== 'string') {
      throw new Error('id and label are required')
    }
    return { accounts: await renameAccount(args.id, args.label), activeId: activeAccountId() }
  })

  ipcMain.handle('app:account-remove', async (_event, payload: unknown) => {
    const id = (payload as { id?: unknown })?.id
    if (typeof id !== 'string') throw new Error('id is required')
    mainWindow?.removeAccountView(id)
    await supervisor.stopAccount(id, 'account removed')
    const result = await removeAccount(id)
    mainWindow?.showAccount(activeAccountId())
    return { ...result, activeId: activeAccountId() }
  })

  ipcMain.handle('app:account-activate', async (_event, payload: unknown) => {
    const id = (payload as { id?: unknown })?.id
    if (typeof id !== 'string') throw new Error('id is required')
    await setActiveAccount(id)
    mainWindow?.showAccount(id)
    mainWindow?.panel.webContents.send('app:accounts', {
      accounts: accountList(),
      activeId: id,
    })
    return { accounts: accountList(), activeId: id }
  })

  ipcMain.handle('app:lock-state', () => appLock.state())

  ipcMain.handle('app:lock-configure', async (_event, payload: unknown) => {
    const args = payload as { pin?: unknown; idleSeconds?: unknown }
    if (typeof args?.pin !== 'string') throw new Error('pin is required')
    const state = await appLock.configure(
      args.pin,
      typeof args.idleSeconds === 'number' ? args.idleSeconds : 0,
    )
    applyLockToWindow()
    return state
  })

  ipcMain.handle('app:unlock', (_event, payload: unknown) => {
    const pin = (payload as { pin?: unknown })?.pin
    if (typeof pin !== 'string') throw new Error('pin is required')
    const ok = appLock.unlock(pin)
    applyLockToWindow()
    return ok
  })

  ipcMain.handle('app:lock-now', () => {
    appLock.lock()
    applyLockToWindow()
    return appLock.state()
  })

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
    return supervisor.request(
      'archive',
      {
        op: 'backup',
        targetDir: args.targetDir,
        includeBlobs: args.includeBlobs !== false,
      },
      { accountId: activeAccountId() },
    )
  })

  /**
   * Drag-out: the panel starts a native drag carrying a real file (PLAN.md Phase 2).
   *
   * `startDrag` needs a path on disk, so this only works for media whose blob is present — the
   * archive worker resolves that, because it owns the blob store and main is not allowed to touch
   * the disk. A file that is not there simply does not start a drag, rather than dragging a
   * placeholder that lands in the file manager as a broken file.
   */
  ipcMain.on('app:drag-out', (event, payload: unknown) => {
    const args = payload as { path?: unknown }
    if (typeof args?.path !== 'string' || args.path === '') return
    try {
      event.sender.startDrag({ file: args.path, icon: dragIcon() })
    } catch (error: unknown) {
      log.warn(`drag-out failed: ${String(error)}`)
    }
  })

  ipcMain.handle('app:blob-path', async (_event, payload: unknown) => {
    const args = payload as { mediaId?: unknown }
    if (typeof args?.mediaId !== 'string') throw new Error('mediaId is required')
    const result = (await supervisor.request(
      'archive',
      { op: 'blobPath', mediaId: args.mediaId },
      { accountId: activeAccountId() },
    )) as { path: string | null }
    return result.path
  })

  /**
   * Saves a set of archived media into a folder the user picks (PLAN.md Phase 2, "Sammel-Download").
   *
   * Hardlinks where the target is on the same filesystem and copies otherwise — the same rule the
   * export uses, and for the same reason: a save that fails is worse than one that takes longer.
   * Name collisions are numbered rather than overwritten; two photos from different chats can
   * genuinely share a filename.
   */
  ipcMain.handle('app:save-media', async (_event, payload: unknown) => {
    const args = payload as { mediaIds?: unknown }
    const ids = Array.isArray(args?.mediaIds)
      ? args.mediaIds.filter((id): id is string => typeof id === 'string')
      : []
    if (ids.length === 0) throw new Error('nothing selected')

    const window = mainWindow?.window
    if (!window) throw new Error('no window')
    const { dialog } = await import('electron')
    const chosen = await dialog.showOpenDialog(window, {
      title: `${String(ids.length)} Dateien speichern`,
      defaultPath: settings().downloadDir,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (chosen.canceled || !chosen.filePaths[0]) return { saved: 0, cancelled: true }

    return supervisor.request(
      'archive',
      { op: 'saveMedia', mediaIds: ids, targetDir: chosen.filePaths[0] },
      { accountId: activeAccountId() },
    )
  })

  ipcMain.handle('app:reveal', (_event, payload: unknown) => {
    const args = payload as { path?: unknown }
    if (typeof args?.path !== 'string') throw new Error('path is required')
    platform().showItemInFolder(args.path)
    return true
  })

  ipcMain.handle('app:open-path', async (_event, payload: unknown) => {
    const args = payload as { path?: unknown }
    if (typeof args?.path !== 'string') throw new Error('path is required')
    // Returns a non-empty string on failure, which is how shell.openPath reports "no application
    // is registered for this type" — worth passing on rather than claiming success.
    return shell.openPath(args.path)
  })

  ipcMain.handle('app:media-stats', () => activePipeline()?.mediaFetcher.stats() ?? null)

  // "Videos on click" (§10): the automatic rules leave big files alone, and this is the user
  // saying they want this one.
  ipcMain.handle('media:fetch-now', async (_event, payload: unknown) => {
    const candidate = payload as { id?: unknown }
    if (typeof candidate?.id !== 'string') throw new Error('id is required')
    const pipeline = activePipeline()
    if (!pipeline) throw new Error('not ready')
    return pipeline.mediaFetcher.fetchNow(candidate as { id: string })
  })

  ipcMain.handle('app:index-status', () =>
    supervisor.request('contentIndex', { op: 'status' }, { accountId: activeAccountId() }),
  )
  ipcMain.handle('app:reindex', (_event, payload: unknown) => {
    const kind = (payload as { kind?: unknown })?.kind
    if (typeof kind !== 'string') throw new Error('kind is required')
    return supervisor.request(
      'contentIndex',
      { op: 'reindex', kind },
      { accountId: activeAccountId() },
    )
  })

  // The initial mirror is a user action, not something that runs on its own at startup: it walks
  // every collection WhatsApp has in memory and the user should decide when to pay for that.
  ipcMain.handle('bridge:snapshot', async () => {
    const pipeline = activePipeline()
    if (!pipeline?.bridge.ready) throw new Error('bridge is not available')
    return pipeline.bridge.send('snapshot')
  })

  // "Im WhatsApp-Chat öffnen" (Phase 4). Opening a chat is a user action, so WhatsApp marking it
  // read is accepted — ADR 0006. That is also why the panel closes first: what happens next has to
  // be visible to the person who asked for it.
  ipcMain.handle('bridge:open-chat', async (_event, payload: unknown) => {
    const args = payload as { chatId?: unknown; msgId?: unknown }
    if (typeof args?.chatId !== 'string') throw new Error('chatId is required')
    const pipeline = activePipeline()
    if (!pipeline?.bridge.ready) throw new Error('bridge is not available')
    mainWindow?.setPanelVisible(false)
    mainWindow?.show()
    return pipeline.bridge.send('openChat', {
      chatId: args.chatId,
      ...(typeof args.msgId === 'string' ? { msgId: args.msgId } : {}),
    })
  })

  // The backfill only ever runs because somebody pressed start: it opens chats, and opening a chat
  // marks it read (ADR 0006).
  ipcMain.handle('backfill:state', () => ({
    ...activePipeline()?.backfill.snapshot(),
    pauseReason: activePipeline()?.backfill.pauseReason(),
  }))

  ipcMain.handle('backfill:start', async (_event, payload: unknown) => {
    const args = payload as { chatIds?: unknown }
    const chatIds = Array.isArray(args?.chatIds)
      ? args.chatIds.filter((id): id is string => typeof id === 'string')
      : []
    const pipeline = activePipeline()
    if (!pipeline) throw new Error('not ready')
    await pipeline.backfill.restore(chatIds)
    return pipeline.backfill.start()
  })

  ipcMain.handle('backfill:stop', () => {
    activePipeline()?.backfill.stop()
    return true
  })

  ipcMain.handle('bridge:load-older', async (_event, payload: unknown) => {
    const args = payload as { chatId?: unknown }
    if (typeof args?.chatId !== 'string') throw new Error('chatId is required')
    const pipeline = activePipeline()
    if (!pipeline?.bridge.ready) throw new Error('bridge is not available')
    return pipeline.bridge.send('loadOlder', { chatId: args.chatId })
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

  /**
   * Unread counts arrive per account, from that account's own view.
   *
   * The tray and the taskbar badge show the sum: they are one icon for the whole application, and
   * a number that silently only counted the account in front would be wrong in exactly the case
   * multiple accounts exist for. The panel gets the breakdown so each tab can show its own.
   */
  ipcMain.on('wa:unread', (event, payload: unknown) => {
    const accountId = accountIdOfSender(event.sender.id)
    if (!accountId) return
    const counts = payload as { unread?: number; mutedUnread?: number }
    unreadByAccount.set(accountId, {
      unread: typeof counts?.unread === 'number' ? counts.unread : 0,
      mutedUnread: typeof counts?.mutedUnread === 'number' ? counts.mutedUnread : 0,
    })

    let unread = 0
    let muted = 0
    for (const count of unreadByAccount.values()) {
      unread += count.unread
      muted += count.mutedUnread
    }
    tray?.setUnread(unread, settings().mutedChatsNotify ? muted : 0)
    mainWindow?.panel.webContents.send('app:unread', {
      unread,
      mutedUnread: muted,
      byAccount: Object.fromEntries(unreadByAccount),
    })
  })

  ipcMain.on('wa:active-chat', (_event, title: unknown) => {
    if (typeof title !== 'string') return
    activeChat = title
    notifications?.setActiveChat(title)
  })

  // "Chat with a number" (PLAN.md Phase 8). Goes through WhatsApp's own /send URL rather than the
  // bridge: opening a chat by number is something the web client supports itself, and routing it
  // through the internals would be reaching for a lever we do not need.
  ipcMain.handle('app:open-number', (_event, payload: unknown) => {
    const raw = (payload as { input?: unknown })?.input
    if (typeof raw !== 'string') throw new Error('input is required')
    const target = parseWhatsAppUrl(raw) ?? numberTarget(raw)
    if (!target) return { ok: false, reason: 'Das ist weder eine Nummer noch ein WhatsApp-Link.' }
    openNumber(target)
    return { ok: true, number: target.number }
  })

  ipcMain.on('wa:open-link', (_event, url: unknown) => {
    if (typeof url === 'string' && /^https?:/.test(url)) void shell.openExternal(url)
  })

  ipcMain.on('wa:download-name', (_event, name: unknown) => {
    if (typeof name === 'string' && name.trim()) pendingDownloadName = name.trim()
  })
}

/**
 * A drag needs an icon and Electron rejects an empty one. The app icon is the honest choice: the
 * drag comes from this application, whatever the file happens to be.
 */
function dragIcon(): Electron.NativeImage {
  const icon = nativeImage.createFromPath(resourcePath('tray', 'tray.png'))
  return icon.isEmpty() ? nativeImage.createFromDataURL(TRANSPARENT_PIXEL) : icon
}

const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

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
  exportSchedule?.stop()
  reminders?.stop()
  for (const pipeline of pipelines.values()) void pipeline.dispose()
  tray?.dispose()
  void supervisor.stopAll('app quitting').finally(() => {
    app.exit(0)
  })
})

export { WA_PARTITION }
