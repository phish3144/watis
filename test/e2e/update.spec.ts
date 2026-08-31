import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'

/**
 * The update must not touch `session/`, `archive/` or `blobs/`. CLAUDE.md says so and PLAN.md says
 * an E2E test has to prove it, so this is that test.
 *
 * It cannot run a real NSIS installer here, and it does not pretend to. What it does instead is
 * reproduce the thing an update actually does to the disk: the application directory is thrown away
 * and replaced with a new version, and the app is started again from it. Everything the user owns
 * has to come through that unchanged, down to the byte.
 *
 * That is the invariant worth testing. A green NSIS run on a machine where the two trees happened
 * not to overlap would prove much less.
 */

const repoRoot = resolve(__dirname, '..', '..')

let dataDir: string
let appDir: string
let app: ElectronApplication | undefined

/** Every file under the data root, with its content hash. The comparison unit is bytes, not mtime. */
function inventory(root: string): Map<string, string> {
  const found = new Map<string, string>()
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        found.set(
          relative(root, full),
          createHash('sha256').update(readFileSync(full)).digest('hex'),
        )
      }
    }
  }
  if (existsSync(root)) walk(root)
  return found
}

/**
 * An application directory the test can delete and rebuild — which is what the installer does.
 * `out/` and `node_modules/` are symlinked rather than copied: they are the parts an update
 * replaces wholesale, and copying half a gigabyte per test run would prove nothing extra.
 */
function buildAppDir(version: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'watis-e2e-app-'))
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ ...manifest, version }, null, 2))
  symlinkSync(join(repoRoot, 'out'), join(directory, 'out'), 'dir')
  symlinkSync(join(repoRoot, 'node_modules'), join(directory, 'node_modules'), 'dir')
  return directory
}

async function launch(directory: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [directory, '--no-sandbox'],
    cwd: repoRoot,
    env: { ...process.env, LOCALAPPDATA: dataDir, XDG_DATA_HOME: dataDir, NODE_ENV: 'test' },
  })
}

async function archive<T>(instance: ElectronApplication, request: unknown): Promise<T> {
  return instance.evaluate(({ ipcMain }, payload) => {
    const handlers = (
      ipcMain as unknown as { _invokeHandlers: Map<string, (e: unknown, a: unknown) => unknown> }
    )._invokeHandlers
    const handler = handlers.get('archive:request')
    if (!handler) throw new Error('archive:request handler is not registered')
    return handler({}, payload)
  }, request) as Promise<T>
}

async function waitForArchive(instance: ElectronApplication): Promise<void> {
  const deadline = Date.now() + 20_000
  for (;;) {
    try {
      await archive(instance, { op: 'stats' })
      return
    } catch (error) {
      if (Date.now() > deadline) throw error
      await new Promise((r) => setTimeout(r, 250))
    }
  }
}

test.beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'watis-e2e-update-'))
})

test.afterAll(async () => {
  await app?.close()
  for (const directory of [dataDir, appDir]) {
    if (directory && existsSync(directory)) rmSync(directory, { recursive: true, force: true })
  }
})

