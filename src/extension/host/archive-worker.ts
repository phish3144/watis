import sqlite3InitModule, { type SAHPoolUtil, type Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import { parseArchiveRequest } from '@shared/ipc/archive-protocol'
import { migrate, registerFunctions } from '../../workers/archive/migrate'
import { LATEST_VERSION } from '../../workers/archive/schema'
import { ArchiveRepository } from '../../workers/archive/repository'
import { serveRepository } from '../../workers/archive/serve'
import { wrap, type WasmDatabase } from '../../workers/archive/sqlite-wasm'
import type { Reply } from '../protocol'
import { OpfsBlobStore, fromBase64 } from './opfs-blobs'
import type { FromWorker, ToWorker } from './worker-protocol'
import { IndexLoop } from './index-loop'

/**
 * The browser's archive worker: SQLite-WASM on OPFS, running the desktop's repository, schema and
 * migrations unchanged (ADR 0010).
 *
 * Storage is the `opfs-sahpool` VFS. It needs no cross-origin isolation — which a frame inside
 * WhatsApp does not reliably get — and it holds exclusive access handles on its files. That
 * exclusivity is the ownership rule: whichever context opens the pool first is the archive, and
 * every other one finds it busy and stands by. Web Locks would have been the obvious tool and do
 * not work for this: in Firefox the frame gets its own lock manager (docs/extension-spike.md).
 *
 * WAL is not available on this VFS; the journal is truncated instead of deleted, which saves a
 * pool slot per transaction. A batch is still one transaction (§3.1).
 */

const POOL = { name: 'watis', directory: '.watis-archive', initialCapacity: 8 }
const DATABASE = '/archive.sqlite'

const scope = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null
}

let sqlite3: Sqlite3Static | undefined
let pool: SAHPoolUtil | undefined
let db: WasmDatabase | undefined
let repo: ArchiveRepository | undefined
let blobs: OpfsBlobStore | undefined
let index: IndexLoop | undefined
let quotaBytes = 20 * 1024 ** 3

const post = (message: FromWorker, transfer?: Transferable[]): void => {
  scope.postMessage(message, transfer)
}

async function open(): Promise<void> {
  try {
    sqlite3 ??= await sqlite3InitModule()
    pool = await sqlite3.installOpfsSAHPoolVfs(POOL)
  } catch (error) {
    // The handles are held elsewhere: another tab or the panel owns the archive.
    post({ type: 'opened', ok: false, busy: true, error: String(error) })
    return
  }
  try {
    blobs = await OpfsBlobStore.open()
    openDatabase()
    post({ type: 'opened', ok: true })
  } catch (error) {
    post({ type: 'opened', ok: false, busy: false, error: String(error) })
  }
}

function openDatabase(): void {
  if (!sqlite3 || !pool) throw new Error('the storage pool is not installed')
  db = wrap(sqlite3, new pool.OpfsSAHPoolDb(DATABASE))
  db.pragma('journal_mode = TRUNCATE')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  registerFunctions(db)
  migrate(db)
  repo = new ArchiveRepository(db)
  index = new IndexLoop(db, (level, message) => {
    post({ type: 'log', level, message })
  })
  index.start()
}

function closeDatabase(): void {
  index?.stop()
  index = undefined
  repo = undefined
  db?.close()
  db = undefined
}

async function usedBytes(): Promise<number> {
  try {
    return (await navigator.storage.estimate()).usage ?? 0
  } catch {
    return 0
  }
}

async function handle(payload: unknown): Promise<unknown> {
  const request = parseArchiveRequest(payload)
  if (!request) throw new Error('malformed archive request')
  if (!repo || !blobs) throw new Error('archive is not open')

  const served = serveRepository(repo, request)
  if (served.handled) return served.value

  switch (request.op) {
    case 'storeBlob': {
      if ((await usedBytes()) >= quotaBytes) {
        // Refusing a file is recoverable; filling the disk is not (§3.1).
        repo.markMedia(request.mediaId, 'skipped')
        return { stored: false, reason: 'blob store quota reached' }
      }
      const stored = await blobs.put(fromBase64(request.data), {
        mime: request.mime ?? null,
        filename: request.filename ?? null,
      })
      repo.attachBlob(request.mediaId, stored.sha256, stored.size)
      index?.wake()
      return { stored: true, sha256: stored.sha256, size: stored.size }
    }
    case 'blobPath': {
      const row = repo.mediaById(request.mediaId)
      if (!row?.sha256) return { path: null }
      const path = OpfsBlobStore.pathFor(row.sha256, row.mime, row.filename)
      return { path: (await blobs.has(path)) ? path : null }
    }
    case 'quota': {
      const bytes = await usedBytes()
      return {
        bytes,
        limitBytes: quotaBytes,
        used: bytes / quotaBytes,
        exceeded: bytes >= quotaBytes,
      }
    }
    default:
      // export, backup, snapshot and saveMedia write to real folders on the desktop. In the
      // browser the database export is its own message, and files leave through downloads.
      throw new Error(`${request.op} is not available in the browser`)
  }
}

