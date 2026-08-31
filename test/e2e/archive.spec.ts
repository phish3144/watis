import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'

/**
 * The archive data plane, end to end: renderer channel → main → utilityProcess → SQLite → back.
 *
 * The unit and integration tests cover the repository against an in-memory database. This is the
 * only test that proves the wiring in between actually carries anything — a worker that never
 * starts, an IPC name that does not match or a request that hangs would all pass everything else.
 */

let app: ElectronApplication
let dataDir: string

/** Drives the channel exactly as the renderer does, through the main process. */
async function archive<T>(request: unknown): Promise<T> {
  return app.evaluate(({ ipcMain }, payload) => {
    // ipcMain.handle registers the same function the preload invokes; calling the registered
    // handler directly keeps the test out of the renderer while still exercising main and worker.
    const handlers = (
      ipcMain as unknown as { _invokeHandlers: Map<string, (e: unknown, a: unknown) => unknown> }
    )._invokeHandlers
    const handler = handlers.get('archive:request')
    if (!handler) throw new Error('archive:request handler is not registered')
    return handler({}, payload)
  }, request) as Promise<T>
}

async function waitForArchive(timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await archive({ op: 'stats' })
      return
    } catch (error) {
      if (Date.now() > deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'watis-e2e-archive-'))
  app = await electron.launch({
    args: ['.', '--no-sandbox'],
    env: { ...process.env, LOCALAPPDATA: dataDir, XDG_DATA_HOME: dataDir, NODE_ENV: 'test' },
  })
  await waitForArchive()
})

test.afterAll(async () => {
  await app?.close()
  if (dataDir && existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
})

test('keeps the database under the app data directory, never the working directory', async () => {
  // It did not, once: the supervisor exported WATIS_ARCHIVE_DIR while the worker read
  // WATIS_ARCHIVE_FILE, so it silently fell back to process.cwd() and wrote the archive into
  // whatever directory the app was started from — outside %LOCALAPPDATA%\\watis, where no
  // uninstall and no storage overview would ever find it.
  const stray = join(process.cwd(), 'archive', 'archive.sqlite')
  expect(existsSync(stray)).toBe(false)

  const paths = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  expect(paths.toLowerCase()).toContain(dataDir.toLowerCase())
})

test('opens an empty archive and reports it', async () => {
  const stats = await archive<{ messages: number; chats: number; databaseBytes: number }>({
    op: 'stats',
  })
  expect(stats.messages).toBe(0)
  expect(stats.databaseBytes).toBeGreaterThan(0)
})

test('imports a batch and finds it again through the search index', async () => {
  await archive({
    op: 'import',
    chats: [{ id: 'c1', name: 'Familie', kind: 'group' }],
    contacts: [{ jid: 'anna@s', name: 'Anna Beispiel' }],
    messages: [
      {
        id: 'm1',
        chatId: 'c1',
        senderJid: 'anna@s',
        ts: 1_700_000_000,
        body: 'Treffen in München',
      },
      { id: 'm2', chatId: 'c1', senderJid: 'anna@s', ts: 1_700_000_100, body: 'Rechnung folgt' },
    ],
  })

  const stats = await archive<{ messages: number }>({ op: 'stats' })
  expect(stats.messages).toBe(2)

  // The German normalisation has to survive the whole chain, not just the repository test.
  const hits = await archive<{ hits: { msgId: string }[] }>({ op: 'search', query: 'Muenchen' })
  expect(hits.hits.map((h) => h.msgId)).toEqual(['m1'])
})

test('pages a chat newest-first', async () => {
  const page = await archive<{ messages: { id: string }[] }>({
    op: 'messagesPage',
    chatId: 'c1',
    limit: 10,
  })
  expect(page.messages.map((m) => m.id)).toEqual(['m2', 'm1'])
})

test('filters by chat and by sender across the channel', async () => {
  const byChat = await archive<{ hits: unknown[] }>({ op: 'search', query: 'in:Familie' })
  expect(byChat.hits).toHaveLength(2)

  const bySender = await archive<{ hits: unknown[] }>({
    op: 'search',
    query: 'from:"Anna Beispiel"',
  })
  expect(bySender.hits).toHaveLength(2)
})

test('rejects a malformed request instead of accepting it quietly', async () => {
  // The worker validates at its own boundary; a bad payload must come back as an error, not as a
  // silent no-op that looks like an empty archive.
  await expect(archive({ op: 'nonsense' })).rejects.toThrow(/malformed|Error/)
})

test('survives a request for a chat that does not exist', async () => {
  const page = await archive<{ messages: unknown[] }>({
    op: 'messagesPage',
    chatId: 'does-not-exist',
    limit: 10,
  })
  expect(page.messages).toEqual([])
})
