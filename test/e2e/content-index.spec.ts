import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'

/**
 * The content index worker, end to end.
 *
 * The scheduler policy and the queue are covered in unit and integration tests. What only this
 * test can show is that the worker starts, opens the same database the archive worker holds, and
 * that main's idle and pause signals actually reach the decision — the parts where a wrong
 * environment variable or a mismatched channel name would fail silently.
 */

let app: ElectronApplication
let dataDir: string

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return app.evaluate(
    ({ ipcMain }, { channel: name, payload: args }) => {
      const handlers = (
        ipcMain as unknown as { _invokeHandlers: Map<string, (e: unknown, a: unknown) => unknown> }
      )._invokeHandlers
      const handler = handlers.get(name)
      if (!handler) throw new Error(`${name} handler is not registered`)
      return handler({}, args)
    },
    { channel, payload },
  ) as Promise<T>
}

interface Status {
  counts: Record<string, number> | null
  verdict: string
  working: boolean
}

async function waitForIndex(timeoutMs = 20_000): Promise<Status> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      return await invoke<Status>('app:index-status')
    } catch (error) {
      if (Date.now() > deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'watis-e2e-index-'))
  app = await electron.launch({
    args: ['.', '--no-sandbox'],
    env: { ...process.env, LOCALAPPDATA: dataDir, XDG_DATA_HOME: dataDir, NODE_ENV: 'test' },
  })
  await waitForIndex()
})

test.afterAll(async () => {
  await app?.close()
  if (dataDir && existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
})

test('opens the queue against the same archive the other worker holds', async () => {
  // The worker answers `status` as soon as it is up, which is BEFORE it has attached: the archive
  // worker owns the schema and this one retries until the migrations are done. Asserting the
  // counts immediately treated an eventually-consistent state as an immediate one, and failed
  // roughly one full-suite run in six.
  await expect
    .poll(async () => (await waitForIndex()).counts, {
      timeout: 40_000,
      message: 'the content index should attach once the archive worker has migrated',
    })
    .toMatchObject({ queued: 0, running: 0 })
})

test('acts on the signals main pushes rather than deciding on its own', async () => {
  await invoke('app:update-settings', { indexPaused: true })
  await expect
    .poll(async () => (await waitForIndex()).verdict, {
      timeout: 20_000,
      message: 'the tray pause switch should reach the worker',
    })
    .toBe('pausiert')

  // Unpausing leaves the idle rule in charge, and the test machine is not idle — which is the
  // right answer, not a failure: it proves the verdict comes from the pushed signals.
  await invoke('app:update-settings', { indexPaused: false })
  await expect
    .poll(async () => (await waitForIndex()).verdict, { timeout: 20_000 })
    .not.toBe('pausiert')
})

test('re-queues one source without touching the others', async () => {
  const result = await invoke<{ requeued: number }>('app:reindex', { kind: 'ocr' })
  expect(result.requeued).toBe(0)
  await expect(invoke('app:reindex', {})).rejects.toThrow()
})
