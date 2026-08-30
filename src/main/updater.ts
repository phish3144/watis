import { autoUpdater } from 'electron-updater'
import { app } from 'electron'
import { log } from './logging'
import type { WorkerSupervisor } from './workers/supervisor'

/**
 * Auto-update over GitHub Releases, on a per-user install, with no elevation anywhere in the
 * path — the installer is built without resources/elevate.exe, so there is no binary that
 * could elevate even if something asked it to.
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
 */

export interface UpdaterOptions {
  /** Set false to disable update checks entirely (a user setting in phase 9). */
  enabled: boolean
}

export function configureUpdater({ enabled }: UpdaterOptions): void {
  autoUpdater.logger = log
  autoUpdater.autoDownload = enabled
  // Never restart behind the user's back — the install happens on quit.
  autoUpdater.autoInstallOnAppQuit = false

  if (!app.isPackaged) {
    log.info('updater disabled: not a packaged build')
    return
  }
  if (!enabled) {
    log.info('updater disabled by configuration')
    return
  }

  autoUpdater.on('error', (error) => {
    // A failed update check must never interrupt the day's work.
    log.warn(`update check failed: ${error.message}`)
  })
  autoUpdater.on('update-downloaded', (info) => {
    log.info(`update ${info.version} downloaded; it will install on quit`)
  })

  void autoUpdater.checkForUpdates()
}

/** Called from the quit path once the user has agreed to install. */
export async function installUpdateAndRestart(supervisor: WorkerSupervisor): Promise<void> {
  log.info('stopping workers before installing the update')
  await supervisor.stopAll('installing update')
  autoUpdater.quitAndInstall(false, true)
}
