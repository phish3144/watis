import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '../../src/main/updater'

type Handler = (payload?: unknown) => void

const handlers = new Map<string, Handler>()
const fake = {
  logger: null as unknown,
  autoDownload: false,
  autoInstallOnAppQuit: true,
  checkCalls: 0,
  quitAndInstallCalls: [] as { silent: boolean; forceRun: boolean }[],
  on(event: string, handler: Handler) {
    handlers.set(event, handler)
  },
  /** Set to make the next check reject, the way a failed DNS lookup or a bad certificate does. */
  failNextCheck: null as Error | null,
  /** Set to hand back a download promise that rejects, the way a dropped connection does. */
  failNextDownload: null as Error | null,
  checkForUpdates() {
    this.checkCalls++
    if (this.failNextCheck) {
      const error = this.failNextCheck
      this.failNextCheck = null
      // electron-updater emits 'error' and then rethrows, so the returned promise rejects too.
      handlers.get('error')?.(error)
      return Promise.reject(error)
    }
    if (this.failNextDownload) {
      const error = this.failNextDownload
      this.failNextDownload = null
      return Promise.resolve({ downloadPromise: Promise.reject(error) })
    }
    return Promise.resolve(null)
  },
  quitAndInstall(silent: boolean, forceRun: boolean) {
    this.quitAndInstallCalls.push({ silent, forceRun })
  },
}

let packaged = true

vi.mock('electron-updater', () => ({ autoUpdater: fake }))
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return packaged
    },
    getVersion: () => '1.2.3',
  },
}))
vi.mock('../../src/main/logging', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const updater = await import('../../src/main/updater')

const stoppedWith: string[] = []
const supervisor = {
  stopAll: (reason: string) => {
    stoppedWith.push(reason)
    return Promise.resolve()
  },
} as never

// Typed, rather than unknown[] with a cast at each use: the assertions are about the shape of
// this state, so the shape belongs in the declaration.
const states: UpdateState[] = []

function configure(enabled = true): void {
  updater.configureUpdater({ enabled, supervisor, onState: (s) => states.push(s) })
}

/**
 * The platform these tests describe, stated rather than inherited from whatever machine runs them.
 *
 * The suite used to take process.platform as it found it, which meant it exercised the Windows path
 * on a developer's Windows box and the Linux path in CI without saying so. Adding the Linux guard —
 * updates there are only possible from an AppImage — broke seven of them at once, on Linux only.
 * A test whose subject depends on the host is a test that will surprise somebody later.
 */
function runningAs(platform: NodeJS.Platform, options: { appImage?: boolean } = {}): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  if (options.appImage === true) process.env.APPIMAGE = '/home/someone/Applications/WatIs.AppImage'
  else delete process.env.APPIMAGE
}

beforeEach(() => {
  // Windows by default, which is what every existing case here was written against.
  runningAs('win32')
  handlers.clear()
  states.length = 0
  stoppedWith.length = 0
  fake.checkCalls = 0
  fake.failNextCheck = null
  fake.failNextDownload = null
  fake.quitAndInstallCalls.length = 0
  fake.autoInstallOnAppQuit = true
  packaged = true
  updater.setInstallOnQuit(false)
  updater.stopUpdater()
})

describe('the updater', () => {
  it('does not reach out at all in a development build', () => {
    packaged = false
    configure()
    expect(fake.checkCalls).toBe(0)
    expect(updater.updateState().status).toBe('disabled')
  })

  it('does not reach out when switched off', () => {
    // The network rule allows GitHub Releases, but somebody who turns it off means it.
    configure(false)
    expect(fake.checkCalls).toBe(0)
    expect(updater.updateState()).toMatchObject({ status: 'disabled' })
  })

  it('checks once at startup', () => {
    configure()
    expect(fake.checkCalls).toBe(1)
  })

  it('reports the version being downloaded, not the one already running', () => {
    // It used to read autoUpdater.currentVersion here, which is the RUNNING version — so the
    // progress line would have counted up towards the version the user already had.
    configure()
    handlers.get('update-available')?.({ version: '2.0.0' })
    handlers.get('download-progress')?.({ percent: 41.6 })
    expect(updater.updateState()).toMatchObject({
      status: 'downloading',
      version: '2.0.0',
      currentVersion: '1.2.3',
      percent: 42,
    })
  })

  it('refuses to install when nothing has been downloaded', async () => {
    configure()
    await expect(updater.installUpdateAndRestart(supervisor)).resolves.toBe(false)
    expect(fake.quitAndInstallCalls).toHaveLength(0)
  })

  it('stops the workers before handing over to the installer', async () => {
    // The NSIS updater kills watis.exe by name only. A surviving worker still holding the SQLite
    // WAL is what produces the "application cannot be closed" dialog and a failed update.
    configure()
    handlers.get('update-downloaded')?.({ version: '2.0.0' })
    await expect(updater.installUpdateAndRestart(supervisor)).resolves.toBe(true)
    expect(stoppedWith).toEqual(['installing update'])
    expect(fake.quitAndInstallCalls).toEqual([{ silent: false, forceRun: true }])
  })

  it('never installs behind the user, but honours install-on-quit once they ask', () => {
    configure()
    // The bug this replaces: autoInstallOnAppQuit was hard-false, installUpdateAndRestart was
    // never called, and the log said "it will install on quit". Nothing ever installed.
    expect(fake.autoInstallOnAppQuit).toBe(false)

    handlers.get('update-downloaded')?.({ version: '2.0.0' })
    updater.setInstallOnQuit(true)
    expect(fake.autoInstallOnAppQuit).toBe(true)
    expect(updater.shouldInstallOnQuit()).toBe(true)
  })

  it('does not promise an install on quit when nothing is ready', () => {
    configure()
    updater.setInstallOnQuit(true)
    expect(updater.shouldInstallOnQuit()).toBe(false)
  })

  it('surfaces a failed check instead of interrupting the day', () => {
    configure()
    handlers.get('error')?.({ message: 'getaddrinfo ENOTFOUND github.com' })
    expect(updater.updateState()).toMatchObject({ status: 'error' })
  })

  it('reports being up to date after a check that found nothing', () => {
    configure()
    handlers.get('update-not-available')?.({})
    const state = updater.updateState()
    expect(state.status).toBe('idle')
    expect(state.status === 'idle' && state.lastCheckedMs).toBeGreaterThan(0)
  })

  it('pushes every state change to its listener', () => {
    configure()
    handlers.get('checking-for-update')?.({})
    handlers.get('update-available')?.({ version: '2.0.0' })
    handlers.get('update-downloaded')?.({ version: '2.0.0' })
    const statuses = states.map((s) => s.status)
    expect(statuses).toContain('checking')
    expect(statuses).toContain('downloading')
    expect(statuses).toContain('ready')
  })

  it('answers a manual check even when the library rejects', async () => {
    configure()
    const boom = vi.spyOn(fake, 'checkForUpdates').mockRejectedValueOnce(new Error('offline'))
    await expect(updater.checkForUpdatesNow()).resolves.toBeDefined()
    boom.mockRestore()
  })
})

