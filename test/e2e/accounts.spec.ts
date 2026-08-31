import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'

/**
 * Multiple accounts, end to end (PLAN.md Phase 8).
 *
 * The claim this test exists to check is separation. Two accounts are two people's message
 * histories as often as they are one person's work and private numbers, so the interesting question
 * is not whether the tab switches — it is whether a message written under one account is invisible
 * from the other, and whether the files really are two files.
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

const archive = async <T>(request: unknown): Promise<T> => invoke<T>('archive:request', request)

async function waitForArchive(timeoutMs = 25_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await archive({ op: 'stats' })
      return
    } catch (error) {
      if (Date.now() > deadline) throw error
      await new Promise((r) => setTimeout(r, 250))
    }
  }
}

interface AccountList {
  accounts: { id: string; label: string; primary: boolean }[]
  activeId: string
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'watis-e2e-accounts-'))
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

test('starts with one account on the original directory layout', async () => {
  // An installation that predates accounts already has its data in session/, archive/ and blobs/.
  // Moving it to tidy a directory tree is not a trade this project makes.
  const list = await invoke<AccountList>('app:accounts')
  expect(list.accounts).toHaveLength(1)
  expect(list.accounts[0]?.primary).toBe(true)
  expect(list.activeId).toBe('default')

  const paths = await invoke<Record<string, string>>('app:paths')
  expect(paths.archive?.endsWith(join('watis', 'archive'))).toBe(true)
})

test('keeps two accounts in two archives that cannot see each other', async () => {
  test.setTimeout(120_000)

  await archive({
    op: 'import',
    chats: [{ id: 'c1', name: 'Privat' }],
    messages: [{ id: 'm1', chatId: 'c1', ts: 1_700_000_000, body: 'Nur im ersten Konto' }],
  })

  const afterAdd = await invoke<AccountList>('app:account-add', { label: 'Arbeit' })
  expect(afterAdd.accounts).toHaveLength(2)
  const second = afterAdd.accounts[1]?.id ?? ''
  expect(second).toMatch(/^acct-\d+$/)

  await invoke('app:account-activate', { id: second })
  await waitForArchive()

  // The second account's archive is a different file, and it is empty.
  const stats = await archive<{ messages: number }>({ op: 'stats' })
  expect(stats.messages).toBe(0)

  const hits = await archive<{ hits: unknown[] }>({ op: 'search', query: 'Konto', limit: 10 })
  expect(hits.hits).toHaveLength(0)

  await archive({
    op: 'import',
    chats: [{ id: 'c9', name: 'Kollegen' }],
    messages: [{ id: 'm9', chatId: 'c9', ts: 1_700_000_500, body: 'Nur im zweiten Konto' }],
  })

  // Back to the first: its own message is still there and the second account's is not.
  await invoke('app:account-activate', { id: 'default' })
  await waitForArchive()
  const first = await archive<{ messages: number }>({ op: 'stats' })
  expect(first.messages).toBe(1)

  const crossover = await archive<{ hits: { msgId: string | null }[] }>({
    op: 'search',
    query: 'zweiten',
    limit: 10,
  })
  expect(crossover.hits).toHaveLength(0)
})

test('gives the second account its own directory under accounts/', async () => {
  const list = await invoke<AccountList>('app:accounts')
  const second = list.accounts.find((a) => !a.primary)?.id ?? ''
  const paths = await invoke<Record<string, string>>('app:paths')
  const root = paths.root ?? ''

  expect(existsSync(join(root, 'accounts', second, 'archive'))).toBe(true)
  expect(existsSync(join(root, 'accounts', second, 'blobs'))).toBe(true)
  expect(existsSync(join(root, 'accounts', second, 'session'))).toBe(true)
})

test('removing an account leaves its data on disk', async () => {
  // Deleting a directory full of somebody's messages because they clicked a button in a list is
  // not something this application does silently.
  const list = await invoke<AccountList>('app:accounts')
  const second = list.accounts.find((a) => !a.primary)?.id ?? ''

  const result = await invoke<{ dataDir: string; accounts: unknown[] }>('app:account-remove', {
    id: second,
  })
  expect(result.accounts).toHaveLength(1)
  expect(existsSync(result.dataDir)).toBe(true)
  expect(existsSync(join(result.dataDir, 'archive'))).toBe(true)
})

test('refuses to remove the first account', async () => {
  await expect(invoke('app:account-remove', { id: 'default' })).rejects.toThrow()
})
