import { app, ipcMain } from 'electron'

// This has to happen before app.whenReady() and before anything touches `session`, so it is the
// very first statement in the entry point. Called late, setPath fails silently and the session
// keeps writing into the roaming profile. See paths.ts.
import { appPaths, assertPathsApplied, configurePaths } from './paths'
const paths = configurePaths()

import { APP_ID, DISPLAY_NAME } from '@shared/app-identity'
import { configureLogging, log } from './logging'
import { applyUserAgent } from './user-agent'
import { startEventLoopWatchdog } from './watchdog'
import { createMainWindow, type MainWindow } from './window/main-window'
import { initWindowState } from './window/bounds'
import { configureUpdater } from './updater'
import { WorkerSupervisor } from './workers/supervisor'
import { platform } from '@platform/current'

// Binds toasts, taskbar grouping and the jump list to this app. Must match electron-builder's
// appId exactly, or Windows notifications fail with no error and no way to reproduce it in dev.
app.setAppUserModelId(APP_ID)

configureLogging()

const startMinimised = process.argv.includes('--minimised')
const supervisor = new WorkerSupervisor()
let mainWindow: MainWindow | undefined
let stopWatchdog: (() => void) | undefined

// A second launch focuses the running instance instead of starting a rival that would fight over
// the same session and SQLite WAL.
if (!app.requestSingleInstanceLock()) {
  log.info('another instance holds the lock; exiting')
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    const { window } = mainWindow
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })

  void bootstrap()
}

async function bootstrap(): Promise<void> {
  await app.whenReady()

  assertPathsApplied()
  log.info(`${DISPLAY_NAME} starting`)
  log.info(`data root: ${paths.root}`)
  log.info(`user agent: ${applyUserAgent()}`)
  log.info(`platform: ${platform().id}`)

  stopWatchdog = startEventLoopWatchdog()

  supervisor.start('archive')
  supervisor.start('contentIndex')

  registerIpcHandlers()

  await initWindowState()
  mainWindow = createMainWindow({ startMinimised })

  configureUpdater({ enabled: true })

  app.on('activate', () => {
    if (!mainWindow) mainWindow = createMainWindow({ startMinimised: false })
    else mainWindow.window.show()
  })
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

  // Phase 1 turns this into the tray badge and notification routing. For now it only proves the
  // channel works end to end.
  ipcMain.on('wa:title', (_event, title: unknown) => {
    if (typeof title === 'string') log.debug(`wa title: ${title}`)
  })
}

// Closing the last window quits on Windows; macOS keeps the app alive, as is conventional there.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// The workers must be down before the process goes away. A worker still holding the SQLite WAL
// at update time is what produces the "application cannot be closed" dialog and a failed update.
let shuttingDown = false
app.on('before-quit', (event) => {
  if (shuttingDown) return
  event.preventDefault()
  shuttingDown = true
  stopWatchdog?.()
  void supervisor.stopAll('app quitting').finally(() => {
    app.quit()
  })
})
