import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  checkForUpdates() {
    this.checkCalls++
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

const states: unknown[] = []

function configure(enabled = true): void {
  updater.configureUpdater({ enabled, supervisor, onState: (s) => states.push(s) })
}

beforeEach(() => {
  handlers.clear()
  states.length = 0
  stoppedWith.length = 0
  fake.checkCalls = 0
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
    const statuses = states.map((s) => (s as { status: string }).status)
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