describe('on Linux', () => {
  /**
   * electron-updater can only update an AppImage there: it replaces that one file in place. An
   * unpacked build is `isPackaged` all the same, so without this the updater would run, download a
   * new AppImage and fail at the replacement — an hour later, naming a path the user never chose.
   */
  it('updates when running from an AppImage', () => {
    runningAs('linux', { appImage: true })
    updater.configureUpdater({ enabled: true, onState: (s) => states.push(s), supervisor })
    expect(states.at(-1)?.status).not.toBe('disabled')
  })

  it('says so plainly when it is not an AppImage, rather than failing later', () => {
    runningAs('linux', { appImage: false })
    updater.configureUpdater({ enabled: true, onState: (s) => states.push(s), supervisor })
    const last = states.at(-1)
    expect(last?.status).toBe('disabled')
    expect(last?.status === 'disabled' ? last.reason : '').toContain('AppImage')
  })

  it('leaves Windows and macOS alone', () => {
    for (const platform of ['win32', 'darwin'] as const) {
      states.length = 0
      runningAs(platform)
      updater.configureUpdater({ enabled: true, onState: (s) => states.push(s), supervisor })
      expect(states.at(-1)?.status, platform).not.toBe('disabled')
    }
  })
})

/**
 * A failed update must stay a reported state and nothing more.
 *
 * electron-updater reports every failure twice: it emits `error` — which is what sets the state
 * above — and then rethrows, so the promise rejects as well. The call sites used to `void` that
 * promise, which does not handle it, so an offline start printed the failure once as handled and
 * once as an unhandled rejection. A container with no route to GitHub showed exactly that:
 *
 *   update check failed: net::ERR_CERT_AUTHORITY_INVALID
 *   Unhandled rejection Error: net::ERR_CERT_AUTHORITY_INVALID
 *
 * Nothing crashed, because electron-log catches them. That is the problem: the noise lands in
 * error.log, where a real fault has to be found later.
 */
describe('a failure that is already reported', () => {
  async function leaksFrom(run: () => void): Promise<unknown[]> {
    const leaks: unknown[] = []
    const onLeak = (reason: unknown): void => {
      leaks.push(reason)
    }
    process.on('unhandledRejection', onLeak)
    run()
    // Two turns of the macrotask queue: one for the rejection to be seen as unhandled, one for
    // Node to emit the event.
    await new Promise((resolve) => setTimeout(resolve, 20))
    process.off('unhandledRejection', onLeak)
    return leaks
  }

  it('does not leak the rejection from a check that failed', async () => {
    fake.failNextCheck = new Error('net::ERR_CERT_AUTHORITY_INVALID')
    const leaks = await leaksFrom(() => {
      configure()
    })
    expect(leaks).toEqual([])
    expect(updater.updateState().status).toBe('error')
  })

  it('does not leak the rejection from a download that died halfway', async () => {
    // The worse of the two, and the one an offline machine never reaches: with autoDownload on,
    // the check hands back the download it started on result.downloadPromise and the library
    // attaches nothing to it — its own checkForUpdatesAndNotify voids it without a catch as well.
    fake.failNextDownload = new Error('net::ERR_CONNECTION_RESET')
    const leaks = await leaksFrom(() => {
      configure()
    })
    expect(leaks).toEqual([])
  })

  it('does not leak either of them from a manual check', async () => {
    configure()
    fake.failNextCheck = new Error('getaddrinfo ENOTFOUND github.com')
    expect(
      await leaksFrom(() => {
        void updater.checkForUpdatesNow()
      }),
    ).toEqual([])
    fake.failNextDownload = new Error('net::ERR_CONNECTION_RESET')
    expect(
      await leaksFrom(() => {
        void updater.checkForUpdatesNow()
      }),
    ).toEqual([])
  })
})