test('leaves session, archive and blobs untouched across an update', async () => {
  test.setTimeout(120_000)

  // --- version 0.1.0: put something in the archive and something in blobs ------------------
  appDir = buildAppDir('0.1.0')
  app = await launch(appDir)
  await waitForArchive(app)

  const paths = (await app.evaluate(({ ipcMain }) => {
    const handlers = (
      ipcMain as unknown as { _invokeHandlers: Map<string, (e: unknown) => unknown> }
    )._invokeHandlers
    return handlers.get('app:paths')?.({})
  })) as Record<string, string | undefined>

  const pathAt = (key: 'root' | 'session' | 'archive' | 'blobs'): string => {
    const value = paths[key]
    if (!value) throw new Error(`main did not report a ${key} path`)
    return value
  }
  const root = pathAt('root')
  const sessionDir = pathAt('session')
  const blobsDir = pathAt('blobs')

  await archive(app, {
    op: 'import',
    chats: [{ id: 'c1', name: 'Vor dem Update' }],
    messages: [{ id: 'm1', chatId: 'c1', ts: 1_700_000_000, body: 'Angebot vom Dachdecker' }],
  })
  await archive(app, {
    op: 'storeBlob',
    mediaId: 'x1',
    data: Buffer.from('a document that must survive').toString('base64'),
    mime: 'application/pdf',
    filename: 'angebot.pdf',
  })

  // The session directory only fills once WhatsApp Web has loaded, which it cannot here. A file
  // placed by hand stands in for it: what is being tested is that the update does not walk this
  // tree, and the updater cannot tell who wrote a file.
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(join(sessionDir, 'Cookies'), 'pretend-session-state')

  await app.close()
  app = undefined

  // The two trees must be disjoint by construction, not by luck. If the data root ever moves
  // under the application directory, an installer that clears its own directory takes the
  // archive with it and no amount of care in the updater helps.
  const appReal = resolve(repoRoot)
  expect(root.startsWith(appReal)).toBe(false)
  expect(appReal.startsWith(root)).toBe(false)
  for (const key of ['session', 'archive', 'blobs'] as const) {
    expect(pathAt(key).startsWith(root)).toBe(true)
  }

  const before = inventory(root)
  expect(before.size).toBeGreaterThan(0)

  // --- the update: the application directory is destroyed and rebuilt ----------------------
  rmSync(appDir, { recursive: true, force: true })
  appDir = buildAppDir('0.2.0')
  expect(
    (JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')) as { version: string }).version,
  ).toBe('0.2.0')

  app = await launch(appDir)
  await waitForArchive(app)

  // --- version 0.2.0: everything is still there, and still readable ------------------------
  const hits = await archive<{ hits: { msgId: string | null }[] }>(app, {
    op: 'search',
    query: 'Dachdecker',
    limit: 10,
  })
  expect(hits.hits.map((h) => h.msgId)).toContain('m1')

  expect(readFileSync(join(sessionDir, 'Cookies'), 'utf8')).toBe('pretend-session-state')

  const blobFiles = inventory(blobsDir)
  expect(blobFiles.size).toBe(1)

  // Byte-for-byte, minus what the running app legitimately rewrites. The exemptions are named
  // rather than pattern-matched loosely, because the list IS the rule: Chromium's HTTP cache,
  // GPU cache and code cache are disposable and the project says so; IndexedDB, Local Storage and
  // the service-worker registrations are the session and must never appear here.
  const after = inventory(root)
  // Matched on a path segment, not a prefix: the persistent `persist:wa` partition has its own
  // copy of every one of these under session/Partitions/wa/, and an update has to leave that alone
  // just the same.
  const DISPOSABLE_DIRS = new Set([
    'Cache',
    'Code Cache',
    'GPUCache',
    'DawnGraphiteCache',
    'DawnWebGPUCache',
    'Shared Dictionary',
    'Network',
  ])
  // LevelDB rewrites its own diagnostics on every open. The data files beside them — .ldb,
  // MANIFEST, CURRENT — are the session and stay strict, which is the line that matters.
  // Everything under IndexedDB, Local Storage and Service Worker is checked byte for byte.
  const DIAGNOSTIC_FILES = new Set(['LOG', 'LOG.old', 'LOCK', 'DevToolsActivePort'])

  const volatile = (name: string): boolean => {
    const parts = name.split('\\').join('/').split('/')
    if (parts[0] === 'logs') return true
    if (name.includes('-wal') || name.includes('-shm')) return true
    if (DIAGNOSTIC_FILES.has(parts[parts.length - 1] ?? '')) return true
    return parts.some((part) => DISPOSABLE_DIRS.has(part))
  }

  // Without this the test would still pass if the exemption list quietly grew to cover everything.
  // These three are the point of the whole exercise, named so they cannot be exempted by accident.
  const compared = [...before.keys()].filter((name) => !volatile(name))
  expect(compared.some((n) => n.includes('archive.sqlite'))).toBe(true)
  expect(compared.some((n) => n.startsWith('blobs'))).toBe(true)
  expect(compared.some((n) => n.includes('Cookies'))).toBe(true)

  for (const [name, hash] of before) {
    if (volatile(name)) continue
    expect(after.get(name), `${name} disappeared or changed during the update`).toBe(hash)
  }
})
