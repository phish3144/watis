import sqlite3InitModule, { type SAHPoolUtil, type Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import { parseArchiveRequest } from '@shared/ipc/archive-protocol'
import { migrate, registerFunctions } from '../../workers/archive/migrate'
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
    db = wrap(sqlite3, new pool.OpfsSAHPoolDb(DATABASE))
    db.pragma('journal_mode = TRUNCATE')
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = ON')
    registerFunctions(db)
    migrate(db)
    repo = new ArchiveRepository(db)
    blobs = await OpfsBlobStore.open()
    index = new IndexLoop(db, (level, message) => {
      post({ type: 'log', level, message })
    })
    index.start()
    post({ type: 'opened', ok: true })
  } catch (error) {
    post({ type: 'opened', ok: false, busy: false, error: String(error) })
  }
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
    case 'request':
      handle(message.payload).then(
        (value) => {
          post({ type: 'reply', id: message.id, reply: { ok: true, value } satisfies Reply })
        },
        (error: unknown) => {
          post({ type: 'reply', id: message.id, reply: { ok: false, error: String(error) } })
        },
      )
      return
    case 'export':
      exportDatabase().then(
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
