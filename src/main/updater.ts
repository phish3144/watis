import { autoUpdater } from 'electron-updater'
import { app } from 'electron'
import { log } from './logging'
import type { WorkerSupervisor } from './workers/supervisor'

/**
 * Auto-update over GitHub Releases, on a per-user install, with no elevation anywhere in the
 * path — the installer is built without resources/elevate.exe, so there is no binary that could
 * elevate even if something asked it to.
 *
 * Two things this must never do:
 *
 *  - Touch session/, archive/ or blobs/. It does not, because those live under
 *    %LOCALAPPDATA%\watis while the update replaces files under
 *    %LOCALAPPDATA%\Programs\WatIs. The two trees are disjoint by construction, and an E2E test
 *    proves it stays that way.
 *  - Install while a worker still holds the SQLite WAL. The NSIS updater kills watis.exe by
 *    name only; a surviving child produces the RETRY/CANCEL "application cannot be closed"
 *    dialog and a failed update. So the workers are stopped first, explicitly.
 *
 * The version before this one downloaded updates and then never installed them:
 * `autoInstallOnAppQuit` was false, `installUpdateAndRestart` was exported and called from
 * nowhere, and the log line said "it will install on quit" — which was the one thing that could
 * not happen. An update that silently never arrives is worse than no updater, because nobody goes
 * looking for it.
 */

/** A tray application runs for days. Checking only at launch means missing updates for weeks. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export type UpdateState =
  | { status: 'disabled'; reason: string }
  | { status: 'idle'; currentVersion: string; lastCheckedMs?: number | undefined }
  | { status: 'checking'; currentVersion: string }
  | { status: 'downloading'; currentVersion: string; version: string; percent: number }
  | { status: 'ready'; currentVersion: string; version: string; notes?: string | undefined }
  | { status: 'error'; currentVersion: string; message: string }

export interface UpdaterOptions {
  /** Set false to disable update checks entirely. */
  enabled: boolean
  onState: (state: UpdateState) => void
  /** Stops the workers before the installer runs. */
  supervisor: WorkerSupervisor
}

let state: UpdateState = { status: 'idle', currentVersion: '0.0.0' }
let emit: (next: UpdateState) => void = () => undefined
let timer: NodeJS.Timeout | undefined
let installOnQuit = false
let readyToInstall = false
/** The version being downloaded. `download-progress` does not carry it; `update-available` does. */
let pendingVersion = ''

function set(next: UpdateState): void {
  state = next
  emit(next)
}

export function updateState(): UpdateState {
  return state
}

export function configureUpdater(options: UpdaterOptions): void {
  const currentVersion = app.getVersion()
  emit = options.onState

  // Reconfiguring starts from a clean slate. Without this, a "ready" left over from a previous
  // configuration would survive into one where nothing has been downloaded, and the app would
  // promise an install it cannot perform.
  stopUpdater()
  readyToInstall = false
  pendingVersion = ''
  installOnQuit = false
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  // The install is never behind the user's back: either they press the button, or they chose
  // "on quit" and this flag is set then.
  autoUpdater.autoInstallOnAppQuit = false

  if (!app.isPackaged) {
    set({ status: 'disabled', reason: 'Entwicklungsbuild — Updates sind hier abgeschaltet.' })
    log.info('updater disabled: not a packaged build')
    return
  }
  if (!options.enabled) {
    set({ status: 'disabled', reason: 'In den Einstellungen abgeschaltet.' })
    log.info('updater disabled by configuration')
    return
  }

  set({ status: 'idle', currentVersion })

  autoUpdater.on('error', (error) => {
    // A failed check must never interrupt the day's work — it is reported, not thrown.
    log.warn(`update check failed: ${error.message}`)
    set({ status: 'error', currentVersion, message: error.message })
  })

  autoUpdater.on('checking-for-update', () => {
    set({ status: 'checking', currentVersion })
  })

  autoUpdater.on('update-not-available', () => {
    set({ status: 'idle', currentVersion, lastCheckedMs: nowMs() })
  })

  autoUpdater.on('update-available', (info) => {
    pendingVersion = info.version
    set({ status: 'downloading', currentVersion, version: info.version, percent: 0 })
  })

  autoUpdater.on('download-progress', (progress) => {
    set({
      status: 'downloading',
      currentVersion,
      version: pendingVersion,
      percent: Math.round(progress.percent),
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    readyToInstall = true
    log.info(`update ${info.version} downloaded and ready to install`)
    set({
      status: 'ready',
      currentVersion,
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes.slice(0, 2000) : undefined,
    })
  })

  void autoUpdater.checkForUpdates()
  timer = setInterval(() => void autoUpdater.checkForUpdates(), CHECK_INTERVAL_MS)
  timer.unref?.()
}

/** The manual check, for somebody who does not want to wait six hours to find out. */
export async function checkForUpdatesNow(): Promise<UpdateState> {
  if (state.status === 'disabled') return state
  try {
    await autoUpdater.checkForUpdates()
  } catch (error: unknown) {
    log.warn(`manual update check failed: ${String(error)}`)
  }
  return state
}

/**
 * "Install the next time I quit."
 *
 * This flips electron-updater's own flag rather than calling `quitAndInstall` from a `will-quit`
 * handler. Installing from inside the quit sequence means racing it — the app is already tearing
 * down while the installer wants to launch — and the flag exists precisely so that does not have
 * to be hand-rolled.
 *
 * The workers still have to be down first, and they are: the quit path stops them before the
 * process exits, which is the same order `installUpdateAndRestart` uses.
 */
export function setInstallOnQuit(value: boolean): boolean {
  installOnQuit = value
  autoUpdater.autoInstallOnAppQuit = value
  return installOnQuit
}

export function shouldInstallOnQuit(): boolean {
  return installOnQuit && readyToInstall
}

export function stopUpdater(): void {
  if (timer) clearInterval(timer)
  timer = undefined
}

/**
 * Installs and restarts. The workers go down first: the NSIS updater kills watis.exe by name only,
 * and a surviving child still holding the SQLite WAL is what produces the RETRY/CANCEL dialog and
 * a failed update.
 */
export async function installUpdateAndRestart(supervisor: WorkerSupervisor): Promise<boolean> {
  if (!readyToInstall) return false
  log.info('stopping workers before installing the update')
  stopUpdater()
  await supervisor.stopAll('installing update')
  autoUpdater.quitAndInstall(false, true)
  return true
}

/** Split out so the module has no direct Date dependency in its testable paths. */
function nowMs(): number {
  return Date.now()
}