/**
 * Copies the database into an ordinary OPFS file and answers with its path; the panel turns that
 * file into a download. All writes are committed transactions, so the copy is consistent. It is
 * read in one piece — the database, not the media, so hundreds of megabytes at most.
 */
async function exportDatabase(): Promise<unknown> {
  if (!pool || !db || !blobs) throw new Error('archive is not open')
  const bytes = pool.exportFile(DATABASE)
  const path = `exports/archiv-${new Date().toISOString().slice(0, 10)}.sqlite`
  await blobs.writeFile(path, bytes)
  return { path, bytes: bytes.length }
}

/** The tables that make a file an archive of ours, not just any SQLite database. */
const ARCHIVE_TABLES = ['chats', 'messages', 'media']

/**
 * Puts a backup's database in place of this one (restore.ts). The panel has copied it into an
 * ordinary OPFS file first; this side does what only the owner of the storage pool can do.
 *
 * Nothing is replaced until the file has proven itself: it is opened under another name first and
 * must be an archive of ours, in a schema this build can migrate. The current database is kept in
 * memory meanwhile, and goes straight back if the new one does not open.
 */
async function importDatabase(path: string): Promise<unknown> {
  if (!sqlite3 || !pool || !blobs) throw new Error('archive is not open')
  const bytes = await blobs.readFile(path)
  if (new TextDecoder().decode(bytes.subarray(0, 16)) !== 'SQLite format 3\u0000') {
    throw new Error('not an SQLite database')
  }
  // The desktop runs in WAL mode; this storage cannot. A backup is a complete file without a
  // -wal next to it, so marking it as a rollback-journal database is all it takes.
  if (bytes[18] === 2) bytes[18] = 1
  if (bytes[19] === 2) bytes[19] = 1

  const probeName = '/restore-probe.sqlite'
  await pool.importDb(probeName, bytes)
  let tables: string[]
  let version: number
  try {
    const probe = new pool.OpfsSAHPoolDb(probeName)
    try {
      tables = probe.selectValues("SELECT name FROM sqlite_master WHERE type = 'table'") as string[]
      version = Number(probe.selectValue('PRAGMA user_version'))
    } finally {
      probe.close()
    }
  } finally {
    pool.unlink(probeName)
  }
  if (!ARCHIVE_TABLES.every((table) => tables.includes(table))) {
    throw new Error('not a WatIs? archive')
  }
  if (version > LATEST_VERSION) {
    throw new Error(`archive schema is version ${String(version)}, newer than this build`)
  }

  // Requests already running finish against the database they started on.
  await Promise.allSettled([...running])
  const previous = pool.exportFile(DATABASE)
  closeDatabase()
  try {
    await pool.importDb(DATABASE, bytes)
    openDatabase()
  } catch (error) {
    await pool.importDb(DATABASE, previous)
    openDatabase()
    throw error
  }
  return repo?.stats()
}

/**
 * Requests wait while the database is being swapped: a batch from the live mirror arriving in
 * that second goes to the new database rather than failing against a closed one.
 */
let swapping: Promise<unknown> = Promise.resolve()
const running = new Set<Promise<unknown>>()

scope.onmessage = (event) => {
  const message = event.data
  switch (message.type) {
    case 'open':
      quotaBytes = message.quotaBytes
      void open()
      return
    case 'configure':
      if (message.quotaBytes) quotaBytes = message.quotaBytes
      if (message.indexPaused !== undefined) index?.setPaused(message.indexPaused)
      return
    case 'request': {
      const job = swapping.then(() => handle(message.payload))
      running.add(job)
      void job.catch(() => undefined).finally(() => running.delete(job))
      job.then(
        (value) => {
          post({ type: 'reply', id: message.id, reply: { ok: true, value } satisfies Reply })
        },
        (error: unknown) => {
          post({ type: 'reply', id: message.id, reply: { ok: false, error: String(error) } })
        },
      )
      return
    }
    case 'import': {
      const job = swapping.then(() => importDatabase(message.path))
      swapping = job.catch(() => undefined)
      job.then(
        (value) => {
          post({ type: 'reply', id: message.id, reply: { ok: true, value } })
        },
        (error: unknown) => {
          post({ type: 'reply', id: message.id, reply: { ok: false, error: String(error) } })
        },
      )
      return
    }
    case 'export':
      swapping.then(exportDatabase).then(
        (value) => {
          post({ type: 'reply', id: message.id, reply: { ok: true, value } })
        },
        (error: unknown) => {
          post({ type: 'reply', id: message.id, reply: { ok: false, error: String(error) } })
        },
      )
      return
  }
}
